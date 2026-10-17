import { authenticate } from "../shopify.server";
import { handleComplianceWebhook } from "../lib/shop-data.server";

export const loader = async () => new Response("OK", { status: 200 });

// customers/data_request, customers/redact and shop/redact
// (subscribed in shopify.app.toml).
export const action = async ({ request }) => {
  const { topic, shop } = await authenticate.webhook(request);
  try {
    return (
      (await handleComplianceWebhook({ topic, shop })) ??
      new Response("Unhandled webhook topic", { status: 404 })
    );
  } catch (error) {
    console.error(`Compliance webhook ${topic} failed:`, error);
    return new Response("Error", { status: 500 });
  }
};
