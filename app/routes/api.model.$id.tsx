import type { LoaderFunctionArgs } from "react-router";

import {
  CACHE_HEADERS,
  CORS_HEADERS,
  resolveModel,
} from "~/lib/model-resolve.server";

/*
 * Direct, cross-origin resolution of a Model ID:
 *
 *   GET /api/model/<id>  ->  { id, name, url, config }
 *
 * The storefront's preferred route is the app proxy (app/routes/proxy.model.$id
 * .tsx), which is same-origin and needs no knowledge of this app's URL. This
 * endpoint is the fallback for shops where the proxy isn't configured yet, and it
 * is also the one the admin can be pointed at directly when debugging.
 *
 * See ~/lib/model-resolve.server for why both are unauthenticated.
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
