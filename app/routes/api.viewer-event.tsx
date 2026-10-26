import type { ActionFunctionArgs } from "react-router";
import { isbot } from "isbot";

import prisma from "../db.server";
import { recordViewerEvent, toDevice } from "~/lib/viewer-stats.server";
import { FEATURES, type ViewerEvent } from "~/lib/viewer-stats";

/*
 * Engagement beacon for the public /viewer/:id embed, which lives on this
 * app's own domain and so cannot use the storefront app proxy. The shop is
 * taken from the model row, never from the request.
 *
 * The same events the storefront's track route takes for a theme block: view,
 * interact, AR, each toolbar control, and time on screen (`dwell`, split into
 * dwell_s/dwell_n there as here). Sent by routes/viewer.$id.tsx. Always 204 —
 * the sender is a beacon.
 */

/** What an embed may report, besides `dwell`. */
const EMBED_EVENTS = new Set<string>(["view", "interact", "ar", ...FEATURES]);

const NO_CONTENT = () => new Response(null, { status: 204 });

/*
 * Model id -> shop, remembered. Without it every beacon from every embedded
 * viewer was its own Mongo read — the one per-event database query in the
 * tracking path. A model never changes shop, so the only staleness is a
 * deleted model still being counted for up to the TTL. Misses (unknown ids)
 * are remembered too, so a stream of junk ids cannot each cost a query.
 */
const MODEL_TTL_MS = 30 * 60_000;
const MODEL_MAX = 20_000;
const modelShops = new Map<string, { at: number; shop: string | null }>();

async function shopForModel(id: string): Promise<string | null> {
  const hit = modelShops.get(id);
  if (hit && Date.now() - hit.at < MODEL_TTL_MS) return hit.shop;
  const row = await prisma.model3D
    .findUnique({ where: { id }, select: { shop: true } })
    .catch(() => undefined);
  // A database error is not remembered as "no such model".
  if (row === undefined) return null;
  modelShops.set(id, { at: Date.now(), shop: row?.shop ?? null });
  if (modelShops.size > MODEL_MAX) {
    modelShops.delete(modelShops.keys().next().value!);
  }
  return row?.shop ?? null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (isbot(request.headers.get("user-agent") ?? "")) return NO_CONTENT();

  let body: { m?: unknown; e?: unknown; d?: unknown; v?: unknown; n?: unknown };
  try {
    body = JSON.parse(await request.text());
  } catch {
    return NO_CONTENT();
  }
  const event = String(body.e ?? "");
  const modelId = String(body.m ?? "");
  if (
    (event !== "dwell" && !EMBED_EVENTS.has(event)) ||
    !/^[0-9a-f-]{36}$/i.test(modelId)
  ) {
    return NO_CONTENT();
  }

  const shop = await shopForModel(modelId.toLowerCase());
  if (!shop) return NO_CONTENT();
  const target = `model:${modelId.toLowerCase()}`;
  const device = toDevice(body.d);

  // Time on screen, exactly as routes/proxy.track.tsx stores it: seconds
  // (capped per report) plus, on a viewer's first report, one viewer — so the
  // Analytics page can average it.
  if (event === "dwell") {
    const secs = Math.min(600, Math.max(0, Math.round(Number(body.v) || 0)));
    if (secs > 0) {
      recordViewerEvent(shop, "embed", "dwell_s", target, device, secs);
      if (body.n === 1) recordViewerEvent(shop, "embed", "dwell_n", target, device);
    }
    return NO_CONTENT();
  }
  recordViewerEvent(shop, "embed", event as ViewerEvent, target, device);
  return NO_CONTENT();
};

export const loader = () => new Response(null, { status: 405 });
