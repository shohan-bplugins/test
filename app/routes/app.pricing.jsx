import { json } from "@remix-run/node";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
  useNavigate,
  useRevalidator,
} from "@remix-run/react";
import Modal from "../components/PolarisWeb/WebModal";
import React, { useEffect, useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createPlanSubscription, findPaidPlan } from "../lib/billing.server";
import "../styles/variables.css";
import "../styles/styles.css";
import "../styles/pricing.css";
import { useSupport } from "../components/SupportForm/SupportProvider";
import { ErrorState } from "../components/PageState/PageState";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const user = await prisma.Users.findMany({
      where: { shop: session?.shop },
    });
    const charge = await prisma.Charges.findMany({
      where: { shop: session?.shop },
    });
    const allPlans = await prisma.plans.findMany({
      orderBy: {
        price: "asc",
      },
    });

    const shopResponse = await admin.graphql(
      `#graphql
      query ShopDetails {
        shop {
          id
          name
          email
          shopOwnerName
          myshopifyDomain
          primaryDomain { host }
          billingAddress {
            address1
            address2
            phone
            country
          }
          createdAt
          plan { displayName }
        }
      }`,
    );

    const shopJson = await shopResponse.json();
    const shopGql = shopJson?.data?.shop ?? {};
    const shopData = {
      shop: {
        shop_owner: shopGql.shopOwnerName,
        email: shopGql.email,
        country_name: shopGql.billingAddress?.country,
        address1: shopGql.billingAddress?.address1,
        address2: shopGql.billingAddress?.address2,
        phone: shopGql.billingAddress?.phone,
        created_at: shopGql.createdAt,
        domain: shopGql.primaryDomain?.host,
        myshopify_domain: shopGql.myshopifyDomain,
        plan_display_name: shopGql.plan?.displayName,
      },
    };

    const webhookCall = await prisma.webhookCall.findUnique({
      where: { shop: session?.shop },
    });

    if (!webhookCall?.called) {
      fetch(
        "https://integrations-api.swipeone.com/webhooks/apps/generic-webhooks/68f1d267d1a678d9726d5287",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify([
            {
              type: "app.visit_pricing_page",
              app_name: "audio-player",
              app_full_name: "Audio Player by bPlugins",
              app_slug: "html5-audio-player",
              success: true,
              shop: session?.shop,
              user_id: session?.id,
              data: {
                name: shopData?.shop?.shop_owner || "",
                email: shopData?.shop?.email || "",
                country_name: shopData?.shop?.country_name || "",
                address1: shopData?.shop?.address1 || "",
                address2: shopData?.shop?.address2 || "",
                phone: shopData?.shop?.phone || null,
                created_at: shopData?.shop?.created_at || "",
                domain: shopData?.shop?.domain || shop,
                myshopify_domain: shopData?.shop?.myshopify_domain || "",
                plan_display_name: shopData?.shop?.plan_display_name || "",
              },
              id: session?.id,
              created: new Date().toISOString().slice(0, 19).replace("T", " "),
              objects: {
                user: {
                  email: shopData?.shop?.email,
                },
              },
            },
          ]),
        },
      );

      await prisma.webhookCall.upsert({
        where: { shop: session?.shop },
        update: { called: true, calledAt: new Date() },
        create: {
          shop: session?.shop,
          called: true,
        },
      });
    }

    let subscription = [];

    if (user[0]?.chargeId) {
      try {
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
        const active =
          subJson?.data?.currentAppInstallation?.activeSubscriptions?.[0];

        if (active) {
          const price = active.lineItems?.[0]?.plan?.pricingDetails?.price;
          subscription = {
            recurring_application_charge: {
              id: active.id,
              name: active.name,
              status: active.status?.toLowerCase(),
              price: price?.amount,
              currency: price?.currencyCode,
              trial_days: active.trialDays,
              created_at: active.createdAt,
              billing_on: active.currentPeriodEnd,
              test: active.test,
            },
          };
        }
      } catch (error) {
        console.error(error);
      }
    }

    return {
      allPlans,
      user,
      plan: subscription,
      charge,
      apiKey: process.env.SHOPIFY_API_KEY || "",
    };
  } catch (error) {
    console.error("Error fetching plans:", error);
    throw error;
  }
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const body = await request.formData();
  try {
    const user = await prisma.Users.findMany({
      where: { shop: session?.shop },
    });
    const charge = await prisma.Charges.findMany({
      where: { shop: session?.shop },
    });

    if (user.length === 0) {
      return { error: "User not found" };
    }

    let response;

    if (request.method === "POST") {
      // Don't touch the stored plan here — the merchant hasn't approved the
      // charge yet. The plan is granted only once Shopify reports the
      // subscription ACTIVE (SuccessBilling, the subscriptions webhook, and the
      // app loader all sync it via syncPlanWithShopify).
      // Name, price and currency come from the stored plan, never the client.
      const plan = await findPaidPlan({
        id: body.get("id"),
        name: body.get("name"),
      });
      if (!plan) {
        return { error: "This plan isn't available right now." };
      }
      const data = await createPlanSubscription(admin, session.shop, plan);

      return { data, charges: charge, user: user };
    } else if (request.method === "PUT") {
      // Cancel existing subscription
      const appSubscriptionResponse = await admin.graphql(
        `#graphql
        mutation AppSubscriptionCancel($id: ID!) {
          appSubscriptionCancel(id: $id) {
            userErrors {
              field
              message
            }
            appSubscription {
              id
              status
            }
          }
        }`,
        {
          variables: {
            id: `gid://shopify/AppSubscription/${user[0]?.chargeId}`,
          },
        },
      );
      const appSubscription = await appSubscriptionResponse.json(); // Single json call

      await prisma.Charges.update({
        where: { id: charge[0]?.id },
        data: {
          status:
            appSubscription?.data?.appSubscriptionCancel?.appSubscription
              ?.status,
        },
      });
      await prisma.Users.update({
        where: { id: user[0]?.id },
        data: { cardits: 5, planId: "", chargeId: "" },
      });

      // Error Handling
      if (
        appSubscription?.errors ||
        (appSubscription?.data &&
          appSubscription?.data?.appSubscriptionCancel?.userErrors?.length > 0)
      ) {
        return {
          error: "Couldn't cancel the subscription. Please try again.",
          details: appSubscription.errors || appSubscription.data.userErrors,
        };
      }

      return { data: appSubscription };
    }

    const data = await response.json();
    if (
      data?.errors ||
      data?.data?.appSubscriptionCreate?.userErrors?.length > 0
    ) {
      console.error(
        "appSubscriptionCreate failed:",
        JSON.stringify(
          data?.errors || data.data.appSubscriptionCreate.userErrors,
        ),
      );
      return {
        error: "Couldn't start the upgrade. Please try again.",
      };
    }

    return { data, charges: charge, user: user };
  } catch (error) {
    // Shown as an error toast instead of replacing the page.
    console.error("Pricing action failed:", error);
    return json(
      { error: "Something went wrong and your plan wasn't changed." },
      { status: 500 },
    );
  }
  // Authentication
};

const SubscriptionBtn = (props) => {
  const openSupport = useSupport();
  const submit = useSubmit();
  const nav = useNavigation();
  const navigate = useNavigate();
  const actionData = useActionData();
  const loaderData = useLoaderData();
  // Confirmation before cancelling a paid plan (it applies immediately).
  const [confirmCancel, setConfirmCancel] = useState(false);

  const isLoading =
    (["loading", "submitting"].includes(nav.state) &&
      nav.formMethod === "POST") ||
    nav.formMethod === "PUT" ||
    nav.formMethod === "DELETE";

  const plan = loaderData.plan;
  const plans = loaderData.allPlans;

  // Send the merchant to Shopify's charge approval page. App Bridge turns a
  // "_top" window.open into a navigation of the whole admin window.
  useEffect(() => {
    const url = actionData?.data?.data?.appSubscriptionCreate?.confirmationUrl;
    if (url) window.open(url, "_top");
  }, [actionData]);

  // Result of an upgrade / cancel: say what happened.
  useEffect(() => {
    if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    } else if (actionData?.data?.data?.appSubscriptionCancel?.appSubscription) {
      shopify.toast.show("Subscription cancelled — you're on the Free plan");
    }
  }, [actionData]);

  const revalidator = useRevalidator();

  const startSub = (plan) => {
    return submit(plan, { replace: true, method: "POST" });
  };

  const cancelSubscription = () => {
    submit({ name: "Free" }, { replace: true, method: "PUT" });
  };

  const user = loaderData?.user?.[0];
  const charge = loaderData?.charge?.[0];

  const currentPlanStatus = plan?.recurring_application_charge?.status;
  const currentPlanName = plan?.recurring_application_charge?.name;

  // Determine if the user is on a free plan
  const isOnFreePlan =
    !plan?.recurring_application_charge || currentPlanStatus !== "active";

  // Get the current plan display name
  const currentPlanDisplayName = isOnFreePlan ? "Free" : currentPlanName;

  // Check if a plan is the active one
  const isPlanActive = (planItem) => {
    if (isOnFreePlan && planItem?.name === "Free") return true;
    if (currentPlanStatus === "active" && planItem?.name === currentPlanName)
      return true;
    return false;
  };

  return (
    <s-page inlineSize="large">
      <ui-title-bar title="Pricing">
        <button onClick={() => openSupport()}>Support</button>
        <button variant="breadcrumb" onClick={() => navigate("/app")}>
          Dashboard
        </button>
      </ui-title-bar>

      <s-stack gap="base">
        <s-stack gap="small-300">
          <s-heading>Pricing</s-heading>
          <s-text color="subdued">
            Choose the right plan for Audio Player by bPlugins
          </s-text>
        </s-stack>

        {/* Current plan */}
        <s-section>
          <s-stack
            direction="inline"
            justifyContent="space-between"
            alignItems="center"
            gap="base"
          >
            <s-stack gap="small-300">
              <s-heading>
                Your current plan — {currentPlanDisplayName}
              </s-heading>
              <s-paragraph color="subdued">
                You&apos;re currently on the {currentPlanDisplayName} plan.{" "}
                {isOnFreePlan
                  ? "Upgrade to unlock powerful audio features."
                  : "Manage your audio player subscription below."}
              </s-paragraph>
            </s-stack>
            <s-button
              tone="critical"
              icon="x"
              loading={(isLoading && nav.formMethod === "PUT") || undefined}
              disabled={
                !charge ||
                currentPlanStatus === "cancelled" ||
                isOnFreePlan ||
                undefined
              }
              onClick={() => setConfirmCancel(true)}
            >
              Cancel subscription
            </s-button>
          </s-stack>
        </s-section>

        {/* Plan cards */}
        {!plans?.length ? (
          <s-section>
            <ErrorState
              heading="Plans couldn't load"
              message="We couldn't load the available plans. Your current plan isn't affected."
              onRetry={() => revalidator.revalidate()}
              retrying={revalidator.state === "loading"}
              onSupport={() => openSupport("Pricing plans not loading")}
            />
          </s-section>
        ) : (
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 260px), 1fr))"
            gap="base"
          >
            {plans?.map((plan_item, index) => {
              const active = isPlanActive(plan_item);
              const isFree = plan_item?.price === 0 || plan_item?.price === "0";
              const showTrialBadge = !isFree && !active;
              // Lower (or equal-priced) plans than the active paid one get no
              // button — downgrades go through Cancel subscription.
              const hideCta =
                !active &&
                currentPlanStatus === "active" &&
                Number(plan?.recurring_application_charge?.price) >=
                  Number(plan_item?.price);

              return (
                <s-box
                  key={plan_item?.id || index}
                  padding="base"
                  borderRadius="base"
                  blockSize="100%"
                  border={active ? "base strong" : "base"}
                  background={active ? "subdued" : "base"}
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
                        <s-heading>{plan_item?.name}</s-heading>
                        <s-stack direction="inline" gap="small-200">
                          {plan_item?.name === "Pro Plus" ? (
                            <s-badge tone="caution" icon="star">
                              Most popular
                            </s-badge>
                          ) : null}
                          {active ? (
                            <s-badge tone="success" icon="check-circle">
                              Active
                            </s-badge>
                          ) : showTrialBadge ? (
                            <s-badge tone="info">7-day free trial</s-badge>
                          ) : null}
                        </s-stack>
                      </s-stack>

                      <s-stack
                        direction="inline"
                        gap="small-200"
                        alignItems="baseline"
                      >
                        {/* No display-size text in Polaris web components. */}
                        <span className="pricing-amount">
                          ${plan_item?.price}
                        </span>
                        <s-text color="subdued">/ month</s-text>
                      </s-stack>

                      <s-divider></s-divider>

                      <s-stack gap="small-200">
                        {plan_item?.features?.map((feature, fIdx) => (
                          <s-stack
                            key={fIdx}
                            direction="inline"
                            gap="small-200"
                            alignItems="center"
                          >
                            <s-icon type="check" tone="success"></s-icon>
                            <s-text>{feature}</s-text>
                          </s-stack>
                        ))}
                      </s-stack>
                    </s-stack>

                    {active ? (
                      <s-button disabled>Current plan</s-button>
                    ) : hideCta || isFree ? null : (
                      <s-button
                        variant="primary"
                        loading={
                          (isLoading && nav.formMethod === "POST") || undefined
                        }
                        disabled={isLoading || undefined}
                        onClick={() => startSub(plan_item)}
                      >
                        Upgrade
                      </s-button>
                    )}
                  </s-stack>
                </s-box>
              );
            })}
          </s-grid>
        )}
      </s-stack>

      {confirmCancel ? (
        <Modal
          open
          onClose={() => setConfirmCancel(false)}
          title="Cancel your subscription?"
          primaryAction={{
            content: "Cancel subscription",
            destructive: true,
            loading: isLoading,
            onAction: () => {
              cancelSubscription();
              setConfirmCancel(false);
            },
          }}
          secondaryActions={[
            { content: "Keep plan", onAction: () => setConfirmCancel(false) },
          ]}
        >
          <Modal.Section>
            <s-paragraph>
              Your <s-text type="strong">{currentPlanDisplayName}</s-text> plan
              ends right away and your player limit goes back to 5. Features
              that need a paid plan will stop working.
            </s-paragraph>
          </Modal.Section>
        </Modal>
      ) : null}
    </s-page>
  );
};

export default SubscriptionBtn;
