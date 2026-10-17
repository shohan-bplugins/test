import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  isRouteErrorResponse,
  useLoaderData,
} from "@remix-run/react";
import { useEffect } from "react";
import "./styles/style.css";
// Bundled with the app's CSS instead of a render-blocking third-party request.
import "plyr/dist/plyr.css";
import NotFound from "./components/NotFound/NotFound";
import { authenticate, login } from "./shopify.server";
import prisma from "./db.server";
import { createUserRecord } from "./lib/plan-gate.server";

// Example loader logic
// Example loader logic
export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/auth/login")) {
    return login(request);
  }

  const { session, admin } = await authenticate.admin(request);
  // Let Shopify's auth strategy handle invalid tokens (it throws a Response with reauth headers).
  // Runs alongside the user lookup instead of before it.
  const [, user] = await Promise.all([
    admin.graphql(`{ shop { id } }`),
    prisma.Users.findUnique({
      where: { shop: session.shop },
    }),
  ]);
  if (!user) {
    // New install: starts on the Pricing page until a plan is picked.
    await createUserRecord(session.shop);
  }

  return {
    shop: session.shop,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    clarityId: process.env.CLARITY_PROJECT_ID || "",
    gaId: process.env.GA_MEASUREMENT_ID || "",
  };
};
export default function App() {
  const loaderData = useLoaderData();
  const apiKey = loaderData?.apiKey;
  const clarityId = loaderData?.clarityId;
  const gaId = loaderData?.gaId;
  const shop = loaderData?.shop;

  // Crisp live chat. Loaded after hydration on purpose: when it was injected
  // from <head>, its chat button landed in <body> before React hydrated, React
  // saw a mismatch and re-rendered the document, deleting the button.
  useEffect(() => {
    if (window.$crisp && window.CRISP_WEBSITE_ID) return; // already loaded
    window.$crisp = [];
    window.CRISP_WEBSITE_ID = "e9e3fe6a-6052-4c62-9d27-3c2d73a2c277";
    // Show support which store is writing.
    if (shop) window.$crisp.push(["set", "session:data", [[["shop", shop]]]]);
    const script = document.createElement("script");
    script.src = "https://client.crisp.chat/l.js";
    script.async = true;
    document.head.appendChild(script);
  }, [shop]);

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {/* App Bridge: loaded from Shopify's CDN as the FIRST script in <head>,
            synchronously (no async/defer/module), as Shopify requires. Keep
            every other <script> below it. (AppProvider's own copy is turned
            off in app.jsx so it isn't loaded twice.) */}
        {apiKey ? (
          <>
            <meta name="shopify-api-key" content={apiKey} />
            <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
          </>
        ) : null}
        {/* Required so embedded YouTube players receive a Referer header
            (YouTube enforced this in late 2025 — without it embeds fail with Error 153). */}
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        {/* Dev only: App Bridge logs the Web Vitals it reports to Shopify in the console. */}
        {import.meta.env.DEV && (
          <meta name="shopify-debug" content="web-vitals" />
        )}
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        {/* Polaris web components (<s-*> tags) — used alongside Polaris React. */}
        <script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
        {/* `defer`: don't block the first paint on a third-party CDN. Plyr is
            only used inside effects, which run after deferred scripts. */}
        <script defer src="https://cdn.plyr.io/3.7.8/plyr.js"></script>

        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />

        {/* Google Analytics — set GA_MEASUREMENT_ID in .env to enable */}
        {gaId && (
          <>
            <script
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
            ></script>
            <script
              dangerouslySetInnerHTML={{
                __html: `
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  gtag('js', new Date());
                  gtag('config', '${gaId}');
                `,
              }}
            />
          </>
        )}

        {/* Microsoft Clarity — set CLARITY_PROJECT_ID in .env to enable */}
        {clarityId && (
          <script
            dangerouslySetInnerHTML={{
              __html: `
                (function(c,l,a,r,i,t,y){
                    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
                })(window, document, "clarity", "script", "${clarityId}");
              `,
            }}
          />
        )}


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

// Root errors render without <App/>, so they need their own document shell
// (and polaris.js) for the Polaris web components in NotFound to render.
export function ErrorBoundary({ error }) {
  const isResponse = isRouteErrorResponse(error);
  const heading =
    isResponse && error.status === 404
      ? "Page not found"
      : "Something went wrong";
  const message = isResponse
    ? error.data?.message ||
      (error.status === 404
        ? "The page you're looking for doesn't exist, was removed, or is temporarily unavailable."
        : `The request failed (status ${error.status}). Please try again.`)
    : "An unexpected error occurred. Please reload the page or contact support@bplugins.com.";

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
        <Meta />
        <Links />
      </head>
      <body>
        <NotFound heading={heading} message={message} />
        <Scripts />
      </body>
    </html>
  );
}
