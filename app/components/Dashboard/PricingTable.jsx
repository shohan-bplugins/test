import React, { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import Modal from "../PolarisWeb/WebModal";

const Check = () => <s-icon type="check" tone="success"></s-icon>;
const Cross = () => <s-icon type="x" tone="critical"></s-icon>;

const PLAN_ORDER = ["Free", "Pro", "Pro Plus"];

const PLANS = [
  { name: "Free", price: "Free", key: "free" },
  { name: "Pro", price: "$4.99", key: "pro" },
  { name: "Pro Plus", price: "$9.99", key: "proPlus", popular: true },
];

const FEATURES = [
  {
    label: "Audio Players",
    badge: "Core",
    free: <s-badge>5 Players</s-badge>,
    pro: <s-badge>50 Players</s-badge>,
    proPlus: <s-badge>Unlimited</s-badge>,
  },
  {
    label: "Single Audio Player",
    badge: "Core",
    free: <Check />,
    pro: <Check />,
    proPlus: <Check />,
  },
  {
    label: "Playlist Audio Player",
    badge: null,
    free: <Check />,
    pro: <Check />,
    proPlus: <Check />,
  },
  {
    label: "Sticky Audio Player",
    badge: null,
    free: <Check />,
    pro: <Check />,
    proPlus: <Check />,
  },
  {
    label: "Single Button Player",
    badge: null,
    free: <Check />,
    pro: <Check />,
    proPlus: <Check />,
  },
  {
    label: "MP3, WAV, OGG & More Formats",
    badge: "Core",
    free: <Check />,
    pro: <Check />,
    proPlus: <Check />,
  },
  {
    label: "Basic Customization",
    badge: "Core",
    free: <Check />,
    pro: <Check />,
    proPlus: <Check />,
  },
  {
    label: "Standard Support",
    badge: "Core",
    free: <Check />,
    pro: <Check />,
    proPlus: <Check />,
  },
  {
    label: "Custom Player Skins & Themes",
    badge: null,
    free: <Check />,
    pro: <Check />,
    proPlus: <Check />,
  },
  {
    label: "Loop / Shuffle",
    badge: null,
    free: <Cross />,
    pro: <Check />,
    proPlus: <Check />,
  },
  {
    label: "Advanced Customization",
    badge: null,
    free: <Cross />,
    pro: <Check />,
    proPlus: <Check />,
  },
  {
    label: "Priority Support",
    badge: null,
    free: <Cross />,
    pro: <Check />,
    proPlus: <Check />,
  },
  {
    label: "Analytics & Reporting",
    badge: null,
    free: <Cross />,
    pro: <Check />,
    proPlus: <Check />,
  },
];

const PricingTable = ({ currentPlanId, isLoading, plans = [] }) => {
  // Plan changes reuse the /app/pricing action: POST creates a subscription
  // (Shopify approval page), PUT cancels the subscription back to Free.
  const billing = useFetcher();
  const [pendingPlan, setPendingPlan] = useState(null);
  const [confirmPlan, setConfirmPlan] = useState(null);
  const currentIdx = PLAN_ORDER.indexOf(currentPlanId);
  const isBusy = billing.state !== "idle";

  useEffect(() => {
    if (billing.state !== "idle" || !billing.data) return;
    const confirmationUrl =
      billing.data?.data?.data?.appSubscriptionCreate?.confirmationUrl;
    const userErrors =
      billing.data?.data?.data?.appSubscriptionCreate?.userErrors;
    if (confirmationUrl) {
      // Shopify's billing approval page must open in the top frame.
      window.open(confirmationUrl, "_top");
    } else if (billing.data?.error || userErrors?.length) {
      shopify.toast.show("Couldn't change your plan. Please try again.", {
        isError: true,
      });
      setPendingPlan(null);
    } else if (pendingPlan === "Free") {
      shopify.toast.show("Your plan was changed to Free.");
      setPendingPlan(null);
    }
  }, [billing.state, billing.data]);

  const changePlan = (planName) => {
    setConfirmPlan(null);
    setPendingPlan(planName);
    if (planName === "Free") {
      billing.submit(
        { name: "Free" },
        { method: "PUT", action: "/app/pricing" },
      );
      return;
    }
    const plan = plans.find((p) => p?.name === planName);
    if (!plan) {
      shopify.toast.show("This plan isn't available right now.", {
        isError: true,
      });
      setPendingPlan(null);
      return;
    }
    billing.submit(
      {
        id: plan.id,
        name: plan.name,
        price: plan.price,
        currencyCode: plan.currencyCode,
      },
      { method: "POST", action: "/app/pricing" },
    );
  };

  const renderPlanAction = (planName) => {
    if (planName === currentPlanId) {
      return <s-button disabled>Current Plan</s-button>;
    }
    const planIdx = PLAN_ORDER.indexOf(planName);
    const isDowngrade = currentIdx > planIdx;
    // Unknown current plan: never offer "downgrade" to Free.
    if (currentIdx === -1 && planName === "Free") return null;
    // Custom elements get `loading="false"` for false, so drop it instead.
    const loading =
      (isBusy && pendingPlan === planName) ||
      (isLoading && !isDowngrade) ||
      undefined;
    return (
      <s-button
        variant={isDowngrade ? undefined : "primary"}
        icon={isDowngrade ? "arrow-down" : "arrow-up"}
        loading={loading}
        disabled={(isBusy && pendingPlan !== planName) || undefined}
        onClick={() =>
          isDowngrade ? setConfirmPlan(planName) : changePlan(planName)
        }
      >
        {isDowngrade ? "Downgrade" : "Upgrade"}
      </s-button>
    );
  };

  return (
    <s-section padding="none">
      <s-table>
        <s-table-header-row>
          <s-table-header listSlot="primary">
            <s-stack gap="small-300">
              <s-heading>Features</s-heading>
              <s-text color="subdued">Compare plan details</s-text>
            </s-stack>
          </s-table-header>
          {PLANS.map((plan) => (
            <s-table-header key={plan.key}>
              <s-stack gap="small-300">
                <s-heading>{plan.name}</s-heading>
                <s-text color="subdued">{plan.price} / month</s-text>
                {plan.popular ? (
                  <s-badge tone="info" icon="star">
                    Most Popular
                  </s-badge>
                ) : null}
              </s-stack>
            </s-table-header>
          ))}
        </s-table-header-row>

        <s-table-body>
          {FEATURES.map((feature) => (
            <s-table-row key={feature.label}>
              <s-table-cell>
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-text>{feature.label}</s-text>
                  {feature.badge ? <s-badge>{feature.badge}</s-badge> : null}
                </s-stack>
              </s-table-cell>
              {PLANS.map((plan) => (
                <s-table-cell key={plan.key}>{feature[plan.key]}</s-table-cell>
              ))}
            </s-table-row>
          ))}

          <s-table-row>
            <s-table-cell></s-table-cell>
            {PLANS.map((plan) => (
              <s-table-cell key={plan.key}>
                {renderPlanAction(plan.name)}
              </s-table-cell>
            ))}
          </s-table-row>
        </s-table-body>
      </s-table>

      {confirmPlan ? (
        <Modal
          open
          onClose={() => setConfirmPlan(null)}
          title={`Downgrade to ${confirmPlan}?`}
          primaryAction={{
            content: `Downgrade to ${confirmPlan}`,
            destructive: true,
            onAction: () => changePlan(confirmPlan),
          }}
          secondaryActions={[
            {
              content: "Keep current plan",
              onAction: () => setConfirmPlan(null),
            },
          ]}
        >
          <Modal.Section>
            <s-paragraph>
              {confirmPlan === "Free"
                ? "Your subscription will be cancelled right away and your player limit goes back to 5. Features that need a paid plan will stop working."
                : `You'll be taken to Shopify to approve the ${confirmPlan} plan. It replaces your current plan once approved, and features only in ${currentPlanId} will stop working.`}
            </s-paragraph>
          </Modal.Section>
        </Modal>
      ) : null}
    </s-section>
  );
};

export default PricingTable;
