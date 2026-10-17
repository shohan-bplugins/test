import { json } from "@remix-run/node";
import {
  CustomBox,
  CustomSpan,
  CustomButton,
} from "../utils/polarisWebComponents";
import {
  useLoaderData,
  useSearchParams,
  useNavigation,
  useNavigate,
  useRevalidator,
  useRouteError,
} from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import PageHeader from "../components/PageHeader/PageHeader";
import {
  Suspense,
  lazy,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Box,
  Text,
  Badge,
  Button,
  Grid,
  InlineGrid,
  IndexTable,
  Combobox,
  Listbox,
  Icon,
  Spinner,
} from "@shopify/polaris";
import {
  SearchIcon,
  ChevronDownIcon,
  PlayCircleIcon,
  PersonIcon,
  ClockIcon,
  GlobeIcon,
  DesktopIcon,
  MobileIcon,
  LocationIcon,
  ChartVerticalIcon,
  ProductIcon,
  LockIcon,
  RefreshIcon,
} from "@shopify/polaris-icons";
import { ClientOnly } from "remix-utils/client-only";
import prisma from "../db.server";
import { isPaidCredits, isPaidPlanName } from "../utils/planLimits";
import { authenticate } from "../shopify.server";
import { countryName, flagEmoji } from "../utils/countries";
import { rankVideosByScore, formatWatchSeconds } from "../utils/topPlayerScore";
import AnalyticsDateRange from "../components/AnalyticsDateRange/AnalyticsDateRange";
import "../styles/styles.css";
import "../styles/analytics.css";
import { verifyShopPlan } from "../utils/planSync.server";

const WorldMap = lazy(() => import("../components/WorldMap"));

// Brand accent — kept in sync with --app-primary in app/styles/variables.css.
// (Darker shade + bar tracks live in app/styles/analytics.css.)
const THEME = "#1a8d5a";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseDateParam(str) {
  if (!str || !DATE_RE.test(str)) return null;
  const [y, m, d] = str.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setHours(0, 0, 0, 0);
  return isNaN(date.getTime()) ? null : date;
}
function fmtDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Percentage change vs a previous value; null when there's no baseline.
function pctDelta(curr, prev) {
  if (!prev) return null;
  return Math.round(((curr - prev) / prev) * 100);
}

// "1h 23m", "12m 30s", or "45s" — compact watch-time label.
function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function groupBy(rows, field, { unknownLabel = "Unknown" } = {}) {
  const map = new Map();
  for (const r of rows) {
    const key = r[field] || unknownLabel;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

// Safe, fully-shaped payload used when the analytics queries fail for any
// reason — keeps the route rendering (with empty data) instead of throwing the
// whole embedded app into the "Application Error" boundary.
function emptyAnalyticsPayload(shop, isPro = false) {
  const today = startOfToday();
  const since = new Date(2000, 0, 1);
  return {
    isPro,
    shop: shop || "",
    scope: "all",
    since: fmtDate(since),
    until: fmtDate(today),
    rangeLabel: `${fmtDate(since)} → ${fmtDate(today)}`,
    selectedVideo: "all",
    selectedTitle: "All videos",
    videos: [],
    totalPlays: 0,
    uniqueVisitors: null,
    avgPlayTime: null,
    totalWatchHours: null,
    spanDays: 1,
    deltaPlays: null,
    deltaViewers: null,
    deltaWatch: null,
    topCountry: null,
    topDevice: null,
    byBrowser: [],
    byDevice: [],
    byOS: [],
    byCountry: [],
    unknownCountry: 0,
    byVideo: [],
    trend: [],
    loadError: true,
  };
}

// Collect every video id that is assigned to at least one product, by paging
// through the shop's products and reading the `bplugins.product_video`
// metafield (a single id or a JSON list). Used by the "Product Video" scope so
// analytics can be restricted to videos that actually appear on a product page.
async function collectAssignedVideoIds(admin) {
  const assigned = new Map();
  let cursor = null;
  // Safety cap: 20 pages × 250 = 5,000 products.
  for (let page = 0; page < 20; page++) {
    const resp = await admin.graphql(
      `#graphql
      query AssignedVideos($after: String) {
        products(first: 250, after: $after) {
          edges {
            node {
              title
              metafield(namespace: "bplugins", key: "product_video") { value type }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { variables: { after: cursor } },
    );
    const r = await resp.json();
    const edges = r?.data?.products?.edges || [];

    const addId = (id, title) => {
      if (!id) return;
      const existing = assigned.get(id);
      assigned.set(id, existing ? `${existing}, ${title}` : title);
    };

    for (const e of edges) {
      const mf = e.node?.metafield;
      if (!mf?.value) continue;
      const title = e.node?.title || "Untitled Product";
      if (mf.type && mf.type.startsWith("list.")) {
        try {
          const arr = JSON.parse(mf.value);
          if (Array.isArray(arr)) arr.forEach((x) => addId(x, title));
        } catch {
          /* ignore malformed metafield */
        }
      } else {
        addId(mf.value, title);
      }
    }
    const pi = r?.data?.products?.pageInfo;
    if (!pi?.hasNextPage) break;
    cursor = pi.endCursor;
  }
  return assigned;
}

export const loader = async ({ request }) => {
  // Keep authentication OUTSIDE the try below: Shopify performs auth via thrown
  // redirect Responses, which must propagate (not be swallowed as an error).
  const { admin, session } = await authenticate.admin(request);
  // Confirm the stored plan against Shopify billing before anything reads it.
  await verifyShopPlan(admin, session.shop);
  const shop = session.shop;

  // Whether this shop is on a paid plan. Detected BEFORE the main try so that a
  // later failure while computing metrics can't silently downgrade a paying
  // merchant to "free" — the catch preserves this value. Detect three
  // independent ways; ANY one unlocks full analytics.
  let isPro = false;
  let proDebug = {};

  // (1) Credits on the Users record — the source of truth the rest of the app
  //     uses. The Free allowance lives in planLimits, not inlined here.
  //     findMany + some() so that
  //     duplicate user rows for the same shop can't return a stale "free" row.
  try {
    const dbUsers = await prisma.Users.findMany({
      where: { shop },
      select: { cardits: true, planId: true, chargeId: true },
    });
    proDebug.users = dbUsers;
    if (dbUsers.some((u) => isPaidCredits(u?.cardits))) isPro = true;
  } catch (e) {
    proDebug.usersError = e.message;
  }

  // (2) Live Billing API — ask Shopify directly for any ACTIVE subscription
  //     whose name starts with "Pro" (covers "Pro", "Pro Plus", casing/spaces).
  if (!isPro) {
    try {
      const r = await admin.graphql(
        `#graphql
        query ActiveSubscriptions {
          currentAppInstallation { activeSubscriptions { name status } }
        }`,
      );
      const j = await r.json();
      const active = j?.data?.currentAppInstallation?.activeSubscriptions || [];
      proDebug.activeSubscriptions = active;
      if (
        active.some((s) => s?.status === "ACTIVE" && isPaidPlanName(s?.name))
      ) {
        isPro = true;
      }
    } catch (e) {
      proDebug.subsError = e.message;
    }
  }

  // (3) Plans table lookup via the user's planId — last-resort match by name.
  if (!isPro) {
    try {
      const planIds = (proDebug.users || [])
        .map((u) => u?.planId)
        .filter(Boolean);
      if (planIds.length) {
        const plans = await prisma.Plans.findMany({
          where: { id: { in: planIds } },
          select: { name: true },
        });
        proDebug.plans = plans;
        if (plans.some((p) => isPaidPlanName(p?.name))) {
          isPro = true;
        }
      }
    } catch (e) {
      proDebug.plansError = e.message;
    }
  }

  // Temporary visibility: shows in server logs so we can confirm detection.
  console.log("[analytics] Pro detection", shop, "=>", isPro, proDebug);

  try {
    const url = new URL(request.url);

    // Date range: explicit since/until (YYYY-MM-DD), default to "All time"
    // (since 2000-01-01 through today) — matches the picker's "All time" preset.
    const todayStart = startOfToday();
    let sinceStart = parseDateParam(url.searchParams.get("since"));
    let untilStart = parseDateParam(url.searchParams.get("until"));
    if (!sinceStart || !untilStart || sinceStart > untilStart) {
      untilStart = todayStart;
      sinceStart = new Date(2000, 0, 1);
    }
    const untilEnd = new Date(untilStart);
    untilEnd.setHours(23, 59, 59, 999);
    const spanDays = Math.round((untilStart - sinceStart) / 86400000) + 1;

    // Scope: "all" (every video) or "product" (only videos assigned to a product
    // via the product_video metafield). Drives both the selector list and the
    // play-event filter below.
    const scope =
      url.searchParams.get("scope") === "product" ? "product" : "all";

    // Video list for the selector (most recent first).
    let videos = await prisma.video.findMany({
      where: { shop },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    // Under "Product Video" scope, narrow the universe to assigned videos only.
    // An empty map means no product has a video yet → every metric reads zero.
    let assignedMap = null;
    if (scope === "product") {
      try {
        assignedMap = await collectAssignedVideoIds(admin);
      } catch (e) {
        console.log(
          "[analytics] collectAssignedVideoIds FAILED",
          shop,
          e?.message,
        );
        assignedMap = new Map();
      }
      // Diagnostic: compare the assigned-video ids (from product metafields)
      // against the video ids that actually have plays, to explain a 0 under
      // product scope (empty assignments vs. id mismatch).
      try {
        const assignedIds = [...assignedMap.keys()];
        const recentPlays = await prisma.videoPlay.findMany({
          where: { shop },
          select: { videoId: true },
          take: 200,
          orderBy: { createdAt: "desc" },
        });
        const playIds = [...new Set(recentPlays.map((p) => p.videoId))];
        const matched = playIds.filter((id) => assignedMap.has(id));
        console.log("[analytics] product-scope debug", shop, {
          assignedCount: assignedIds.length,
          assignedSample: assignedIds.slice(0, 5),
          distinctPlayVideoIds: playIds.length,
          playSample: playIds.slice(0, 5),
          matchedCount: matched.length,
        });
      } catch (e) {
        console.log("[analytics] product-scope debug FAILED", e?.message);
      }
      videos = videos
        .filter((v) => assignedMap.has(v.id))
        .map((v) => ({ ...v, title: assignedMap.get(v.id) }));
    }

    // Default to "All videos" (aggregates every video); a specific video is used
    // only when explicitly requested via the ?video=<id> param.
    const requested = url.searchParams.get("video");
    const validIds = new Set(videos.map((v) => v.id));
    const selectedVideo =
      requested && validIds.has(requested) ? requested : "all";

    // Restrict play events to the assigned-video set when no single video is
    // chosen under product scope.
    const scopeVideoFilter =
      scope === "product"
        ? { videoId: { in: [...(assignedMap?.keys() || [])] } }
        : {};

    const where = { shop };
    if (selectedVideo !== "all") where.videoId = selectedVideo;
    else Object.assign(where, scopeVideoFilter);
    where.createdAt = { gte: sinceStart, lte: untilEnd };

    const selectedTitleFor = (id) =>
      id === "all"
        ? "All videos"
        : videos.find((v) => v.id === id)?.title || "Untitled";

    // Free plan: return ONLY the Total plays headline. No other metric is
    // computed or sent — the locked cards on the client render placeholders.
    if (!isPro) {
      const totalPlays = await prisma.videoPlay.count({ where });
      return json({
        isPro: false,
        shop,
        scope,
        since: fmtDate(sinceStart),
        until: fmtDate(untilStart),
        rangeLabel: `${fmtDate(sinceStart)} → ${fmtDate(untilStart)}`,
        selectedVideo,
        selectedTitle: selectedTitleFor(selectedVideo),
        videos,
        totalPlays,
        uniqueVisitors: null,
        avgPlayTime: null,
        totalWatchHours: null,
        spanDays,
        deltaPlays: null,
        deltaViewers: null,
        deltaWatch: null,
        topCountry: null,
        topDevice: null,
        byBrowser: [],
        byDevice: [],
        byOS: [],
        byCountry: [],
        unknownCountry: 0,
        byVideo: [],
        trend: [],
      });
    }

    // Base fields every running Prisma client knows about. `ipHash` is newer, so
    // we add it only if the in-memory client supports it (a dev server started
    // before the schema change still has the old client until it restarts).
    // Without this guard the query would throw and the whole loader would fall
    // back to the locked "free" view.
    const playSelect = {
      videoId: true,
      videoTitle: true,
      visitorId: true,
      browser: true,
      os: true,
      device: true,
      country: true,
      watchedSeconds: true,
      createdAt: true,
    };
    let plays;
    try {
      plays = await prisma.videoPlay.findMany({
        where,
        select: { ...playSelect, ipHash: true },
        orderBy: { createdAt: "desc" },
        take: 50000,
      });
    } catch {
      plays = await prisma.videoPlay.findMany({
        where,
        select: playSelect,
        orderBy: { createdAt: "desc" },
        take: 50000,
      });
    }

    const totalPlays = plays.length;
    // A unique view is one distinct (device, network) pair: the persistent
    // visitorId identifies the device, the ipHash identifies the network. The
    // same device on a different network (e.g. after turning on a VPN) is a new
    // unique view. Rows missing both identifiers can't be attributed, so skip.
    const uniqueKey = (p) =>
      p.visitorId || p.ipHash ? `${p.visitorId || ""}|${p.ipHash || ""}` : null;
    const uniqueVisitors = new Set(plays.map(uniqueKey).filter(Boolean)).size;

    // Watch time: total seconds across all plays; average over plays that
    // actually reported a duration (so legacy rows with no data don't skew it).
    const totalWatchSeconds = plays.reduce(
      (sum, p) => sum + (p.watchedSeconds || 0),
      0,
    );
    const timedPlays = plays.filter((p) => (p.watchedSeconds || 0) > 0).length;
    const avgWatchSeconds = timedPlays ? totalWatchSeconds / timedPlays : 0;
    const totalWatchHours = totalWatchSeconds / 3600;

    // Previous equal-length window (immediately before the current one) so each
    // headline KPI can show a period-over-period trend.
    const prevSince = new Date(sinceStart);
    prevSince.setDate(prevSince.getDate() - spanDays);
    const prevWhere = { shop };
    if (selectedVideo !== "all") prevWhere.videoId = selectedVideo;
    else Object.assign(prevWhere, scopeVideoFilter);
    prevWhere.createdAt = { gte: prevSince, lt: sinceStart };
    let prevPlaysRows;
    try {
      prevPlaysRows = await prisma.videoPlay.findMany({
        where: prevWhere,
        select: { visitorId: true, ipHash: true, watchedSeconds: true },
        take: 50000,
      });
    } catch {
      prevPlaysRows = await prisma.videoPlay.findMany({
        where: prevWhere,
        select: { visitorId: true, watchedSeconds: true },
        take: 50000,
      });
    }
    const prevPlays = prevPlaysRows.length;
    const prevUnique = new Set(prevPlaysRows.map(uniqueKey).filter(Boolean))
      .size;
    const prevWatchSeconds = prevPlaysRows.reduce(
      (sum, p) => sum + (p.watchedSeconds || 0),
      0,
    );

    const byBrowser = groupBy(plays, "browser");
    const byDevice = groupBy(plays, "device");
    const byOS = groupBy(plays, "os");
    const byCountryRaw = groupBy(plays, "country", { unknownLabel: "ZZ" });
    const byCountry = byCountryRaw
      .filter((c) => c.key !== "ZZ")
      .map((c) => ({ code: c.key, count: c.count }));
    const unknownCountry = byCountryRaw.find((c) => c.key === "ZZ")?.count || 0;

    // Per-video breakdown (used for the "All videos" table).
    // Rank videos by the composite "top player" score (plays + unique viewers +
    // watch time), not by plays alone — see app/utils/topPlayerScore.js.
    const byVideo = rankVideosByScore(plays, (videoId, p) =>
      scope === "product" && assignedMap?.has(videoId)
        ? assignedMap.get(videoId)
        : p.videoTitle || "Untitled",
    );

    // ── Trend buckets ────────────────────────────────────────────────────
    // Granularity follows the selected range, so every preset produces a shape
    // worth looking at:
    //
    //   Today / Yesterday -> 24 hourly bars
    //   up to 31 days     -> one bar per DAY
    //   up to 92 days     -> one bar per 15 DAYS
    //   up to 366 days    -> one bar per calendar MONTH
    //   longer (All time) -> one bar per calendar YEAR, the last 5 only
    //
    // The previous rule was a flat `spanDays / 31`, which gave All time
    // 315-day bars and collapsed a shop's whole history into the final one.
    const trend = [];
    let trendBucketLabel = "Each bar = 1 day";
    // Set when the chart deliberately shows LESS than the selected range, so
    // the card can say so instead of quietly disagreeing with the KPIs.
    let trendWindowNote = null;

    const countIn = (from, to) =>
      plays.filter((p) => p.createdAt >= from && p.createdAt < to).length;
    const MONTH_NAMES = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];

    if (spanDays <= 1) {
      trendBucketLabel = "Each bar = 1 hour";
      for (let h = 0; h < 24; h++) {
        const from = new Date(sinceStart);
        from.setHours(h);
        const to = new Date(from);
        to.setHours(h + 1);
        const hh = String(h).padStart(2, "0");
        trend.push({
          label: `${hh}h`,
          // All 24 are labelled, so only the first carries the unit — 24x"00h"
          // does not fit on a narrow card, 24x"00" does.
          tick: h === 0 ? `${hh}h` : hh,
          count: countIn(from, to),
          range: `${hh}:00 – ${String(h + 1).padStart(2, "0")}:00`,
        });
      }
    } else if (spanDays > 366) {
      // Calendar years, capped at the five most recent. "All time" starts in
      // 2000, so without the cap 26 mostly-empty buckets crowd out the years
      // that actually have plays.
      trendBucketLabel = "Each bar = 1 year";
      trendWindowNote = "last 5 years";
      const endYear = untilStart.getFullYear();
      for (let y = endYear - 4; y <= endYear; y++) {
        trend.push({
          label: String(y),
          tick: String(y),
          count: countIn(new Date(y, 0, 1), new Date(y + 1, 0, 1)),
          range: String(y),
        });
      }
    } else if (spanDays > 92) {
      // Calendar months — aligned to real month boundaries, so a bar is "May",
      // not "a 30-day window that happens to start on the 12th".
      trendBucketLabel = "Each bar = 1 month";
      const cursor = new Date(
        sinceStart.getFullYear(),
        sinceStart.getMonth(),
        1,
      );
      const lastMonth = new Date(
        untilStart.getFullYear(),
        untilStart.getMonth(),
        1,
      );
      while (cursor <= lastMonth) {
        const from = new Date(cursor);
        const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        const mon = MONTH_NAMES[from.getMonth()];
        // The year is only printed where it changes — on the first bar and
        // each January. Repeating it on all 13 ticks is what overflowed a
        // narrow card, and "Sep" is unambiguous once the reader has seen
        // which year the axis started in.
        const showsYear = trend.length === 0 || from.getMonth() === 0;
        trend.push({
          label: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}`,
          tick: showsYear
            ? `${mon} ${String(from.getFullYear()).slice(2)}`
            : mon,
          count: countIn(from, to),
          range: `${mon} ${from.getFullYear()}`,
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    } else {
      const bucketDays = spanDays <= 31 ? 1 : 15;
      trendBucketLabel =
        bucketDays === 1 ? "Each bar = 1 day" : `Each bar = ${bucketDays} days`;
      const cursor = new Date(sinceStart);
      while (cursor <= untilStart) {
        const from = new Date(cursor);
        const to = new Date(cursor);
        to.setDate(to.getDate() + bucketDays);
        // The bucket is [from, to), so its last day is `to` minus one, clamped
        // to untilStart — the final bucket usually runs past the end of the
        // selected range, and a tooltip must not claim unqueried days.
        const lastDay = new Date(
          Math.min(to.getTime() - 86400000, untilStart.getTime()),
        );
        // Every bucket is labelled, so a daily tick has to be narrow: 30 of
        // "08-27" will not fit across a card. The day number alone does, with
        // the month named on the first bar and at each month rollover so the
        // axis never loses its place.
        const isFirstBar = trend.length === 0;
        const startsMonth = from.getDate() === 1;
        const dayTick =
          isFirstBar || startsMonth
            ? `${MONTH_NAMES[from.getMonth()]} ${from.getDate()}`
            : String(from.getDate());
        trend.push({
          label: fmtDate(from),
          tick: bucketDays === 1 ? dayTick : fmtDate(from).slice(5),
          count: countIn(from, to),
          range:
            bucketDays === 1
              ? fmtDate(from)
              : `${fmtDate(from)} → ${fmtDate(lastDay)}`,
        });
        cursor.setDate(cursor.getDate() + bucketDays);
      }
    }

    const selectedTitle = selectedTitleFor(selectedVideo);

    return json({
      isPro: true,
      shop,
      scope,
      since: fmtDate(sinceStart),
      until: fmtDate(untilStart),
      rangeLabel: `${fmtDate(sinceStart)} → ${fmtDate(untilStart)}`,
      selectedVideo,
      selectedTitle,
      videos,
      totalPlays,
      uniqueVisitors,
      avgPlayTime: fmtDuration(avgWatchSeconds),
      totalWatchHours:
        totalWatchHours >= 10
          ? `${Math.round(totalWatchHours)} h`
          : `${totalWatchHours.toFixed(1)} h`,
      spanDays,
      deltaPlays: pctDelta(totalPlays, prevPlays),
      deltaViewers: pctDelta(uniqueVisitors, prevUnique),
      deltaWatch: pctDelta(totalWatchSeconds, prevWatchSeconds),
      topCountry: byCountry[0]?.code || null,
      topDevice: byDevice[0]?.key || null,
      byBrowser,
      byDevice,
      byOS,
      byCountry,
      unknownCountry,
      byVideo,
      trend,
      trendBucketLabel,
      trendWindowNote,
    });
  } catch (error) {
    console.error("Analytics loader failed:", error);
    // Preserve the already-detected plan: a metrics-computation failure must
    // NOT downgrade a paying merchant to the locked "free" view.
    return json(emptyAnalyticsPayload(shop, isPro));
  }
};

/* ---------- UI pieces ---------- */

function SearchSelect({
  label,
  options,
  value,
  onChange,
  disabled,
  placeholder = "Search videos…",
}) {
  const [selectedOption, setSelectedOption] = useState(value);
  const [inputValue, setInputValue] = useState("");
  const [optionsState, setOptionsState] = useState(options);

  useEffect(() => {
    setSelectedOption(value);
  }, [value]);

  useEffect(() => {
    setOptionsState(options);
  }, [options]);

  const updateText = useCallback(
    (val) => {
      setInputValue(val);
      if (val === "") {
        setOptionsState(options);
        return;
      }
      const filterRegex = new RegExp(val, "i");
      const resultOptions = options.filter((option) =>
        option.label.match(filterRegex),
      );
      setOptionsState(resultOptions);
    },
    [options],
  );

  const updateSelection = useCallback(
    (selected) => {
      setSelectedOption(selected);
      onChange(selected);
      setInputValue("");
    },
    [onChange],
  );

  const handleFocus = useCallback(() => {
    setInputValue("");
    setOptionsState(options);
  }, [options]);

  const optionsMarkup =
    optionsState.length > 0 ? (
      optionsState.map((option) => (
        <Listbox.Option
          key={option.value}
          value={option.value}
          selected={selectedOption === option.value}
          accessibilityLabel={option.label}
        >
          {option.label}
        </Listbox.Option>
      ))
    ) : (
      <Listbox.Loading accessibilityLabel="No matches" />
    );

  const displayValue =
    inputValue || options.find((o) => o.value === selectedOption)?.label || "";

  return (
    <BlockStack gap="100">
      <Text as="label" variant="bodyMd">
        {label}
      </Text>
      <Combobox
        activator={
          <Combobox.TextField
            prefix={<Icon source={SearchIcon} />}
            onChange={updateText}
            label={label}
            labelHidden
            value={displayValue}
            placeholder={placeholder}
            autoComplete="off"
            disabled={disabled}
            onFocus={handleFocus}
          />
        }
      >
        {optionsState.length > 0 ? (
          <Listbox onSelect={updateSelection}>{optionsMarkup}</Listbox>
        ) : null}
      </Combobox>
    </BlockStack>
  );
}

const ProBadge = () => <Badge tone="info">PRO</Badge>;

// Client-side navigation to the Pricing page with an inline spinner while the
// redirect is in flight (the destination loader runs before the page swaps).
function UpgradeButton({ children = "Upgrade to Pro" }) {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [clicked, setClicked] = useState(false);
  const redirecting =
    clicked &&
    navigation.state === "loading" &&
    navigation.location?.pathname === "/app/pricing";

  const handleClick = useCallback(() => {
    if (redirecting) return;
    setClicked(true);
    navigate("/app/pricing");
  }, [redirecting, navigate]);

  return (
    <Button onClick={handleClick} loading={redirecting} variant="primary">
      {children}
    </Button>
  );
}

function ProLock({ text = "This insight is available on the Pro plan" }) {
  return (
    <BlockStack align="center" inlineAlign="center" gap="400">
      <Box paddingBlockStart="800" paddingBlockEnd="800">
        <BlockStack align="center" inlineAlign="center" gap="300">
          <Icon source={LockIcon} tone="base" />
          <Text as="p" tone="subdued">
            {text}
          </Text>
          <UpgradeButton />
        </BlockStack>
      </Box>
    </BlockStack>
  );
}

function Kpi({ label, value, sub, icon, delta, locked, loading }) {
  // While the page is loading (date/video change or reload) the numbers are
  // stale, so we hide them behind "—" until fresh data arrives.
  const muted = locked || loading;
  const dir =
    muted || delta == null
      ? null
      : delta > 0
        ? "up"
        : delta < 0
          ? "down"
          : "flat";
  return (
    <Card roundedAbove="sm">
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start">
          <Box
            padding="200"
            borderRadius="200"
            background="bg-surface-secondary"
          >
            <Icon source={icon} tone="base" />
          </Box>
          {locked ? (
            <ProBadge />
          ) : (
            dir && (
              <Badge
                tone={
                  dir === "up" ? "success" : dir === "down" ? "critical" : "new"
                }
              >
                {dir === "up" ? "↑" : dir === "down" ? "↓" : "→"}{" "}
                {Math.abs(delta)}%
              </Badge>
            )
          )}
        </InlineStack>
        <BlockStack gap="100">
          <Text variant="heading3xl" as="h2">
            {muted ? "—" : value}
          </Text>
          <Text tone="subdued" as="p">
            {label}
          </Text>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

function StatList({ rows, formatLabel }) {
  if (!rows.length) return <Text tone="subdued">No data yet</Text>;
  const top = rows.slice(0, 8);
  const total = rows.reduce((sum, r) => sum + r.count, 0) || 1;
  const max = Math.max(...top.map((r) => r.count), 1);
  return (
    <BlockStack gap="300">
      {top.map((r) => {
        const share = Math.round((r.count / total) * 100);
        return (
          <BlockStack key={r.key} gap="100">
            <InlineStack align="space-between">
              <Text as="span">{formatLabel ? formatLabel(r.key) : r.key}</Text>
              <Text as="span" tone="subdued">
                {share}%
              </Text>
            </InlineStack>
            <CustomBox
              style={{
                width: "100%",
                height: "6px",
                backgroundColor: "var(--p-color-bg-surface-secondary)",
                borderRadius: "3px",
                overflow: "hidden",
              }}
            >
              <CustomBox
                style={{
                  width: `${Math.max(3, Math.round((r.count / max) * 100))}%`,
                  height: "100%",
                  backgroundColor: THEME,
                  borderRadius: "3px",
                }}
              />
            </CustomBox>
          </BlockStack>
        );
      })}
    </BlockStack>
  );
}

// Ranks videos by the composite "top player" score (plays + unique viewers +
// watch time) and crowns the #1. `rows` is data.byVideo — already scored and
// sorted in the loader (see app/utils/topPlayerScore.js). The bar reflects the
// composite score, so its length tracks the ranking, not just play count.
// `onView(videoId)` filters the whole page to that player.
function TopVideos({ rows, onView }) {
  if (!rows.length) return <Text tone="subdued">No plays yet</Text>;
  const top = rows.slice(0, 8);

  const resourceName = {
    singular: "video",
    plural: "videos",
  };

  return (
    <IndexTable
      resourceName={resourceName}
      itemCount={top.length}
      headings={[
        { title: "Player" },
        { title: "Plays" },
        { title: "Viewers" },
        { title: "Watch time" },
        { title: "" },
      ]}
      selectable={false}
    >
      {top.map((r, index) => (
        <IndexTable.Row id={r.videoId} key={r.videoId} position={index}>
          <IndexTable.Cell>
            <InlineStack gap="200" blockAlign="center">
              <Text as="span" fontWeight="bold">
                {index === 0 ? "🏆" : index + 1}
              </Text>
              <Text as="span" fontWeight="bold">
                {r.title || "Untitled"}
              </Text>
              {index === 0 && <Badge tone="success">Top</Badge>}
            </InlineStack>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <BlockStack gap="100">
              <Text as="span" fontWeight="bold">
                {r.plays.toLocaleString()}
              </Text>
              <Text as="span" tone="subdued">
                {r.plays === 1 ? "play" : "plays"}
              </Text>
            </BlockStack>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <BlockStack gap="100">
              <Text as="span" fontWeight="bold">
                {r.unique.toLocaleString()}
              </Text>
              <Text as="span" tone="subdued">
                {r.unique === 1 ? "viewer" : "viewers"}
              </Text>
            </BlockStack>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <BlockStack gap="100">
              <Text as="span" fontWeight="bold">
                {formatWatchSeconds(r.watchSeconds)}
              </Text>
              <Text as="span" tone="subdued">
                watch time
              </Text>
            </BlockStack>
          </IndexTable.Cell>
          <IndexTable.Cell>
            {onView && (
              <Button onClick={() => onView(r.videoId)} variant="plain">
                View details
              </Button>
            )}
          </IndexTable.Cell>
        </IndexTable.Row>
      ))}
    </IndexTable>
  );
}

function SectionCard({ title, action, children, icon, locked }) {
  return (
    <CustomBox className="stretch-card">
      <Card roundedAbove="sm">
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="300" blockAlign="center">
              {icon && <Icon source={icon} tone="base" />}
              <Text variant="headingMd" as="h3">
                {title}
              </Text>
            </InlineStack>
            {locked ? <ProBadge /> : action}
          </InlineStack>
          <Box>{locked ? <ProLock /> : children}</Box>
        </BlockStack>
      </Card>
    </CustomBox>
  );
}

export default function Analytics() {
  const data = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const loading =
    navigation.state === "loading" || revalidator.state === "loading";

  const setParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    setSearchParams(next);
  };

  // Switching scope resets the video selector, since the valid video list
  // differs between "all" and "product".
  const setScope = (value) => {
    if ((data.scope || "all") === value) return;
    const next = new URLSearchParams(searchParams);
    next.set("scope", value);
    next.delete("video");
    setSearchParams(next);
  };

  const applyRange = ({ since, until }) => {
    const next = new URLSearchParams(searchParams);
    next.set("since", since);
    next.set("until", until);
    setSearchParams(next);
  };

  const locked = !data.isPro;
  const scope = data.scope === "product" ? "product" : "all";

  const videoOptions = [
    {
      label: scope === "product" ? "All products" : "All videos",
      value: "all",
    },
    ...data.videos.map((v) => ({ label: v.title || "Untitled", value: v.id })),
  ];
  const maxTrend = Math.max(1, ...data.trend.map((t) => t.count));
  const trendTotal = data.trend.reduce((sum, t) => sum + t.count, 0);
  // Bar heights are scaled to `maxTrend`, so a 3-play peak and a 30,000-play
  // peak draw identically. Naming the bucket width and the peak is what makes
  // the shape readable — without them the chart is decoration. The loader
  // picks the wording because it owns the bucketing.
  const trendBucketLabel = data.trendBucketLabel ?? "Each bar = 1 day";
  const trendWindowNote = data.trendWindowNote ?? null;
  // Which bar the pointer or keyboard focus is on, for the tooltip.
  const [hoverBar, setHoverBar] = useState(null);
  // A tooltip must never be the ONLY way to read a value, so every bucket is
  // also available as plain text.
  const [showTrendTable, setShowTrendTable] = useState(false);

  const countryRows = data.byCountry.slice(0, 8);
  const countriesReached = data.byCountry.length;

  const mapSpinner = (
    <Box padding="800">
      <InlineStack align="center">
        <Spinner accessibilityLabel="Loading map" size="large" />
      </InlineStack>
    </Box>
  );

  const pageActions = (
    <Button
      icon={RefreshIcon}
      onClick={() => revalidator.revalidate()}
      disabled={revalidator.state === "loading"}
      loading={revalidator.state === "loading"}
    >
      Reload
    </Button>
  );

  return (
    <Page
      backAction={{ content: "Dashboard", onAction: () => navigate("/app") }}
      title="Analytics & Reports"
      subtitle="Track how each video performs across your storefront"
      primaryAction={pageActions}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {/* Scope selector */}
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 6, xl: 6 }}>
                <CustomBox
                  onClick={() => setScope("all")}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setScope("all");
                    }
                  }}
                  style={{
                    cursor: loading ? "default" : "pointer",
                    opacity: loading ? 0.7 : 1,
                    border:
                      scope === "all"
                        ? `2px solid ${THEME}`
                        : "1px solid var(--p-color-border)",
                    borderRadius: "var(--p-border-radius-300)",
                    padding: "var(--p-space-400)",
                    backgroundColor:
                      scope === "all"
                        ? "var(--p-color-bg-surface-secondary-active)"
                        : "var(--p-color-bg-surface)",
                    height: "100%",
                    outline: "none",
                  }}
                >
                  <InlineStack
                    blockAlign="center"
                    align="space-between"
                    wrap={false}
                  >
                    <InlineStack gap="400" blockAlign="center" wrap={false}>
                      <Icon
                        source={ChartVerticalIcon}
                        tone={scope === "all" ? "success" : "base"}
                      />
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingSm">
                          All Video Players
                        </Text>
                        <Text as="p" tone="subdued">
                          Analytics across all video players in your store
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    {scope === "all" && <Badge tone="success">Active</Badge>}
                  </InlineStack>
                </CustomBox>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 6, xl: 6 }}>
                <CustomBox
                  onClick={() => setScope("product")}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setScope("product");
                    }
                  }}
                  style={{
                    cursor: loading ? "default" : "pointer",
                    opacity: loading ? 0.7 : 1,
                    border:
                      scope === "product"
                        ? `2px solid ${THEME}`
                        : "1px solid var(--p-color-border)",
                    borderRadius: "var(--p-border-radius-300)",
                    padding: "var(--p-space-400)",
                    backgroundColor:
                      scope === "product"
                        ? "var(--p-color-bg-surface-secondary-active)"
                        : "var(--p-color-bg-surface)",
                    height: "100%",
                    outline: "none",
                  }}
                >
                  <InlineStack
                    blockAlign="center"
                    align="space-between"
                    wrap={false}
                  >
                    <InlineStack gap="400" blockAlign="center" wrap={false}>
                      <Icon
                        source={ProductIcon}
                        tone={scope === "product" ? "success" : "base"}
                      />
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingSm">
                          Product Video
                        </Text>
                        <Text as="p" tone="subdued">
                          Videos assigned to specific products
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    {scope === "product" && (
                      <Badge tone="success">Active</Badge>
                    )}
                  </InlineStack>
                </CustomBox>
              </Grid.Cell>
            </Grid>

            {/* Controls */}
            <Card roundedAbove="sm">
              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 8, xl: 8 }}>
                  <SearchSelect
                    label={scope === "product" ? "Product" : "Video"}
                    options={videoOptions}
                    value={data.selectedVideo}
                    onChange={(v) => setParam("video", v)}
                    disabled={loading}
                    placeholder={
                      scope === "product"
                        ? "Search products…"
                        : "Search videos…"
                    }
                  />
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 2, md: 2, lg: 4, xl: 4 }}>
                  <BlockStack gap="100">
                    <Text as="label" variant="bodyMd">
                      Date range
                    </Text>
                    <AnalyticsDateRange
                      value={{ since: data.since, until: data.until }}
                      onApply={applyRange}
                      disabled={loading}
                    />
                  </BlockStack>
                </Grid.Cell>
              </Grid>
            </Card>

            {locked && (
              <Card background="bg-surface-secondary">
                <InlineStack
                  align="space-between"
                  blockAlign="center"
                  wrap={false}
                >
                  <InlineStack gap="400" blockAlign="center" wrap={false}>
                    <Icon source={LockIcon} tone="base" />
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingSm">
                        Unlock full analytics with Pro
                      </Text>
                      <Text as="p" tone="subdued">
                        Free plans see Total plays only. Upgrade to view
                        viewers, watch time, devices, countries and more.
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <UpgradeButton />
                </InlineStack>
              </Card>
            )}

            {/* KPI cards */}
            <InlineGrid
              columns={{ xs: 2, sm: 3, md: 3, lg: 5, xl: 5 }}
              gap="400"
            >
              <Kpi
                icon={PlayCircleIcon}
                label="Total plays"
                value={data.totalPlays.toLocaleString()}
                sub="Play events for the selected period"
                delta={data.deltaPlays}
                loading={loading}
              />
              <Kpi
                icon={PersonIcon}
                label="Unique viewers"
                value={(data.uniqueVisitors ?? 0).toLocaleString()}
                sub="Distinct visitors in this period"
                delta={data.deltaViewers}
                locked={locked}
                loading={loading}
              />
              <Kpi
                icon={ClockIcon}
                label="Avg play time"
                value={data.avgPlayTime}
                sub="Average watch time per play"
                locked={locked}
                loading={loading}
              />
              <Kpi
                icon={PlayCircleIcon}
                label="Total watch time"
                value={data.totalWatchHours}
                sub="Combined hours watched this period"
                delta={data.deltaWatch}
                locked={locked}
                loading={loading}
              />
              <Kpi
                icon={GlobeIcon}
                label="Countries reached"
                value={countriesReached.toLocaleString()}
                sub="Regions with at least one play"
                locked={locked}
                loading={loading}
              />
            </InlineGrid>

            {/* Breakdowns */}
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                <SectionCard title="Browsers" icon={GlobeIcon} locked={locked}>
                  <StatList rows={data.byBrowser} />
                </SectionCard>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                <SectionCard title="Devices" icon={DesktopIcon} locked={locked}>
                  <StatList rows={data.byDevice} />
                </SectionCard>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                <SectionCard
                  title="Operating systems"
                  icon={MobileIcon}
                  locked={locked}
                >
                  <StatList rows={data.byOS} />
                </SectionCard>
              </Grid.Cell>
            </Grid>

            {/* Map + top countries, side by side */}
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 8, xl: 8 }}>
                <SectionCard
                  title="Plays by Country"
                  icon={GlobeIcon}
                  locked={locked}
                  action={
                    data.unknownCountry ? (
                      <Badge>{`${data.unknownCountry} unknown`}</Badge>
                    ) : null
                  }
                >
                  <ClientOnly fallback={mapSpinner}>
                    {() => (
                      <Suspense fallback={mapSpinner}>
                        <WorldMap data={data.byCountry} themeColor={THEME} />
                      </Suspense>
                    )}
                  </ClientOnly>
                </SectionCard>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                <SectionCard
                  title="Top countries"
                  icon={LocationIcon}
                  locked={locked}
                >
                  <StatList
                    rows={countryRows.map((c) => ({
                      key: c.code,
                      count: c.count,
                    }))}
                    formatLabel={(code) =>
                      `${flagEmoji(code)} ${countryName(code)}`
                    }
                  />
                </SectionCard>
              </Grid.Cell>
            </Grid>

            {/* Plays over time — full width */}
            <SectionCard
              icon={ChartVerticalIcon}
              locked={locked}
              title={
                data.since === data.until
                  ? "Plays (hourly)"
                  : "Plays over time"
              }
              action={
                !locked && trendTotal > 0 ? (
                  <s-button
                    variant="secondary"
                    onClick={() => setShowTrendTable((v) => !v)}
                  >
                    {showTrendTable ? "Show chart" : "Show table"}
                  </s-button>
                ) : null
              }
            >
              <BlockStack gap="300">
                {/* The two facts the bars themselves never state: how wide
                    one bucket is, and what the tallest bar is worth. */}
<s-text color="subdued">
                  {trendBucketLabel}
                  {trendWindowNote ? ` · ${trendWindowNote}` : ""}
                  {trendTotal > 0
                    ? ` · peak ${maxTrend.toLocaleString()} ${maxTrend === 1 ? "play" : "plays"} · ${trendTotal.toLocaleString()} ${trendWindowNote ? "in view" : "total"}`
                    : ""}
                </s-text>

                {trendTotal === 0 ? (
                  <s-box padding="large-200">
                    <s-stack
                      direction="block"
                      gap="small-300"
                      alignItems="center"
                    >
                      <s-text>No plays in this date range</s-text>
                      <s-text color="subdued">
                        Pick a wider range, or check back once shoppers
                        start watching your videos.
                      </s-text>
                    </s-stack>
                  </s-box>
                ) : showTrendTable ? (
                  <s-stack direction="block" gap="small-400">
                    {data.trend
                      .filter((t) => t.count > 0)
                      .map((t) => (
                        <s-stack
                          key={t.label}
                          direction="inline"
                          justifyContent="space-between"
                          gap="base"
                        >
                          <s-text color="subdued">{t.range}</s-text>
                          <s-text>
                            {t.count.toLocaleString()}
                            {t.count === 1 ? " play" : " plays"}
                          </s-text>
                        </s-stack>
                      ))}
                  </s-stack>
                ) : (
                  <CustomBox style={{ display: "flex", gap: "8px" }}>
                    {/* y-axis. Two ticks is all a 200px plot can carry
                        without crowding, and it is enough to stop the
                        reader guessing the scale. */}
                    <CustomBox
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        height: "200px",
                        flexShrink: 0,
                        textAlign: "right",
                      }}
                    >
                      <Text as="span" variant="bodySm" tone="subdued">
                        {maxTrend.toLocaleString()}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        0
                      </Text>
                    </CustomBox>

                    <CustomBox style={{ flex: 1 }}>
                      {/* The plot area is its own positioning context and
                          is exactly as tall as the bars, so the `top: 100%`
                          gridline lands on the baseline rather than under
                          the x-axis labels below. */}
                      <CustomBox style={{ position: "relative" }}>
                        {[0, 100].map((top) => (
                          <CustomBox
                            key={top}
                            style={{
                              position: "absolute",
                              top: `${top}%`,
                              left: 0,
                              right: 0,
                              borderTop:
                                "1px solid var(--p-color-border-secondary)",
                              pointerEvents: "none",
                            }}
                          />
                        ))}
                        <CustomBox
                        style={{
                          display: "flex",
                          height: "200px",
                          alignItems: "flex-end",
                          gap: "2px",
                        }}
                      >
                        {data.trend.map((t, i) => {
                          const barPct = Math.max(
                            2,
                            Math.round((t.count / maxTrend) * 100),
                          );
                          return (
                          // The whole column is the hit target, not just
                          // the painted bar — a 4px-tall bar is otherwise
                          // impossible to hover. tabIndex keeps the value
                          // reachable by keyboard.
                          <CustomBox
                            key={t.label}
                            tabIndex={0}
                            role="img"
                            aria-label={`${t.range}: ${t.count.toLocaleString()} plays`}
                            onMouseEnter={() => setHoverBar(i)}
                            onMouseLeave={() => setHoverBar(null)}
                            onFocus={() => setHoverBar(i)}
                            onBlur={() => setHoverBar(null)}
                            style={{
                              flex: 1,
                              height: "100%",
                              display: "flex",
                              alignItems: "flex-end",
                              // Centred so a width-capped bar stays under its
                              // axis tick, which centres on the slot.
                              justifyContent: "center",
                              position: "relative",
                              cursor: "default",
                              outline: "none",
                            }}
                          >
                            <CustomBox
                              style={{
                                width: "100%",
                                // A 5-bar year view would otherwise draw
                                // 200px slabs of solid brand colour.
                                maxWidth: "56px",
                                backgroundColor:
                                  t.count > 0 ? THEME : "transparent",
                                // Dim the others rather than brighten the
                                // hovered bar: the peak stays the peak.
                                opacity:
                                  hoverBar === null || hoverBar === i
                                    ? 1
                                    : 0.4,
                                borderRadius: "4px 4px 0 0",
                                height: `${barPct}%`,
                                minHeight: t.count > 0 ? "4px" : "0",
                                transition:
                                  "height 0.3s ease, opacity 0.15s ease",
                              }}
                            />
                            {hoverBar === i && (
                              <CustomBox
                                style={{
                                  position: "absolute",
                                  // Sits just above its own bar. The min()
                                  // keeps the tallest bar's tooltip inside
                                  // the plot instead of over the heading.
                                  bottom: `min(calc(${barPct}% + 6px), calc(100% - 46px))`,
                                  // Edge bars anchor to their own side so
                                  // the tooltip never hangs off the card.
                                  ...(i <= 1
                                    ? { left: 0 }
                                    : i >= data.trend.length - 2
                                      ? { right: 0 }
                                      : {
                                          left: "50%",
                                          transform: "translateX(-50%)",
                                        }),
                                  zIndex: 5,
                                  pointerEvents: "none",
                                  whiteSpace: "nowrap",
                                  background:
                                    "var(--p-color-bg-surface-inverse, #1a1a1a)",
                                  color:
                                    "var(--p-color-text-inverse, #ffffff)",
                                  padding: "6px 10px",
                                  borderRadius: "8px",
                                  boxShadow:
                                    "0 4px 12px rgba(0, 0, 0, 0.18)",
                                  fontSize: "12px",
                                  lineHeight: 1.4,
                                }}
                              >
                                {/* Value first, label second — the reader
                                    already knows which bar they are on. */}
                                <CustomBox style={{ fontWeight: 600 }}>
                                  {t.count.toLocaleString()}
                                  {t.count === 1 ? " play" : " plays"}
                                </CustomBox>
                                <CustomBox style={{ opacity: 0.75 }}>
                                  {t.range}
                                </CustomBox>
                              </CustomBox>
                            )}
                          </CustomBox>
                          );
                        })}
                        </CustomBox>
                      </CustomBox>

                      {/* Ticks are positioned absolutely rather than sitting
                          in per-bar flex slots. A slot is only ~35px wide and a
                          tick like "2025-11" is ~50px, and `text-align` does
                          nothing once the line is wider than its container —
                          the text starts at the left content edge and overflows
                          RIGHT, which is what pushed the final tick off the
                          card. Anchoring the last tick to `right: 0` and the
                          first to `left: 0` makes clipping impossible.
                          Polaris <Text> is avoided here because it drops
                          `style`, which is why the old opacity-based thinning
                          silently rendered every tick. */}
                      <CustomBox
                        style={{
                          position: "relative",
                          height: "16px",
                          marginTop: "6px",
                        }}
                      >
                        {data.trend.map((t, i) => {
                          // Every bucket is labelled — no thinning. The tick
                          // formats above are chosen to stay narrow enough for
                          // the densest case (30 daily bars).
                          const isFirst = i === 0;
                          const isLast = i === data.trend.length - 1;
                          // Exact centre of bar i, accounting for the 2px gaps
                          // the bar row uses, so a tick lines up with its bar.
                          const gaps = (data.trend.length - 1) * 2;
                          const frac = (i + 0.5) / data.trend.length;
                          return (
                            <CustomSpan
                              key={t.label}
                              style={{
                                position: "absolute",
                                top: 0,
                                ...(isLast
                                  ? { right: 0 }
                                  : isFirst
                                    ? { left: 0 }
                                    : {
                                        left: `calc((100% - ${gaps}px) * ${frac.toFixed(6)} + ${i * 2}px)`,
                                        transform: "translateX(-50%)",
                                      }),
                                fontSize: "11px",
                                lineHeight: 1.3,
                                whiteSpace: "nowrap",
                                color: "var(--p-color-text-secondary)",
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {t.tick ?? t.label}
                            </CustomSpan>
                          );
                        })}
                      </CustomBox>
                    </CustomBox>
                  </CustomBox>
                )}
              </BlockStack>
            </SectionCard>

            {/* Top videos table */}
            <SectionCard
              title="Top videos"
              icon={PlayCircleIcon}
              locked={locked}
            >
              <TopVideos
                rows={data.byVideo}
                onView={(id) => setParam("video", id)}
              />
            </SectionCard>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// Scoped error boundary: keeps a failure on this page contained here (with the
// real message visible) instead of bubbling up to the app-wide "Application
// Error" screen. Thrown Responses (e.g. Shopify auth redirects) are handed back
// to Shopify's boundary so their headers propagate correctly.
export function ErrorBoundary() {
  const error = useRouteError();

  if (error instanceof Response || error?.status) {
    return boundary.error(error);
  }

  const message =
    error?.message || "Something went wrong while loading analytics.";

  return (
    <Page>
      <Layout>
        <Layout.Section>
          <Card padding="500">
            <BlockStack gap="400">
              <Text as="h1" variant="headingLg">
                Analytics couldn't load
              </Text>
              <Text as="p" tone="subdued">
                {message}
              </Text>
              <InlineStack>
                <Button onClick={() => window.location.reload()}>
                  Reload page
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
