import { useLoaderData, useNavigate, useNavigation } from "@remix-run/react";
import "../styles/variables.css";
import React, { useEffect, useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncPlanWithShopify } from "../lib/billing.server";
import { useSupport } from "../components/SupportForm/SupportProvider";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../components/PageState/PageState";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const charge_id = url.searchParams.get("charge_id");

  try {
    let appCharge;

    if (charge_id) {
      const subResponse = await admin.graphql(
        `#graphql
        query ActiveSubscriptions {
          currentAppInstallation {
            activeSubscriptions {
              id
              name
              status
              trialDays
              createdAt
              currentPeriodEnd
              test
              lineItems {
                plan {
                  pricingDetails {
                    ... on AppRecurringPricing {
                      price { amount currencyCode }
                      interval
                    }
                  }
                }
              }
            }
          }
        }`,
      );

      const subJson = await subResponse.json();
      const subscriptionGid = `gid://shopify/AppSubscription/${charge_id}`;
      const matched =
        subJson?.data?.currentAppInstallation?.activeSubscriptions?.find(
          (sub) => sub.id === subscriptionGid,
        );

      const price = matched?.lineItems?.[0]?.plan?.pricingDetails?.price;
      appCharge = matched
        ? {
            id: matched.id,
            name: matched.name,
            status: matched.status?.toLowerCase(),
            price: price?.amount,
            currency_code: price?.currencyCode,
            trial_days: matched.trialDays,
            created_at: matched.createdAt,
            updated_at: matched.currentPeriodEnd,
          }
        : null;

      const charge = await prisma.Charges.findMany({
        where: { chargeId: charge_id },
      });

      const user = await prisma.Users.findMany({
        where: { shop: session?.shop },
      });

      // Only record a subscription Shopify actually reports for this shop
      // (a declined or unknown charge_id has no match).
      if (!charge[0] && appCharge && user[0]) {
        await prisma.Charges.create({
          data: {
            shop: session?.shop,
            name: appCharge.name,
            price: appCharge.price,
            status: appCharge.status,
            cradit: 0,
            activated_on: appCharge?.created_at,
            trial_days: `${appCharge?.trial_days}`,
            cancelled_on: appCharge?.updated_at,
            billing_on: appCharge?.created_at,
            planId: "",
            chargeId: charge_id,
          },
        });
      }

      // Grant (or keep) the plan only if Shopify reports it ACTIVE. A declined
      // or abandoned approval leaves the shop on its current plan.
      await syncPlanWithShopify(admin, session?.shop);
    }

    return { appCharge, charge_id };
  } catch (error) {
    console.error("Error fetching Billing:", error);
    throw error;
  }
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

const REDIRECT_SECONDS = 10;

const SuccessBilling = () => {
  const openSupport = useSupport();
  const loaderData = useLoaderData();
  const navigate = useNavigate();
  const nav = useNavigation();
  const [countdown, setCountdown] = useState(REDIRECT_SECONDS);

  const planName = loaderData?.appCharge?.name || "Pro";
  const planPrice = loaderData?.appCharge?.price
    ? `$${parseFloat(loaderData.appCharge.price).toFixed(2)}/month`
    : null;
  const trialDays = loaderData?.appCharge?.trial_days;
  // Only an active subscription is a success; anything else gets its own state.
  const isActive = loaderData?.appCharge?.status === "active";

  useEffect(() => {
    if (nav.state === "loading" || !isActive) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate("/app/pricing");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [nav.state, isActive]);

  if (nav.state === "loading") {
    return <LoadingState label="Loading…" />;
  }

  if (!isActive) {
    return (
      <s-page inlineSize="large">
        <ui-title-bar title="Subscription">
          <button onClick={() => openSupport()}>Support</button>
          <button variant="breadcrumb" onClick={() => navigate("/app")}>
            Dashboard
          </button>
        </ui-title-bar>
        <s-section>
          {!loaderData?.charge_id ? (
            <EmptyState
              heading="Nothing to confirm"
              message="This page confirms a plan upgrade. Choose a plan on the Pricing page to start your free trial."
              action={
                <s-button
                  variant="primary"
                  onClick={() => navigate("/app/pricing")}
                >
                  View plans
                </s-button>
              }
            />
          ) : (
            <ErrorState
              heading="Your plan wasn't activated"
              message="The subscription wasn't approved, or Shopify is still processing it. If you approved it, wait a moment and try again. You haven't been charged."
              onRetry={() => window.location.reload()}
              onSupport={() =>
                openSupport(
                  `Plan not activated (charge ${loaderData.charge_id})`,
                )
              }
            />
          )}
        </s-section>
      </s-page>
    );
  }

  const features = [
    planName === "Pro Plus"
      ? "Unlimited audio players — no caps"
      : "Up to 10 audio players",
    "Single, Playlist, Sticky & Button player types",
    "Full color, skin & controls customization",
    "Loop & embed anywhere",
  ];

  return (
    <s-page inlineSize="large">
      <ui-title-bar title="Trial Started">
        <button onClick={() => openSupport()}>Support</button>
        <button variant="breadcrumb" onClick={() => navigate("/app")}>
          Dashboard
        </button>
      </ui-title-bar>

      <s-section>
        <s-stack gap="base">
          <s-banner tone="success" heading="Trial activated!">
            Your <s-text type="strong">{planName}</s-text> free trial is now
            live. No charge until the trial ends.
          </s-banner>

          <s-stack direction="inline">
            <s-badge tone="info" icon="star">
              {planName} · {trialDays || 7}-day free trial
            </s-badge>
          </s-stack>

          <s-stack gap="small-200">
            {features.map((feat) => (
              <s-stack
                key={feat}
                direction="inline"
                gap="small-200"
                alignItems="center"
              >
                <s-icon type="check" tone="success"></s-icon>
                <s-text>{feat}</s-text>
              </s-stack>
            ))}
          </s-stack>

          {trialDays > 0 ? (
            <s-banner tone="info">
              <s-text type="strong">Free trial — no payment today.</s-text>{" "}
              You&apos;ll be billed{planPrice ? ` ${planPrice}` : ""} only after
              your {trialDays}-day trial ends. Cancel any time before then.
            </s-banner>
          ) : null}

          <s-divider></s-divider>

          <s-stack
            direction="inline"
            justifyContent="space-between"
            alignItems="center"
            gap="base"
          >
            <s-text color="subdued">
              Redirecting to Pricing in {countdown}s…
            </s-text>
            <s-stack direction="inline" gap="small-200">
              <s-button
                variant="primary"
                icon="home"
                onClick={() => navigate("/app")}
              >
                Go to Dashboard
              </s-button>
              <s-button icon="sound" onClick={() => navigate("/app/audios")}>
                Add players
              </s-button>
            </s-stack>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
};

export default SuccessBilling;
