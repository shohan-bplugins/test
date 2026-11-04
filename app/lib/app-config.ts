/*
 * Values that must match shopify.app.toml, and the one billing switch that must
 * never be wrong in production.
 */

/**
 * `handle` in shopify.app.toml. Admin deep links are built from it:
 * https://admin.shopify.com/store/<store>/apps/<APP_HANDLE>/...
 *
 * Keep the two in sync. A stale handle here doesn't fail loudly — it produces a
 * URL that 404s inside the admin, which is how a hardcoded dev handle survived
 * in the billing return URL long enough to be shipped.
 */
export const APP_HANDLE = "easy-3d-viewer-shohan";

/**
 * Whether app subscriptions are created as *test* charges.
 *
 * A test charge is never billed and never settles, so shipping one to the App
 * Store means every merchant gets the paid plans for free — and Shopify's
 * reviewers check for exactly this. It is therefore opt-*in*, gated on an
 * explicit env var, and never inferred from anything else:
 *
 *   SHOPIFY_BILLING_TEST=1    # development stores only
 *
 * Deliberately not keyed off NODE_ENV. `react-router-serve` defaults NODE_ENV
 * to "production", but a host that starts the process any other way (pm2, a
 * Passenger panel, `node build/server/index.js` directly) may not — and a
 * missing var must fail toward *charging*, not toward giving the app away.
 */
export const BILLING_TEST_MODE =
  process.env.SHOPIFY_BILLING_TEST === "1" ||
  process.env.SHOPIFY_BILLING_TEST === "true";

/** The store handle in an admin URL: "my-shop.myshopify.com" -> "my-shop". */
export function storeHandle(shop: string): string {
  return shop.split(".")[0] ?? shop;
}

/** An absolute deep link to a path inside this app in the Shopify admin. */
export function adminAppUrl(shop: string, path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `https://admin.shopify.com/store/${storeHandle(shop)}/apps/${APP_HANDLE}${suffix}`;
}

/**
 * Admin API version for raw `fetch` calls that have no `admin.graphql` client to
 * hand (the afterAuth hook, webhook handlers).
 *
 * Must match `api_version` in shopify.app.toml and `ApiVersion` in
 * shopify.server.ts. It lives here rather than being imported from
 * shopify.server because that module imports the CRM helper that needs this,
 * and the cycle breaks module init.
 */
export const ADMIN_API_VERSION = "2026-01";
