import { addDocumentResponseHeaders } from "~/shopify.server";

/*
 * A redirect that survives being followed inside the Shopify admin's iframe.
 *
 * react-router's `redirect()` builds a bare 302. That is fine anywhere else and
 * broken here, for a reason that is invisible until it is deployed behind a
 * proxy:
 *
 *  - A thrown or returned redirect short-circuits rendering, so `handleRequest`
 *    in entry.server.tsx — the one place `addDocumentResponseHeaders` runs —
 *    never sees the response. The 302 carries no `Content-Security-Policy`.
 *  - Browsers ignore `X-Frame-Options` only when a CSP *is* present, and they
 *    check XFO on redirect hops, not just on the final document.
 *  - Hosting-panel vhost templates routinely stamp `X-Frame-Options: SAMEORIGIN`
 *    on every response (see DEPLOY-VPS.md → "X-Frame-Options from nginx blocks
 *    the embedded frame"). This app's rendered documents all carry a CSP, so
 *    that header is harmless on them — and lethal on the one response that
 *    doesn't.
 *
 * The result is a redirect the admin refuses to follow, with the app itself
 * looking perfectly healthy either side of it. The first-install path made that
 * concrete: app._index's loader throws a redirect to /app/onboarding exactly
 * once per install, so a brand new merchant hit the one broken hop and nobody
 * else ever did.
 *
 * _index/route.tsx built this by hand first, then auth.$.tsx needed the same
 * thing; this is that pattern with one owner, so the next redirect added to a
 * framed route gets it for free.
 */
export function framedRedirect(
  request: Request,
  location: string,
  status = 302,
): Response {
  const headers = new Headers();
  addDocumentResponseHeaders(request, headers);
  headers.set("Location", location);
  return new Response(null, { status, headers });
}
