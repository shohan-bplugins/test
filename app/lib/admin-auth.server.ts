const DEFAULT_ADMIN_SHOPS = ["shohan192.myshopify.com", "shohan192"];

export function getAdminPassword(): string {
  return (
    process.env.ADMIN_PASSWORD ||
    process.env.ADMIN_PASSCODE ||
    "shohan@2026!"
  ).trim();
}

export const getAdminPasscode = getAdminPassword;

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

/**
 * Check if standalone request (out of Shopify) has a valid admin session cookie.
 */
export function checkStandaloneAdminAuth(request: Request): boolean {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(/easy3d_admin_token=([a-zA-Z0-9_-]+)/);
  if (match && match[1] === getAdminToken()) {
    return true;
  }
  return false;
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

export function getAdminToken(): string {
  const pwd = getAdminPassword();
  return Buffer.from(`easy3d_secret_${pwd}`).toString("base64url");
}

export function createAdminCookieHeader(): string {
  return `easy3d_admin_token=${getAdminToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

export function clearAdminCookieHeader(): string {
  return `easy3d_admin_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
