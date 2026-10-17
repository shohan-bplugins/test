import {
  useActionData,
  useLoaderData,
  useNavigation,
  useNavigate,
  useSubmit,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Divider,
  Icon,
  Banner,
} from "@shopify/polaris";
import { ArrowLeftIcon, CheckIcon } from "@shopify/polaris-icons";
import React, { useEffect, useState } from "react";
import "../components/PageHeader/PageHeader.css";
import { useGoBack } from "../utils/useGoBack";
import { flag } from "../utils/polarisWebComponents";
import { authenticate } from "../shopify.server";
import axios from "axios";
import prisma from "../db.server";
import {
  chooseFreePlan,
  syncSubscriptionState,
  verifyShopPlan,
} from "../utils/planSync.server";
import { resolvePlan } from "../utils/planLimits";
import "../styles/variables.css";
import "../styles/styles.css";
import "../styles/pricing.css";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  // Confirm the stored plan against Shopify billing before anything reads it.
  await verifyShopPlan(admin, session.shop);
  try {
    const user = await prisma.Users.findMany({
      where: { shop: session.shop },
    });
    const charge = await prisma.Charges.findMany({
      where: { shop: session.shop },
    });
    const allPlans = await prisma.plans.findMany({
      orderBy: {
        price: "asc",
      },
    });

    const accessToken = session.accessToken;

    const responseShop = await fetch(
      `https://${session.shop}/admin/api/2026-07/shop.json`,
      {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      },
    );

    // Non-critical: this only feeds the SwipeOne analytics ping below. Under
    // expiring offline tokens a 401 here must not take down the pricing page.
    let shopData = null;
    if (responseShop.ok) {
      shopData = await responseShop.json();
    } else {
      console.error(
        "Non-critical shop.json error:",
        responseShop.status,
        await responseShop.text(),
      );
    }

    const webhookCall = await prisma.webhookCall.findUnique({
      where: { shop: session.shop },
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
              app_name: "video-player",
              app_full_name: "Video Player by bPlugins",
              app_slug: "video-player-by-bplugins",
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
                domain: shopData?.shop?.domain || session.shop,
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
        where: { shop: session.shop },
        update: { called: true, calledAt: new Date() },
        create: {
          shop: session.shop,
          called: true,
        },
      });
    }

    let subscription = [];

    if (user[0]?.chargeId) {
      try {
        const response = await axios.get(
          `https://${session.shop}/admin/api/2026-07/recurring_application_charges/${user[0]?.chargeId}.json`,
          {
            headers: {
              "X-Shopify-Access-Token": session.accessToken,
              "Content-Type": "application/json",
            },
          },
        );
        subscription = response.data;
      } catch (error) {
        console.error(error);
      }
    }

    return { allPlans, user, plan: subscription, charge };
  } catch (error) {
    console.error("Error fetching plans:", error);
    throw error;
  }
};

export const action = async ({ request }) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const body = await request.formData();
  try {
    const user = await prisma.Users.findMany({
      where: { shop: session.shop },
    });
    const charge = await prisma.Charges.findMany({
      where: { shop: session.shop },
    });

    if (user.length === 0) {
      return { error: "User not found" };
    }

    // Update user planId

    let response;

    // First-run gate: choosing Free is recorded straight away (no charge).
    if (request.method === "POST" && body.get("intent") === "choose-free") {
      const result = await chooseFreePlan(admin, session.shop);
      if (!result.ok) return { error: result.error };
      return redirect("/app");
    }

    if (request.method === "POST") {
      // Only the plan id is taken from the form. Name, price, currency and
      // trial come from the Plans catalogue, so an edited form can't buy a
      // plan at a made-up price.
      const planId = String(body.get("id") || "");
      const plan = /^[a-f0-9]{24}$/i.test(planId)
        ? await prisma.Plans.findUnique({ where: { id: planId } })
        : null;
      if (!plan) {
        return { error: "Plan not found" };
      }

      // planId is NOT written here. Recording the plan before the merchant
      // approves the charge let an abandoned checkout count as a paid plan;
      // it is written once Shopify reports the charge ACTIVE (SuccessBilling,
      // the subscriptions webhook, or verifyShopPlan on the next app open).

      // Create new subscription
      response = await admin.graphql(
        `#graphql
        mutation AppSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $trialDays: Int, $test: Boolean) {
          appSubscriptionCreate(name: $name, returnUrl: $returnUrl, lineItems: $lineItems, trialDays: $trialDays, test: $test) {
            userErrors {
              field
              message
            }
            appSubscription {
              id
            }
            confirmationUrl
          }
        }`,
        {
          variables: {
            name: plan.name,
            returnUrl: `https://admin.shopify.com/store/${session.shop.split(".")[0]}/apps/video-player-by-bplugins/app/SuccessBilling`,
            lineItems: [
              {
                plan: {
                  appRecurringPricingDetails: {
                    price: {
                      amount: Number(plan.price),
                      currencyCode: plan.currencyCode,
                    },
                    interval: "EVERY_30_DAYS",
                  },
                },
              },
            ],
            trialDays: Number(plan.trial_days) || 0,
            test: true, // Set this to false in production
          },
        },
      );

      const data = await response.json();

      // The charge confirmation page lives on admin.shopify.com, which sends
      // X-Frame-Options: deny — loading it inside the app's iframe fails with
      // "Refused to display 'https://admin.shopify.com/' in a frame". It has to
      // be a TOP-level navigation, and `redirect(..., { target: "_top" })` is
      // the only reliable way to get one: it answers this POST with the
      // App Bridge reauthorize-url header, and App Bridge — which sits outside
      // the iframe — performs the navigation. Doing it client-side instead
      // (`window.top.location = confirmationUrl`) is what used to run here, and
      // a cross-origin top navigation issued after an async round trip has no
      // user activation left to spend, so the browser refuses it.
      const confirmationUrl =
        data?.data?.appSubscriptionCreate?.confirmationUrl;

      if (confirmationUrl) {
        return redirect(confirmationUrl, { target: "_top" });
      }

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

      // Error Handling — checked BEFORE the local rows are touched. This used
      // to run last, so a cancel that Shopify rejected still downgraded the
      // shop's credits locally and left it paying for a plan the app no longer
      // granted.
      if (
        appSubscription?.errors ||
        (appSubscription?.data &&
          appSubscription?.data?.appSubscriptionCancel?.userErrors?.length > 0)
      ) {
        return {
          error: "Operation failed",
          details: appSubscription.errors || appSubscription.data.userErrors,
        };
      }

      // Same helper the app_subscriptions/update webhook uses, so an in-app
      // cancel and one made from the Shopify admin leave identical rows. It
      // clears planId and chargeId as well as cardits — the code here used to
      // write only cardits, leaving planId on the paid plan and chargeId
      // pointing at a cancelled charge that every loader kept re-fetching.
      const cancelled =
        appSubscription?.data?.appSubscriptionCancel?.appSubscription;

      await syncSubscriptionState({
        shop: session.shop,
        status: cancelled?.status || "CANCELLED",
        chargeId: cancelled?.id || user[0]?.chargeId,
      });

      return { data: appSubscription };
    }

    const data = await response.json();

    return { data, charges: charge, user: user };
  } catch (error) {
    console.error("Error fetching:", error);
    throw error;
  }
  // Authentication
};

const SubscriptionBtn = () => {
  const submit = useSubmit();
  const nav = useNavigation();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const [loading, setLoading] = useState(false);

  const isLoading =
    (["loading", "submitting"].includes(nav.state) &&
      nav.formMethod === "POST") ||
    nav.formMethod === "PUT" ||
    nav.formMethod === "DELETE";

  const plan = loaderData.plan;
  const plans = loaderData.allPlans;
  const pageLoading = nav.state == "loading";

  const startSub = (plan) => {
    return submit(plan, { replace: true, method: "POST" });
  };

  const cancelSubscription = () => {
    if (canCancel) {
      submit(
        { name: "Md Shohanur Rahman" },
        { replace: true, method: "PUT" }, // optional: verify how encoding is being handled
      );
    }
  };

  // Current-plan summary shown in the banner. Resolved the same way as every
  // other page: the live Shopify subscription wins, then the stored plan, then
  // stored credits, then Free. This used to read the subscription alone, so a
  // failed REST lookup showed a paying merchant as Free here while the
  // dashboard still showed their real plan.
  const charge = plan?.recurring_application_charge;
  const currentPlan = resolvePlan({
    plans: plans || [],
    user: loaderData?.user?.[0],
    subscription: charge,
  });
  const isActivePaid = currentPlan.isPaid;
  // Cancelling needs a live charge to cancel. `isActivePaid` can be true from
  // stored credits alone (e.g. the REST lookup failed), which is right for the
  // plan label but must not enable a cancel that has nothing to act on.
  const canCancel = charge?.status === "active" && Number(charge?.price) > 0;
  // No plan chosen yet (first run): nothing is "current", Free gets a button,
  // and there is nowhere to go back to.
  const planChosen = Boolean(loaderData?.user?.[0]?.planId);
  const chooseFree = () =>
    submit({ intent: "choose-free" }, { replace: true, method: "POST" });
  const currentPlanName = currentPlan.title;
  const currentPlanNote = currentPlan.isPaid
    ? `${currentPlan.limitLabel} unlocked.`
    : "Upgrade to unlock powerful features.";

  console.log({ canCancel });

  return (
    <Page>
      <ui-title-bar title="Pricing" />

      <Layout>
        <Layout.Section>
          <Card padding="400">
            <InlineStack align="space-between" blockAlign="center" wrap={false}>
              <InlineStack gap="400" blockAlign="center">
                {planChosen && (
                  <Button
                    icon={ArrowLeftIcon}
                    onClick={goBack}
                    accessibilityLabel="Go back"
                    disabled={pageLoading}
                    variant="tertiary"
                  />
                )}

                {planChosen ? (
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">
                      Your current plan
                    </Text>
                    <InlineStack gap="200" blockAlign="center">
                      <Text variant="bodyMd" fontWeight="bold">
                        {currentPlanName}
                      </Text>
                      <Text variant="bodySm" tone="subdued">
                        {currentPlanNote}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                ) : (
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">
                      Choose a plan to get started
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      Pick the plan that fits your store. You can change it any
                      time.
                    </Text>
                  </BlockStack>
                )}
              </InlineStack>

              {planChosen && (
                <Button
                  tone="critical"
                  disabled={flag(!canCancel || isLoading)}
                  loading={flag(isLoading)}
                  onClick={() => cancelSubscription()}
                >
                  Cancel Subscription
                </Button>
              )}
            </InlineStack>
          </Card>
        </Layout.Section>

        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical">{actionData.error}</Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <div className="vp-pricing-grid">
            {plans?.map((plan_item, index) => {
              const isActive =
                planChosen && plan_item?.name === currentPlan.name;
              const isPopular = plan_item?.name === "Pro";
              const showRibbon = isPopular && !isActive;

              return (
                <Card
                  key={index}
                  background={isActive ? "bg-surface-success" : "bg-surface"}
                >
                  <div className="vp-plan-card">
                    <BlockStack gap="400">
                      {showRibbon && (
                        <InlineStack>
                          <Badge tone="success">Most Popular</Badge>
                        </InlineStack>
                      )}
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="headingMd">{plan_item?.title}</Text>
                        {isActive ? (
                          <Badge tone="success">Active</Badge>
                        ) : plan_item?.price > 0 ? (
                          <Badge tone="info">7-Day Free Trial</Badge>
                        ) : null}
                      </InlineStack>

                      <Text variant="bodyMd" tone="subdued">
                        {plan_item?.description}
                      </Text>

                      <InlineStack gap="100" blockAlign="baseline">
                        <Text variant="headingLg">${plan_item?.price}</Text>
                        <Text variant="bodyMd" tone="subdued">
                          / month
                        </Text>
                      </InlineStack>

                      <Divider />

                      <BlockStack gap="200" inlineAlign="start">
                        {plan_item?.features?.map((feature, fIndex) => (
                          <InlineStack
                            gap="200"
                            align="start"
                            blockAlign="start"
                            wrap={false}
                            key={fIndex}
                          >
                            <Icon source={CheckIcon} tone="success" />
                            <Text variant="bodyMd" as="span">
                              {feature}
                            </Text>
                          </InlineStack>
                        ))}
                      </BlockStack>
                    </BlockStack>

                    {/* Pinned to the bottom of the card so every plan's CTA lines
                    up, however many features the plan lists. */}
                    <div className="vp-plan-card-action">
                      {isActive ? (
                        <Button icon={CheckIcon} disabled fullWidth>
                          Current Plan
                        </Button>
                      ) : plan_item?.price > 0 ? (
                        <Button
                          variant="primary"
                          onClick={() => startSub(plan_item)}
                          disabled={flag(isLoading)}
                          loading={flag(isLoading)}
                          fullWidth
                        >
                          Upgrade
                        </Button>
                      ) : !planChosen ? (
                        <Button
                          onClick={chooseFree}
                          disabled={flag(isLoading)}
                          loading={flag(isLoading)}
                          fullWidth
                        >
                          Start with Free
                        </Button>
                      ) : (
                        <Button disabled fullWidth>
                          Included
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
};

export default SubscriptionBtn;
