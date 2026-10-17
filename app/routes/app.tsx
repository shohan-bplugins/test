import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";
import {
  Outlet,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { hasChosenPlan } from "~/lib/billing.server";
import { framedRedirect } from "~/lib/framed-redirect.server";
import { AnalyticsIdentify } from "~/components/Analytics";
import { WebVitals } from "~/components/WebVitals";
import { CrispChat } from "~/components/CrispChat";
import { ReviewPromptTest } from "~/components/ReviewPrompt";
import { reviewDebugAllowed } from "~/lib/review-prompt.server";

/*
 * Pages a shop can open before it has picked a plan: the plan picker, and the
 * page Shopify returns to after a charge is approved. Prefix matches, so
 * client-side data requests (`/app/select-plan.data`) pass too.
 */
const PLAN_GATE_ALLOWED = ["/app/select-plan", "/app/SuccessBilling"];

/**
 * Reports in the dev server terminal when a page arrives with a `review` URL
 * flag, so it is clear whether `?review=debug` reached the app at all.
 */
function logReviewFlag(url: URL, allowed: boolean): boolean {
  const flag = url.searchParams.get("review");
  if (flag) {
    console.info(
      `[review debug] ${url.pathname} arrived with review=${flag}; debugging ${allowed ? "allowed" : "NOT allowed on this server"}`,
    );
  }
  return allowed;
}

const isPlanGateAllowed = (pathname: string) =>
  PLAN_GATE_ALLOWED.some((p) => pathname.startsWith(p));

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";

  /*
   * A fresh install chooses a plan before anything else. Awaited, unlike the
   * background user seed this replaced: the answer decides whether the page
   * renders at all. Only the first check per shop touches Mongo — after that
   * it is an in-memory Set hit (see hasChosenPlan).
   */
  // Fails open: a lookup error must not take down every admin page — the
  // worst case is one shop seeing the app before choosing a plan.
  const planChosen = shop
    ? await hasChosenPlan(admin, shop).catch((error) => {
        console.error("[app] plan check failed", error);
        return true;
      })
    : true;
  const url = new URL(request.url);
  // POSTs to /app/pricing are the plan picker submitting its choice — the
  // pricing *page* itself stays behind the gate.
  const choosing =
    request.method !== "GET" && url.pathname.startsWith("/app/pricing");
  if (!planChosen && !choosing && !isPlanGateAllowed(url.pathname)) {
    // framedRedirect, and the query string kept, for the same reasons as the
    // onboarding hop in app._index.tsx.
    throw framedRedirect(
      request,
      url.search ? `/app/select-plan${url.search}` : "/app/select-plan",
    );
  }

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    // Tags the analytics session with the store, so funnels and Clarity
    // recordings can be traced back to a merchant.
    shop: session?.shop ?? null,
    planChosen,
    // The review test and debug URL flags work only where this is true:
    // outside production, or with REVIEW_DEBUG=1. Live merchants never get them.
    reviewDebug: logReviewFlag(url, reviewDebugAllowed()),
    // Decided here, not in render: the server and the browser would otherwise
    // evaluate the date separately and could disagree on the expiry day.
    newNav: NAV_ITEMS.filter(
      (i) => i.newUntil && new Date().toISOString().slice(0, 10) <= i.newUntil,
    ).map((i) => i.href),
  };
};

type NavItem = {
  href: string;
  label: string;
  exact?: boolean;
  home?: boolean;
  /**
   * Marks a new feature until this date (YYYY-MM-DD, UTC). The admin draws
   * s-app-nav itself and renders link text only — no badge component — so
   * "New" is part of the label, and it drops off on its own once the date
   * passes, with no deploy needed.
   */
  newUntil?: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/app", label: "Home", exact: true, home: true },
  // Always present. This used to be hidden once `onboardingDone` was set, but
  // that flag is also set by the dismiss-X on the dashboard's inline checklist,
  // so dismissing a card deleted the only route into the wizard.
  { href: "/app/onboarding", label: "Get started" },
  { href: "/app/products", label: "Product 3D Models" },
  { href: "/app/models", label: "3D Model Library" },
  { href: "/app/analytics", label: "Analytics", newUntil: "2026-12-31" },
  { href: "/app/documentation", label: "Documentation" },
  { href: "/app/pricing", label: "Pricing" },
  { href: "/app/setup", label: "Setup" },
];

function isActivePath(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

/**
 * Route transitions, shown by the admin rather than by the app.
 *
 * `shopify.loading` drives the admin's own indicator — the same one merchants
 * see moving between native pages — so a navigation inside this app is
 * indistinguishable from one in Shopify's own UI. It replaces a hand-drawn
 * progress bar this app used to paint across the top of its iframe, which was
 * a second, differently-styled loader sitting just below the real one and, being
 * inside the frame, could never line up with it.
 *
 * Returns null: there is nothing to render, the indicator lives outside this
 * document entirely.
 */
function NavigationLoading() {
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  useEffect(() => {
    shopify.loading(busy);
    // Clears the indicator if this route unmounts mid-flight, so a navigation
    // that is interrupted cannot leave the admin spinning forever.
    return () => shopify.loading(false);
  }, [shopify, busy]);

  return null;
}

export default function App() {
  const { apiKey, shop, planChosen, newNav, reviewDebug } =
    useLoaderData<typeof loader>();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  /*
   * The server gate only runs when this layout's loader does, and React Router
   * does not re-run a parent loader on a plain client-side navigation. So the
   * nav is hidden until a plan is chosen, and anything that still lands
   * elsewhere is sent back to the plan picker. Choosing Free is an action, which
   * revalidates this loader and lifts both.
   */
  useEffect(() => {
    if (!planChosen && !isPlanGateAllowed(pathname)) {
      navigate("/app/select-plan", { replace: true });
    }
  }, [planChosen, pathname, navigate]);

  const navItems = planChosen ? NAV_ITEMS : [];

  return (
    <AppProvider embedded apiKey={apiKey}>
      <AnalyticsIdentify shop={shop} />
      <WebVitals />
      <CrispChat shop={shop} />
      <ReviewPromptTest enabled={reviewDebug} />
      <NavigationLoading />
      <s-app-nav>
        {navItems.map((item) => {
          const active = isActivePath(pathname, item);
          const useChildHref = active && pathname !== item.href;
          const homeAttrs = item.home ? { rel: "home" as const } : {};
          const clickHandler = useChildHref
            ? (e: Event) => {
                e.preventDefault();
                e.stopPropagation();
                navigate(item.href);
              }
            : undefined;

          return (
            <s-link
              key={item.href}
              href={useChildHref ? pathname : item.href}
              onClick={clickHandler}
              {...homeAttrs}
            >
              {newNav.includes(item.href) ? `${item.label} ( New )` : item.label}
            </s-link>
          );
        })}
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
