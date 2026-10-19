// Client-safe analytics constants. Importing this from a route file does NOT
// pull server-only code (prisma, geoip) into the client bundle.

export const ALL_PLAYERS_VALUE = "all";
export const COMING_SOON_PLAYER_TYPES = new Set(["playlist-audio"]);

export const PLAYER_TYPE_LABELS = {
  "single-audio": "Single Audio",
  "playlist-audio": "Playlist",
  "sticky-player": "Sticky Player",
  "sticky-single-button": "Sticky Single Button",
};

// ---------------------------------------------------------------------------
// Date ranges and plan access for Analytics & Reports.
//
// The URL carries `filter` (preset key), `since`/`until` (YYYY-MM-DD in the
// merchant's own calendar) and `tzo` (the browser's getTimezoneOffset()).
// `filter=all` means All time and has no dates. Anything else without a valid
// since/until falls back to Today.

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_TZO_MINUTES = 14 * 60;

export function isYmd(value) {
  const m = typeof value === "string" ? YMD_RE.exec(value) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === value;
}

// Add whole days to a YYYY-MM-DD string.
export function shiftYmd(ymd, days) {
  const m = YMD_RE.exec(ymd);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
  return d.toISOString().slice(0, 10);
}

// Browser timezone offset from the URL, or null when missing/invalid.
export function parseTzo(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > MAX_TZO_MINUTES) return null;
  return Math.round(n);
}

// The merchant's "today". Without a usable tzo, the server's local date.
export function todayYmd(tzo, now = Date.now()) {
  const offset = tzo === null ? new Date(now).getTimezoneOffset() : tzo;
  return new Date(now - offset * 60000).toISOString().slice(0, 10);
}

// Client-side: since/until for a preset, in the browser's own calendar.
export function presetDates(filter, today) {
  if (filter === "yesterday") {
    const y = shiftYmd(today, -1);
    return { since: y, until: y };
  }
  if (filter === "last7") return { since: shiftYmd(today, -6), until: today };
  if (filter === "last30") return { since: shiftYmd(today, -29), until: today };
  if (filter === "all") return { since: "", until: "" };
  return { since: today, until: today };
}

// Read the range from a URL. Always returns a usable range (Today fallback).
export function resolveAnalyticsRange(searchParams, now = Date.now()) {
  const tzo = parseTzo(searchParams.get("tzo"));
  const today = todayYmd(tzo, now);
  const filter = searchParams.get("filter") || "";
  if (filter === "all") {
    return { filter: "all", since: "", until: "", today, tzo, isAll: true };
  }
  const since = searchParams.get("since") || "";
  const until = searchParams.get("until") || "";
  if (isYmd(since) && isYmd(until) && since <= until) {
    // The dates decide; the label follows them (a stale "Last 7 days" link
    // from last week shows as a custom range, not as Last 7 days).
    return {
      filter: presetFor(since, until, today),
      since,
      until,
      today,
      tzo,
      isAll: false,
    };
  }
  return {
    filter: "today",
    since: today,
    until: today,
    today,
    tzo,
    isAll: false,
  };
}

const DATED_PRESETS = ["today", "yesterday", "last7", "last30"];

// The preset whose dates match since/until exactly, else "custom".
export function presetFor(since, until, today) {
  return (
    DATED_PRESETS.find((key) => {
      const p = presetDates(key, today);
      return p.since === since && p.until === until;
    }) || "custom"
  );
}

export const isTodayRange = (range) =>
  !range.isAll && range.since === range.today && range.until === range.today;

// "full" | "limited" | "locked". Pro is always full. Only these exact ranges
// count for Free: Today (full), Yesterday and Last 7 days (limited). Product
// scope is free on Today only.
export function analyticsAccess({ isPro, range, scope = "all" }) {
  if (isPro) return "full";
  if (isTodayRange(range)) return "full";
  if (scope === "product") return "locked";
  const yesterday = shiftYmd(range.today, -1);
  const isYesterday = range.since === yesterday && range.until === yesterday;
  const isLast7 =
    range.since === shiftYmd(range.today, -6) && range.until === range.today;
  return !range.isAll && (isYesterday || isLast7) ? "limited" : "locked";
}
