import { useEffect, useState, type CSSProperties } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { framedRedirect } from "~/lib/framed-redirect.server";
import { hasChosenPlan, parseFeatures, getPlans } from "~/lib/billing.server";
import {
  formatLimit,
  formatMoney,
  GROWTH_PLAN_NAME,
} from "~/lib/billing-constants";
import { launchOfferActive, launchOfferPrice } from "~/lib/launch-offer";
import { BUTTON_FILL, flag } from "~/components/polaris/helpers";

/*
 * The first screen after install: pick a plan, nothing else.
 *
 * routes/app.tsx sends every admin page here until a plan is chosen. It is a
 * stripped-down plan list rather than the full /app/pricing page — no usage,
 * no cancel, no coupon — because a brand new merchant has nothing to compare
 * against yet. The choice itself still posts to /app/pricing's action, so the
 * charge (trial, launch discount, test mode, return URL) has a single owner.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";

  // Together, not in series: the plan list is in memory, and the check is
  // shared with the layout's identical one on this same request.
  const [chosen, plans] = await Promise.all([
    hasChosenPlan(admin, shop),
    getPlans(),
  ]);

  // Already chosen — this page has nothing to offer; the full pricing page
  // handles changes from here on.
  if (chosen) {
    const url = new URL(request.url);
    throw framedRedirect(request, url.search ? `/app${url.search}` : "/app");
  }

  return {
    offerActive: launchOfferActive(),
    // Stored as a string, so sorted numerically here rather than by the DB.
    plans: [...plans]
      .sort((a, b) => Number(a.price) - Number(b.price))
      .map((p) => ({
        id: p.id,
        name: p.name,
        title: p.title,
        description: p.description,
        price: p.price,
        trialDays: Number(p.trialDays ?? 0),
        modelLimit: p.modelLimit,
        productLimit: p.productLimit,
        features: parseFeatures(p.features),
      })),
  };
};

type ActionResult = {
  ok: boolean;
  error?: string;
  confirmationUrl?: string;
};

export default function SelectPlan() {
  const { plans, offerActive } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    const data = fetcher.data;
    if (!data) return;
    if (data.ok && data.confirmationUrl) {
      // Shopify's approval page has to own the whole window, not the iframe.
      try {
        window.top!.location.href = data.confirmationUrl;
      } catch {
        window.location.href = data.confirmationUrl;
      }
    } else if (!data.ok && data.error) {
      shopify.toast.show(data.error, { isError: true });
      setPendingId(null);
    }
  }, [fetcher.data, shopify]);

  function choose(plan: (typeof plans)[number]) {
    setPendingId(plan.id);
    const fd = new FormData();
    if (Number(plan.price) > 0) {
      fd.set("intent", "subscribe");
      fd.set("planId", plan.id);
      fd.set("interval", "monthly");
    } else {
      fd.set("intent", "choose_free");
    }
    fetcher.submit(fd, { method: "post", action: "/app/pricing" });
  }

  return (
    <s-page heading="Select a plan">
      <s-section>
        <s-stack direction="block" gap="small-200">
          <s-heading>Welcome! Choose a plan to get started</s-heading>
          <s-paragraph>
            Every plan includes the full 3D viewer. Plans differ only in how
            many products and models you can use, and you can change your plan
            any time from Pricing.
          </s-paragraph>
        </s-stack>
      </s-section>

      <div
        className="plan-grid"
        style={{ "--plan-count": plans.length } as CSSProperties}
      >
        {plans.map((plan) => {
          const price = Number(plan.price);
          const isPaid = price > 0;
          const isPopular = plan.name === GROWTH_PLAN_NAME;
          const payPrice =
            isPaid && offerActive ? launchOfferPrice(price) : price;
          const features =
            plan.features.length > 0
              ? plan.features
              : [
                  `${formatLimit(plan.productLimit)} products`,
                  `${formatLimit(plan.modelLimit)} 3D models`,
                ];

          return (
            /*
              The wrapper fills its grid cell (rows share one height, see
              .plan-grid), and the card fills the wrapper — so every card is
              the height of the tallest, and the button, pushed down by
              `marginTop: auto`, sits on the same line across the row however
              many features each plan lists.
            */
            <div key={plan.id} style={{ blockSize: "100%" }}>
              <s-box
                blockSize="100%"
                padding="base"
                borderWidth="base"
                borderStyle="solid"
                borderColor={isPopular ? "strong" : "base"}
                borderRadius="large"
                background={isPopular ? "subdued" : "base"}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                    blockSize: "100%",
                  }}
                >
                  <s-stack direction="block" gap="small-300">
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-heading>{plan.title}</s-heading>
                      {isPopular ? (
                        <s-badge tone="info">Recommended</s-badge>
                      ) : null}
                    </s-stack>
                    <s-stack
                      direction="inline"
                      gap="small-500"
                      alignItems="baseline"
                    >
                      {payPrice < price ? (
                        <s-text type="redundant" color="subdued">
                          {`$${formatMoney(price)}`}
                        </s-text>
                      ) : null}
                      <span style={{ fontSize: "1.5rem", fontWeight: 600 }}>
                        {isPaid ? `$${formatMoney(payPrice)}` : "Free"}
                      </span>
                      {isPaid ? <s-text color="subdued">/ month</s-text> : null}
                    </s-stack>
                    {plan.description ? (
                      <s-text color="subdued">{plan.description}</s-text>
                    ) : null}
                  </s-stack>

                  <s-unordered-list>
                    {features.map((f) => (
                      <s-list-item key={f}>{f}</s-list-item>
                    ))}
                  </s-unordered-list>

                  <div style={{ marginTop: "auto" }}>
                    <s-button
                      {...BUTTON_FILL}
                      variant={isPopular ? "primary" : "secondary"}
                      loading={flag(busy && pendingId === plan.id)}
                      disabled={flag(busy && pendingId !== plan.id)}
                      onClick={() => choose(plan)}
                    >
                      {isPaid
                        ? plan.trialDays > 0
                          ? `Start ${plan.trialDays}-day free trial`
                          : `Choose ${plan.title}`
                        : "Start with Free"}
                    </s-button>
                  </div>
                </div>
              </s-box>
            </div>
          );
        })}
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
