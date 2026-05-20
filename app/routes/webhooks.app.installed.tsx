import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { notifySwipeone, type ShopInfo } from "~/lib/swipeone.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, session, payload } = await authenticate.webhook(request);
    const info = (payload as any) as ShopInfo;
    await notifySwipeone({
      type: "app.installed",
      shop,
      userId: session?.id,
      installId: info?.id,
      shopInfo: info,
    });
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("[webhooks.app.installed] error:", err);
    return new Response("Webhook error", { status: 500 });
  }
};
