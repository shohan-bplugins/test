import { authenticate } from "../shopify.server";
import { purgeShopData } from "../utils/purgeShopData.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  // Shopify sends this 48 hours after an uninstall. The uninstall webhook has
  // normally purged the shop already, but this is the compliance guarantee, so
  // it runs the same purge unconditionally rather than trusting that it did.
  // See: https://shopify.dev/docs/apps/build/privacy-law-compliance
  try {
    const deleted = await purgeShopData(shop);
    console.log(`[${topic}] Purged data for ${shop}:`, deleted);
    return new Response();
  } catch (err) {
    console.error(`❌ [${topic}] Failed to purge data for ${shop}:`, err);
    // 500 makes Shopify retry; the purge is idempotent.
    return new Response("Purge failed", { status: 500 });
  }
};
