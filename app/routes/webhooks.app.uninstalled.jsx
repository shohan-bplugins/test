import { authenticate } from "../shopify.server";
import { purgeShopData } from "../utils/purgeShopData.server";

export const loader = async () => {
  return new Response("OK", { status: 200 });
};

export const action = async ({ request }) => {
  // return await shopify.processWebhook(request);
  const { shop, session, topic, payload } = await authenticate.webhook(request);

  try {
    function getFormattedDateTime() {
      const now = new Date();
      const pad = (n) => n.toString().padStart(2, "0");

      const year = now.getFullYear();
      const month = pad(now.getMonth() + 1); // Months are 0-indexed
      const day = pad(now.getDate());
      const hours = pad(now.getHours());
      const minutes = pad(now.getMinutes());
      const seconds = pad(now.getSeconds());

      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }
    fetch("https://integrations-api.swipeone.com/webhooks/apps/generic-webhooks/68f1d267d1a678d9726d5287", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          type: "app.uninstalled",
          app_name: "video-player",
          app_full_name: "Video Player by bPlugins",
          app_slug: "video-player-by-bplugins",
          success: true,
          shop,
          user_id: session?.id,
          install_id: payload?.id,
          data: {
            name: payload?.shop_owner,
            email: payload?.email,
            country_name: payload?.country_name,
            address1: payload?.address1,
            address2: payload?.address2,
            phone: payload?.phone,
            created_at: payload?.created_at,
            domain: payload?.domain,
            myshopify_domain: payload?.myshopify_domain,
            plan_display_name: payload?.plan_display_name,
          },
          id: session?.id,
          created: getFormattedDateTime(),
          objects: {
            user: {
              email: payload?.email,
            },
          },
        },
      ]),
    }).catch((err) => {
      // Fire-and-forget: a failed analytics ping must never take down the
      // purge below, but it must not surface as an unhandled rejection either.
      console.error("SwipeOne uninstall notification failed:", err);
    });
  } catch (err) {
    console.error("❌ Webhook error:", err);
  }

  // Uninstall wipes the shop out entirely: players, analytics, billing rows and
  // sessions. Returning 500 on failure is deliberate — it makes Shopify retry
  // the webhook, and `purgeShopData` is idempotent, so a retry finishes the job.
  try {
    const deleted = await purgeShopData(shop);
    console.log(`Purged data for ${shop}:`, deleted);
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error(`❌ Failed to purge data for ${shop}:`, err);
    return new Response("Purge failed", { status: 500 });
  }
};
