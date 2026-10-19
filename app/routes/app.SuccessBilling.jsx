import { useLoaderData, useNavigate, useNavigation } from "@remix-run/react";
import { CustomBox } from "../utils/polarisWebComponents";
import React, { useEffect, useState } from "react";
import { authenticate } from "../shopify.server";
import axios from "axios";
import { PrismaClient } from "@prisma/client";
import { syncSubscriptionState } from "../utils/planSync.server";
import "../styles/variables.css";

const prisma = new PrismaClient();

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  // Shopify charge ids are numeric; anything else would be spliced into the
  // REST path below.
  const rawChargeId = url.searchParams.get("charge_id");
  const charge_id = /^\d+$/.test(rawChargeId || "") ? rawChargeId : null;

  try {
    let appCharge;

    if (charge_id) {
      const response = await axios.get(
        `https://${session.shop}/admin/api/2026-07/recurring_application_charges/${charge_id}.json`,
        {
          headers: {
            "X-Shopify-Access-Token": session?.accessToken,
            "Content-Type": "application/json",
          },
        },
      );

      appCharge = await response?.data?.recurring_application_charge;
      // return { appCharge };
      const charge = await prisma.Charges.findMany({
        where: { chargeId: charge_id },
      });
      // return { charge, name: "Md Shohanur Rahman", charge_id };

      let createCharge = [];

      const user = await prisma.Users.findMany({
        where: { shop: session.shop },
      });

      if (!charge[0]) {
        createCharge = await prisma.Charges.create({
          data: {
            shop: session.shop,
            name: appCharge.name,
            price: appCharge.price,
            status: appCharge.status,
            cradit: 0,
            activated_on: appCharge?.created_at,
            trial_days: `${appCharge?.trial_days}`,
            cancelled_on: null,
            billing_on: appCharge?.created_at,
            planId: "",
            chargeId: charge_id,
          },
        });
        await prisma.Users.update({
          where: {
            id: user[0].id,
          },
          data: {
            chargeId: charge_id,
          },
        });
      }

      // Same helper the cancel paths use, so activation and cancellation write
      // the same columns. Replaces a hardcoded if/else on "Pro" / "Pro Plus"
      // that granted nothing at all for any other plan name, and that set
      // `cardits` without ever writing `planId` — so the user's plan and their
      // credits could disagree.
      await syncSubscriptionState({
        shop: session.shop,
        status: appCharge?.status,
        planName: appCharge?.name,
        chargeId: charge_id,
        occurredAt: appCharge?.updated_at,
      });
    }

    return { appCharge: appCharge, charge_id };
  } catch (error) {
    console.error("Error fetching Billing:", error);
    throw error;
  }
};
export const action = async ({ request }) => {
  // Authentication
  const { admin } = await authenticate.admin(request);

  return null;
};
const REDIRECT_SECONDS = 6;
const REDIRECT_TO = "/app/pricing";

const SuccessBilling = () => {
  const loaderData = useLoaderData();
  const navigate = useNavigate();
  const nav = useNavigation();

  const charge = loaderData?.appCharge;
  const planName = charge?.name;
  const planPrice = charge?.price;

  const [secondsLeft, setSecondsLeft] = useState(REDIRECT_SECONDS);
  const [autoRedirect, setAutoRedirect] = useState(true);

  // Countdown that auto-forwards to the Pricing page, the way most external
  // payment providers bounce you back after a successful charge.
  useEffect(() => {
    if (!autoRedirect) return undefined;
    if (secondsLeft <= 0) {
      navigate(REDIRECT_TO);
      return undefined;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft, autoRedirect, navigate]);

  const progress = ((REDIRECT_SECONDS - secondsLeft) / REDIRECT_SECONDS) * 100;

  if (nav.state === "loading") {
    return (
      <s-box class="sb-center">
        <s-spinner accessibilityLabel="Loading" size="large" />
      </s-box>
    );
  }

  return (
    <s-box class="sb-center">
      <s-box
        class="sb-card"
        border="base"
        borderRadius="base"
        padding="large-100"
      >
        {/* Animated success badge — bespoke motion, no Polaris equivalent. */}
        <s-box class="sb-badge">
          <s-text class="sb-ring" aria-hidden="true"  />
          <s-box class="sb-disc">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                className="sb-check"
                d="M5 12.5 10 17l9-10"
                stroke="#fff"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </s-box>
        </s-box>

        <s-stack direction="block" gap="small-300" alignItems="center">
          <s-heading class="sb-title">Upgrade Successful 🎉</s-heading>

          <s-text color="subdued">
            {planName
              ? `Your ${planName} plan is now active.`
              : "Your upgrade is now active."}
          </s-text>

          {planName && planPrice ? (
            <s-text color="subdued">
              {planName} · ${planPrice}/month
            </s-text>
          ) : null}

          <s-stack
            direction="inline"
            gap="small-300"
            justifyContent="center"
            alignItems="center"
          >
            <s-button variant="primary" onClick={() => navigate(REDIRECT_TO)}>
              Go to Pricing now
            </s-button>
            <s-button onClick={() => navigate("/app")}>
              Go to Dashboard
            </s-button>
          </s-stack>

          {autoRedirect ? (
            <>
              <s-text color="subdued">
                Redirecting to Pricing in{" "}
                <s-text type="strong">{secondsLeft}s</s-text>
              </s-text>
              {/* Plain divs: an inline style object is dropped on an s-*
                  element, and the fill width has to be inline. */}
              <s-box class="sb-track">
                <CustomBox className="sb-fill" style={{ width: `${progress}%` }} />
              </s-box>
              <s-button
                variant="tertiary"
                onClick={() => setAutoRedirect(false)}
              >
                Cancel auto-redirect
              </s-button>
            </>
          ) : (
            <s-text color="subdued">Auto-redirect cancelled.</s-text>
          )}
        </s-stack>
      </s-box>
    </s-box>
  );
};

export default SuccessBilling;
