import prisma from "../db.server";
import { parseConfig } from "./viewer-config";

/*
 * Resolves one Model ID to what the storefront viewer needs to render it.
 *
 * Shared by the two public entry points, which differ only in how the storefront
 * reaches them:
 *
 *   app/routes/proxy.model.$id.tsx  — via Shopify's app proxy, so the storefront
 *                                     requests a path on its OWN domain and
 *                                     Shopify forwards it here. Same-origin, so
 *                                     no CORS, and nothing has to know this
 *                                     app's URL.
 *   app/routes/api.model.$id.tsx    — direct, cross-origin. Needed when the app
 *                                     proxy isn't configured on the shop yet.
 *
 * Both are deliberately unauthenticated. Ids are v4 uuids so they aren't
 * guessable, and the payload carries only what is needed to draw the model — the
 * owning shop is never exposed. This is the same exposure /viewer/:id has had
 * since it was added.
 */

export type ResolvedModel = {
  id: string;
  name: string;
  url: string;
  config: ReturnType<typeof parseConfig>;
};

export async function resolveModel(
  id: string | undefined,
): Promise<ResolvedModel | null> {
  if (!id) return null;

  const model = await prisma.model3D.findUnique({
    where: { id },
    select: { id: true, name: true, fileUrl: true, config: true },
  });

  // No row, or a row whose file never resolved — neither is renderable, and the
  // difference isn't the caller's business.
  if (!model || !model.fileUrl) return null;

  return {
    id: model.id,
    name: model.name,
    url: model.fileUrl,
    // Normalised through the same parser the admin and /viewer/:id use, so the
    // storefront never has to validate anything itself.
    config: parseConfig(model.config),
  };
}

// A plain GET with no custom request headers is a CORS "simple request", so no
// OPTIONS preflight is involved and this single header is sufficient. Sent on
// errors too, or the browser would hide the status code behind an opaque
// "Failed to fetch" and the storefront could not report why.
export const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

// Short shared cache: a config edit should show up promptly, but a page with
// several viewers shouldn't hammer this.
export const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
};
