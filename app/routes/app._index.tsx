import { Fragment, useEffect, useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  redirect,
  useActionData,
  useLoaderData,
  useNavigate,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { framedRedirect } from "~/lib/framed-redirect.server";
import {
  evaluateReviewPrompt,
  type ReviewPromptSignal,
} from "~/lib/review-prompt.server";
import { useReviewPrompt } from "~/components/ReviewPrompt";
import { AnalyticsOverviewCard } from "~/components/AnalyticsOverview";
import { getAnalyticsOverview } from "~/lib/viewer-stats.server";
import type { AnalyticsOverview } from "~/lib/viewer-stats";
import { checkDefsReadyCached } from "~/lib/metafields.server";
import prisma from "../db.server";
import {
  countDistinctModels,
  getAssignedModelGidsCached,
  fetchActiveSubscriptionCached,
  fetchProductsCountCached,
  getOrCreateUser,
  getPlans,
} from "~/lib/billing.server";
import {
  FREE_MODEL_LIMIT,
  FREE_PLAN_NAME,
  FREE_PRODUCT_LIMIT,
  formatMoney,
  isUnlimited,
} from "~/lib/billing-constants";
import {
  addThemeBlock,
  checkThemeBlocksCached,
  invalidateThemeBlocks,
  type ThemeBlockStatus,
} from "~/lib/theme-blocks.server";

import {
  useOverlay,
  useRouteNav,
  type OverlayElement,
} from "~/components/polaris/helpers";
import {
  FEATURE_FORM_ID,
  FeatureRequestModal,
  SupportAction,
} from "~/components/SupportAction";
import { LanguagePicker } from "~/components/LanguagePicker";
import { ModalAction } from "~/components/polaris/ModalAction";
import { useLocale, useT, type TFunction } from "~/i18n";
import { getServerT, resolveAdminLocale } from "~/i18n/i18n.server";

/*
 * The merchant community group. Peer help, not a support channel: it sits below
 * "Get support" in the aside so a merchant with a real problem reaches the
 * ticket form first rather than waiting on a group to answer.
 */
const COMMUNITY_URL = "https://www.facebook.com/groups/easy3dviewer";

/*
 * "Leave a review" opens the App Store listing in a new tab with its
 * write-a-review modal already open — the deep link Shopify documents for
 * this. The automatic ask (ReviewPrompt.tsx) is what uses Shopify's in-admin
 * popup.
 */
const APP_STORE_REVIEW_URL =
  "https://apps.shopify.com/easy-3d-viewer#modal-show=WriteReviewModal";

type RecentModel = {
  id: string;
  name: string;
  fileSize: number | null;
  createdAt: string;
};

type FileTypeStat = {
  ext: string;
  count: number;
};

type SubscriptionDetail = {
  price: string;
  status: string;
  trialDays: number | null;
  cancelledOn: string | null;
};

type LoaderData = {
  shop: string;
  planTitle: string;
  modelLimit: number;
  productLimit: number;
  assigned: number;
  distinctModelsUsed: number;
  totalProducts: number;
  uploadsThisMonth: number;
  uploadsLastMonth: number;
  monthStartLabel: string;
  lastMonthLabel: string;
  uploadDates: string[];
  fileTypes: FileTypeStat[];
  recentModels: RecentModel[];
  onboardingDone: boolean;
  metafieldDefsReady: boolean;
  subscription: SubscriptionDetail | null;
  themeBlocks: ThemeBlockStatus;
  /**
   * Last-30-day analytics for the overview card. A promise, not a value: it is
   * streamed in after first paint so the dashboard never waits on it.
   */
  analytics: Promise<AnalyticsOverview>;
  /**
   * The review ask for this load (review-prompt.server.ts): the one-time
   * lifetime-views milestone, or "onboarding finished" when the wizard just
   * sent the merchant here.
   */
  reviewPrompt: ReviewPromptSignal;
};

function fileExt(m: { fileUrl: string; name: string }): string {
  const source = (m.fileUrl || m.name).split("?")[0];
  const match = source.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : "other";
}

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";

  /*
   * One round of work, not three.
   *
   * This used to be authenticate, then getOrCreateUser, then this block, then a
   * plan lookup — four phases, each waiting on the last. Against Mongo that is
   * expensive in a way it would not be against a local database: a single
   * findMany here measures around 250ms (see the note in seedPlans), so each
   * phase boundary was roughly a quarter second added to TTFB, and TTFB is the
   * floor under both FCP and LCP.
   *
   * Nothing in this list depends on anything else in it, so none of it needs to
   * be ordered. The onboarding redirect below is the one thing that does depend
   * on `user`, and it now runs after the block instead of gating it: it fires
   * once per install, and paying for it with a handful of wasted queries on
   * that single request is worth taking the wait off every other one.
   */
  const [
    user,
    totalProducts,
    defsReady,
    models,
    assignedModels,
    themeBlocks,
    activeSub,
    plans,
  ] = await Promise.all([
    // getOrCreateUser seeds the plans itself; the extra call here was a second
    // full seeding pass on every dashboard load.
    getOrCreateUser(shop),
    fetchProductsCountCached(admin, shop),
    checkDefsReadyCached(admin, shop),
    // Selected rather than whole rows: `config` holds a viewer settings blob per
    // model and nothing on this page reads it.
    prisma.model3D.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        fileGid: true,
        fileUrl: true,
        fileSize: true,
        createdAt: true,
      },
    }),
    getAssignedModelGidsCached(admin, shop),
    checkThemeBlocksCached(admin, shop),
    // Was awaited on its own after this block, adding a Shopify round trip
    // (~500ms) in series for data that depends on nothing in it.
    fetchActiveSubscriptionCached(admin, shop),
    // Every plan, rather than the one this store is on. Picking a single row
    // needs `user.planId`, which would mean waiting for getOrCreateUser before
    // this query could even be issued — and the point of this block is that
    // nothing in it waits for anything else. There are four plans; the extra
    // rows cost nothing next to a round trip. In memory, so free anyway.
    getPlans(),
  ]);

  // A store that has never opened the wizard gets sent there instead of a
  // dashboard full of zeroes. Thrown rather than returned so the loader keeps
  // its LoaderData return type; the wizard sets onboardingStep on first view,
  // so this fires exactly once per install.
  //
  // Two things this hop needs that a plain `redirect("/app/onboarding")` does
  // not give it, both of which only ever bit a brand-new install:
  //
  //  - framedRedirect, because a bare 302 carries no CSP and a proxy's
  //    X-Frame-Options then makes the admin refuse to follow it. See
  //    app/lib/framed-redirect.server.ts.
  //  - the query string, because this is a *document* redirect followed inside
  //    the iframe on the very first load. Drop shop/host/embedded/id_token and
  //    the next request arrives with no way to identify the store, so
  //    authenticate.admin can neither exchange a token nor even name a shop to
  //    bounce for — it falls through to /auth/login and the merchant is looking
  //    at a shop-domain form. Forwarded exactly as _index/route.tsx forwards it
  //    one hop earlier.
  if (!user.onboardingDone && user.onboardingStep === 0) {
    const query = new URL(request.url).searchParams.toString();
    throw framedRedirect(
      request,
      query ? `/app/onboarding?${query}` : "/app/onboarding",
    );
  }

  const assigned = assignedModels.count;
  const distinctModelsUsed = countDistinctModels(
    models.map((m) => m.fileGid),
    assignedModels.gids,
  );

  let planTitle = FREE_PLAN_NAME;
  let modelLimit = user.modelLimit ?? FREE_MODEL_LIMIT;
  let productLimit = user.productLimit ?? FREE_PRODUCT_LIMIT;
  let subscription: SubscriptionDetail | null = null;
  if (activeSub?.status === "active") {
    planTitle = activeSub.name;
    subscription = {
      price: activeSub.price,
      status: activeSub.status,
      trialDays: activeSub.trialDays ?? null,
      cancelledOn: activeSub.cancelledOn ?? null,
    };
    const plan = plans.find((p) => p.id === user.planId);
    if (plan) {
      planTitle = plan.title;
      modelLimit = plan.modelLimit;
      productLimit = plan.productLimit;
    }
  }

  const now = new Date();
  // The labels below are read by the merchant, so in their admin language.
  const locale = resolveAdminLocale(request);
  const inMonth = (d: Date, year: number, month: number) =>
    d.getFullYear() === year && d.getMonth() === month;
  const uploadsThisMonth = models.filter((m) =>
    inMonth(m.createdAt, now.getFullYear(), now.getMonth()),
  ).length;
  // Same server clock as the month bucket above, for the same reason.
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const uploadsLastMonth = models.filter((m) =>
    inMonth(m.createdAt, prevMonth.getFullYear(), prevMonth.getMonth()),
  ).length;
  const lastMonthLabel = prevMonth.toLocaleDateString(locale, {
    month: "long",
  });
  // Formatted here rather than in the component: the count above is bucketed by
  // the server's month boundary, so the label naming that boundary has to come
  // off the same clock — derived in the browser it could name a different month
  // either side of midnight, and it would differ between the server-rendered
  // HTML and the hydrated markup.
  const monthStartLabel = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
  ).toLocaleDateString(locale, { month: "long", day: "numeric" });

  const extCounts = new Map<string, number>();
  for (const m of models) {
    const ext = fileExt(m);
    extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
  }
  const fileTypes: FileTypeStat[] = Array.from(extCounts, ([ext, count]) => ({
    ext,
    count,
  }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    shop,
    planTitle,
    modelLimit,
    productLimit,
    assigned,
    distinctModelsUsed,
    totalProducts,
    uploadsThisMonth,
    uploadsLastMonth,
    monthStartLabel,
    lastMonthLabel,
    uploadDates: models.map((m) => m.createdAt.toISOString()),
    fileTypes,
    recentModels: models.slice(0, 6).map((m) => ({
      id: m.id,
      name: m.name,
      fileSize: m.fileSize ?? null,
      createdAt: m.createdAt.toISOString(),
    })),
    onboardingDone: user.onboardingDone,
    metafieldDefsReady: defsReady,
    subscription,
    themeBlocks,
    reviewPrompt: await evaluateReviewPrompt(
      admin,
      shop,
      // Set by the onboarding wizard's "Go to dashboard" once every step is
      // done. The rules are still checked here, so the parameter alone can
      // never cause an ask.
      new URL(request.url).searchParams.get("reviewMoment") ===
        "onboarding-finished"
        ? "onboarding-finished"
        : "views-milestone",
      {
        user,
        libraryCount: models.length,
        assignedCount: assigned,
        productBlockAdded: themeBlocks.productBlockAdded,
        pageBlockAdded: themeBlocks.pageBlockAdded,
      },
    ),
    // Not awaited. Free plan → last 7 days (see getAnalyticsOverview). A
    // rejection stays inside the promise, where the card's errorElement shows
    // it, instead of failing the whole dashboard.
    analytics: getAnalyticsOverview(shop, activeSub?.status === "active"),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  if (intent === "dismiss_onboarding") {
    await prisma.appUser.update({
      where: { shop },
      data: { onboardingDone: true },
    });
    return { ok: true };
  }

  if (intent === "add_theme_block") {
    const themeId = String(fd.get("themeId") ?? "");
    const template = String(fd.get("template") ?? "");
    const blockHandle = String(fd.get("blockHandle") ?? "");
    if (
      !themeId ||
      (template !== "product" && template !== "page") ||
      (blockHandle !== "product_viewer" && blockHandle !== "page_viewer")
    ) {
      const t = getServerT(request, "dashboard");
      return { ok: false, error: t("errors.invalidBlock") };
    }
    const templateKey =
      template === "product" ? "templates/product.json" : "templates/page.json";
    // The block this action inserts is exactly what checkThemeBlocks looks for.
    invalidateThemeBlocks(shop);
    const result = await addThemeBlock(
      admin,
      shop,
      themeId,
      templateKey,
      blockHandle,
    );
    return result;
  }

  return { ok: false };
};

function formatBytes(n: number) {
  if (n === 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string, locale: string) {
  try {
    return new Date(iso).toLocaleDateString(locale);
  } catch {
    return "";
  }
}

/**
 * Tone of the badge beside a tile's value. `warn`/`bad` are what turn the row
 * into a warning as a limit gets close, so a merchant sees it without reading
 * the numbers.
 */
type Tone = "muted" | "good" | "warn" | "bad";

/** Maps the tile's own vocabulary onto Polaris badge tones. */
const BADGE_TONE: Record<Tone, "neutral" | "success" | "warning" | "critical"> =
  {
    muted: "neutral",
    good: "success",
    warn: "warning",
    bad: "critical",
  };

/** Ratio -> tone, so every part of a tile agrees about how bad it is. */
function usageTone(ratio: number): Tone {
  if (ratio >= 1) return "bad";
  if (ratio >= 0.8) return "warn";
  return "muted";
}

function StatTile({
  icon,
  label,
  value,
  meta,
  metaTone = "muted",
  sub,
  footer,
}: {
  icon: string;
  label: string;
  value: string;
  meta?: string;
  metaTone?: Tone;
  sub?: string;
  footer?: React.ReactNode;
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
          alignItems="baseline"
          justifyContent="space-between"
          inlineSize="100%"
        >
          <s-heading>{value}</s-heading>
          {meta ? <s-badge tone={BADGE_TONE[metaTone]}>{meta}</s-badge> : null}
        </s-stack>

        {sub ? <s-text color="subdued">{sub}</s-text> : null}
        {footer}
      </s-stack>
    </s-box>
  );
}

type Granularity = "day" | "week" | "month";

type Bucket = {
  label: string;
  full: string;
  count: number;
};

/*
 * The period is named in whole sentences per granularity (chart.summary.day,
 * chart.empty.week, …) rather than a "14 days" fragment, since other languages
 * inflect it differently in each sentence.
 */
const GRANULARITY_CONFIG: Record<Granularity, { periods: number }> = {
  day: { periods: 14 },
  week: { periods: 8 },
  month: { periods: 6 },
};

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function buildBuckets(
  granularity: Granularity,
  dates: Date[],
  now: Date,
  locale: string,
  t: TFunction,
): Bucket[] {
  const { periods } = GRANULARITY_CONFIG[granularity];
  const buckets: Bucket[] = [];

  if (granularity === "day") {
    const today = startOfDay(now);
    for (let i = periods - 1; i >= 0; i--) {
      const start = new Date(today);
      start.setDate(start.getDate() - i);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const count = dates.filter((d) => d >= start && d < end).length;
      buckets.push({
        label: start.toLocaleDateString(locale, {
          month: "numeric",
          day: "numeric",
        }),
        full: start.toLocaleDateString(locale, {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
        count,
      });
    }
  } else if (granularity === "week") {
    const todayEnd = new Date(startOfDay(now));
    todayEnd.setDate(todayEnd.getDate() + 1);
    for (let i = periods - 1; i >= 0; i--) {
      const end = new Date(todayEnd);
      end.setDate(end.getDate() - i * 7);
      const start = new Date(end);
      start.setDate(start.getDate() - 7);
      const count = dates.filter((d) => d >= start && d < end).length;
      buckets.push({
        label: start.toLocaleDateString(locale, {
          month: "numeric",
          day: "numeric",
        }),
        full: t("chart.weekOf", {
          date: start.toLocaleDateString(locale, {
            month: "short",
            day: "numeric",
          }),
        }),
        count,
      });
    }
  } else {
    for (let i = periods - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const count = dates.filter((d) => d >= start && d < end).length;
      buckets.push({
        label: start.toLocaleDateString(locale, { month: "short" }),
        full: start.toLocaleDateString(locale, {
          month: "long",
          year: "numeric",
        }),
        count,
      });
    }
  }

  return buckets;
}

function UploadsChart({ dates }: { dates: string[] }) {
  const t = useT("dashboard");
  const locale = useLocale();
  const [granularity, setGranularity] = useState<Granularity>("week");
  const now = useMemo(() => new Date(), []);
  const parsedDates = useMemo(() => dates.map((d) => new Date(d)), [dates]);
  const buckets = useMemo(
    () => buildBuckets(granularity, parsedDates, now, locale, t),
    [granularity, parsedDates, now, locale, t],
  );

  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const hasActivity = total > 0;
  const { periods } = GRANULARITY_CONFIG[granularity];

  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    const raf = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(raf);
  }, [granularity]);

  return (
    <s-stack direction="block" gap="base">
      <s-stack
        direction="inline"
        gap="small"
        alignItems="center"
        justifyContent="space-between"
        inlineSize="100%"
      >
        <s-text color="subdued">
          {t(`chart.summary.${granularity}`, { count: total, periods })}
        </s-text>
        <s-stack direction="inline" gap="small-500">
          {(Object.keys(GRANULARITY_CONFIG) as Granularity[]).map((g) => (
            <s-button
              key={g}
              variant={granularity === g ? "secondary" : "tertiary"}
              onClick={() => setGranularity(g)}
            >
              {t(`chart.granularity.${g}`)}
            </s-button>
          ))}
        </s-stack>
      </s-stack>

      {hasActivity ? (
        /*
          The one hand-drawn visual left in the admin UI. Polaris ships no
          chart, and the honest alternatives — a table of counts, or nothing —
          both lose what the shape of the series is here to show. It is built to
          borrow rather than invent: every bar is `currentColor` at reduced
          opacity, so it takes the admin's own text colour and stays correct in
          whatever theme Polaris renders, with no palette of its own to drift.
        */
        <div
          role="img"
          aria-label={t(`chart.aria.${granularity}`, { periods })}
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 6,
            height: 112,
          }}
        >
          {buckets.map((b, i) => {
            const heightPct =
              b.count === 0 ? 3 : Math.max(6, (b.count / max) * 100);
            const showLabel =
              granularity !== "day" || i % 2 === 1 || i === buckets.length - 1;
            return (
              <div
                key={i}
                title={`${b.full} · ${b.count}`}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  height: "100%",
                  opacity: settled ? 1 : 0,
                  transition: "opacity 300ms ease-out",
                  transitionDelay: `${Math.min(i, 12) * 15}ms`,
                }}
              >
                {/*
                  Grown with a transform, not by animating `height`.

                  The Layout Instability API ignores movement caused by CSS
                  transforms and counts everything else, so a bar animating
                  from `height: 0%` to its final height reported a layout shift
                  on every frame of that 500ms — its top edge really was moving
                  — and the whole chart did it at once on first paint, when no
                  user input was near enough to excuse it. That was this page's
                  CLS.

                  Holding the final height from the first frame and scaling
                  from the bottom edge looks identical and moves nothing: the
                  box is the size it will end up being before the animation
                  starts.
                */}
                <div
                  style={{
                    width: "100%",
                    height: `${heightPct}%`,
                    background: "currentColor",
                    opacity: 0.65,
                    transform: settled ? "scaleY(1)" : "scaleY(0)",
                    transformOrigin: "bottom",
                    transition: "transform 500ms ease-out",
                  }}
                />
                <div style={{ height: 14, marginTop: 6 }}>
                  {showLabel ? (
                    <s-text color="subdued">{b.label}</s-text>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <s-stack direction="block" gap="small" alignItems="center">
          <s-icon type="three-d-environment" color="subdued" />
          <s-text color="subdued">
            {t(`chart.empty.${granularity}`, { periods })}
          </s-text>
        </s-stack>
      )}
    </s-stack>
  );
}

function FileTypeBars({ data }: { data: FileTypeStat[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <s-stack direction="block" gap="small">
      {data.map((d) => (
        <s-stack key={d.ext} direction="inline" gap="small" alignItems="center">
          <s-text color="subdued">.{d.ext}</s-text>
          {/* Same currentColor treatment as the uploads chart above. */}
          <div
            style={{
              flex: 1,
              height: 8,
              opacity: 0.15,
              background: "currentColor",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.max(4, (d.count / max) * 100)}%`,
                background: "currentColor",
              }}
            />
          </div>
          <s-text color="subdued">{String(d.count)}</s-text>
        </s-stack>
      ))}
    </s-stack>
  );
}

function VideoLightbox({
  videoId,
  title,
  open,
  onOpenChange,
}: {
  videoId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ref = useOverlay<OverlayElement>(open, () => onOpenChange(false));
  const tc = useT("common");

  return (
    <s-modal
      ref={ref as never}
      id="tutorial-video"
      heading={title}
      size="large"
      accessibilityLabel={title}
    >
      {/*
        The iframe mounts only while open, so nothing is requested from YouTube
        until a merchant actually asks for it — and because opening is always a
        click, the ?autoplay=1 on the embed is a user gesture browsers honour.
      */}
      <div style={{ aspectRatio: "16 / 9", width: "100%", background: "#000" }}>
        {open ? (
          <iframe
            style={{
              width: "100%",
              height: "100%",
              border: 0,
              display: "block",
            }}
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : null}
      </div>
      <ModalAction
        slot="primary-action"
        variant="primary"
        onClick={() => onOpenChange(false)}
      >
        {tc("close")}
      </ModalAction>
    </s-modal>
  );
}

const TUTORIAL_VIDEO_ID = "7WIAhqRQ3hM";
/** Message key in the dashboard namespace. */
const TUTORIAL_TITLE = "tutorialTitle";

type QuickLink = {
  icon: string;
  label: string;
  /** Where the row goes. Omitted for rows that run `onSelect` instead. */
  href?: string;
  /**
   * Run something in-app rather than navigating — opening the tutorial dialog,
   * for instance. Takes precedence over `href`, which such a row omits, so the
   * element renders as a button with no address to leak or middle-click.
   */
  onSelect?: () => void;
  /**
   * Id of an overlay this row opens, for a dialog owned by another component —
   * the support form lives in SupportAction, which is in the page header. The
   * row targets it declaratively rather than the two components having to share
   * state across the page.
   */
  commandFor?: string;
  external?: boolean;
  // Show the row but don't let it go anywhere: it renders as plain content with
  // a "Coming soon" badge where the chevron would be. Overrides `external`, and
  // `href` is ignored entirely — there is no anchor and no handler to click, so
  // the link can't leak via middle-click or a copied address either, which a
  // CSS-only `pointer-events: none` would not prevent.
  comingSoon?: boolean;
};

function QuickLinkRow({
  href,
  icon,
  label,
  onSelect,
  commandFor,
  onNavigate,
  external,
  comingSoon,
}: QuickLink & { onNavigate?: (href: string) => void }) {
  const t = useT("dashboard");
  const body = (
    /*
      A two-track grid, not a flex row with space-between.

      space-between only has an effect when the container is wider than its
      contents — it distributes *free* space. Inside s-clickable there was none
      to distribute, so the arrow sat immediately after the text instead of at
      the card's edge. `1fr auto` states the intent directly: the label column
      takes everything left over and the arrow column hugs its icon, so the
      arrow is pinned right whatever the row contains, and alignItems centres it
      against the row.
    */
    <s-grid
      gridTemplateColumns="1fr auto"
      gap="small"
      alignItems="center"
      inlineSize="100%"
    >
      {/* minInlineSize lets this column shrink below its content, so a long
          label truncates inside the track instead of widening the row. */}
      <s-stack
        direction="inline"
        gap="small-500"
        alignItems="center"
        minInlineSize="0"
      >
        <s-icon type={icon as never} color="subdued" size="small" />
        <s-text type="strong">{label}</s-text>
      </s-stack>

      {comingSoon ? (
        <s-badge>{t("comingSoon")}</s-badge>
      ) : (
        <s-icon
          type={external ? "external" : "chevron-right"}
          color="subdued"
          size="small"
        />
      )}
    </s-grid>
  );

  if (comingSoon) {
    return (
      <s-box padding="small-100" aria-disabled="true">
        {body}
      </s-box>
    );
  }

  // A row that opens an overlay owned elsewhere on the page.
  if (commandFor) {
    return (
      <s-clickable
        padding="small-100"
        borderRadius="base"
        inlineSize="100%"
        commandFor={commandFor}
        command="--show"
      >
        {body}
      </s-clickable>
    );
  }

  // A row that acts rather than navigates: no href, so nothing to preventDefault.
  if (onSelect) {
    return (
      <s-clickable
        padding="small-100"
        borderRadius="base"
        inlineSize="100%"
        onClick={onSelect}
      >
        {body}
      </s-clickable>
    );
  }

  return (
    <s-clickable
      padding="small-100"
      borderRadius="base"
      inlineSize="100%"
      href={href}
      {...(external ? { target: "_blank" } : {})}
      onClick={
        external
          ? undefined
          : (event: Event) => {
              event.preventDefault();
              if (href) onNavigate?.(href);
            }
      }
    >
      {body}
    </s-clickable>
  );
}

/**
 * A card's worth of quick links, ruled between rows.
 *
 * The dividers are what make this read as a list of separate destinations
 * rather than one block of text — the rows carry no border or background of
 * their own, so without them the only separation is whitespace. Interleaved
 * here rather than trailed off each row so the last row has no rule under it,
 * and so a conditionally-rendered row cannot leave a stray divider behind.
 */
function QuickLinkList({
  items,
  onNavigate,
}: {
  items: QuickLink[];
  onNavigate: (href: string) => void;
}) {
  return (
    <s-stack direction="block" gap="none">
      {items.map((item, i) => (
        <Fragment key={item.label}>
          {i > 0 ? <s-divider /> : null}
          <QuickLinkRow {...item} onNavigate={onNavigate} />
        </Fragment>
      ))}
    </s-stack>
  );
}

function OnboardingStep({
  done,
  title,
  description,
  cta,
  onNavigate,
}: {
  done: boolean;
  title: string;
  description: string;
  cta?: { label: string; href: string };
  onNavigate: (href: string) => void;
}) {
  return (
    <s-stack
      direction="inline"
      gap="base"
      alignItems="start"
      justifyContent="space-between"
      inlineSize="100%"
    >
      <s-stack direction="inline" gap="small" alignItems="start">
        <s-icon
          type={done ? "check-circle-filled" : "circle"}
          tone={done ? "success" : "neutral"}
          color={done ? "base" : "subdued"}
        />
        <s-stack direction="block" gap="small-500">
          <s-text type="strong">{title}</s-text>
          <s-text color="subdued">{description}</s-text>
        </s-stack>
      </s-stack>
      {cta && !done ? (
        <s-button
          href={cta.href}
          onClick={(event) => {
            event.preventDefault();
            onNavigate(cta.href);
          }}
        >
          {cta.label}
        </s-button>
      ) : null}
    </s-stack>
  );
}

export default function Dashboard() {
  const {
    shop,
    planTitle,
    modelLimit,
    productLimit,
    assigned,
    distinctModelsUsed,
    totalProducts,
    uploadsThisMonth,
    uploadsLastMonth,
    monthStartLabel,
    lastMonthLabel,
    uploadDates,
    fileTypes,
    recentModels,
    onboardingDone,
    metafieldDefsReady,
    subscription,
    themeBlocks,
    reviewPrompt,
    analytics,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  useReviewPrompt(reviewPrompt);
  const navigate = useNavigate();
  const submit = useSubmit();
  const routeTo = useRouteNav();
  const shopify = useAppBridge();
  // Owned here rather than inside a trigger component: the walkthrough is now
  // reachable from the header, and a second entry point (a Help & feedback row)
  // would drive the same lightbox.
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const t = useT("dashboard");
  const tc = useT("common");
  const locale = useLocale();
  const limitText = (limit: number) =>
    isUnlimited(limit) ? t("usage.unlimited") : String(limit);

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show(t("toast.onboardingDismissed"));
    }
  }, [actionData, shopify, t]);

  const totalInUse = distinctModelsUsed;
  const usageRatio = modelLimit > 0 ? totalInUse / modelLimit : 0;
  const productUsageRatio = productLimit > 0 ? assigned / productLimit : 0;
  const coveragePct =
    totalProducts > 0 ? Math.round((assigned / totalProducts) * 100) : 0;
  const uploadDelta = uploadsThisMonth - uploadsLastMonth;

  return (
    <s-page heading={t("heading")}>
      {/*
        The page's one primary action, in the primary-action slot rather than
        styled primary inside the secondary group — a page gets a single primary
        action, and on the free plan "Upgrade" was already using it. Upgrade is
        still here, one step down, which is the right weight for it: adding a
        model is what a merchant came to the dashboard to do.

        It links to the library, which is where the drop zone lives, rather than
        being a control that would have to reproduce the upload flow up here.
      */}
      <s-button
        slot="primary-action"
        variant="primary"
        icon="plus"
        href="/app/models"
        onClick={routeTo("/app/models")}
        accessibilityLabel={t("actions.addModel")}
      >
        {t("actions.addModel")}
      </s-button>
      <s-button
        slot="primary-action"
        variant="primary"
        icon="plus"
        href="/app/products"
        onClick={routeTo("/app/products")}
        accessibilityLabel={t("actions.assignModel")}
      >
        {t("actions.assignModel")}
      </s-button>
      {planTitle === FREE_PLAN_NAME ? (
        <s-button
          slot="secondary-actions"
          href="/app/pricing"
          onClick={routeTo("/app/pricing")}
        >
          {tc("upgrade")}
        </s-button>
      ) : null}
      <SupportAction />

      <s-section>
        <s-grid
          gridTemplateColumns="1fr auto"
          gap="small"
          alignItems="center"
        >
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text color="subdued">{shop}</s-text>
            <s-badge icon="wand">{t("planBadge", { plan: planTitle })}</s-badge>
          </s-stack>
          <LanguagePicker compact />
        </s-grid>
      </s-section>

      {!onboardingDone ? (
        <s-section heading={t("gettingStarted.heading")}>
          <s-paragraph color="subdued">{t("gettingStarted.body")}</s-paragraph>

          {/*
            A dismiss X is the lowest-emphasis control on the card, not its
            main one, so it belongs in secondary-actions. No `variant`: that
            slot accepts only "secondary" or "auto", and "auto" lets the
            section style the X itself. primary-action, its previous home,
            rejects everything but "primary".
          */}
          <s-button
            slot="secondary-actions"
            icon="x"
            accessibilityLabel={t("gettingStarted.dismiss")}
            onClick={() =>
              submit({ intent: "dismiss_onboarding" }, { method: "post" })
            }
          />

          <s-stack direction="block" gap="base">
            <OnboardingStep
              done={metafieldDefsReady}
              title={t("gettingStarted.defs.title")}
              description={t("gettingStarted.defs.description")}
              cta={{ label: t("gettingStarted.defs.cta"), href: "/app/setup" }}
              onNavigate={navigate}
            />
            <s-divider />
            <OnboardingStep
              done={assigned > 0}
              title={t("gettingStarted.upload.title")}
              description={t("gettingStarted.upload.description")}
              cta={{
                label: t("gettingStarted.upload.cta"),
                href: "/app/products",
              }}
              onNavigate={navigate}
            />
            <s-divider />
            <OnboardingStep
              done={themeBlocks.productBlockAdded}
              title={t("gettingStarted.block.title")}
              description={t("gettingStarted.block.description")}
              onNavigate={navigate}
            />
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading={t("usage.heading")}>
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 220px), 1fr))"
          gap="base"
        >
          <StatTile
            icon="package"
            label={t("usage.products")}
            value={`${assigned} / ${limitText(productLimit)}`}
            meta={
              isUnlimited(productLimit)
                ? t("usage.unlimited")
                : productUsageRatio >= 1
                  ? t("usage.limitReached")
                  : t("usage.left", { count: productLimit - assigned })
            }
            metaTone={
              isUnlimited(productLimit) ? "good" : usageTone(productUsageRatio)
            }
            sub={
              totalProducts > 0
                ? t("usage.coverage", {
                    percent: coveragePct,
                    count: totalProducts,
                  })
                : t("usage.noProducts")
            }
          />
          {/*
            The usage count lives here and nowhere else — it used to be
            duplicated between a header badge and the plan card, and both of
            those are gone. The sub-line names what the count covers, since a
            file used both in the library and on a product is counted once.
          */}
          <StatTile
            icon="three-d-environment"
            label={t("usage.models")}
            value={`${totalInUse} / ${limitText(modelLimit)}`}
            meta={
              isUnlimited(modelLimit)
                ? t("usage.unlimited")
                : usageRatio >= 1
                  ? t("usage.limitReached")
                  : t("usage.left", { count: modelLimit - totalInUse })
            }
            metaTone={isUnlimited(modelLimit) ? "good" : usageTone(usageRatio)}
            sub={t("usage.modelsSub")}
          />
          <StatTile
            icon="upload"
            label={t("usage.uploads")}
            value={String(uploadsThisMonth)}
            meta={
              uploadDelta === 0
                ? undefined
                : `${uploadDelta > 0 ? "+" : "−"}${Math.abs(uploadDelta)}`
            }
            metaTone={uploadDelta > 0 ? "good" : "muted"}
            sub={t("usage.since", { date: monthStartLabel })}
            footer={
              <s-text color="subdued">
                {t("usage.lastMonth", {
                  month: lastMonthLabel,
                  uploads: uploadsLastMonth,
                })}
              </s-text>
            }
          />
          <StatTile
            icon="credit-card"
            label={t("plan.label")}
            value={planTitle}
            meta={
              subscription
                ? subscription.status === "active"
                  ? t("plan.statusActive")
                  : subscription.status.charAt(0).toUpperCase() +
                    subscription.status.slice(1)
                : undefined
            }
            metaTone={subscription?.status === "active" ? "good" : "muted"}
            sub={
              subscription
                ? subscription.trialDays
                  ? t("plan.priceWithTrial", {
                      price: formatMoney(subscription.price),
                      count: subscription.trialDays,
                    })
                  : t("plan.price", { price: formatMoney(subscription.price) })
                : t("plan.noCharge")
            }
            footer={
              <s-button
                icon="credit-card"
                href="/app/pricing"
                onClick={routeTo("/app/pricing")}
                accessibilityLabel={
                  subscription ? t("plan.manage") : t("plan.viewPlans")
                }
              >
                {subscription ? t("plan.manage") : t("plan.viewPlans")}
              </s-button>
            }
          />
        </s-grid>
      </s-section>

      <AnalyticsOverviewCard overview={analytics} />

      <s-section heading={t("recent.heading")}>
        <s-paragraph color="subdued">{t("recent.body")}</s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          href="/app/models"
          onClick={routeTo("/app/models")}
        >
          {t("recent.viewAll")}
        </s-button>

        {recentModels.length === 0 ? (
          <s-stack direction="block" gap="small" alignItems="center">
            <s-icon type="three-d-environment" color="subdued" />
            <s-text color="subdued">{t("recent.empty")}</s-text>
          </s-stack>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">
                {t("recent.model")}
              </s-table-header>
              <s-table-header format="numeric">{t("recent.size")}</s-table-header>
              <s-table-header>{t("recent.added")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {recentModels.map((m) => (
                <s-table-row key={m.id}>
                  <s-table-cell>
                    <s-link
                      href={`/app/models/${m.id}`}
                      onClick={routeTo(`/app/models/${m.id}`)}
                    >
                      {m.name}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{formatBytes(m.fileSize ?? 0)}</s-table-cell>
                  <s-table-cell>{formatDate(m.createdAt, locale)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading={t("activity.heading")}>
        <s-paragraph color="subdued">{t("activity.body")}</s-paragraph>
        <UploadsChart dates={uploadDates} />
      </s-section>

      <s-section slot="aside" heading={t("links.heading")}>
        <QuickLinkList
          onNavigate={navigate}
          items={[
            {
              href: "/app/products",
              icon: "product",
              label: t("links.products"),
            },
            {
              href: "/app/models",
              icon: "three-d-environment",
              label: t("links.models"),
            },
            {
              href: "/app/analytics",
              icon: "chart-line",
              label: t("links.analytics"),
            },
            {
              href: "/app/setup",
              icon: "settings",
              label: t("links.setup"),
            },
            ...(planTitle === FREE_PLAN_NAME
              ? [
                  {
                    href: "/app/pricing",
                    icon: "credit-card",
                    label: t("links.pricing"),
                  },
                ]
              : []),
          ]}
        />
      </s-section>

      <s-section slot="aside" heading={t("help.heading")}>
        <s-paragraph color="subdued">{t("help.body")}</s-paragraph>
        <QuickLinkList
          onNavigate={navigate}
          items={[
            {
              href: "/app/documentation",
              icon: "book",
              label: t("help.documentation"),
            },
            // Sits with the docs because it is the same errand — learning how
            // the app works — rather than in the page header beside the actions.
            {
              icon: "play-circle",
              label: t("help.tutorial"),
              onSelect: () => setTutorialOpen(true),
            },
            {
              icon: "question-circle",
              label: t("help.support"),
              // Opens the same ticket form as the Support button in the header.
              commandFor: "support-form",
            },
            {
              href: COMMUNITY_URL,
              icon: "chat",
              label: t("help.community"),
              external: true,
            },
            {
              icon: "lightbulb",
              label: t("help.featureRequests"),
              // The support form, in its feature-request version.
              commandFor: FEATURE_FORM_ID,
            },
            {
              icon: "star",
              label: t("help.review"),
              href: APP_STORE_REVIEW_URL,
              external: true,
            },
          ]}
        />
      </s-section>

      <FeatureRequestModal />

      {fileTypes.length > 0 ? (
        <s-section slot="aside" heading={t("fileTypes.heading")}>
          <s-paragraph color="subdued">{t("fileTypes.body")}</s-paragraph>
          <FileTypeBars data={fileTypes} />
        </s-section>
      ) : null}

      {/*
        One instance for the whole page, so both entry points drive the same
        dialog and only one YouTube iframe can ever exist.
      */}
      <VideoLightbox
        videoId={TUTORIAL_VIDEO_ID}
        title={t(TUTORIAL_TITLE)}
        open={tutorialOpen}
        onOpenChange={setTutorialOpen}
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
