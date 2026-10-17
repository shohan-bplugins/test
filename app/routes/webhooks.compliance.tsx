import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";

/*
 * Shopify's three mandatory privacy-compliance webhooks, all on one endpoint.
 *
 * Every app distributed through the App Store must subscribe to these; a
 * submission without them is rejected. They are declared together in
 * shopify.app.toml under `compliance_topics`, which is why one route handles all
 * three rather than there being a file per topic:
 *
 *   customers/data_request  a shopper asked what data we hold on them
 *   customers/redact        a shopper asked us to erase their data
 *   shop/redact             a shop was uninstalled 48h ago; erase everything
 *
 * `authenticate.webhook` verifies the X-Shopify-Hmac-Sha256 header and throws a
 * 401 response when it fails, which is exactly what Shopify requires of an
 * unverified request — so an invalid HMAC never reaches the switch below.
 *
 * Shopify allows 30 days to complete the action. Everything here is synchronous
 * and finishes inside the request, so there is no queue to reason about.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  switch (topic) {
    /*
     * This app stores no shopper data at all. It holds a shop's 3D model files,
     * the viewer settings for them, and the shop's plan — nothing keyed to a
     * customer, and nothing a shopper ever submits. The storefront viewer is
     * read-only: it renders a model and records nothing.
     *
     * So the honest answer to both customer topics is "we hold none", and the
     * required response is a 200 acknowledging that. Logged rather than silently
     * dropped, so a merchant asking what we did with a request has an answer.
     */
    case "CUSTOMERS_DATA_REQUEST":
      console.log(
        `[compliance] customers/data_request for ${shop} — no customer data stored`,
        { customerId: (payload as any)?.customer?.id ?? null },
      );
      break;

    case "CUSTOMERS_REDACT":
      console.log(
        `[compliance] customers/redact for ${shop} — no customer data stored`,
        { customerId: (payload as any)?.customer?.id ?? null },
      );
      break;

    /*
     * Sent 48 hours after an uninstall. Everything this app keeps is keyed by
     * shop domain, so erasure is a delete of those rows.
     *
     * Sessions are already gone by now (app/uninstalled deletes them), but the
     * delete is repeated rather than assumed: that webhook can fail or be
     * retried past its window, and shop/redact is the endpoint Shopify holds us
     * to. Charge history goes too — it is the shop's billing record, not ours,
     * and Shopify keeps the authoritative copy.
     */
    case "SHOP_REDACT": {
      const deleted = await db.$transaction([
        db.session.deleteMany({ where: { shop } }),
        db.model3D.deleteMany({ where: { shop } }),
        db.charge.deleteMany({ where: { shop } }),
        db.appUser.deleteMany({ where: { shop } }),
        db.webhookCall.deleteMany({ where: { shop } }),
      ]);
      console.log(
        `[compliance] shop/redact for ${shop} — erased`,
        deleted.map((d) => d.count),
      );
      break;
    }

    default:
      // A topic routed here that we don't handle is a configuration mistake, not
      // a request to reject: 401 would make Shopify retry it forever.
      console.warn(`[compliance] unhandled topic ${topic} for ${shop}`);
  }

  return new Response(null, { status: 200 });
};
