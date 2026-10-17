/*
 * The app's own origin, for absolute URLs that are handed to someone else
 * rather than followed by us.
 *
 * `new URL(request.url).origin` is the obvious way to get this and it is wrong
 * behind a reverse proxy. nginx terminates TLS and forwards over plain HTTP to
 * 127.0.0.1:3000 (see DEPLOY-VPS.md step 8), and @react-router/serve does not
 * trust `X-Forwarded-Proto` by default — so `request.url` comes back as
 * `http://<host>/…` on a site that is only ever served over HTTPS.
 *
 * That looked harmless for a long time, because nginx 301s http → https and
 * every link therefore still worked. What it silently broke was the iframe
 * embed's permissions:
 *
 *   <iframe src="http://app.example.com/viewer/x"
 *           allow="fullscreen; xr-spatial-tracking" allowfullscreen>
 *
 * `allow="fullscreen"` is shorthand for `fullscreen 'src'`, and legacy
 * `allowfullscreen` means the same thing — the allowlist is the origin of the
 * `src` attribute, `http://app.example.com`. The 301 lands the frame on
 * `https://app.example.com`, and a scheme is part of an origin, so the document
 * that actually loaded is *not* in its own frame's allowlist. It gets no
 * fullscreen and no WebXR permission: `document.fullscreenEnabled` is false, the
 * viewer's button falls back to reporting that fullscreen is unavailable, and
 * "View in your room" never appears. The model itself renders perfectly, which
 * is what makes this so hard to see — everything works except the two features
 * that happen to be delegated per-frame.
 *
 * So: prefer SHOPIFY_APP_URL, which is the app's canonical public URL and the
 * same value shopify.server.ts and model-library.server.ts already treat as
 * authoritative. Fall back to the request, but honour X-Forwarded-Proto when
 * deciding its scheme.
 */
export function resolveAppOrigin(request: Request): string {
  const configured = process.env.SHOPIFY_APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // A malformed env var shouldn't take the page down — fall through to the
      // request, which at least resolves to something reachable.
    }
  }

  const url = new URL(request.url);
  // Comma-separated when more than one proxy is in front; the first entry is
  // the scheme the client actually used.
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwarded === "http" || forwarded === "https") {
    url.protocol = `${forwarded}:`;
  }
  return url.origin;
}
