
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { framedRedirect } from "~/lib/framed-redirect.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

/*
 * Everything under /auth: the OAuth callback, the session-token bounce, the
 * exit-iframe hop. `authenticate.admin` handles all of them.
 *
 * The exception is a request to bare `/auth`, the legacy install entry point.
 * There is no session and no session token on that request by definition, so
 * `authenticate.admin` cannot authenticate it and redirects to `/auth/login` —
 * dropping the query string on the way. `/auth/login` with no shop renders a
 * form asking the merchant to type their store domain, which is what a
 * first-time installer was being shown: a login screen, at the exact moment
 * Shopify had already told us which store it was.
 *
 *   /auth?shop=acme.myshopify.com        -> 302 /auth/login            (form)
 *   /auth/login?shop=acme.myshopify.com  -> 302 admin.shopify.com/store/acme/oauth/install
 *
 * The shop is the whole difference, so carry it across. `login()` behind
 * /auth/login already resolves it to Shopify's managed-install URL, which is
 * where a fresh install should have gone in the first place.
 *
 * Scoped to bare `/auth` — `params["*"]` is empty only there — so the callback
 * and the two bounce routes still reach `authenticate.admin` untouched. Getting
 * that wrong would break the callback, which arrives *with* a shop param and
 * must not be redirected.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (shop && !params["*"]) {
    // framedRedirect for the same reason _index does: a bare 302 carries no CSP,
    // and a proxy stamping X-Frame-Options then breaks this hop on its own.
    throw framedRedirect(request, `/auth/login?${url.searchParams.toString()}`);
  }

  await authenticate.admin(request);

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
