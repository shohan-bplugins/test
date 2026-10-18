import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Await,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getAnalytics,
  getViewedTargets,
} from "~/lib/viewer-stats.server";
import {
  DEVICES,
  FEATURES,
  PLACEMENTS,
  isPlacement,
  type Placement,
} from "~/lib/viewer-stats";
import {
  fetchActiveSubscriptionCached,
  fetchProductsCountCached,
  getAssignedModelGidsCached,
} from "~/lib/billing.server";
import {
  EngagementChart,
  SERIES,
  type DayPoint,
} from "~/components/EngagementChart";
import { BackButton } from "~/components/BackButton";
import { useReviewPrompt } from "~/components/ReviewPrompt";
import { evaluateReviewPrompt } from "~/lib/review-prompt.server";
import { fieldValue } from "~/components/polaris/helpers";

/*
 * Storefront engagement with the 3D viewer: how often shoppers saw it, used
 * it, and opened it in AR — over a date range, optionally narrowed to one
 * viewer placement. Counts come from app/lib/viewer-stats.server.ts.
 *
 * Every filter lives in the URL, so a range is shareable and survives reload,
 * and changing one is an ordinary navigation that reruns this loader.
 *
 * LCP: the response waits on one Mongo read and nothing else. Product names
 * and thumbnails for the ranked table come from Shopify, so they are returned
 * as a promise and streamed in after the page has painted — that table sits
 * below the fold, and the numbers above it are the page.
 */

// "1" is Today — the default, so opening Analytics shows what is happening now.
const PRESETS = ["1", "7", "30", "90", "365"] as const;
const DEFAULT_RANGE = "1";
/** The one date range the Free plan gets. */
const FREE_RANGE = "7";

const RANGE_OPTIONS: [string, string][] = [
  ["1", "Today"],
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
  ["365", "Last 12 months"],
  ["lifetime", "Lifetime"],
  ["custom", "Custom range"],
];
const MAX_DAYS = 366;
const DAY_MS = 86_400_000;

const PLACEMENT_LABELS: Record<Placement | "all", string> = {
  all: "All",
  product: "Product page",
  page: "Page section",
  embed: "Embed link",
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const isDay = (v: string | null): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

function resolveRange(params: URLSearchParams) {
  const range = params.get("range") ?? DEFAULT_RANGE;
  const today = isoDay(new Date());
  if (
    range === "custom" &&
    isDay(params.get("from")) &&
    isDay(params.get("to"))
  ) {
    let from = params.get("from")!;
    let to = params.get("to")!;
    if (from > to) [from, to] = [to, from];
    if (to > today) to = today;
    const span = (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
    if (span > MAX_DAYS) {
      from = isoDay(new Date(Date.parse(to) - (MAX_DAYS - 1) * DAY_MS));
    }
    return { range: "custom", from, to };
  }
  const days = PRESETS.includes(range as (typeof PRESETS)[number])
    ? Number(range)
    : Number(DEFAULT_RANGE);
  const from = isoDay(new Date(Date.parse(today) - (days - 1) * DAY_MS));
  return { range: String(days), from, to: today };
}

/** The "Lifetime" choice in the date range picker. */
const LIFETIME = "lifetime";

/**
 * Lifetime runs from the first day this store recorded any viewer activity to
 * today. A store with nothing recorded yet gets today alone.
 */
async function resolveLifetime(shop: string) {
  const today = isoDay(new Date());
  const first = await prisma.viewerStat.findFirst({
    where: { shop },
    orderBy: { day: "asc" },
    select: { day: true },
  });
  const from = first?.day && first.day < today ? first.day : today;
  return { range: LIFETIME, from, to: today };
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY_MS) {
    out.push(isoDay(new Date(t)));
  }
  return out;
}

type Totals = { view: number; interact: number; ar: number };
const emptyTotals = (): Totals => ({ view: 0, interact: 0, ar: 0 });

type TopRow = Totals & { target: string; placement: string };
type TargetDetail = { name: string; image: string | null };

/** Names and thumbnails for the ranked rows — streamed, never awaited. */
/*
 * Small TTL caches for the two streamed sections. The page refreshes itself
 * every minute while open; without these, each refresh would ask Shopify for
 * the same product titles and re-read the model library. Names and library
 * size change rarely, and a few minutes' lag on either is harmless.
 */
const SIDE_TTL_MS = 5 * 60_000;
const SIDE_MAX = 1_000;
const sideCache = new Map<string, { at: number; value: Promise<unknown> }>();

function sideCached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = sideCache.get(key);
  if (hit && Date.now() - hit.at < SIDE_TTL_MS) return hit.value as Promise<T>;
  const value = load();
  sideCache.set(key, { at: Date.now(), value });
  // A failed load must not be served for five minutes.
  value.catch(() => sideCache.delete(key));
  if (sideCache.size > SIDE_MAX) {
    sideCache.delete(sideCache.keys().next().value!);
  }
  return value;
}

async function loadTargetDetails(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  shop: string,
  top: TopRow[],
): Promise<Record<string, TargetDetail>> {
  const productIds = top
    .filter((t) => t.target.startsWith("product:"))
    .map((t) => `gid://shopify/Product/${t.target.slice(8)}`);
  const modelIds = top
    .filter((t) => t.target.startsWith("model:"))
    .map((t) => t.target.slice(6));

  const [products, models] = await Promise.all([
    productIds.length
      ? admin
          .graphql(
            `#graphql
              query AnalyticsProducts($ids: [ID!]!) {
                nodes(ids: $ids) {
                  ... on Product {
                    id
                    title
                    featuredImage {
                      url(transform: { maxWidth: 80, maxHeight: 80 })
                    }
                  }
                }
              }`,
            { variables: { ids: productIds } },
          )
          .then((r) => r.json())
          .then((j) => (j?.data?.nodes ?? []).filter(Boolean))
          .catch(() => [])
      : [],
    modelIds.length
      ? prisma.model3D
          .findMany({
            where: { shop, id: { in: modelIds } },
            select: { id: true, name: true },
          })
          .catch(() => [])
      : [],
  ]);

  const out: Record<string, TargetDetail> = {};
  for (const p of products as {
    id: string;
    title: string;
    featuredImage?: { url?: string } | null;
  }[]) {
    out[`product:${p.id.split("/").pop()}`] = {
      name: p.title,
      image: p.featuredImage?.url ?? null,
    };
  }
  for (const m of models) out[`model:${m.id}`] = { name: m.name, image: null };
  return out;
}

type LibraryStats = {
  models: number;
  storageBytes: number;
  productsWithModel: number;
  totalProducts: number;
  unviewedCount: number;
  unviewed: string[];
};

/*
 * The store's 3D library and how much of the catalogue it covers, plus which
 * models nobody looked at in this range. Streamed: it reads Shopify (cached)
 * and its own unfiltered slice of the counters, and sits below the fold.
 */
async function loadLibraryStats(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  shop: string,
  from: string,
  to: string,
): Promise<LibraryStats> {
  const [models, totalProducts, assigned, viewedTargets] = await Promise.all([
    prisma.model3D.findMany({
      where: { shop },
      select: { id: true, name: true, fileGid: true, fileSize: true },
      orderBy: { createdAt: "desc" },
    }),
    fetchProductsCountCached(admin, shop).catch(() => 0),
    getAssignedModelGidsCached(admin, shop).catch(() => null),
    // Every placement, whatever the page filter: "never viewed" means never.
    getViewedTargets(shop, from, to),
  ]);

  const viewed = new Set(viewedTargets);
  const unviewed = models.filter((m) => {
    if (viewed.has(`model:${m.id}`)) return false;
    // A library model also counts as seen through any product it is on.
    const owners = assigned?.owners.get(m.fileGid) ?? [];
    return !owners.some((o) => viewed.has(`product:${o.id.split("/").pop()}`));
  });

  return {
    models: models.length,
    storageBytes: models.reduce((sum, m) => sum + (m.fileSize ?? 0), 0),
    productsWithModel: assigned?.count ?? 0,
    totalProducts,
    unviewedCount: unviewed.length,
    unviewed: unviewed.slice(0, 5).map((m) => m.name),
  };
}

type DeviceRow = { device: string } & Totals;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const params = new URL(request.url).searchParams;

  /*
   * Every metric is shown on every plan. The Free plan is limited in what it
   * can look at, not in what it sees: the last 7 days only, and all
   * placements together. Enforced here, so editing the URL changes nothing.
   * The plan comes from Shopify's live subscription (cached, see
   * shop-cache.server.ts), the same source the Pricing page trusts.
   */
  const [subscription, reviewPrompt] = await Promise.all([
    fetchActiveSubscriptionCached(admin, shop).catch(() => null),
    // The one-time "more than 5 lifetime views" review moment. Never throws.
    evaluateReviewPrompt(admin, shop, "views-milestone"),
  ]);
  const freePlan = subscription?.status !== "active";
  if (freePlan) {
    params.set("range", FREE_RANGE);
    params.delete("from");
    params.delete("to");
    params.delete("placement");
  }

  // Lifetime has no earlier period to compare with: the previous window is
  // made empty, so every change badge hides itself.
  const lifetime = params.get("range") === LIFETIME;
  const { range, from, to } = lifetime
    ? await resolveLifetime(shop)
    : resolveRange(params);
  const placementParam = params.get("placement");
  const placement: Placement | "all" = isPlacement(placementParam)
    ? placementParam
    : "all";

  // The period just before this one, the same length, for the change badges.
  const span = daysBetween(from, to).length;
  const prevTo = isoDay(new Date(Date.parse(from) - DAY_MS));
  const prevFrom = lifetime
    ? from
    : isoDay(new Date(Date.parse(from) - span * DAY_MS));

  // Summed by MongoDB in one aggregation, cached until this shop's next
  // write — see getAnalytics. Only summary rows reach this process.
  const stats = await getAnalytics(shop, { prevFrom, from, to, placement });

  const pick = (e: string): e is keyof Totals =>
    e === "view" || e === "interact" || e === "ar";

  const byDay = new Map<string, Totals>(
    daysBetween(from, to).map((d) => [d, emptyTotals()]),
  );
  for (const r of stats.daily) {
    if (pick(r.event)) byDay.get(r.day)![r.event] += r.count;
  }

  const cur = stats.current;
  const prev = stats.previous;
  const totals: Totals = {
    view: cur.view ?? 0,
    interact: cur.interact ?? 0,
    ar: cur.ar ?? 0,
  };
  const previous: Totals = {
    view: prev.view ?? 0,
    interact: prev.interact ?? 0,
    ar: prev.ar ?? 0,
  };

  const byPlacement = new Map<string, Totals>();
  for (const r of stats.byPlacement) {
    if (!pick(r.event)) continue;
    const p = byPlacement.get(r.placement) ?? emptyTotals();
    p[r.event] += r.count;
    byPlacement.set(r.placement, p);
  }
  // Add-to-cart is only measured on product pages, so its rates are taken
  // against product-page views and interactions, not every placement's.
  const productPage = byPlacement.get("product") ?? emptyTotals();

  const byDevice = new Map<string, Totals>();
  for (const r of stats.byDevice) {
    if (!pick(r.event)) continue;
    const d = byDevice.get(r.device) ?? emptyTotals();
    d[r.event] += r.count;
    byDevice.set(r.device, d);
  }

  const avg = (b: Record<string, number>) =>
    (b.dwell_n ?? 0) > 0 ? Math.round((b.dwell_s ?? 0) / b.dwell_n) : null;

  const devices: DeviceRow[] = [...DEVICES, "unknown"]
    .map((device) => ({ device, ...(byDevice.get(device) ?? emptyTotals()) }))
    // "unknown" only when there is something in it (older rows, odd devices).
    .filter((d) => d.device !== "unknown" || d.view + d.interact + d.ar > 0);

  const top: TopRow[] = stats.top;

  return {
    reviewPrompt,
    lifetime,
    freePlan,
    range,
    from,
    to,
    prevFrom,
    prevTo,
    placement,
    totals,
    previous,
    series: [...byDay].map(([day, v]) => ({ day, ...v })) as DayPoint[],
    // The PRO sections below are sent empty on Free: their cards show sample
    // previews, never the store's own numbers.
    top: freePlan ? [] : top,
    placements: freePlan
      ? []
      : PLACEMENTS.map((p) => ({
          placement: p,
          ...(byPlacement.get(p) ?? emptyTotals()),
        })),
    // Not awaited: streamed in after first paint (see the note at the top).
    details: freePlan
      ? Promise.resolve({} as Record<string, TargetDetail>)
      : sideCached(
          JSON.stringify(["details", shop, top.map((t) => t.target).sort()]),
          () => loadTargetDetails(admin, shop, top),
        ),
    cart: freePlan
      ? { after3d: 0, without3d: 0, productViews: 0, productInteract: 0 }
      : {
          after3d: cur.cart_3d ?? 0,
          without3d: cur.cart_no3d ?? 0,
          productViews: productPage.view,
          productInteract: productPage.interact,
        },
    dwell: { avg: avg(cur), prevAvg: avg(prev), viewers: cur.dwell_n ?? 0 },
    features: freePlan
      ? []
      : FEATURES.map((f) => ({ key: f, count: cur[f] ?? 0 })),
    devices: freePlan ? [] : devices,
    library: freePlan
      ? Promise.resolve(null)
      : sideCached(JSON.stringify(["library", shop, from, to]), () =>
          loadLibraryStats(admin, shop, from, to),
        ),
  };
};

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
const fmtPct = (v: number | null) => (v === null ? "—" : `${v}%`);

const fmtDuration = (secs: number | null) => {
  if (secs === null) return "—";
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  return `${m}m ${String(secs % 60).padStart(2, "0")}s`;
};

const fmtBytes = (bytes: number) => {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
};

const DEVICE_LABELS: Record<string, string> = {
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mobile",
  unknown: "Other",
};

const FEATURE_LABELS: Record<string, string> = {
  f_zoom: "Zoom buttons",
  f_fullscreen: "Fullscreen",
  f_screenshot: "Screenshot",
  f_animation: "Animation picker",
  f_hotspot: "Hotspots opened",
};

/** Product-page views below this give add-to-cart rates too noisy to trust. */
const CART_MIN_VIEWS = 30;

const fmtRangeDay = (day: string, withYear: boolean) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
const fmtRange = (from: string, to: string) =>
  from === to
    ? fmtRangeDay(to, true)
    : `${fmtRangeDay(from, from.slice(0, 4) !== to.slice(0, 4))} – ${fmtRangeDay(to, true)}`;

type Badge = { label: string; tone: "success" | "critical" | "neutral" };

/** Change against the previous period, or null with nothing to compare. */
function change(now: number, before: number): Badge | null {
  if (before === 0) return null;
  const v = Math.round(((now - before) / before) * 100);
  return {
    label: `${v > 0 ? "↑ " : v < 0 ? "↓ " : ""}${Math.abs(v)}%`,
    tone: v > 0 ? "success" : v < 0 ? "critical" : "neutral",
  };
}

function KpiTile({
  icon,
  label,
  value,
  badge,
  sub,
}: {
  icon: string;
  label: string;
  value: string;
  badge?: Badge | null;
  sub: string;
}) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderStyle="solid"
      borderColor="base"
      borderRadius="base"
      blockSize="100%"
    >
      <s-stack direction="block" gap="small">
        <s-stack direction="inline" gap="small-500" alignItems="center">
          <s-icon type={icon as never} color="subdued" />
          <s-text color="subdued">{label}</s-text>
        </s-stack>
        <s-stack
          direction="inline"
          gap="small"
          alignItems="center"
          justifyContent="space-between"
          inlineSize="100%"
        >
          <span className="an-value">{value}</span>
          {badge ? <s-badge tone={badge.tone}>{badge.label}</s-badge> : null}
        </s-stack>
        {/* A plain span: s-text has no size, and this line is secondary to
            the number above it. */}
        <span className="an-sub">{sub}</span>
      </s-stack>
    </s-box>
  );
}

/** One labelled horizontal bar: a share of a whole, with its number. */
function ShareBar({
  label,
  value,
  of,
  detail,
}: {
  label: string;
  value: number;
  of: number;
  detail: string;
}) {
  const width = of > 0 ? Math.max(value > 0 ? 2 : 0, (value / of) * 100) : 0;
  return (
    <div>
      <div className="an-bar-head">
        <s-text>{label}</s-text>
        <s-text color="subdued">{detail}</s-text>
      </div>
      <div className="an-bar-track" aria-hidden="true">
        <div className="an-bar-fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

/**
 * Two cards side by side, kept the same height.
 *
 * s-section draws its card inside its own shadow DOM, so stretching the
 * element (grid/flex, height: 100%) leaves the visible card at its content
 * height — the two cards came out different heights. Instead this measures
 * each card's content and gives every pane the tallest one's height as a
 * min-height. Only while the cards are actually side by side: when they stack
 * on a narrow screen each keeps its natural height. A ResizeObserver re-fits
 * on any change in size (window, fonts, data).
 */
function EqualRow({ children }: { children: ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const fit = () => {
      const panes = Array.from(
        row.querySelectorAll<HTMLElement>("[data-eq-pane]"),
      );
      for (const p of panes) p.style.minHeight = "";
      if (panes.length < 2) return;
      // The cards' own tops, not the panes': a heading that wraps would put
      // one pane lower even when the cards are side by side.
      const tops = panes.map(
        (p) => (p.closest("s-section") ?? p).getBoundingClientRect().top,
      );
      const sideBySide = tops.every((t) => Math.abs(t - tops[0]) < 2);
      if (!sideBySide) return;
      const tallest = Math.max(
        ...panes.map((p) => p.getBoundingClientRect().height),
      );
      for (const p of panes) p.style.minHeight = `${tallest}px`;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    return () => observer.disconnect();
  });
  return (
    <div ref={rowRef} className="an-two-col">
      {children}
    </div>
  );
}

/** A product or model name with its thumbnail, or a placeholder while loading. */
function TargetCell({
  detail,
  isProduct,
}: {
  detail: TargetDetail | null | undefined;
  isProduct: boolean;
}) {
  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      {detail?.image ? (
        <s-thumbnail src={detail.image} alt="" size="small-200" />
      ) : (
        <span className="an-thumb" aria-hidden="true">
          <s-icon
            type={isProduct ? "product" : "three-d-environment"}
            color="subdued"
          />
        </span>
      )}
      {detail === null ? (
        <span className="an-skeleton" role="status" aria-label="Loading" />
      ) : (
        <s-text>
          {detail?.name ?? (isProduct ? "Deleted product" : "Deleted model")}
        </s-text>
      )}
    </s-stack>
  );
}

function CartImpact({
  cart,
  applies,
  onShowProduct,
}: {
  cart: {
    after3d: number;
    without3d: number;
    productViews: number;
    productInteract: number;
  };
  applies: boolean;
  onShowProduct: () => void;
}) {
  if (!applies) {
    return (
      <s-stack direction="block" gap="small">
        <s-paragraph>
          <s-text color="subdued">
            Add to cart is measured on product pages only.
          </s-text>
        </s-paragraph>
        <s-button variant="secondary" onClick={onShowProduct}>
          Show product pages
        </s-button>
      </s-stack>
    );
  }
  const with3d = pct(cart.after3d, cart.productInteract);
  const without = pct(
    cart.without3d,
    Math.max(0, cart.productViews - cart.productInteract),
  );
  const lift =
    with3d !== null && without !== null && without > 0
      ? Math.round((with3d / without) * 10) / 10
      : null;
  const of = Math.max(with3d ?? 0, without ?? 0);
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="inline" gap="small" alignItems="center">
        <span className="an-value">{fmt(cart.after3d)}</span>
        {lift !== null && lift > 1 ? (
          <s-badge tone="success">{`${lift}× more likely`}</s-badge>
        ) : null}
      </s-stack>
      <s-text color="subdued">
        Add-to-carts by shoppers who interacted with the 3D model first
      </s-text>
      <ShareBar
        label="Interacted with 3D"
        value={with3d ?? 0}
        of={of}
        detail={`${fmtPct(with3d)} added to cart`}
      />
      <ShareBar
        label="Saw 3D, didn’t interact"
        value={without ?? 0}
        of={of}
        detail={`${fmtPct(without)} added to cart`}
      />
      {cart.productViews < CART_MIN_VIEWS ? (
        <s-text color="subdued">
          Rates settle after a few dozen product-page views.
        </s-text>
      ) : null}
    </s-stack>
  );
}

function LibrarySkeleton() {
  return (
    <s-stack direction="block" gap="base">
      {[0, 1, 2].map((i) => (
        <span key={i} className="an-skeleton" style={{ width: "100%" }} />
      ))}
    </s-stack>
  );
}

function LibraryCard({ lib }: { lib: LibraryStats }) {
  return (
    <s-stack direction="block" gap="base">
      <ShareBar
        label="Products with a 3D model"
        value={lib.productsWithModel}
        of={lib.totalProducts}
        detail={`${fmt(lib.productsWithModel)} of ${fmt(lib.totalProducts)} · ${fmtPct(pct(lib.productsWithModel, lib.totalProducts))}`}
      />
      <div className="an-stat-rows">
        <div>
          <s-text color="subdued">Models in library</s-text>
          <s-text>{fmt(lib.models)}</s-text>
        </div>
        <div>
          <s-text color="subdued">Storage used</s-text>
          <s-text>{fmtBytes(lib.storageBytes)}</s-text>
        </div>
        <div>
          <s-text color="subdued">Not viewed in this range</s-text>
          <s-text>{fmt(lib.unviewedCount)}</s-text>
        </div>
      </div>
      {lib.unviewed.length ? (
        <s-text color="subdued">
          {lib.unviewed.join(", ")}
          {lib.unviewedCount > lib.unviewed.length
            ? ` and ${fmt(lib.unviewedCount - lib.unviewed.length)} more`
            : ""}
        </s-text>
      ) : null}
      <s-button variant="secondary" href="/app/models">
        Open 3D Model Library
      </s-button>
    </s-stack>
  );
}

/*
 * Keeping the numbers current without a page reload.
 *
 * React Router's revalidate() re-runs the loaders and swaps the data in place —
 * filters, scroll position and open sections all stay put, and nothing dims.
 * It runs:
 *   - every minute while the tab is visible, never while it is hidden, so a
 *     forgotten tab costs nothing;
 *   - on returning to the tab, if the data is more than 15 seconds old;
 *   - on the Refresh button.
 * Each run is one cached aggregation on the server (see getAnalytics), which
 * costs no database work at all unless new counts have landed since.
 */
const AUTO_REFRESH_MS = 60_000;
const STALE_ON_FOCUS_MS = 15_000;

function useLiveRefresh(dataKey: unknown) {
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  const [, tick] = useState(0);

  // New loader data, however it arrived, is "just updated".
  useEffect(() => {
    setUpdatedAt(Date.now());
  }, [dataKey]);

  const busyRef = useRef(false);
  busyRef.current = revalidator.state !== "idle" || navigation.state !== "idle";
  const updatedRef = useRef(updatedAt);
  updatedRef.current = updatedAt;
  const revalidateRef = useRef(revalidator.revalidate);
  revalidateRef.current = revalidator.revalidate;

  useEffect(() => {
    const refresh = () => {
      if (busyRef.current || document.visibilityState !== "visible") return;
      void revalidateRef.current();
    };
    const timer = window.setInterval(refresh, AUTO_REFRESH_MS);
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - updatedRef.current > STALE_ON_FOCUS_MS
      ) {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    // Re-renders the "Updated … ago" label; nothing is fetched.
    const clock = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return {
    refreshing: revalidator.state === "loading",
    refresh: () => {
      if (!busyRef.current) void revalidator.revalidate();
    },
    updatedAt,
  };
}

function updatedLabel(at: number) {
  const secs = Math.round((Date.now() - at) / 1000);
  if (secs < 45) return "Updated just now";
  const mins = Math.round(secs / 60);
  return mins < 60 ? `Updated ${mins} min ago` : "Updated over an hour ago";
}

/** The paid-plan marker on Free: a small "PRO" pill. */
function ProTag() {
  return <span className="an-pro">PRO</span>;
}

/**
 * A paid-only card on the Free plan: the real heading and layout, a blurred
 * preview built from fixed sample numbers (never the store's own — the loader
 * sends none for these sections), and an upgrade button over it.
 */
function ProCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <div className="an-pro-head">
          <s-heading>{title}</s-heading>
          <ProTag />
        </div>
        <div className="an-pro-body" data-eq-pane>
          <div className="an-pro-preview" aria-hidden="true">
            {children}
          </div>
          <div className="an-pro-overlay">
            <s-button variant="primary" icon="lock" href="/app/pricing">
              Upgrade to unlock
            </s-button>
          </div>
        </div>
      </s-stack>
    </s-section>
  );
}

/** Fixed sample figures for the blurred previews — illustrative only. */
const SAMPLE = {
  journey: [
    ["Saw the 3D model", 100, "1,240"],
    ["Interacted with it", 42, "521 · 42%"],
    ["Opened it in AR", 9, "112 · 9%"],
  ],
  placement: [
    ["Product page", 100, "860 views · 44% engaged"],
    ["Page section", 34, "290 views · 37% engaged"],
    ["Embed link", 11, "90 views · 31% engaged"],
  ],
  devices: [
    ["Desktop", 100, "640 views · 46% engaged · 18 AR"],
    ["Mobile", 82, "520 views · 39% engaged · 88 AR"],
    ["Tablet", 13, "80 views · 41% engaged · 6 AR"],
  ],
  controls: [
    ["Zoom buttons", 31, "385 · 31% of views"],
    ["Fullscreen", 14, "174 · 14% of views"],
    ["Screenshot", 4, "50 · 4% of views"],
    ["Animation picker", 9, "112 · 9% of views"],
    ["Hotspots opened", 22, "273 · 22% of views"],
  ],
  cart: [
    ["Interacted with 3D", 100, "11.8% added to cart"],
    ["Saw 3D, didn’t interact", 45, "5.3% added to cart"],
  ],
  library: [["Products with a 3D model", 36, "18 of 50 · 36%"]],
} as const;

function SampleBars({
  rows,
}: {
  rows: readonly (readonly [string, number, string])[];
}) {
  return (
    <s-stack direction="block" gap="base">
      {rows.map(([label, value, detail]) => (
        <ShareBar
          key={label}
          label={label}
          value={value}
          of={100}
          detail={detail}
        />
      ))}
    </s-stack>
  );
}

/**
 * The Free plan's sections below the headline numbers: the real engagement
 * chart, then every PRO section as a locked card with a blurred sample preview.
 * The loader sends no data for the locked sections.
 */
function FreeSections({ series }: { series: DayPoint[] }) {
  return (
    <>
      <s-section heading="Engagement over time">
        <EngagementChart data={series} />
      </s-section>

      <EqualRow>
        <ProCard title="Shopper journey">
          <SampleBars rows={SAMPLE.journey} />
        </ProCard>
        <ProCard title="Views by placement">
          <SampleBars rows={SAMPLE.placement} />
        </ProCard>
      </EqualRow>

      <EqualRow>
        <ProCard title="Add to cart after 3D">
          <s-stack direction="block" gap="base">
            <span className="an-value">146</span>
            <SampleBars rows={SAMPLE.cart} />
          </s-stack>
        </ProCard>
        <ProCard title="Devices">
          <SampleBars rows={SAMPLE.devices} />
        </ProCard>
      </EqualRow>

      <EqualRow>
        <ProCard title="Controls shoppers use">
          <SampleBars rows={SAMPLE.controls} />
        </ProCard>
        <ProCard title="Library and coverage">
          <s-stack direction="block" gap="base">
            <SampleBars rows={SAMPLE.library} />
            <div className="an-stat-rows">
              <div>
                <span>Models in library</span>
                <span>24</span>
              </div>
              <div>
                <span>Storage used</span>
                <span>312.4 MB</span>
              </div>
              <div>
                <span>Not viewed in this range</span>
                <span>5</span>
              </div>
            </div>
          </s-stack>
        </ProCard>
      </EqualRow>

      <ProCard title="Top products and models">
        <div className="an-sample-table">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="an-sample-row">
              <span className="an-thumb" />
              <span>{`Sample product ${i}`}</span>
              <span>{`${(6 - i) * 180} views`}</span>
              <span>{`${44 - i * 3}%`}</span>
            </div>
          ))}
        </div>
      </ProCard>

      <ProCard title="Daily numbers">
        <div className="an-sample-table">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="an-sample-row">
              <span />
              <span>{`Day ${i}`}</span>
              <span>{`${(6 - i) * 40} views`}</span>
              <span>{`${(6 - i) * 15} interactions`}</span>
            </div>
          ))}
        </div>
      </ProCard>
    </>
  );
}

export default function Analytics() {
  const data = useLoaderData<typeof loader>();
  useReviewPrompt(data.reviewPrompt);
  const live = useLiveRefresh(data);
  const [params, setParams] = useSearchParams();
  const navigation = useNavigation();
  const loading =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/app/analytics";

  const setFilter = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { preventScrollReset: true });
  };

  const toolbar = (
    <>
      {/*
          Toolbar, laid out like Shopify's own Analytics: what to look at on
          the left (date range first — every number depends on it — then
          placement), the data's freshness on the right. The summary under
          the picker names the exact dates and the comparison period.
        */}
      <s-section>
        <s-stack direction="block" gap="small">
          <div className="an-toolbar">
            <div className="an-toolbar-left">
              <div className="an-range">
                <div className="an-range-select">
                  <s-select
                    label="Date range"
                    labelAccessibilityVisibility="exclusive"
                    value={data.range}
                    onInput={(e) => {
                      const v = fieldValue(e);
                      setFilter(
                        v === "custom"
                          ? { range: "custom", from: data.from, to: data.to }
                          : { range: v, from: null, to: null },
                      );
                    }}
                  >
                    {RANGE_OPTIONS.map(([value, label]) => {
                      const locked = data.freePlan && value !== FREE_RANGE;
                      return (
                        <s-option
                          key={value}
                          value={value}
                          disabled={locked || undefined}
                        >
                          {locked ? `${label} · PRO` : label}
                        </s-option>
                      );
                    })}
                  </s-select>
                </div>
              </div>

              {/* Filtering by placement is paid; Free sees All only. */}
              <div
                className="an-segmented"
                role="group"
                aria-label="Viewer placement"
              >
                {(["all", ...PLACEMENTS] as const).map((p) => {
                  const locked = data.freePlan && p !== "all";
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={data.placement === p}
                      disabled={locked}
                      title={
                        locked ? "Upgrade to filter by placement" : undefined
                      }
                      onClick={() =>
                        setFilter({ placement: p === "all" ? null : p })
                      }
                    >
                      {PLACEMENT_LABELS[p]}
                      {locked ? (
                        <>
                          {" "}
                          <ProTag />
                        </>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="an-toolbar-right">
              <span
                className="an-live"
                data-busy={live.refreshing ? "" : undefined}
                aria-live="polite"
              >
                <span className="an-live-dot" aria-hidden="true" />
                {live.refreshing ? "Updating…" : updatedLabel(live.updatedAt)}
              </span>
              <s-button
                variant="secondary"
                icon="refresh"
                accessibilityLabel="Refresh analytics"
                loading={live.refreshing || undefined}
                onClick={live.refresh}
              >
                Refresh
              </s-button>
            </div>
          </div>

          {/*
            Custom range: From / To on their own row under the toolbar, each
            with room for a full date. Squeezed into the toolbar row beside the
            picker and the placement buttons, the two fields overlapped each
            other and the buttons.
          */}
          {data.range === "custom" ? (
            <div className="an-custom-row">
              <div className="an-custom-field">
                <span className="an-custom-label">From</span>
                <s-date-field
                  label="From"
                  labelAccessibilityVisibility="exclusive"
                  value={data.from}
                  onChange={(e) => {
                    const v = fieldValue(e);
                    if (v) setFilter({ range: "custom", from: v, to: data.to });
                  }}
                />
              </div>
              <span className="an-range-sep" aria-hidden="true">
                –
              </span>
              <div className="an-custom-field">
                <span className="an-custom-label">To</span>
                <s-date-field
                  label="To"
                  labelAccessibilityVisibility="exclusive"
                  value={data.to}
                  onChange={(e) => {
                    const v = fieldValue(e);
                    if (v)
                      setFilter({ range: "custom", from: data.from, to: v });
                  }}
                />
              </div>
            </div>
          ) : null}

          <s-stack direction="inline" gap="small-300" alignItems="center">
            <s-icon type="calendar" color="subdued" />
            <span className="an-sub">
              {data.lifetime
                ? `${fmtRange(data.from, data.to)} · all time, no comparison`
                : `${fmtRange(data.from, data.to)} · compared with ${fmtRange(data.prevFrom, data.prevTo)}`}
            </span>
          </s-stack>
        </s-stack>
      </s-section>
    </>
  );

  const page = (body: ReactNode) => (
    <s-page heading="Analytics">
      <style>{PAGE_CSS}</style>
      <BackButton to="/app" label="Dashboard" />

      {/*
        One column, one gap. Every block on the page — filters, tiles, chart,
        side-by-side cards, tables — is a direct child of .an-stack or
        .an-body, both of which space their children by --an-gap and nothing
        else, so no two sections can drift to different distances apart.
      */}
      <div className="an-stack">
        {toolbar}
        {body}
      </div>
    </s-page>
  );

  const { totals, previous } = data;
  const hasData = totals.view + totals.interact + totals.ar > 0;
  const engagement = pct(totals.interact, totals.view);
  const prevEngagement = pct(previous.interact, previous.view);
  const compared = data.lifetime
    ? "All time"
    : `vs ${fmtRange(data.prevFrom, data.prevTo)}`;
  const maxPlacementViews = Math.max(0, ...data.placements.map((p) => p.view));
  const topMaxViews = Math.max(0, ...data.top.map((t) => t.view));

  return page(
    <div className={loading ? "an-body an-loading" : "an-body"}>
      {data.freePlan ? (
        <s-banner tone="info" heading="You’re on the Free plan">
          <s-paragraph>
            Free shows every metric for the last 7 days, across all placements.
            Upgrade for longer date ranges and to filter by product page, page
            section or embed.
          </s-paragraph>
          <s-button slot="secondary-actions" href="/app/pricing">
            View plans
          </s-button>
        </s-banner>
      ) : null}
      {/* Headline numbers — the page's LCP, rendered from the loader alone. */}
      <div className="an-kpis">
        <KpiTile
          icon="view"
          label="3D views"
          value={fmt(totals.view)}
          badge={change(totals.view, previous.view)}
          sub={compared}
        />
        <KpiTile
          icon="cursor"
          label="Interactions"
          value={fmt(totals.interact)}
          badge={change(totals.interact, previous.interact)}
          sub="Rotated, zoomed or dragged"
        />
        <KpiTile
          icon="mobile"
          label="AR Click"
          value={fmt(totals.ar)}
          badge={change(totals.ar, previous.ar)}
          sub="Opened “View in your room”"
        />
        <KpiTile
          icon="target"
          label="Engagement rate"
          value={fmtPct(engagement)}
          badge={
            engagement !== null && prevEngagement !== null
              ? change(engagement, prevEngagement)
              : null
          }
          sub="Views with an interaction"
        />
        <KpiTile
          icon="clock"
          label="Avg. time with 3D"
          value={fmtDuration(data.dwell.avg)}
          badge={
            data.dwell.avg !== null && data.dwell.prevAvg !== null
              ? change(data.dwell.avg, data.dwell.prevAvg)
              : null
          }
          sub="Model on screen"
        />
      </div>

      {hasData && data.freePlan ? (
        <FreeSections series={data.series} />
      ) : hasData ? (
        <>
          <s-section heading="Engagement over time">
            <EngagementChart data={data.series} />
          </s-section>

          <EqualRow>
            <s-section heading="Shopper journey">
              <div data-eq-pane>
                <s-stack direction="block" gap="base">
                  <ShareBar
                    label="Saw the 3D model"
                    value={totals.view}
                    of={totals.view}
                    detail={fmt(totals.view)}
                  />
                  <ShareBar
                    label="Interacted with it"
                    value={totals.interact}
                    of={totals.view}
                    detail={`${fmt(totals.interact)} · ${fmtPct(pct(totals.interact, totals.view))}`}
                  />
                  <ShareBar
                    label="Opened it in AR"
                    value={totals.ar}
                    of={totals.view}
                    detail={`${fmt(totals.ar)} · ${fmtPct(pct(totals.ar, totals.view))}`}
                  />
                </s-stack>
              </div>
            </s-section>

            {data.placement === "all" ? (
              <s-section heading="Views by placement">
                <div data-eq-pane>
                  <s-stack direction="block" gap="base">
                    {data.placements.map((p) => (
                      <ShareBar
                        key={p.placement}
                        label={PLACEMENT_LABELS[p.placement]}
                        value={p.view}
                        of={maxPlacementViews}
                        detail={`${fmt(p.view)} views · ${fmtPct(pct(p.interact, p.view))} engaged`}
                      />
                    ))}
                  </s-stack>
                </div>
              </s-section>
            ) : (
              <s-section heading={PLACEMENT_LABELS[data.placement]}>
                <div data-eq-pane>
                  <s-stack direction="block" gap="small">
                    <s-paragraph>
                      Showing only the{" "}
                      {PLACEMENT_LABELS[data.placement].toLowerCase()} viewer.
                    </s-paragraph>
                    <s-button
                      variant="secondary"
                      onClick={() => setFilter({ placement: null })}
                    >
                      Compare all placements
                    </s-button>
                  </s-stack>
                </div>
              </s-section>
            )}
          </EqualRow>

          {/* Does 3D sell? / Who is looking. */}
          <EqualRow>
            <s-section heading="Add to cart after 3D">
              <div data-eq-pane>
                <CartImpact
                  cart={data.cart}
                  applies={
                    data.placement === "all" || data.placement === "product"
                  }
                  onShowProduct={() => setFilter({ placement: "product" })}
                />
              </div>
            </s-section>

            <s-section heading="Devices">
              <div data-eq-pane>
                <s-stack direction="block" gap="base">
                  {data.devices.map((d) => (
                    <ShareBar
                      key={d.device}
                      label={DEVICE_LABELS[d.device] ?? d.device}
                      value={d.view}
                      of={Math.max(0, ...data.devices.map((x) => x.view))}
                      detail={`${fmt(d.view)} views · ${fmtPct(pct(d.interact, d.view))} engaged · ${fmt(d.ar)} AR`}
                    />
                  ))}
                </s-stack>
              </div>
            </s-section>
          </EqualRow>

          {/* What shoppers do with it / what the store has. */}
          <EqualRow>
            <s-section heading="Controls shoppers use">
              <div data-eq-pane>
                <s-stack direction="block" gap="base">
                  {data.features.map((f) => (
                    <ShareBar
                      key={f.key}
                      label={FEATURE_LABELS[f.key] ?? f.key}
                      value={f.count}
                      of={totals.view}
                      detail={`${fmt(f.count)} · ${fmtPct(pct(f.count, totals.view))} of views`}
                    />
                  ))}
                </s-stack>
              </div>
            </s-section>

            <s-section heading="Library and coverage">
              <div data-eq-pane>
                <Suspense fallback={<LibrarySkeleton />}>
                  <Await
                    resolve={data.library}
                    errorElement={
                      <s-paragraph>
                        <s-text color="subdued">
                          Couldn’t load library stats. Refresh to try again.
                        </s-text>
                      </s-paragraph>
                    }
                  >
                    {(lib) => (lib ? <LibraryCard lib={lib} /> : null)}
                  </Await>
                </Suspense>
              </div>
            </s-section>
          </EqualRow>

          <s-section heading="Top products and models">
            {data.top.length ? (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Item</s-table-header>
                  <s-table-header>Placement</s-table-header>
                  <s-table-header format="numeric">Views</s-table-header>
                  <s-table-header format="numeric">Interactions</s-table-header>
                  <s-table-header format="numeric">AR</s-table-header>
                  <s-table-header format="numeric">Engagement</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {data.top.map((t) => {
                    const isProduct = t.target.startsWith("product:");
                    return (
                      <s-table-row key={`${t.placement}|${t.target}`}>
                        <s-table-cell>
                          <Suspense
                            fallback={
                              <TargetCell detail={null} isProduct={isProduct} />
                            }
                          >
                            <Await
                              resolve={data.details}
                              errorElement={
                                <TargetCell
                                  detail={undefined}
                                  isProduct={isProduct}
                                />
                              }
                            >
                              {(details) => (
                                <TargetCell
                                  detail={details[t.target]}
                                  isProduct={isProduct}
                                />
                              )}
                            </Await>
                          </Suspense>
                        </s-table-cell>
                        <s-table-cell>
                          <s-badge>
                            {PLACEMENT_LABELS[t.placement as Placement] ??
                              t.placement}
                          </s-badge>
                        </s-table-cell>
                        <s-table-cell>
                          <span className="an-cell-bar">
                            <span
                              className="an-mini-bar"
                              style={{
                                width: `${topMaxViews > 0 ? Math.max(2, (t.view / topMaxViews) * 48) : 0}px`,
                              }}
                              aria-hidden="true"
                            />
                            {fmt(t.view)}
                          </span>
                        </s-table-cell>
                        <s-table-cell>{fmt(t.interact)}</s-table-cell>
                        <s-table-cell>{fmt(t.ar)}</s-table-cell>
                        <s-table-cell>
                          {fmtPct(pct(t.interact, t.view))}
                        </s-table-cell>
                      </s-table-row>
                    );
                  })}
                </s-table-body>
              </s-table>
            ) : (
              <s-paragraph>
                <s-text color="subdued">
                  Views from viewers set up with a pasted file URL can’t be tied
                  to a product or model, so they count toward the totals only.
                </s-text>
              </s-paragraph>
            )}
          </s-section>

          {/* The chart's numbers as a table — for screen readers and for
                anyone who wants exact values without hovering. */}
          <s-section heading="Daily numbers">
            <details className="an-details">
              <summary>Show the table</summary>
              <div style={{ marginTop: 12 }}>
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Day</s-table-header>
                    {SERIES.map((s) => (
                      <s-table-header key={s.key} format="numeric">
                        {s.label}
                      </s-table-header>
                    ))}
                  </s-table-header-row>
                  <s-table-body>
                    {[...data.series].reverse().map((d) => (
                      <s-table-row key={d.day}>
                        <s-table-cell>{fmtRangeDay(d.day, true)}</s-table-cell>
                        <s-table-cell>{fmt(d.view)}</s-table-cell>
                        <s-table-cell>{fmt(d.interact)}</s-table-cell>
                        <s-table-cell>{fmt(d.ar)}</s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              </div>
            </details>
          </s-section>
        </>
      ) : (
        <s-section>
          <div className="an-empty">
            <span className="an-empty-icon" aria-hidden="true">
              <s-icon type="chart-line" color="subdued" />
            </span>
            <s-heading>No shopper activity in this range yet</s-heading>
            <s-paragraph>
              Numbers appear here as shoppers view your 3D models. Make sure the
              3D Viewer block is on your live theme — visits from the theme
              editor are never counted.
            </s-paragraph>
            <s-stack direction="inline" gap="small" justifyContent="center">
              <s-button
                variant="primary"
                href="shopify://admin/themes/current/editor?template=product"
                target="_top"
              >
                Open theme editor
              </s-button>
              {data.range !== "90" && !data.lifetime && !data.freePlan ? (
                <s-button
                  onClick={() =>
                    setFilter({ range: "90", from: null, to: null })
                  }
                >
                  Try the last 90 days
                </s-button>
              ) : null}
            </s-stack>
          </div>
        </s-section>
      )}
    </div>,
  );
}

const PAGE_CSS = `
.an-toolbar {
  display: flex; flex-wrap: wrap; align-items: center;
  justify-content: space-between; gap: 12px 16px;
}
.an-toolbar-left { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; min-width: 0; }
/* margin-left: auto keeps it on the right even when it wraps to its own line. */
.an-toolbar-right { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.an-range { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
.an-range-select { width: 180px; max-width: 100%; }
.an-custom-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.an-custom-field { display: flex; align-items: center; gap: 8px; flex: 0 1 260px; min-width: 0; }
.an-custom-field s-date-field { flex: 1; min-width: 0; }
.an-custom-label { font-size: 13px; color: #616161; min-width: 34px; }
.an-range-sep { color: #616161; }
@media (max-width: 520px) {
  .an-range-select { width: 100%; }
  .an-custom-field { flex-basis: 100%; }
  .an-range-sep { display: none; }
}
.an-segmented {
  display: inline-flex; flex-wrap: wrap; padding: 3px; gap: 2px;
  border-radius: 10px; background: #f1f1f1;
}
.an-segmented button {
  font: inherit; font-size: 13px; font-weight: 500; color: #616161;
  background: transparent; border: 0; border-radius: 8px;
  padding: 6px 12px; cursor: pointer; min-height: 32px;
}
.an-segmented button:hover { color: #303030; }
.an-segmented button[aria-pressed="true"] {
  background: #ffffff; color: #303030;
  box-shadow: 0 1px 2px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06);
}
.an-segmented button:focus-visible { outline: 2px solid #2a78d6; outline-offset: 1px; }
.an-segmented button:disabled { cursor: not-allowed; opacity: .6; }
.an-segmented button:disabled:hover { color: inherit; }
/* The page's one spacing value, used for every gap between blocks. */
.an-stack, .an-body { --an-gap: 16px; display: flex; flex-direction: column; gap: var(--an-gap); }
.an-body { transition: opacity 120ms; }
.an-loading { opacity: 0.55; pointer-events: none; }
.an-kpis {
  display: grid; gap: var(--an-gap);
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
}
/*
 * Laptop and up: every tile on one line, as many equal columns as there are
 * tiles (five). Column flow rather
 * than a fixed count, so the number of tiles can change without touching this.
 * 900px is the app frame's width, not the window's — the admin's sidebar
 * already takes its share on a laptop.
 */
@media (min-width: 900px) {
  .an-kpis {
    grid-template-columns: none;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
  }
}
.an-value {
  font-size: 1.25rem; font-weight: 650; line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.an-two-col { display: grid; gap: var(--an-gap); grid-template-columns: 1fr; align-items: stretch; }
.an-two-col > s-section { display: block; }
@media (min-width: 768px) { .an-two-col { grid-template-columns: 1fr 1fr; } }
.an-bar-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
.an-bar-track { height: 6px; border-radius: 3px; background: #f1f1f1; overflow: hidden; }
.an-bar-fill { height: 100%; border-radius: 3px; background: #2a78d6; transition: width 300ms ease; }
.an-cell-bar { display: inline-flex; align-items: center; gap: 8px; }
.an-mini-bar { display: inline-block; height: 6px; border-radius: 3px; background: #2a78d6; }
.an-thumb {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 6px; background: #f1f1f1; flex: none;
}
.an-skeleton {
  display: inline-block; width: 140px; height: 12px; border-radius: 6px;
  background: linear-gradient(90deg, #ececec 25%, #f6f6f6 50%, #ececec 75%);
  background-size: 200% 100%; animation: an-shimmer 1.2s ease-in-out infinite;
}
@keyframes an-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.an-details summary { cursor: pointer; }
/* "Updated … ago": a pill with a status dot, so it reads as live status
   rather than another line of fine print. The dot pulses while updating. */
.an-live {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px; border-radius: 999px;
  background: #e6f6ee; color: #0c5132;
  font-size: 12px; font-weight: 550; line-height: 16px; white-space: nowrap;
}
.an-live-dot {
  width: 7px; height: 7px; border-radius: 50%; background: #29845a; flex: none;
}
.an-live[data-busy] { background: #eaf2fd; color: #13438a; }
.an-live[data-busy] .an-live-dot {
  background: #2a78d6; animation: an-pulse 1s ease-in-out infinite;
}
@keyframes an-pulse { 50% { opacity: 0.25; transform: scale(0.7); } }
.an-sub { font-size: 12px; line-height: 16px; color: #616161; }
.an-locked-value { letter-spacing: 3px; color: #8a8a8a; filter: blur(1.5px); user-select: none; }
.an-pro {
  display: inline-flex; align-items: center; height: 20px; padding: 0 8px;
  border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
  color: #fff; background: linear-gradient(135deg, #7c3aed, #2a78d6); flex: none;
}
.an-pro-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.an-pro-body { position: relative; min-height: 120px; }
.an-pro-preview { filter: blur(5px); opacity: 0.55; pointer-events: none; user-select: none; }
.an-pro-overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
}
.an-sample-table { display: flex; flex-direction: column; gap: 12px; }
.an-sample-row {
  display: grid; grid-template-columns: 32px 1fr auto auto; gap: 16px; align-items: center;
}
.an-stat-rows > div > span:first-child { color: #616161; }
.an-stat-rows { display: flex; flex-direction: column; gap: 8px; }
.an-stat-rows > div {
  display: flex; justify-content: space-between; gap: 12px;
  padding-bottom: 8px; border-bottom: 1px solid #ebebeb;
}
.an-stat-rows > div:last-child { border-bottom: 0; padding-bottom: 0; }
.an-empty {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  text-align: center; padding: 32px 16px; max-width: 520px; margin: 0 auto;
}
.an-empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 48px; height: 48px; border-radius: 12px; background: #f1f1f1;
}
@media (prefers-reduced-motion: reduce) {
  .an-live-dot { animation: none !important; }
  .an-skeleton { animation: none; }
  .an-bar-fill, .an-body { transition: none; }
}
@media (prefers-color-scheme: dark) {
  .an-segmented, .an-bar-track, .an-thumb, .an-empty-icon { background: #2a2a2a; }
  .an-stat-rows > div { border-bottom-color: #333; }
  .an-sub { color: #b5b5b5; }
  .an-live { background: #0e3b26; color: #b4f0cf; }
  .an-live-dot { background: #4cc38a; }
  .an-live[data-busy] { background: #12305a; color: #c7dcfa; }
  .an-locked-value { color: #8a8a8a; }
  .an-segmented button { color: #b5b5b5; }
  .an-segmented button:hover, .an-segmented button[aria-pressed="true"] { color: #e3e3e3; }
  .an-segmented button[aria-pressed="true"] { background: #3a3a3a; }
  .an-bar-fill, .an-mini-bar { background: #3987e5; }
  .an-skeleton {
    background: linear-gradient(90deg, #2a2a2a 25%, #333 50%, #2a2a2a 75%);
    background-size: 200% 100%;
  }
}
`;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
