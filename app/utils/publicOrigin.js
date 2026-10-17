/**
 * The origin a BROWSER should use to reach this app.
 *
 * `new URL(request.url).origin` describes the connection the SERVER saw. Behind
 * a proxy or tunnel (Cloudflare, ngrok, a load balancer, nginx) that connection
 * is plain http:// on an internal host, even though visitors arrive over https.
 *
 * That matters because snippets handed to merchants get pasted onto https
 * storefronts: an http:// iframe or script URL there is blocked outright as
 * mixed content, and the video silently never loads.
 *
 * So: trust the forwarded headers when a proxy set them, and otherwise assume
 * https for any non-local host — a public deployment is never plain http.
 */
export function publicOrigin(request) {
  const url = new URL(request.url);

  // A proxy chain can append values; the first is the original client's.
  const forwardedProto = (request.headers.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  // Forwarded-Host is client-controllable unless the proxy overwrites it, and
  // the origin is emitted into generated JS — accept only a bare host[:port].
  const forwardedHost = (request.headers.get("x-forwarded-host") || "")
    .split(",")[0]
    .trim();
  const host = /^[a-z0-9.-]+(:\d{1,5})?$/i.test(forwardedHost)
    ? forwardedHost
    : url.host;

  const isLocal = /^(localhost|127\.0\.0\.1|\[?::1\]?)(:\d+)?$/i.test(host);
  const scheme =
    (forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : null) || (isLocal ? url.protocol.replace(":", "") : "https");

  return `${scheme}://${host}`;
}
