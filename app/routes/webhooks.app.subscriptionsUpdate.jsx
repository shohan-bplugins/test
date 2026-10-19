import { authenticate, unauthenticated } from "../shopify.server";
import { syncPlanWithShopify } from "../lib/billing.server";

const SWIPEONE_ENDPOINT =
  "https://integrations-api.swipeone.com/webhooks/apps/generic-webhooks/68f1d267d1a678d9726d5287";

// Look up shop details and forward the subscription event to SwipeOne.
// This runs AFTER the webhook has already been acknowledged: the shop lookup
// needs an offline session that may be gone (a subscription event can arrive
// around an uninstall or a token change), and neither that nor a SwipeOne
// outage is something Shopify retrying the delivery would fix.
async function forwardToSwipeOne({ shop, session, payload }) {
  let shopData = {};

  if (shop) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      const response = await admin.graphql(
        `#graphql
        query ShopDetails {
          shop {
            id
            name
            email
            shopOwnerName
            myshopifyDomain
            primaryDomain { host }
            billingAddress {
              address1
              address2
              phone
              country
            }
            createdAt
            plan { displayName }
          }
        }`,
      );

      const json = await response.json();
      shopData = json?.data?.shop ?? {};
    } catch (err) {
      // No usable session for this shop — forward what the payload gives us
      // rather than dropping the event entirely.
      console.error(
        `Subscription update: shop lookup failed for ${shop}:`,
        err?.message || err,
      );
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
        type: (
          "app.subscription_" + payload?.app_subscription?.status
        ).toLowerCase(),
        app_name: "audio-player",
        app_full_name: "Audio Player by bPlugins",
        app_slug: "html5-audio-player",
        success: true,
        shop,
        user_id: session?.id,
        install_id: "",
        data: {
          name: shopData?.shopOwnerName || "",
          email: shopData?.email || "",
          country_name: shopData?.billingAddress?.country || "",
          address1: shopData?.billingAddress?.address1 || "",
          address2: shopData?.billingAddress?.address2 || "",
          phone: shopData?.billingAddress?.phone || "",
          created_at: shopData?.createdAt || "",
          domain: shopData?.primaryDomain?.host || shop,
          myshopify_domain: shopData?.myshopifyDomain || "",
          plan_display_name: shopData?.plan?.displayName || "",
          ...payload,
        },
        id: session?.id,
        created: new Date().toISOString().slice(0, 19).replace("T", " "),
        objects: {
          user: {
            email: payload?.email || "",
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

async function syncPlanFromWebhook(shop) {
  if (!shop) return;
  const { admin } = await unauthenticated.admin(shop);
  await syncPlanWithShopify(admin, shop);
}

export const action = async ({ request }) => {
  let hook;
  try {
    hook = await authenticate.webhook(request);
  } catch (err) {
    // The library throws a Response (401) for a failed HMAC check — pass it
    // through so Shopify gets the status it expects and stops retrying.
    if (err instanceof Response) return err;
    console.error("Subscription update webhook auth failed:", err);
    return new Response("Unauthorized", { status: 401 });
  }

  // Acknowledge before doing any slow work. Shopify counts a slow or failed
  // reply as a failed delivery, and everything below is best-effort reporting
  // that must not affect our delivery record.
  forwardToSwipeOne(hook).catch((err) =>
    console.error(
      "Subscription update: SwipeOne forward failed:",
      err?.message || err,
    ),
  );

  // Keep the stored plan in line with Shopify: activated → paid plan;
  // cancelled / declined / expired / frozen → Free. The sync reads the shop's
  // real active subscriptions, so a declined *new* upgrade doesn't touch a
  // plan the shop is already paying for.
  syncPlanFromWebhook(hook?.shop).catch((err) =>
    console.error("Subscription update: plan sync failed:", err?.message || err),
  );

  return new Response("OK", { status: 200 });
};
