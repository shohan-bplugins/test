import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { notifySwipeone } from "~/lib/swipeone.server";
import {
  invalidateAssignedModels,
  invalidateSubscription,
  resetPlanChoice,
} from "~/lib/billing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    await notifySwipeone({
      type: "app.uninstalled",
      shop,
      userId: session?.id,
      shopInfo: (payload as any) ?? undefined,
    });
  } catch (err) {
    console.error("[uninstalled] swipeone notify failed:", err);
  }

  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Nothing cached about the old install may outlive it — a reinstall reads
  // the store fresh.
  invalidateSubscription(shop);
  invalidateAssignedModels(shop);

  // A reinstall starts at the plan picker again, like a first install.
  try {
    await resetPlanChoice(shop);
  } catch (err) {
    console.error("[uninstalled] plan choice reset failed:", err);
  }

  return new Response();
};
