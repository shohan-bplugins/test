import { fetchActiveSubscriptionCached } from "~/lib/billing.server";

/**
 * Hotspots are a paid-plan feature. Read from Shopify's live subscription
 * (cached), the same source the Pricing and Analytics pages trust — decided on
 * the server, so a Free store cannot add hotspots by posting them directly.
 */
export async function hotspotsAllowed(
  admin: Parameters<typeof fetchActiveSubscriptionCached>[0],
  shop: string,
): Promise<boolean> {
  const subscription = await fetchActiveSubscriptionCached(admin, shop).catch(
    () => null,
  );
  return subscription?.status === "active";
}
