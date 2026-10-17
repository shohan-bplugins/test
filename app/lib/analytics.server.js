import prisma from "../db.server";
import geoip from "geoip-lite";

// Route files should import the client-safe constants (ALL_PLAYERS_VALUE,
// COMING_SOON_PLAYER_TYPES, PLAYER_TYPE_LABELS) from ./analytics-shared so
// this server-only module never gets pulled into the client bundle.

export function countryFromIp(ip) {
  if (!ip || ip === "Unknown") return null;
  try {
    return geoip.lookup(ip)?.country || null;
  } catch {
    return null;
  }
}

export function resolveFromDate(filter) {
  const now = new Date();
  if (filter === "today") return new Date(now.setHours(0, 0, 0, 0));
  if (filter === "last7") return new Date(now.setDate(now.getDate() - 7));
  if (filter === "last30") return new Date(now.setDate(now.getDate() - 30));
  return null;
}

function parseYmd(value, endOfDay = false) {
  if (!value || typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, 0, 0, 0, 0));
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setUTCHours(23, 59, 59, 999);
  return date;
}

export function resolveDateRange(filter, customFrom, customTo) {
  if (filter === "custom") {
    return {
      from: parseYmd(customFrom),
      to: parseYmd(customTo, true),
    };
  }
  return { from: resolveFromDate(filter), to: null };
}

const EMPTY_ANALYTICS = {
  totalPlay: 0,
  avgPlayTime: 0,
  uniqueDevices: 0,
  sumaryData: { devices: {}, browsers: {}, os: {}, totalDuration: 0 },
  dailyPlays: [],
  countryPlays: [],
};

// Derive a coarse operating-system label from a raw user-agent string.
function osFromUserAgent(ua) {
  if (!ua) return "Unknown";
  const s = ua.toLowerCase();
  if (/windows/.test(s)) return "Windows";
  if (/iphone|ipad|ipod/.test(s)) return "iOS";
  if (/android/.test(s)) return "Android";
  if (/mac os x|macintosh/.test(s)) return "macOS";
  if (/cros/.test(s)) return "Chrome OS";
  if (/linux/.test(s)) return "Linux";
  return "Unknown";
}

export async function buildAnalytics({
  shop,
  audioId,
  audioIds,
  filter,
  customFrom,
  customTo,
  isFree,
}) {
  // Explicit empty set means "no audios match" — return zeros without querying.
  if (Array.isArray(audioIds) && audioIds.length === 0) {
    return { ...EMPTY_ANALYTICS };
  }

  const { from: fromDate, to: toDate } = resolveDateRange(
    filter,
    customFrom,
    customTo,
  );
  const whereFilter = {
    shop,
    ...(audioId && { audioId }),
    ...(audioIds && audioIds.length > 0 && { audioId: { in: audioIds } }),
    ...((fromDate || toDate) && {
      calledAt: {
        ...(fromDate && { gte: fromDate }),
        ...(toDate && { lte: toDate }),
      },
    }),
  };

  const events = await prisma.analytics.findMany({
    where: whereFilter,
    select: {
      id: true,
      audioId: true,
      sessionId: true,
      calledAt: true,
      duration: true,
      userAgent: true,
      device: true,
      browser: true,
      event: true,
    },
  });

  let countryRows = [];
  if (!isFree) {
    try {
      countryRows = await prisma.analytics.findMany({
        where: whereFilter,
        select: {
          country: true,
          ipAddress: true,
          event: true,
          sessionId: true,
          id: true,
          audioId: true,
          calledAt: true,
        },
      });
    } catch (e) {
      console.warn("Country/IP select failed:", e);
      try {
        countryRows = await prisma.analytics.findMany({
          where: whereFilter,
          select: {
            ipAddress: true,
            event: true,
            sessionId: true,
            id: true,
            audioId: true,
            calledAt: true,
          },
        });
      } catch {
        countryRows = [];
      }
    }
  }

  const DUP_WINDOW_MS = 2000;
  // De-dupe per audio + session so repeated "play" events from the same player
  // collapse, but two different players in one session still count separately.
  // This keeps a player's total, the top-played ranking, and the summed total
  // all consistent with each other.
  const dedupeKey = (e) =>
    `${e?.audioId ?? "?"}::${e?.sessionId || `row:${e?.id}`}`;
  const lastPlayAt = new Map();

  const playEvents = events
    .filter((e) => e?.event === "play")
    .slice()
    .sort((a, b) => {
      const ta = a?.calledAt ? new Date(a.calledAt).getTime() : 0;
      const tb = b?.calledAt ? new Date(b.calledAt).getTime() : 0;
      return ta - tb;
    })
    .filter((e) => {
      const ts = e?.calledAt ? new Date(e.calledAt).getTime() : 0;
      const key = dedupeKey(e);
      const prev = lastPlayAt.get(key);
      if (prev !== undefined && ts - prev < DUP_WINDOW_MS) return false;
      lastPlayAt.set(key, ts);
      return true;
    });

  const durationEvents = events.filter(
    (e) => e?.event === "ended" || e?.event === "unload",
  );
  const totalPlay = playEvents.length;

  if (isFree) {
    return {
      ...EMPTY_ANALYTICS,
      totalPlay,
    };
  }

  let totalDuration = 0;
  let durationSamples = 0;
  const userAgentSet = new Set();
  const deviceMap = {};
  const browserMap = {};
  const osMap = {};
  const dailyMap = {};
  const countryMap = {};

  playEvents.forEach((e) => {
    if (e?.userAgent) userAgentSet.add(e.userAgent);
    const device = e?.device || "Unknown";
    deviceMap[device] = (deviceMap[device] || 0) + 1;
    const browser = e?.browser || "Unknown";
    browserMap[browser] = (browserMap[browser] || 0) + 1;
    const os = osFromUserAgent(e?.userAgent);
    osMap[os] = (osMap[os] || 0) + 1;

    if (e?.calledAt) {
      const ts = new Date(e.calledAt);
      if (!Number.isNaN(ts.getTime())) {
        const date = ts.toISOString().split("T")[0];
        dailyMap[date] = (dailyMap[date] || 0) + 1;
      }
    }
  });

  durationEvents.forEach((e) => {
    const duration = Number.isFinite(e?.duration) ? e.duration : 0;
    if (duration > 0) {
      totalDuration += duration;
      durationSamples += 1;
    }
  });

  const lastCountryAt = new Map();
  countryRows
    .filter((r) => r?.event === "play")
    .slice()
    .sort((a, b) => {
      const ta = a?.calledAt ? new Date(a.calledAt).getTime() : 0;
      const tb = b?.calledAt ? new Date(b.calledAt).getTime() : 0;
      return ta - tb;
    })
    .forEach((row) => {
      const ts = row?.calledAt ? new Date(row.calledAt).getTime() : 0;
      const key = dedupeKey(row);
      const prev = lastCountryAt.get(key);
      if (prev !== undefined && ts - prev < DUP_WINDOW_MS) return;
      lastCountryAt.set(key, ts);
      const country =
        row?.country || countryFromIp(row?.ipAddress) || "Unknown";
      countryMap[country] = (countryMap[country] || 0) + 1;
    });

  const avgPlayTime = durationSamples
    ? Number((totalDuration / durationSamples).toFixed(2))
    : 0;
  const uniqueDevices = userAgentSet.size;

  const dailyPlays = Object.keys(dailyMap)
    .sort()
    .map((date) => ({ data: date, totalTime: dailyMap[date] }));
  const countryPlays = Object.entries(countryMap).map(([country, plays]) => ({
    country,
    plays,
  }));

  return {
    totalPlay,
    avgPlayTime,
    uniqueDevices,
    sumaryData: {
      devices: deviceMap,
      browsers: browserMap,
      os: osMap,
      totalDuration,
    },
    dailyPlays,
    countryPlays,
  };
}

// Rank audio players by play count within a time period. Returns
// [{ audioId, plays }, ...] sorted desc. Pass the candidate audioIds to scope
// it (e.g. all supported players, or only product-assigned players).
export async function buildPlayerRanking({
  shop,
  audioIds,
  filter,
  customFrom,
  customTo,
}) {
  if (!Array.isArray(audioIds) || audioIds.length === 0) return [];

  const { from: fromDate, to: toDate } = resolveDateRange(
    filter,
    customFrom,
    customTo,
  );

  const where = {
    shop,
    audioId: { in: audioIds },
    event: "play",
    ...((fromDate || toDate) && {
      calledAt: {
        ...(fromDate && { gte: fromDate }),
        ...(toDate && { lte: toDate }),
      },
    }),
  };

  try {
    // Count plays with the SAME de-duplication buildAnalytics uses for the
    // detail view, so a player's ranking count matches the total shown when you
    // open its details. A raw groupBy count would over-count repeated "play"
    // events fired by the same session within a short window.
    const events = await prisma.analytics.findMany({
      where,
      select: { id: true, audioId: true, sessionId: true, calledAt: true },
    });

    const DUP_WINDOW_MS = 2000;
    const lastPlayAt = new Map();
    const counts = new Map();

    events
      .slice()
      .sort((a, b) => {
        const ta = a?.calledAt ? new Date(a.calledAt).getTime() : 0;
        const tb = b?.calledAt ? new Date(b.calledAt).getTime() : 0;
        return ta - tb;
      })
      .forEach((e) => {
        if (!e?.audioId) return;
        const ts = e?.calledAt ? new Date(e.calledAt).getTime() : 0;
        // Scope the de-dupe per audio so each player is counted exactly like
        // its own detail view (which filters to that single audioId).
        const key = `${e.audioId}::${e?.sessionId || `row:${e?.id}`}`;
        const prev = lastPlayAt.get(key);
        if (prev !== undefined && ts - prev < DUP_WINDOW_MS) return;
        lastPlayAt.set(key, ts);
        counts.set(e.audioId, (counts.get(e.audioId) || 0) + 1);
      });

    return Array.from(counts.entries())
      .map(([audioId, plays]) => ({ audioId, plays }))
      .sort((a, b) => b.plays - a.plays);
  } catch (e) {
    console.error("buildPlayerRanking failed:", e?.message);
    return [];
  }
}

// Fetch the user's plan (`isFree`) — used by both v1 and v2 analytics loaders.
export async function loadShopPlan(shop) {
  const user = await prisma.Users.findUnique({
    where: { shop },
    select: { id: true, cardits: true, planId: true },
  });
  let plan = null;
  if (user?.planId) {
    plan = await prisma.Plans.findUnique({
      where: { id: user.planId },
      select: { id: true, name: true },
    });
  }
  const isFree = !plan || plan?.name === "Free";
  return { user, plan, isFree };
}
