import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  COMPLIANCE_TOPICS,
  handleComplianceWebhook,
} from "../lib/shop-data.server";

export const action = async ({ request }) => {
  const { topic, shop, session, admin } = await authenticate.webhook(request);

  // Older setups pointed the privacy webhooks at this URL. shop/redact arrives
  // after uninstall (no admin context), so handle these before the check below.
  if (COMPLIANCE_TOPICS.includes(topic)) {
    try {
      return await handleComplianceWebhook({ topic, shop });
    } catch (error) {
      console.error(`Compliance webhook ${topic} failed:`, error);
      return new Response("Error", { status: 500 });
    }
  }

  if (!admin) {
    // The admin context isn't returned if the webhook fired after a shop was uninstalled.
    throw new Response();
  }

  switch (topic) {
    case "APP_UNINSTALLED":
      if (session) {
        await prisma.session.deleteMany({ where: { shop } });
        await prisma.users.deleteMany({ where: { shop } });
      }

      break;
    default:
      throw new Response("Unhandled webhook topic", { status: 404 });
  }

  throw new Response();
};
