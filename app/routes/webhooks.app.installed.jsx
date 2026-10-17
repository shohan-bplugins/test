import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  // return await shopify.processWebhook(request);
  const { shop, session, topic, payload } = await authenticate.webhook(request);
  try {
    fetch("https://integrations-api.swipeone.com/webhooks/apps/generic-webhooks/68f1d267d1a678d9726d5287", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          type: "app.installed",
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
          created: new Date().toISOString().slice(0, 19).replace("T", " "),
          objects: {
            user: {
              email: payload?.email,
            },
          },
        },
      ]),
    });

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("❌ Webhook error:", err);
    return new Response("Webhook error", { status: 500 });
  }
};
