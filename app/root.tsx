import type { LinksFunction } from "react-router";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";

import criticalStylesUrl from "./critical.css?url";
import {
  AnalyticsScripts,
  useAnalyticsPageViews,
} from "~/components/Analytics";
import { BootSplash } from "~/components/BootSplash";
import { getAnalyticsConfig } from "~/lib/analytics.server";

// Only the app shell's own chrome is global. Both view3d's stylesheet and
// app.css — Tailwind plus the viewer's styling — are render-blocking requests
// that nothing outside the three viewer routes has anything to style with, so
// those routes declare them and they arrive with the route rather than ahead of
// every page. See critical.css for what is left here and why.
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: criticalStylesUrl },
];

export const loader = () => ({ analytics: getAnalyticsConfig() });

/**
 * Route-transition progress for the pages *outside* the embedded admin — the
 * public /viewer/:id page and the auth screens.
 *
 * Admin routes do not use this. They call `shopify.loading` instead (see
 * routes/app.tsx), which drives the admin's own indicator; painting this bar
 * there as well put a second loader inside the iframe, a few pixels below the
 * real one and never in step with it.
 */
function NavigationProgress() {
  const navigation = useNavigation();
  if (navigation.state === "idle") return null;
  return <div className="nav-progress-bar" />;
}

export default function App() {
  const { analytics } = useLoaderData<typeof loader>();
  const { pathname } = useLocation();

  // Merchant-facing admin pages only. This gates two things: analytics (the
  // public /viewer/:id embed and the auth screens stay untracked — see the note
  // in components/Analytics.tsx) and the boot splash, which covers a wait that
  // only the embedded admin shell has.
  const isAdminRoute = pathname === "/app" || pathname.startsWith("/app/");
  useAnalyticsPageViews(isAdminRoute);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        {/*
          Render-blocking on purpose, and `crossorigin` on purpose.

          polaris.js appends this same stylesheet itself once it runs:

            xm.rel = "stylesheet";
            xm.href = ".../static/fonts/inter/v4/styles.css";
            xm.crossOrigin = "";

          The version of this that shipped here briefly was `rel="preload"`,
          to keep a cross-origin round trip off the critical path. That was the
          wrong trade. The file declares seven @font-face rules with
          `font-display: swap` and no metric overrides — no `size-adjust`, no
          `ascent-override` — so the moment Inter arrives, every piece of text
          on the page reflows from the fallback's metrics to Inter's. A preload
          does not apply a stylesheet, so the @font-face rules stayed unknown
          until polaris.js executed and appended its own link, which pushed the
          font download hundreds of milliseconds later and the reflow with it:
          a guaranteed layout shift, arriving late enough to look like the page
          moving under the merchant.

          As a stylesheet it is parsed before the first paint, so the font
          fetch starts at the earliest possible moment and the swap window is
          as small as it can be. The cost is one request for 2.1KB to a CDN the
          admin has already connected to and which `preconnect` above covers.

          `crossorigin` is the part worth keeping from the preload attempt: it
          has to match Polaris's copy or the two have different cache keys and
          the browser fetches the file twice.
        */}
        <link
          rel="stylesheet"
          crossOrigin=""
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        {isAdminRoute ? (
          <>
            {/*
              Fetched from the top of <head>, alongside the stylesheets.
              AppProvider (routes/app.tsx) renders both as blocking scripts in
              <body>, and nothing on an admin page paints as itself until
              polaris.js has defined the s-* elements — so this download is on
              the LCP path. Same URLs and no crossorigin, matching the script
              tags, so the browser reuses these rather than fetching twice.
            */}
            <link
              rel="preload"
              as="script"
              href="https://cdn.shopify.com/shopifycloud/app-bridge.js"
            />
            <link
              rel="preload"
              as="script"
              href="https://cdn.shopify.com/shopifycloud/polaris.js"
            />
          </>
        ) : null}
        <Meta />
        <Links />
        {isAdminRoute ? <AnalyticsScripts {...analytics} /> : null}
      </head>
      <body>
        {isAdminRoute ? <BootSplash /> : null}
        {isAdminRoute ? null : <NavigationProgress />}
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
