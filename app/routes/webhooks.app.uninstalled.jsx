import { authenticate, sessionStorage } from "../shopify.server";

const SWIPEONE_ENDPOINT =
  "https://integrations-api.swipeone.com/webhooks/apps/generic-webhooks/68f1d267d1a678d9726d5287";

export const loader = async () => {
  return new Response("OK", { status: 200 });
};

// Clear the shop's sessions and report the uninstall. Runs after the webhook
// is acknowledged — neither a storage hiccup nor a SwipeOne outage is
// something Shopify retrying the delivery would fix.
async function handleUninstall({ shop, session, payload }) {
  if (shop) {
    const sessions = await sessionStorage.findSessionsByShop(shop);
    if (sessions.length) {
      await sessionStorage.deleteSessions(sessions.map((s) => s.id));
    }
  }

  const response = await fetch(SWIPEONE_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      {
        type: "app.uninstalled",
        app_name: "audio-player",
        app_full_name: "Audio Player by bPlugins",
        app_slug: "html5-audio-player",
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

  if (!response.ok) {
    throw new Error(
      `SwipeOne returned ${response.status} ${response.statusText}`,
    );
  }
}

export const action = async ({ request }) => {
  let hook;
  try {
    hook = await authenticate.webhook(request);
  } catch (err) {
    // The library throws a Response (401) for a failed HMAC check — pass it
    // through so Shopify gets the status it expects and stops retrying.
    if (err instanceof Response) return err;
    console.error("Uninstall webhook auth failed:", err);
    return new Response("Unauthorized", { status: 401 });
  }

  // Acknowledge before doing any slow work — Shopify counts a slow or failed
  // reply as a failed delivery.
  handleUninstall(hook).catch((err) =>
    console.error("Uninstall cleanup failed:", err?.message || err),
  );

  return new Response("OK", { status: 200 });
};
