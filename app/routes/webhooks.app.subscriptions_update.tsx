import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { FREE_PLAN_NAME, invalidateSubscription } from "~/lib/billing.server";
import { FREE_MODEL_LIMIT, FREE_PRODUCT_LIMIT } from "~/lib/billing-constants";
import { fetchShopInfo, notifySwipeone } from "~/lib/swipeone.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, payload } = await authenticate.webhook(request);

  try {
    const sub = (payload as any)?.app_subscription;
    if (!sub) return new Response("OK", { status: 200 });

    const status = String(sub.status ?? "").toLowerCase();
    // The cached subscription is served stale for up to a day (see
    // shop-cache.server.ts); a plan change made anywhere must not wait on that.
    invalidateSubscription(shop);
    if (session?.accessToken) {
      const shopInfo = await fetchShopInfo(shop, session.accessToken);
      await notifySwipeone({
        type: `app.subscription_${status}`,
        shop,
        userId: session?.id,
        shopInfo: shopInfo ?? undefined,
        extra: payload as Record<string, unknown>,
      });
    }

    const adminGraphqlId = String(sub.admin_graphql_api_id ?? "");
    const chargeId = adminGraphqlId.split("/").pop() ?? String(sub.id ?? "");

    if (!chargeId) return new Response("OK", { status: 200 });

    await prisma.charge.updateMany({
      where: { shop, chargeId },
      data: { status },
    });

    const user = await prisma.appUser.findUnique({ where: { shop } });
    if (!user) return new Response("OK", { status: 200 });

    if (
      status === "cancelled" ||
      status === "expired" ||
      status === "declined" ||
      status === "frozen"
    ) {
      const freePlan = await prisma.plan.findUnique({
        where: { name: FREE_PLAN_NAME },
      });
      await prisma.appUser.update({
        where: { id: user.id },
        data: {
          planId: freePlan?.id ?? null,
          chargeId: null,
          modelLimit: freePlan?.modelLimit ?? FREE_MODEL_LIMIT,
          productLimit: freePlan?.productLimit ?? FREE_PRODUCT_LIMIT,
        },
      });
    } else if (status === "active") {
      const charge = await prisma.charge.findFirst({
        where: { shop, chargeId },
      });
      if (charge?.planId) {
        const plan = await prisma.plan.findUnique({
          where: { id: charge.planId },
        });
        if (plan) {
          await prisma.appUser.update({
            where: { id: user.id },
            data: {
              planId: plan.id,
              chargeId,
              modelLimit: plan.modelLimit,
              productLimit: plan.productLimit,
            },
          });
        }
      }
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("[subscriptions_update] webhook error:", err);
    return new Response("Webhook error", { status: 500 });
  }
};
