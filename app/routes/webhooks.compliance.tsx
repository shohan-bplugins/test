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
     * The only shopper data this app holds is the configurator's Design rows:
     * a shopper's option picks and personalization text, keyed to their
     * customer id when they were logged in. Everything else — model files,
     * viewer settings, the shop's plan — is the merchant's.
     *
     * A data request is answered by the merchant from their admin, so it is
     * logged with what we hold; a redact deletes the customer's designs.
     * OrderDesign rows hold no customer id — they belong to the merchant's
     * order record, which Shopify redacts itself.
     */
    case "CUSTOMERS_DATA_REQUEST": {
      const customerId = String((payload as any)?.customer?.id ?? "");
      const designs = customerId
        ? await db.design.count({ where: { shop, customerId } })
        : 0;
      console.log(`[compliance] customers/data_request for ${shop}`, {
        customerId: customerId || null,
        designs,
      });
      break;
    }

    case "CUSTOMERS_REDACT": {
      const customerId = String((payload as any)?.customer?.id ?? "");
      const deleted = customerId
        ? await db.design.deleteMany({ where: { shop, customerId } })
        : { count: 0 };
      console.log(`[compliance] customers/redact for ${shop}`, {
        customerId: customerId || null,
        designs: deleted.count,
      });
      break;
    }

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
        db.productConfig.deleteMany({ where: { shop } }),
        db.design.deleteMany({ where: { shop } }),
        db.orderDesign.deleteMany({ where: { shop } }),
        db.preset.deleteMany({ where: { shop } }),
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
