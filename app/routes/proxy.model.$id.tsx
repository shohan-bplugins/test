import type { LoaderFunctionArgs } from "react-router";

import {
  CACHE_HEADERS,
  CORS_HEADERS,
  resolveModel,
} from "~/lib/model-resolve.server";

/*
 * The app-proxy entry point for resolving a Model ID.
 *
 * Shopify maps  https://<shop>/apps/viewer-3d/model/<id>
 *          to   https://<this app>/proxy/model/<id>
 * (see [app_proxy] in shopify.app.toml).
 *
 * This exists because the direct cross-origin endpoint proved unusable in the
 * field: the theme block has no way to learn this app's URL, so the URL had to be
 * hardcoded in Liquid — and the moment it didn't match reality (a `shopify app
 * dev` tunnel, a changed domain) every fetch failed with nothing but the
 * browser's opaque "Failed to fetch".
 *
 * Through the proxy the storefront requests a *relative* path on its own domain.
 * Shopify forwards it to whatever the app's current URL is, so there is nothing
 * to hardcode and nothing to keep in sync, and because it is same-origin, CORS
 * cannot be involved at all.
 *
 * Not signature-validated on purpose. `authenticate.public.appProxy` would add a
 * failure mode (clock skew, secret mismatch) to an endpoint that returns data
 * already public at /api/model/:id and /viewer/:id. There is nothing here worth
 * protecting and a great deal worth not breaking.
 */

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const model = await resolveModel(params.id);

  if (!model) {
    return Response.json(
      { error: "Model not found" },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  return Response.json(model, {
    headers: { ...CORS_HEADERS, ...CACHE_HEADERS },
  });
};
