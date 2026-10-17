import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  fetchActiveSubscription,
  getOrCreateUser,
  getPlans,
  invalidateSubscription,
  rememberPlanChosen,
} from "~/lib/billing.server";

import { BackButton } from "~/components/BackButton";
import { SupportAction } from "~/components/SupportAction";
import { useRouteNav } from "~/components/polaris/helpers";

type LoaderData = {
  ok: boolean;
  chargeName: string | null;
  chargeStatus: string | null;
};

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const url = new URL(request.url);
  const chargeId = url.searchParams.get("charge_id");

  if (!chargeId) {
    return { ok: false, chargeName: null, chargeStatus: null };
  }

  /*
   * Everything this page needs, asked at once. It used to be seven round trips
   * in a row — user, subscription, plan, charge, plan-chosen flag, user — on
   * the page every paying merchant lands on straight after approving.
   */
  const [user, subscription, plans] = await Promise.all([
    getOrCreateUser(shop),
    fetchActiveSubscription(admin, chargeId),
    getPlans(),
  ]);

  if (!subscription) {
    return { ok: false, chargeName: null, chargeStatus: null };
  }

  const matchingPlan =
    plans.find(
      (p) => p.title === subscription.name || p.name === subscription.name,
    ) ?? null;

  const active = subscription.status === "active";
  await Promise.all([
    prisma.charge.upsert({
      where: { id: chargeId },
      update: {
        status: subscription.status,
        price: subscription.price,
        planId: matchingPlan?.id ?? null,
        modelLimit: matchingPlan?.modelLimit ?? null,
        productLimit: matchingPlan?.productLimit ?? null,
      },
      create: {
        id: chargeId,
        shop,
        chargeId,
        name: subscription.name,
        price: subscription.price,
        status: subscription.status,
        modelLimit: matchingPlan?.modelLimit ?? null,
        productLimit: matchingPlan?.productLimit ?? null,
        activatedOn: subscription.createdAt ?? null,
        trialDays: subscription.trialDays
          ? String(subscription.trialDays)
          : null,
        cancelledOn: subscription.cancelledOn ?? null,
        billingOn: subscription.createdAt ?? null,
        planId: matchingPlan?.id ?? null,
      },
    }),
    active
      ? prisma.appUser.update({
          where: { id: user.id },
          data: {
            chargeId,
            planId: matchingPlan?.id ?? user.planId,
            modelLimit: matchingPlan?.modelLimit ?? user.modelLimit,
            productLimit: matchingPlan?.productLimit ?? user.productLimit,
            // The plan gate's flag, in the same write (see hasChosenPlan).
            planSelectedAt: user.planSelectedAt ?? new Date(),
          },
        })
      : null,
  ]);
  if (active) rememberPlanChosen(shop);

  // This loader confirms the charge live (it passes a chargeId, so it never
  // reads the cache). Every other page does read it, and would otherwise show
  // the old plan for up to a minute after a successful upgrade.
  invalidateSubscription(shop);

  return {
    ok: true,
    chargeName: subscription.name,
    chargeStatus: subscription.status,
  };
};

export default function SuccessBilling() {
  const { ok, chargeName, chargeStatus } = useLoaderData<typeof loader>();
  const routeTo = useRouteNav();

  const activated = ok && chargeStatus === "active";
  const heading = activated
    ? "Subscription activated"
    : ok
      ? "Subscription updated"
      : "Subscription pending";

  return (
    <s-page heading={heading}>
      <BackButton to="/app" label="Dashboard" />
      <SupportAction />

      <s-section>
        <s-stack direction="block" gap="base">
          {/*
            The outcome is carried by a banner rather than a large centred
            success illustration: a charge that could not be confirmed is a real
            failure state, and the same layout has to be able to say so. Tone
            does that work here, so the two cases cannot drift apart visually.
          */}
          <s-banner
            tone={ok ? "success" : "warning"}
            heading={
              ok ? "Your plan is up to date" : "We couldn’t confirm the charge"
            }
          >
            {chargeName ? (
              <s-paragraph>
                {chargeName} plan · status: {chargeStatus}
              </s-paragraph>
            ) : null}
            {!ok ? (
              <s-paragraph>
                If you completed payment in Shopify, refresh the pricing page or
                contact support.
              </s-paragraph>
            ) : null}
          </s-banner>

          <s-stack direction="inline" gap="base">
            <s-button variant="primary" href="/app" onClick={routeTo("/app")}>
              Go to dashboard
            </s-button>
            <s-button href="/app/pricing" onClick={routeTo("/app/pricing")}>
              Back to pricing
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
