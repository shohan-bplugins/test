import { json } from "@remix-run/node";
import {
  Link,
  Outlet,
  useLoaderData,
  useLocation,
  useRouteError,
  useNavigation,
} from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import variablesStyles from "../styles/variables.css?url";
import themeOverrides from "../styles/theme-overrides.css?url";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { FREE_PLAN_NAME, FREE_PLAN_CREDITS } from "../utils/planLimits";
import { hasChosenPlan, verifyShopPlan } from "../utils/planSync.server";
import { useEffect, useState } from "react";

// Pages reachable before a plan is chosen (lower-case, no trailing slash).
const PLAN_GATE_ALLOWED_PATHS = new Set(["/app/pricing", "/app/successbilling"]);

export const links = () => [
  { rel: "stylesheet", href: variablesStyles },
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: themeOverrides },
];

export const loader = async ({ request }) => {
  const { admin, session, redirect } = await authenticate.admin(request);

  const shop = session.shop;

  // This loader runs on EVERY admin page, so its cost lands in the TTFB of all
  // of them. `shop` is @unique, so findUnique is an indexed point read where
  // findMany was a scan-shaped query; and the free-plan row only needs creating
  // on a shop's first visit, so the Plans read stays behind that branch.
  const existing = await prisma.users.findUnique({
    where: { shop },
    select: { id: true },
  });

  if (!existing) {
    const freePlan = await prisma.plans.findFirst({
      where: { name: FREE_PLAN_NAME },
    });
    await prisma.users.create({
      // `?? FREE_PLAN_CREDITS` so a missing catalogue row cannot write a null
      // allowance, which every limit check would then read as 0 players.
      data: { shop, cardits: freePlan?.cradit ?? FREE_PLAN_CREDITS },
    });
  }

  // Runs on every app open: is the shop's charge approved and still ACTIVE?
  // If not, the stored plan is corrected (see verifyShopPlan).
  await verifyShopPlan(admin, shop);

  // First-run gate: until the shop has chosen a plan (Free, or a paid plan
  // whose charge Shopify reports as approved and active), every page except
  // pricing — and the billing return page that completes a purchase —
  // redirects to pricing.
  const planChosen = await hasChosenPlan(shop);
  const path = new URL(request.url).pathname.replace(/\/+$/, "").toLowerCase();
  if (!planChosen && !PLAN_GATE_ALLOWED_PATHS.has(path)) {
    throw redirect("/app/pricing");
  }

  return json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop,
    planChosen,
  });
};

export default function App() {
  const { apiKey, shop, planChosen } = useLoaderData();

  // Real-user Core Web Vitals for every admin route. Client-only, and imported
  // lazily so web-vitals never lands in the server bundle or blocks first paint.
  useEffect(() => {
    import("../utils/webVitals.client").then((m) => m.startWebVitals());
  }, []);

  // Crisp live chat, admin pages only. Loaded here rather than in root.jsx so
  // it never appears on the storefront-facing embed/proxy routes. The guard
  // keeps client-side navigation (and dev HMR) from injecting it twice.
  useEffect(() => {
    if (window.$crisp) return;
    window.$crisp = [];
    window.CRISP_WEBSITE_ID = "e9e3fe6a-6052-4c62-9d27-3c2d73a2c277";
    if (shop) window.$crisp.push(["set", "session:data", [[["shop", shop]]]]);
    const s = document.createElement("script");
    s.src = "https://client.crisp.chat/l.js";
    s.async = true;
    document.head.appendChild(s);
  }, [shop]);

  const navigation = useNavigation();
  const loading =
    navigation.state === "loading" || navigation.state === "submitting";

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      {/* Until a plan is chosen, pricing is the only page — so it is the only
          menu entry too (the loader redirects everything else there). */}
      {planChosen ? (
        <ui-nav-menu>
          <Link to="/app" rel="home">
            Home
          </Link>
          <Link to="/app/videos">Videos</Link>
          <Link to="/app/product-video">Product Video</Link>
          <Link to="/app/analytics">Analytics &amp; Reports</Link>
          <Link to="/app/documentation">Documentation</Link>
          <Link to="/app/setup">Setup</Link>
          <Link to="/app/pricing">Pricing</Link>
        </ui-nav-menu>
      ) : (
        <ui-nav-menu>
          <Link to="/app/pricing" rel="home">
            Pricing
          </Link>
        </ui-nav-menu>
      )}
      {loading && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "3px",
            zIndex: 9999,
            overflow: "hidden",
            backgroundColor: "rgba(0, 128, 96, 0.15)",
          }}
        >
          <div
            style={{
              height: "100%",
              backgroundColor: "#008060",
              animation: "appLoadingBar 1.5s ease-in-out infinite",
            }}
          />
        </div>
      )}
      <div
        style={{
          opacity: loading ? 0.6 : 1,
          pointerEvents: loading ? "none" : "auto",
          transition: "opacity 0.15s ease",
        }}
      >
        <Outlet />
      </div>
      <style>{`
        @keyframes appLoadingBar {
          0% { width: 0%; margin-left: 0; }
          50% { width: 60%; margin-left: 20%; }
          100% { width: 0%; margin-left: 100%; }
        }
      `}</style>
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
