import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import {
  isPlacement,
  isViewerEvent,
  recordViewerEvent,
  toDevice,
  toTarget,
} from "~/lib/viewer-stats.server";

/*
 * Storefront engagement beacon, sent by the theme blocks' viewer-3d.js.
 *
 * Shopify maps  https://<shop>/apps/viewer-3d/track
 *          to   https://<this app>/proxy/track
 * and signs the forwarded query string. Unlike /proxy/model/:id this one *is*
 * signature-checked: it writes counts against a shop, and the shop has to come
 * from Shopify, not from whoever sent the request.
 *
 * Always answers 204, even on a rejected request — the sender is a beacon that
 * cannot act on an error, and a storefront must never see this fail.
 */

const MAX_EVENTS = 20;
const NO_CONTENT = () => new Response(null, { status: 204 });

export const action = async ({ request }: ActionFunctionArgs) => {
  let shop: string | null = null;
  try {
    await authenticate.public.appProxy(request);
    shop = new URL(request.url).searchParams.get("shop");
  } catch {
    return NO_CONTENT();
  }
  if (!shop) return NO_CONTENT();

  let body: unknown;
  try {
    // sendBeacon posts text/plain, so read it as text and parse ourselves.
    body = JSON.parse(await request.text());
  } catch {
    return NO_CONTENT();
  }
  const events = Array.isArray((body as any)?.events)
    ? ((body as any).events as unknown[]).slice(0, MAX_EVENTS)
    : [];

  for (const raw of events) {
    const e = raw as {
      e?: unknown;
      p?: unknown;
      t?: unknown;
      d?: unknown;
      v?: unknown;
      n?: unknown;
    };
    // The embed placement is counted by its own route, never by this one.
    if (!isPlacement(e.p) || e.p === "embed") continue;
    const target = toTarget(e.t);
    const device = toDevice(e.d);

    // Time on screen arrives as seconds; stored as a sum plus a count of
    // viewers (on a viewer's first report only) so it can be averaged.
    if (e.e === "dwell") {
      const secs = Math.min(600, Math.max(0, Math.round(Number(e.v) || 0)));
      if (secs > 0)
        recordViewerEvent(shop, e.p, "dwell_s", target, device, secs);
      if (e.n === 1 && secs > 0) {
        recordViewerEvent(shop, e.p, "dwell_n", target, device);
      }
      continue;
    }
    // dwell_s/dwell_n are internal; only the route above may write them.
    if (!isViewerEvent(e.e) || e.e === "dwell_s" || e.e === "dwell_n") continue;
    recordViewerEvent(shop, e.p, e.e, target, device);
  }
  return NO_CONTENT();
};

export const loader = () => new Response(null, { status: 405 });
