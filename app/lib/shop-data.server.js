import prisma from "../db.server";

// Everything this app stores about a shop. Shared rows are left alone:
// `Screen` holds the default player templates every shop copies from, and
// `Plans` is the global pricing list.
export async function deleteShopData(shop) {
  if (!shop) return;
  const where = { shop };
  const results = await Promise.allSettled([
    prisma.session.deleteMany({ where }),
    prisma.users.deleteMany({ where }),
    prisma.charges.deleteMany({ where }),
    prisma.audio.deleteMany({ where }),
    prisma.analytics.deleteMany({ where }),
    prisma.webVital.deleteMany({ where }),
    prisma.webhookCall.deleteMany({ where }),
  ]);
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) {
    // Thrown so the webhook answers 500 and Shopify redelivers it; the
    // deletes are idempotent, so a retry just finishes the job.
    throw new Error(
      `Deleting data for ${shop} failed: ${failed
        .map((r) => r.reason?.message || r.reason)
        .join("; ")}`,
    );
  }
  console.log(`Deleted all stored data for ${shop}`);
}

// Shopify's mandatory privacy webhooks. Returns the Response to send.
export async function handleComplianceWebhook({ topic, shop }) {
  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      // Nothing is stored per customer: records are keyed by shop, and the
      // play analytics aren't linked to a customer ID or email.
      return new Response(null, { status: 200 });

    case "SHOP_REDACT":
      // Sent 48 hours after the shop uninstalls the app.
      await deleteShopData(shop);
      return new Response(null, { status: 200 });

    default:
      return null;
  }
}

export const COMPLIANCE_TOPICS = [
  "CUSTOMERS_DATA_REQUEST",
  "CUSTOMERS_REDACT",
  "SHOP_REDACT",
];
