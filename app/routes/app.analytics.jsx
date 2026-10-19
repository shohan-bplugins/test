import { useEffect, useRef } from "react";
import {
  Outlet,
  useLocation,
  useMatches,
  useNavigate,
  useRevalidator,
} from "@remix-run/react";
import { authenticate } from "../shopify.server";
import "../styles/styles.css";
import "../styles/analytics-web.css";
import { useSupport } from "../components/SupportForm/SupportProvider";
import { todayYmd } from "../lib/analytics-shared";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

const TABS = [
  {
    id: "standalone",
    label: "All Audio Players",
    path: "/app/analytics",
    icon: "chart-vertical",
    description: "Analytics across all audio players in your store",
  },
  {
    id: "product",
    label: "Product Audio",
    path: "/app/analytics/product",
    icon: "product",
    description: "Audios assigned to specific products",
    isNew: false,
  },
];

export default function AnalyticsV2Layout() {
  const openSupport = useSupport();
  const location = useLocation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const matches = useMatches();

  // The open tab's loader data (plan + range), for the tab cards.
  const tabData = matches.find(
    (m) => m.data && typeof m.data === "object" && "access" in m.data,
  )?.data;
  const isFreePlan = tabData ? !tabData.isPro : false;
  const isToday = tabData ? Boolean(tabData.isTodayRange) : true;

  // "Today" must be the merchant's date, so the server needs the browser's
  // timezone offset. On first load (no tzo yet) re-navigate once, adding it
  // and — when the range is missing — the browser's today.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has("tzo")) return;
    const tzo = new Date().getTimezoneOffset();
    params.set("tzo", String(tzo));
    if (
      params.get("filter") !== "all" &&
      (!params.get("since") || !params.get("until"))
    ) {
      const today = todayYmd(tzo);
      params.set("filter", "today");
      params.set("since", today);
      params.set("until", today);
    }
    navigate(`${location.pathname}?${params}`, { replace: true });
  }, [location.pathname, location.search, navigate]);

  // Show a confirmation once a user-triggered reload finishes refetching.
  const reloadRequested = useRef(false);
  useEffect(() => {
    if (revalidator.state === "idle" && reloadRequested.current) {
      reloadRequested.current = false;
      if (typeof shopify !== "undefined") {
        shopify.toast.show("Analytics updated");
      }
    }
  }, [revalidator.state]);

  const handleReload = () => {
    reloadRequested.current = true;
    revalidator.revalidate();
  };
  const activeTab = location.pathname.endsWith("/product")
    ? "product"
    : "standalone";
  const activeIndex = TABS.findIndex((t) => t.id === activeTab);
  const activeMeta = TABS[activeIndex];

  const reloading = revalidator.state === "loading";

  return (
    <s-page inlineSize="large">
      <ui-title-bar title="Analytics & Reports">
        <button onClick={() => openSupport()}>Support</button>
        <button variant="primary" onClick={() => navigate("/app/audios")}>
          Manage Players
        </button>
      </ui-title-bar>

      <s-stack gap="base">
        <s-stack
          direction="inline"
          justifyContent="space-between"
          alignItems="center"
          gap="base"
        >
          <s-stack gap="small-300">
            <s-heading>Analytics &amp; Reports</s-heading>
            <s-text color="subdued">
              {activeMeta?.description ||
                "Standalone vs. product-assigned audio engagement."}
            </s-text>
          </s-stack>
          <s-button
            icon="refresh"
            loading={reloading || undefined}
            onClick={handleReload}
          >
            Reload
          </s-button>
        </s-stack>

        {/* Tabs: All players / Product pages (switch by URL) */}
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 260px), 1fr))"
          gap="base"
        >
          {TABS.map((t) => {
            const isActive = activeTab === t.id;
            // Product analytics: free on Today only for Free plans.
            const isProduct = t.id === "product";
            const description =
              isProduct && isFreePlan
                ? `${t.description} · Free for Today`
                : t.description;
            const showPro = isProduct && isFreePlan && !isToday;
            return (
              <s-clickable
                key={t.id}
                padding="base"
                border={isActive ? "base strong" : "base"}
                borderRadius="base"
                background={isActive ? "subdued" : "base"}
                accessibilityLabel={t.label}
                onClick={() => navigate(t.path)}
              >
                <s-grid
                  gridTemplateColumns="auto minmax(0, 1fr) auto"
                  gap="small"
                  alignItems="center"
                >
                  <s-icon
                    type={t.icon}
                    tone={isActive ? "success" : "subdued"}
                  ></s-icon>
                  <s-stack gap="small-500">
                    <s-heading>{t.label}</s-heading>
                    <s-text color="subdued">{description}</s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="small-200">
                    {t.isNew ? <s-badge tone="caution">New</s-badge> : null}
                    {isActive ? <s-badge tone="success">Active</s-badge> : null}
                    {showPro ? <s-badge tone="caution">PRO</s-badge> : null}
                  </s-stack>
                </s-grid>
              </s-clickable>
            );
          })}
        </s-grid>

        {/* Dimmed while Reload re-fetches. The spinner floats over the
            content instead of being inserted above it, so nothing moves. */}
        <div className="an-outlet-wrap">
          <div
            key={activeTab}
            className={`an-outlet${reloading ? " is-reloading" : ""}`}
          >
            <Outlet />
          </div>
          {reloading ? (
            <div className="an-reload-spinner">
              <s-spinner
                size="large"
                accessibilityLabel="Loading analytics"
              ></s-spinner>
            </div>
          ) : null}
        </div>
      </s-stack>
    </s-page>
  );
}
