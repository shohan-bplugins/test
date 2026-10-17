import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "@remix-run/react";

export default function App() {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {/* Not boilerplate — do not delete. The production nginx in front of
            this app injects `Referrer-Policy: same-origin` on every HTML
            response, which means the browser sends NO Referer header on any
            cross-origin request. YouTube's embedded player answers a missing
            Referer with "Error 153" and refuses to play, so every tutorial and
            preview video died on deploy while working fine in dev (no nginx,
            so the browser default applied).

            We cannot edit that nginx config. This meta is the app-side lever:
            per spec the header populates the document's policy container
            during navigation, then the parser's meta-referrer steps ASSIGN to
            that same slot — last write wins, and the meta is parsed after.

            A per-iframe `referrerPolicy` attribute beats both and is used at
            every embed below, but it cannot reach the Plyr-driven players:
            Plyr's YouTube provider throws our iframe away and lets the YT
            IFrame API build its own, which takes no referrerpolicy. Those
            players are reachable ONLY from here.

            The value must stay spelled exactly — an unrecognised token is
            silently ignored and leaves `same-origin` in force, with no
            console warning to tell you why the videos are still broken. */}
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="preconnect"
          href="https://cdn.plyr.io/"
          crossOrigin="anonymous"
        />
        {/* App Bridge is deliberately NOT loaded here. `AppProvider` in app.jsx
            injects it with `data-api-key={apiKey}` read from the server's own
            SHOPIFY_API_KEY, which is the only copy guaranteed to match the app
            the request authenticated against.

            What used to be here was a hardcoded <meta name="shopify-api-key">
            plus a second, key-less app-bridge.js tag. Two App Bridge instances
            race to set up the channel to the admin, and the one that wins was
            configured for a different client id than the server's — so App
            Bridge could not act on responses from the admin. That is what broke
            the billing upgrade: the action answers with App Bridge's
            reauthorize-url header (see app.pricing.jsx) expecting a TOP-level
            navigation, nothing handled it, and the admin URL was left to load
            inside the app frame — "Refused to display 'https://admin.shopify.com/'
            in a frame because it set 'X-Frame-Options' to 'deny'". */}
        {/* Polaris web components (the s-* custom elements). App Bridge
            registers only s-button and s-link; the rest of the library
            (s-section, s-stack, s-grid, s-badge, s-banner, s-box, s-heading,
            s-paragraph, s-text, s-icon, s-divider) comes from this script.
            polaris-1.js tracks the newest stable 1.x. It is ~500KB, so if
            dashboard LCP regresses, this is the first thing to measure. */}
        <script src="https://cdn.shopify.com/shopifycloud/polaris-1.js"></script>
        <script async src="https://cdn.plyr.io/3.7.8/plyr.js"></script>
        {/* plyr.css used to be a plain <link rel="stylesheet"> here, which makes
            it render-blocking on a third-party origin for EVERY admin page —
            including the dashboard, which never renders a player. Loading it as
            media="print" and flipping to "all" on load keeps the same styles
            without holding up first paint. Plyr consumers poll for window.Plyr
            before initialising, so arriving slightly later is safe. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var l=document.createElement('link');" +
              "l.rel='stylesheet';l.media='print';" +
              "l.href='https://cdn.plyr.io/3.7.8/plyr.css';" +
              "l.onload=function(){this.media='all'};" +
              "document.head.appendChild(l)})()",
          }}
        />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Last-resort boundary for the whole document.
 *
 * Without one, any error that reaches this far renders Remix's built-in error
 * page IN PLACE OF the entire app — which, inside the admin iframe, reads as
 * "the whole app crashed" rather than "one page failed". Errors get here more
 * easily than it looks: `boundary.error()` in app.jsx (Shopify's helper) only
 * handles thrown Responses and RE-THROWS every ordinary Error, so a single bad
 * value in one route component escapes every boundary the app has.
 *
 * This keeps App Bridge's script tag and the page chrome alive and shows the
 * actual message, so the next failure is diagnosable instead of a blank frame.
 */
export function ErrorBoundary() {
  const error = useRouteError();

  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : "Something went wrong";
  const detail = isRouteErrorResponse(error)
    ? error.data
    : error instanceof Error
      ? error.message
      : String(error);

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{title}</title>
        <Meta />
        <Links />
      </head>
      <body style={{ fontFamily: "Inter, system-ui, sans-serif", padding: 24 }}>
        <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>{title}</h1>
        <p style={{ margin: "0 0 16px", color: "#616161" }}>
          This page failed to load. The rest of the app is unaffected — use the
          menu to go somewhere else, or reload to try again.
        </p>
        <pre
          style={{
            background: "#f6f6f7",
            border: "1px solid #e3e3e3",
            borderRadius: 8,
            padding: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 12,
          }}
        >
          {detail}
          {error instanceof Error && error.stack ? `\n\n${error.stack}` : ""}
        </pre>
        <Scripts />
      </body>
    </html>
  );
}
