/**
 * Small in-memory fixed-window rate limiter for the public endpoints (video
 * password check, play tracking).
 *
 * State lives in this Node process. With several processes/machines each one
 * counts on its own, so the effective limit is (limit × processes) — still a
 * hard ceiling on brute force and flooding, just not an exact one. Move the
 * buckets to Redis if exact global limits are ever needed.
 */

const buckets = new Map(); // key -> { count, resetAt }
const MAX_BUCKETS = 50_000;

function sweep(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Count one hit against `key`.
 *
 * @param {string} key
 * @param {{limit: number, windowMs: number}} opts
 * @returns {{ok: boolean, remaining: number, retryAfter: number}} retryAfter in seconds
 */
export function hit(key, { limit, windowMs }) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) sweep(now);
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return {
    ok: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/** Is `key` already over `limit`? Does not count a hit. */
export function isLimited(key, { limit }) {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= Date.now()) return { limited: false, retryAfter: 0 };
  return {
    limited: bucket.count >= limit,
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000)),
  };
}

/**
 * The visitor's IP for rate-limit keys. Set TRUSTED_IP_HEADER (e.g.
 * "cf-connecting-ip" behind Cloudflare, "x-real-ip" behind nginx) to the one
 * header your edge overwrites, so a client can't pick its own key. Without it
 * the usual proxy headers are tried in order.
 */
export function clientIp(request) {
  const h = request.headers;
  const trusted = process.env.TRUSTED_IP_HEADER;
  if (trusted) {
    const value = (h.get(trusted) || "").split(",")[0].trim();
    if (value) return value;
  }
  const xff = h.get("x-forwarded-for");
  return (
    h.get("fly-client-ip") ||
    h.get("cf-connecting-ip") ||
    h.get("true-client-ip") ||
    (xff ? xff.split(",")[0] : "") ||
    h.get("x-real-ip") ||
    "unknown"
  ).trim();
}
