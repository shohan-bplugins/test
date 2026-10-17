import prisma from "../db.server";

// Every model that carries a `shop` column, i.e. everything that is tenant
// data. `Plans` is deliberately absent: it is the global plan catalogue shared
// by all shops, not something a single merchant owns.
//
// Order matters only for `session`, which goes last. It holds the access token,
// so if a purge dies partway through, the shop still has a usable session and
// Shopify's webhook retry can finish the job.
const SHOP_SCOPED_MODELS = [
  "videoPlay", // analytics: one row per play, carries visitorId + ipHash
  "webVital", // analytics: Core Web Vitals samples
  "video", // the merchant's players and their configuration
  "charges", // billing history
  "users", // plan + credit record
  "webhookCall", // webhook bookkeeping
  "session", // access tokens — last, see above
];

/**
 * Delete every record belonging to a shop: players, analytics, billing and
 * session rows. Used when an app is uninstalled and again when Shopify sends
 * the `shop/redact` compliance webhook 48h later.
 *
 * Runs the deletes sequentially rather than in `$transaction` because each
 * `deleteMany` is idempotent — a partial purge that gets retried simply
 * re-runs and deletes whatever is left, which is the behaviour we want when
 * Shopify retries a failed webhook.
 *
 * @param {string} shop myshopify domain, e.g. "example.myshopify.com"
 * @returns {Promise<Record<string, number>>} rows deleted per model
 */
export async function purgeShopData(shop) {
  if (!shop) {
    throw new Error("purgeShopData: a shop domain is required");
  }

  const deleted = {};
  for (const model of SHOP_SCOPED_MODELS) {
    const { count } = await prisma[model].deleteMany({ where: { shop } });
    deleted[model] = count;
  }

  return deleted;
}
