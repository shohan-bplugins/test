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

  // Record uninstall state and lifecycle event for Admin Dashboard
  try {
    await db.appUser.updateMany({
      where: { shop },
      data: {
        isInstalled: false,
        uninstalledAt: new Date(),
      },
    });
    await db.appStoreEvent.create({
      data: {
        shop,
        type: "uninstall",
        detail: JSON.stringify({
          uninstalledAt: new Date().toISOString(),
          payload: payload ?? null,
        }),
      },
    });
  } catch (err) {
    console.error("[uninstalled] failed to record uninstall event:", err);
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
