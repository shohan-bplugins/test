import { useEffect } from "react";
import { json } from "@remix-run/node";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createPlanSubscription, findPaidPlan } from "../lib/billing.server";
import { markPlanSelected, needsPlanSelection } from "../lib/plan-gate.server";
import "../styles/pricing.css";

// One-time plan selection shown right after install (and to existing Free
// shops that never picked a plan). Nothing else in the app is reachable until
// a plan is chosen; afterwards this page just sends the merchant home.

const isFreePlan = (plan) =>
  Number(plan?.price) === 0 || String(plan?.name).toLowerCase() === "free";

export const loader = async ({ request }) => {
  const { session, redirect } = await authenticate.admin(request);

  if (!(await needsPlanSelection(session.shop))) {
    throw redirect("/app");
  }

  let plans = [];
  try {
    plans = await prisma.plans.findMany({ orderBy: { price: "asc" } });
  } catch (error) {
    console.error("Select plan: couldn't load plans:", error);
  }

  return json({ plans });
};

export const action = async ({ request }) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const body = await request.formData();
  const intent = body.get("intent");

  if (intent === "free") {
    await markPlanSelected(session.shop);
    throw redirect("/app");
  }

  if (intent === "trial") {
    const plan = await findPaidPlan({ id: body.get("id") });
    if (!plan) return json({ error: "This plan isn't available right now." });
    try {
      const data = await createPlanSubscription(admin, session.shop, plan);
      const result = data?.data?.appSubscriptionCreate;
      if (data?.errors || result?.userErrors?.length || !result?.confirmationUrl) {
        console.error(
          "Select plan: subscription create failed:",
          data?.errors || result?.userErrors,
        );
        return json({ error: "Couldn't start the free trial. Please try again." });
      }
      // The gate clears once Shopify reports the subscription active.
      return json({ confirmationUrl: result.confirmationUrl });
    } catch (error) {
      console.error("Select plan: subscription create failed:", error);
      return json({ error: "Couldn't start the free trial. Please try again." });
    }
  }

  return json({ error: "Please choose a plan." }, { status: 400 });
};

export default function SelectPlan() {
  const { plans } = useLoaderData();
  const actionData = useActionData();
  const nav = useNavigation();
  const submit = useSubmit();

  const pendingIntent =
    nav.state !== "idle" ? nav.formData?.get("intent") : null;
  const pendingId = nav.state !== "idle" ? nav.formData?.get("id") : null;
  const busy = Boolean(pendingIntent);

  // White page background on this screen only; restored when leaving.
  useEffect(() => {
    const html = document.documentElement;
    const prev = [document.body.style.background, html.style.background];
    document.body.style.background = "#ffffff";
    html.style.background = "#ffffff";
    return () => {
      [document.body.style.background, html.style.background] = prev;
    };
  }, []);

  // Send the merchant to Shopify's charge approval page.
  useEffect(() => {
    if (actionData?.confirmationUrl) {
      window.open(actionData.confirmationUrl, "_top");
    }
    if (actionData?.error && typeof shopify !== "undefined") {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData]);

  const chooseFree = () =>
    submit({ intent: "free" }, { method: "POST", replace: true });
  const startTrial = (plan) =>
    submit({ intent: "trial", id: plan.id }, { method: "POST", replace: true });

  return (
    <s-page inlineSize="large">
      <ui-title-bar title="Choose your plan"></ui-title-bar>

      <s-stack gap="base">
        <s-stack gap="small-300">
          <s-heading>Choose your plan</s-heading>
          <s-text color="subdued">
            Pick a plan to start using Audio Player by bPlugins.
          </s-text>
        </s-stack>

        {!plans?.length ? (
          // Plans didn't load: never leave a new shop stuck.
          <s-section>
            <s-stack gap="base">
              <s-paragraph>
                We couldn&apos;t load the plans right now. You can start on the
                Free plan and upgrade later from Pricing.
              </s-paragraph>
              <s-button
                variant="primary"
                loading={pendingIntent === "free" || undefined}
                disabled={busy || undefined}
                onClick={chooseFree}
              >
                Continue with Free
              </s-button>
            </s-stack>
          </s-section>
        ) : (
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 260px), 1fr))"
            gap="base"
          >
            {plans.map((plan) => {
              const free = isFreePlan(plan);
              return (
                <s-box
                  key={plan.id}
                  padding="base"
                  borderRadius="base"
                  blockSize="100%"
                  border={plan.name === "Pro Plus" ? "base strong" : "base"}
                >
                  <s-stack
                    gap="base"
                    blockSize="100%"
                    justifyContent="space-between"
                  >
                    <s-stack gap="base">
                      <s-stack
                        direction="inline"
                        justifyContent="space-between"
                        alignItems="center"
                        gap="small"
                      >
                        <s-heading>{plan.name}</s-heading>
                        <s-stack direction="inline" gap="small-200">
                          {plan.name === "Pro Plus" ? (
                            <s-badge tone="caution" icon="star">
                              Most popular
                            </s-badge>
                          ) : null}
                          {free ? null : (
                            <s-badge tone="info">7-day free trial</s-badge>
                          )}
                        </s-stack>
                      </s-stack>

                      <s-stack
                        direction="inline"
                        gap="small-200"
                        alignItems="baseline"
                      >
                        <span className="pricing-amount select-plan-amount">${plan.price}</span>
                        <s-text color="subdued">/ month</s-text>
                      </s-stack>

                      <s-divider></s-divider>

                      <s-stack gap="small-200">
                        {(Array.isArray(plan.features) ? plan.features : []).map(
                          (feature, i) => (
                            <s-stack
                              key={i}
                              direction="inline"
                              gap="small-200"
                              alignItems="center"
                            >
                              <s-icon type="check" tone="success"></s-icon>
                              <s-text>{feature}</s-text>
                            </s-stack>
                          ),
                        )}
                      </s-stack>
                    </s-stack>

                    {free ? (
                      <s-button
                        inlineSize="fill"
                        loading={pendingIntent === "free" || undefined}
                        disabled={busy || undefined}
                        onClick={chooseFree}
                      >
                        Continue with Free
                      </s-button>
                    ) : (
                      <s-button
                        variant="primary"
                        inlineSize="fill"
                        loading={
                          (pendingIntent === "trial" && pendingId === plan.id) ||
                          undefined
                        }
                        disabled={busy || undefined}
                        onClick={() => startTrial(plan)}
                      >
                        Start free trial
                      </s-button>
                    )}
                  </s-stack>
                </s-box>
              );
            })}
          </s-grid>
        )}
      </s-stack>
    </s-page>
  );
}
