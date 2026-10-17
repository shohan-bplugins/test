import { authenticate } from "../shopify.server";
import { syncSubscriptionState } from "../utils/planSync.server";

export const action = async ({ request }) => {
  const { shop, session, payload } = await authenticate.webhook(request);

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

  const subscription = payload?.app_subscription;

  // The database write comes first and stands on its own. This webhook is the
  // ONLY signal the app gets when a merchant cancels from the Shopify admin, or
  // when a subscription is frozen, declined or expires — so if it does not land
  // here, the shop keeps its paid credits forever. It used to run after an
  // unguarded `fetch` for shop.json that threw on any non-2xx, which meant a
  // transient Shopify error skipped the plan update entirely.
  let synced = { applied: false, reason: "no-payload" };
  try {
    synced = await syncSubscriptionState({
      shop,
      status: subscription?.status,
      planName: subscription?.name,
      chargeId: subscription?.admin_graphql_api_id,
      occurredAt: subscription?.updated_at,
    });
    console.log(
      `app_subscriptions/update ${shop} ${subscription?.status}:`,
      synced,
    );
  } catch (err) {
    // Returning 500 makes Shopify retry, and syncSubscriptionState is
    // idempotent — replaying the same status produces the same rows.
    console.error(`❌ Failed to sync plan for ${shop}:`, err);
    return new Response("Plan sync failed", { status: 500 });
  }

  // Analytics forwarding is best-effort and must never fail the webhook now
  // that the plan update above depends on it returning 200.
  try {
    const response = await fetch(
      `https://${shop}/admin/api/2026-07/shop.json`,
      {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": session?.accessToken,
          "Content-Type": "application/json",
        },
      },
    );

    const data = response.ok ? await response.json() : {};
    if (!response.ok) {
      console.error("Shopify Error:", await response.text());
    }

    await fetch(
      "https://integrations-api.swipeone.com/webhooks/apps/generic-webhooks/68f1d267d1a678d9726d5287",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          {
            type: ("app.subscription_" + subscription?.status).toLowerCase(),
            app_name: "video-player",
            app_full_name: "Video Player by bPlugins",
            app_slug: "video-player-by-bplugins",
            success: true,
            shop,
            user_id: session?.id,
            install_id: "",
            data: {
              name: data?.shop?.shop_owner || "",
              email: data?.shop?.email || "",
              country_name: data?.shop?.country_name || "",
              address1: data?.shop?.address1 || "",
              address2: data?.shop?.address2 || "",
              phone: data?.shop?.phone || "",
              created_at: data?.shop?.created_at || "",
              domain: data?.shop?.domain || shop,
              myshopify_domain: data?.shop?.myshopify_domain || "",
              plan_display_name: data?.shop?.plan_display_name || "",
              ...payload,
            },
            id: session?.id,
            created: getFormattedDateTime(),
            objects: {
              user: {
                email: payload?.email || "",
              },
            },
          },
        ]),
      },
    );
  } catch (err) {
    console.error("SwipeOne subscription notification failed:", err);
  }

  return new Response("OK", { status: 200 });
};
