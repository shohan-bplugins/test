import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Super-admin authentication for /admin (standalone) and /app/admin (embedded).
 *
 * Security notes — each line here replaced something that was exploitable:
 *
 *   - There is NO fallback password. A missing ADMIN_PASSWORD disables admin
 *     login entirely instead of silently accepting a password committed to the
 *     repo.
 *   - The cookie is an HMAC-signed, expiring token, not base64 of the password.
 *     A leaked cookie no longer reveals the password, expires on its own, and
 *     every outstanding cookie is revoked by changing ADMIN_PASSWORD (or
 *     ADMIN_TOKEN_SECRET).
 *   - Comparisons are constant-time, and failed logins are rate limited per
 *     client so the password cannot be brute-forced over HTTP.
 */

const DEFAULT_ADMIN_SHOPS = ["shohan192.myshopify.com", "shohan192"];
const COOKIE_NAME = "easy3d_admin_token";
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export function getAdminPassword(): string {
  return (process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSCODE || "").trim();
}

export const getAdminPasscode = getAdminPassword;

/** Admin login is only possible when a password of reasonable length is configured. */
export function isAdminLoginEnabled(): boolean {
  return getAdminPassword().length >= 8;
}

function signingKey(): string {
  // Bound to the password so that rotating it revokes every issued cookie.
  const secret =
    process.env.ADMIN_TOKEN_SECRET || process.env.SHOPIFY_API_SECRET || "";
  return `${secret}\u0000${getAdminPassword()}`;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual needs equal lengths; compare against self to keep timing flat.
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * Check if a shop domain is in the authorized admin list.
 */
export function isSuperAdminShop(shop: string): boolean {
  if (!shop) return false;
  const cleanShop = shop.trim().toLowerCase();
  const configured = (process.env.ADMIN_SHOPS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const allowed = new Set([...DEFAULT_ADMIN_SHOPS, ...configured]);
  return (
    allowed.has(cleanShop) ||
    allowed.has(cleanShop.replace(".myshopify.com", ""))
  );
}

/** A fresh signed token: "<expiry-unix-seconds>.<hmac>". */
export function getAdminToken(now: number = Date.now()): string {
  const exp = Math.floor(now / 1000) + TOKEN_TTL_SECONDS;
  return `${exp}.${sign(`admin:${exp}`)}`;
}

export function verifyAdminToken(token: string, now: number = Date.now()): boolean {
  if (!isAdminLoginEnabled() || !token) return false;
  const [expStr, mac, extra] = token.split(".");
  if (!expStr || !mac || extra !== undefined || !/^\d+$/.test(expStr)) return false;
  if (Number(expStr) * 1000 <= now) return false;
  return safeEqual(mac, sign(`admin:${expStr}`));
}

/**
 * Check if standalone request (out of Shopify) has a valid admin session cookie.
 */
export function checkStandaloneAdminAuth(request: Request): boolean {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(/(?:^|;\s*)easy3d_admin_token=([A-Za-z0-9_.-]+)/);
  return !!match && verifyAdminToken(match[1]);
}

/**
 * Check if in-app request has valid admin auth.
 */
export function checkAdminAuth(request: Request, shop: string): boolean {
  if (isSuperAdminShop(shop)) {
    return true;
  }
  return checkStandaloneAdminAuth(request);
}

// --- Login rate limiting ----------------------------------------------------

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; first: number }>();

function clientKey(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export type PasswordCheck = { ok: true } | { ok: false; error: string };

/**
 * Constant-time password check with per-client lockout after repeated failures.
 * Returns a merchant-safe error message on failure.
 */
export function verifyAdminPassword(
  request: Request,
  password: string,
  now: number = Date.now(),
): PasswordCheck {
  if (!isAdminLoginEnabled()) {
    return { ok: false, error: "Admin login is disabled on this server." };
  }
  const key = clientKey(request);
  const entry = failures.get(key);
  if (entry && now - entry.first > WINDOW_MS) failures.delete(key);
  const current = failures.get(key);
  if (current && current.count >= MAX_FAILURES) {
    return { ok: false, error: "Too many attempts. Try again in 15 minutes." };
  }

  if (safeEqual(password.trim(), getAdminPassword())) {
    failures.delete(key);
    return { ok: true };
  }

  if (current) current.count += 1;
  else failures.set(key, { count: 1, first: now });
  // Bound memory: drop the oldest entries if an attacker rotates IPs.
  if (failures.size > 10_000) {
    const oldest = failures.keys().next().value;
    if (oldest !== undefined) failures.delete(oldest);
  }
  return { ok: false, error: "Incorrect admin password. Please try again." };
}

/** Test hook. */
export function _resetAdminRateLimit() {
  failures.clear();
}

export function createAdminCookieHeader(): string {
  return `${COOKIE_NAME}=${getAdminToken()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TOKEN_TTL_SECONDS}`;
}

export function clearAdminCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
