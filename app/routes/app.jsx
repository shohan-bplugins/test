import { useEffect, useState } from "react";
import { json } from "@remix-run/node";
import {
  Link,
  Outlet,
  useLoaderData,
  useRouteError,
  useRouteLoaderData,
  isRouteErrorResponse,
  useNavigation,
  useLocation,
} from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import "@shopify/polaris/build/esm/styles.css";
import enTranslations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";
import CustomizeSkeleton from "../components/Customize/CustomizeSkeleton";
import SupportProvider, {
  useSupport,
} from "../components/SupportForm/SupportProvider";
import { ErrorState } from "../components/PageState/PageState";
import WebVitalsOverlay from "../components/WebVitalsOverlay/WebVitalsOverlay";
import prisma from "../db.server";
import { syncPlanWithShopify } from "../lib/billing.server";
import {
  SELECT_PLAN_PATH,
  isOpenPath,
  needsPlanSelection,
} from "../lib/plan-gate.server";

export const loader = async ({ request }) => {
  const { admin, billing, session, redirect } = await authenticate.admin(request);

  const [user, charge] = await Promise.all([
    prisma.Users.findMany({
      where: { shop: session?.shop },
    }),
    prisma.Charges.findMany({
      where: { shop: session?.shop },
    }),
  ]);

  if (user[0]?.shop !== session?.shop) {
    const response = await admin.graphql(
      `#graphql
        {
          shop {
            name
            email
            domain
            myshopifyDomain
            plan {
              displayName
            }
            countryName
          }
        }
      `,
    );

    const data = await response.json();
  }

  // Drop any paid plan Shopify isn't actually billing for (e.g. an upgrade
  // that was never approved). Free shops skip the Shopify call.
  await syncPlanWithShopify(admin, session?.shop, { onlyIfPaid: true });

  // New installs and Free shops that never picked a plan see only the
  // one-time plan screen; every other page is hidden until they choose.
  const planGate = await needsPlanSelection(session?.shop);
  if (planGate && !isOpenPath(new URL(request.url).pathname)) {
    throw redirect(SELECT_PLAN_PATH);
  }

  return json({ apiKey: process.env.SHOPIFY_API_KEY || "", planGate });
};

export default function App() {
  const { apiKey, planGate } = useLoaderData();
  const nav = useNavigation();
  const location = useLocation();
  // Opening a player editor from another page: show its skeleton right away.
  const showCustomizeSkeleton =
    nav.state === "loading" &&
    nav.location?.pathname?.startsWith("/app/customize/") &&
    !location.pathname.startsWith("/app/customize/");
  const loading = nav.state === "loading" || nav.state === "submitting";
  const isCustomizePage =
    location.pathname.startsWith("/app/customize/") || showCustomizeSkeleton;
  // Pages that use the full width instead of the centered 1200px column.
  const isFullWidth =
    isCustomizePage || location.pathname.startsWith("/app/documentation");

  // Real-merchant Core Web Vitals: App Bridge measures them in the admin;
  // forward each report to our own database (see app.web-vitals.jsx).
  // App Bridge adds the session token to this fetch automatically.
  useEffect(() => {
    if (typeof shopify === "undefined" || !shopify.webVitals?.onReport) return;
    shopify.webVitals.onReport((payload) => {
      fetch("/app/web-vitals", {
        method: "POST",
        keepalive: true, // reports often arrive as the page is being hidden
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: window.location.pathname,
          appLoadId: payload?.appLoadId,
          userId: payload?.userId,
          metrics: payload?.metrics,
        }),
      }).catch(() => {});
    });
  }, []);

  // Shopify's own admin loading bar instead of a custom one.
  useEffect(() => {
    if (typeof shopify !== "undefined") shopify.loading(loading);
  }, [loading]);

  return (
    <AppProvider
      // App Bridge is already loaded first in <head> (root.jsx); here this
      // flag only controls AppProvider injecting a second copy into <body>.
      isEmbeddedApp={false}
      apiKey={apiKey}
      i18n={enTranslations}
    >
      <NavMenu planGate={planGate} />
      {/* One page width for the whole app (1200px, centered); the player
          customize pages (editor + preview) and the documentation use the
          full width. */}
      <div
        style={{
          ...(isFullWidth ? null : { maxWidth: 1200, margin: "0 auto" }),
          opacity: loading && !showCustomizeSkeleton ? 0.6 : 1,
          pointerEvents: loading ? "none" : "auto",
          transition: "opacity 0.15s ease",
        }}
      >
        {/* Opening a player editor: show its skeleton instead of keeping the
            previous page on screen while the loader runs. */}
        <SupportProvider>
          {showCustomizeSkeleton ? <CustomizeSkeleton /> : <Outlet />}
        </SupportProvider>
      </div>
      {/* <WebVitalsOverlay /> */}
    </AppProvider>
  );
}

// Same as SELECT_PLAN_PATH (that module is server-only).
const SELECT_PLAN_PATH_CLIENT = "/app/select-plan";

function NavMenu({ planGate }) {
  // Until a plan is picked the menu is empty (the home link isn't listed).
  if (planGate) {
    return (
      <ui-nav-menu>
        <Link to={SELECT_PLAN_PATH_CLIENT} rel="home">
          Home
        </Link>
      </ui-nav-menu>
    );
  }
  return (
    <ui-nav-menu>
      <Link to="/app" rel="home">
        Home
      </Link>
      <Link to="/app/audios">Audios</Link>
      <Link to="/app/product-audio">Product Audio</Link>
      <Link to="/app/analytics">Analytics &amp; Reporting</Link>

      <Link to="/app/documentation">Documentation</Link>
      <Link to="/app/pricing">Pricing</Link>
    </ui-nav-menu>
  );
}

// Auth responses thrown by authenticate.admin (session-token retry, bounce
// page) must reach Shopify's boundary so re-authentication keeps working.
const isShopifyAuthResponse = (error) =>
  isRouteErrorResponse(error) &&
  (error.status === 401 ||
    error.status === 403 ||
    (typeof error.data === "string" && error.data.includes("<")));

function PageError({ error }) {
  const openSupport = useSupport();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const detail = isRouteErrorResponse(error)
    ? typeof error.data === "string"
      ? error.data
      : error.data?.message
    : null;
  const notFound = status === 404;
  return (
    <s-section>
      <ErrorState
        heading={notFound ? "Not found" : "Something went wrong"}
        message={
          detail ||
          (notFound
            ? "This page or item doesn't exist, or it was removed."
            : "This page couldn't load. Please try again — if it keeps happening, contact support.")
        }
        onRetry={notFound ? undefined : () => window.location.reload()}
        onSupport={() =>
          openSupport(notFound ? "" : `Error on ${window.location.pathname}: `)
        }
      />
    </s-section>
  );
}

// Errors from any /app page render here, inside the app shell (nav menu and
// App Bridge stay), instead of replacing the whole embedded app.
export function ErrorBoundary() {
  const error = useRouteError();
  const apiKey = useRouteLoaderData("routes/app")?.apiKey;
  // Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
  if (isShopifyAuthResponse(error) || !apiKey) return boundary.error(error);
  if (!isRouteErrorResponse(error)) console.error(error);
  return (
    <AppProvider
      // App Bridge is already loaded first in <head> (root.jsx); here this
      // flag only controls AppProvider injecting a second copy into <body>.
      isEmbeddedApp={false}
      apiKey={apiKey}
      i18n={enTranslations}
    >
      <NavMenu planGate={planGate} />
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <SupportProvider>
          <PageError error={error} />
        </SupportProvider>
      </div>
    </AppProvider>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
