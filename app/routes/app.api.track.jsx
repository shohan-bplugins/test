import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import { hit } from "../utils/rateLimit.server";

const prisma = new PrismaClient();

// Salt for hashing visitor IPs. We store only the hash (never the raw IP) so a
// play can be attributed to a network without retaining personal data.
const IP_SALT = process.env.IP_HASH_SALT || "svp-default-ip-salt";

// One-way hash of a client IP → a short, stable "network" fingerprint. A VPN
// changes the IP, so it changes this hash, which is what lets a device on a new
// network count as a distinct unique view. Returns null when we have no IP.
function hashIp(ip) {
  if (!ip) return null;
  return crypto
    .createHash("sha256")
    .update(IP_SALT + "|" + ip)
    .digest("hex")
    .slice(0, 16);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// Flood protection. A real viewer sends one beacon when a play starts and a few
// more on pause / end / tab close, so these ceilings sit far above normal use.
//   - per visitor IP, per shop: 120 beacons a minute (keyed by shop too, so
//     visitors behind one shared IP on different stores don't collide)
//   - per play: 30 updates a minute (stops watch-time hammering on one row)
//   - per video: 300 NEW plays a minute (holds even with rotated/forged IPs,
//     and caps how fast fake rows can be added)
const PER_IP_SHOP = { limit: 120, windowMs: 60 * 1000 };
const PER_PLAY = { limit: 30, windowMs: 60 * 1000 };
const PER_VIDEO_NEW_PLAYS = { limit: 300, windowMs: 60 * 1000 };

function tooManyRequests(retryAfter) {
  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
      ...corsHeaders,
    },
  });
}

// Browser names we accept from the client-side hint. The hint exists because
// some browsers are indistinguishable server-side: Brave ships Chrome's exact
// user-agent string, so only the page (via navigator.brave) can tell.
const ALLOWED_BROWSER_HINTS = new Set([
  "Brave",
  "Chrome",
  "Firefox",
  "Safari",
  "Edge",
  "Opera",
  "Samsung Internet",
]);

// Chromium browsers also send a Sec-CH-UA header listing brand names, which —
// unlike the user-agent string — distinguishes Brave/Edge/Opera from Chrome.
function browserFromClientHints(request) {
  const ch = request.headers.get("sec-ch-ua") || "";
  if (!ch) return null;
  if (/Brave/i.test(ch)) return "Brave";
  if (/Microsoft Edge/i.test(ch)) return "Edge";
  if (/OPR|Opera/i.test(ch)) return "Opera";
  if (/Samsung/i.test(ch)) return "Samsung Internet";
  if (/Google Chrome/i.test(ch)) return "Chrome";
  // Brand list without a recognizable name (e.g. bare "Chromium") — let the
  // user-agent parse decide.
  return null;
}

// Parse a user-agent string into browser / os / device-type.
function parseUserAgent(ua = "") {
  const s = ua || "";

  let browser = "Unknown";
  if (/Edg\//i.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(s)) browser = "Opera";
  else if (/SamsungBrowser/i.test(s)) browser = "Samsung Internet";
  else if (/Chrome\//i.test(s) && !/Chromium/i.test(s)) browser = "Chrome";
  else if (/CriOS/i.test(s)) browser = "Chrome";
  else if (/Firefox\/|FxiOS/i.test(s)) browser = "Firefox";
  else if (/Version\/.*Safari/i.test(s) || /Safari/i.test(s)) browser = "Safari";
  else if (/MSIE|Trident/i.test(s)) browser = "Internet Explorer";

  let os = "Unknown";
  if (/Windows NT/i.test(s)) os = "Windows";
  else if (/Mac OS X/i.test(s) && !/Mobile/i.test(s)) os = "macOS";
  else if (/Android/i.test(s)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(s)) os = "iOS";
  else if (/Linux/i.test(s)) os = "Linux";

  let device = "Desktop";
  if (/Tablet|iPad/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s))) device = "Tablet";
  else if (/Mobi|iPhone|iPod|Android.*Mobile/i.test(s)) device = "Mobile";

  return { browser, os, device };
}

// Pull the real visitor IP out of the proxy/edge headers. On Fly.io the
// trustworthy one is `Fly-Client-IP`; `X-Forwarded-For` is a fallback (first
// hop is the client). `X-Real-IP` covers nginx-style proxies.
function getClientIp(request) {
  const h = request.headers;
  const xff = h.get("x-forwarded-for");
  const ip =
    h.get("fly-client-ip") ||
    h.get("cf-connecting-ip") ||
    h.get("true-client-ip") ||
    (xff ? xff.split(",")[0] : "") ||
    h.get("x-real-ip") ||
    "";
  return ip.trim();
}

// Private / loopback / link-local ranges — never worth a geo lookup.
function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  return (
    /^127\./.test(ip) ||
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^169\.254\./.test(ip) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)
  );
}

// GET a JSON url with a hard timeout; null on any failure.
async function fetchJson(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Free geo APIs, tried in order until one answers. Each returns an alpha-2
// code or null. Multiple providers because each is individually rate-limited.
const GEO_PROVIDERS = [
  async (ip) => {
    // 45 req/min free; http-only on the free tier (fine server-side).
    const d = await fetchJson(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode`,
      1500,
    );
    return d && d.status === "success" ? d.countryCode : null;
  },
  async (ip) => {
    const d = await fetchJson(
      `https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country_code`,
      1500,
    );
    return d && d.success ? d.country_code : null;
  },
  async (ip) => {
    const d = await fetchJson(
      `https://api.country.is/${encodeURIComponent(ip)}`,
      1500,
    );
    return d && d.country ? d.country : null;
  },
];

// ip -> alpha-2 code for this process. Bounded; cleared when it grows too big.
const countryCache = new Map();
// ip -> timestamp of the last time every provider failed. Stops repeated
// beacons of the same play from hammering rate-limited providers.
const countryFailedAt = new Map();
const FAIL_RETRY_MS = 10 * 60 * 1000;

// Look up an alpha-2 country code from an IP. Used as a fallback when no edge
// header is present. Free geo APIs rate-limit hard — at production play volume
// a lookup-per-play exhausted ipwho.is within days and every country came back
// null — so external calls are the LAST resort:
//   1. in-process cache (same IP this process lifetime),
//   2. reuse the country a previous play from the same network already
//      resolved (ipHash is a deterministic hash of the IP),
//   3. provider chain, first answer wins.
async function lookupCountryByIp(ip) {
  if (isPrivateIp(ip)) return null;
  if (countryCache.has(ip)) return countryCache.get(ip);
  const failedAt = countryFailedAt.get(ip);
  if (failedAt && Date.now() - failedAt < FAIL_RETRY_MS) return null;

  let code = null;
  try {
    const prev = await prisma.videoPlay.findFirst({
      where: { ipHash: hashIp(ip), country: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { country: true },
    });
    if (prev?.country) code = prev.country;
  } catch (e) {
    // e.g. transient DB error — fall through to the providers.
  }

  for (let i = 0; !code && i < GEO_PROVIDERS.length; i++) {
    try {
      const c = await GEO_PROVIDERS[i](ip);
      if (c) code = String(c).toUpperCase().slice(0, 2);
    } catch (e) {
      // Provider failed — try the next one.
    }
  }

  if (code) {
    if (countryCache.size > 5000) countryCache.clear();
    countryCache.set(ip, code);
    countryFailedAt.delete(ip);
  } else {
    if (countryFailedAt.size > 5000) countryFailedAt.clear();
    countryFailedAt.set(ip, Date.now());
  }
  return code;
}

// Determine the visitor's country. Prefer fast edge/proxy headers; if the host
// doesn't provide one (Fly.io), fall back to an IP-based geo lookup.
async function getCountry(request) {
  const h = request.headers;
  const fromHeader =
    h.get("cf-ipcountry") ||
    h.get("x-vercel-ip-country") ||
    h.get("x-shopify-country") ||
    h.get("x-country-code") ||
    h.get("x-appengine-country") ||
    null;
  if (fromHeader && fromHeader.toUpperCase() !== "XX") {
    return fromHeader.toUpperCase().slice(0, 2);
  }
  return await lookupCountryByIp(getClientIp(request));
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return new Response(JSON.stringify({ message: "Use POST" }), {
    status: 405,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      body = {};
    }

    const videoId = (body.videoId || body.id || "").toString();
    if (!/^[a-f0-9]{24}$/i.test(videoId)) {
      return new Response(JSON.stringify({ error: "Invalid videoId" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Look up the video so we can attribute the play to the right shop.
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { id: true, shop: true, title: true },
    });

    if (!video) {
      return new Response(JSON.stringify({ error: "Video not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const ipLimit = hit(
      `track:${getClientIp(request) || "unknown"}:${video.shop}`,
      PER_IP_SHOP,
    );
    if (!ipLimit.ok) return tooManyRequests(ipLimit.retryAfter);

    const ua = request.headers.get("user-agent") || "";
    const { browser: uaBrowser, os, device } = parseUserAgent(ua);

    // Most-specific signal wins: the page-side hint (only source that can see
    // Brave), then the Sec-CH-UA brand header, then the user-agent string.
    const hintedBrowser = (body.browser || "").toString();
    const browser =
      (ALLOWED_BROWSER_HINTS.has(hintedBrowser) ? hintedBrowser : null) ||
      browserFromClientHints(request) ||
      uaBrowser;

    let referrer = (body.referrer || request.headers.get("referer") || "").toString();
    if (referrer.length > 500) referrer = referrer.slice(0, 500);

    // The page the play happened on (current page) — used to attribute the
    // play to the product page vs. a single video player on other pages.
    let pageUrl = (body.pageUrl || "").toString();
    if (pageUrl.length > 500) pageUrl = pageUrl.slice(0, 500);

    // Attribute the play to a product page once, here, instead of regex-matching
    // pageUrl/referrer on every dashboard read. pageUrl is the page the play
    // happened on; referrer is the fallback for older players that don't send it.
    const isProductPage =
      pageUrl.includes("/products/") || referrer.includes("/products/");

    let visitorId = (body.visitorId || "").toString();
    if (visitorId.length > 64) visitorId = visitorId.slice(0, 64);

    let playId = (body.playId || "").toString();
    if (playId.length > 64) playId = playId.slice(0, 64);

    // Watched seconds: clamp to a sane non-negative integer (cap at 24h).
    let watchedSeconds = Math.round(Number(body.watchedSeconds));
    if (!Number.isFinite(watchedSeconds) || watchedSeconds < 0) watchedSeconds = 0;
    if (watchedSeconds > 86400) watchedSeconds = 86400;

    // A play is one row per (video, page-load), keyed by the client's playId.
    // The first call creates the row (counts the play); later beacons carry the
    // same playId and only update the running watch time — no duplicate rows.
    const existing = playId
      ? await prisma.videoPlay.findFirst({
          where: { videoId: video.id, playId },
          select: { id: true, watchedSeconds: true, country: true },
        })
      : null;

    if (existing) {
      const playLimit = hit(`track-play:${existing.id}`, PER_PLAY);
      if (!playLimit.ok) return tooManyRequests(playLimit.retryAfter);

      // Self-heal: if the country lookup failed when the row was created
      // (provider down / rate-limited), retry on later beacons of the same
      // play instead of leaving the row "Unknown" forever.
      let healCountry = null;
      if (!existing.country) {
        healCountry = await getCountry(request);
      }
      // Never let watch time go backwards (beacons can arrive out of order).
      if (watchedSeconds > (existing.watchedSeconds || 0) || healCountry) {
        await prisma.videoPlay.update({
          where: { id: existing.id },
          data: {
            watchedSeconds: Math.max(watchedSeconds, existing.watchedSeconds || 0),
            ...(healCountry && { country: healCountry }),
          },
        });
      }
    } else {
      const newPlayLimit = hit(`track-new:${video.id}`, PER_VIDEO_NEW_PLAYS);
      if (!newPlayLimit.ok) return tooManyRequests(newPlayLimit.retryAfter);

      // Only resolve country/network when we actually create the play row (the
      // first beacon). Later watch-time beacons skip this work entirely.
      const country = await getCountry(request);
      const ipHash = hashIp(getClientIp(request));
      const data = {
        shop: video.shop,
        videoId: video.id,
        videoTitle: video.title || null,
        visitorId: visitorId || null,
        browser,
        os,
        device,
        country: country || null,
        ipHash,
        referrer: referrer || null,
        pageUrl: pageUrl || null,
        isProductPage,
        playId: playId || null,
        watchedSeconds,
      };
      try {
        await prisma.videoPlay.create({ data });
      } catch {
        // Older in-memory Prisma client may not know `ipHash` yet (dev server
        // started before the schema change). Retry without it so a play is
        // still recorded; the field populates once the server restarts.
        const { ipHash: _omit, ...rest } = data;
        await prisma.videoPlay.create({ data: rest });
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err) {
    console.error("track error:", err);
    return new Response(JSON.stringify({ error: "Could not record play" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
}
