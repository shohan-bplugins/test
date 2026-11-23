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

  // Fire-and-forget so a slow CRM never delays the webhook response.
  void notifySwipeone({
    type: "app.uninstalled",
    shop,
    userId: session?.id,
    shopInfo: (payload as any) ?? undefined,
  }).catch((err) => console.error("[uninstalled] swipeone notify failed:", err));

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
        // Only non-personal shop fields. The full payload carries the owner's
        // name, email, phone and address, and this row is read by the admin
        // dashboard — it must not become a second copy of merchant PII.
        detail: JSON.stringify({
          uninstalledAt: new Date().toISOString(),
          name: (payload as any)?.name ?? null,
          domain: (payload as any)?.myshopify_domain ?? shop,
          plan: (payload as any)?.plan_name ?? null,
          country: (payload as any)?.country_code ?? null,
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
