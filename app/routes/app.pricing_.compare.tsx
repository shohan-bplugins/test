import { Fragment, useEffect, useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  countDistinctModels,
  fetchActiveSubscription,
  fetchActiveSubscriptionCached,
  getAssignedModelGidsCached,
  getOrCreateUser,
  invalidateSubscription,
  type SubscriptionInfo,
  getPlans,
  getPlanById,
  getPlanByName,
} from "~/lib/billing.server";
import {
  ADVANCE_PLAN_NAME,
  FREE_MODEL_LIMIT,
  FREE_PLAN_NAME,
  FREE_PRODUCT_LIMIT,
  formatMoney,
  GROWTH_PLAN_NAME,
  STARTER_PLAN_NAME,
  isUnlimited,
} from "~/lib/billing-constants";
import { adminAppUrl, BILLING_TEST_MODE } from "~/lib/app-config";

import { BackButton } from "~/components/BackButton";
import { ConfirmModal } from "~/components/polaris/ConfirmModal";
import { SupportAction } from "~/components/SupportAction";
import { useT } from "~/i18n";

type PlanRow = {
  id: string;
  title: string;
  name: string;
  description: string | null;
  price: string;
  currencyCode: string;
  trialDays: string | null;
  modelLimit: number;
  productLimit: number;
};

type Usage = {
  products: number;
  models: number;
};

type LoaderData = {
  usage: Usage;
  plans: PlanRow[];
  subscription: SubscriptionInfo | null;
  currentPlanName: string;
};

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";

  const [, plans, subscription, models, assignedModels] = await Promise.all([
    getOrCreateUser(shop),
    getPlans(),
    fetchActiveSubscriptionCached(admin, shop),
    prisma.model3D.findMany({ where: { shop }, select: { fileGid: true } }),
    getAssignedModelGidsCached(admin, shop),
  ]);

  const usage = {
    products: assignedModels.count,
    models: countDistinctModels(
      models.map((m) => m.fileGid),
      assignedModels.gids,
    ),
  };

  const allPlans = [...plans].sort((a, b) => Number(a.price) - Number(b.price));
  const currentPlanName =
    subscription?.status === "active" ? subscription.name : FREE_PLAN_NAME;

  return {
    usage,
    plans: allPlans.map((p) => ({
      id: p.id,
      title: p.title,
      name: p.name,
      description: p.description,
      price: p.price,
      currencyCode: p.currencyCode,
      trialDays: p.trialDays,
      modelLimit: p.modelLimit,
      productLimit: p.productLimit,
    })),
    subscription,
    currentPlanName,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const user = await getOrCreateUser(shop);
  const t = (key: string) => key;

  const handleDowngradeToFree = async () => {
    const live = await fetchActiveSubscription(admin);
    const subscriptionGid =
      live?.id ||
      (user.chargeId ? `gid://shopify/AppSubscription/${user.chargeId}` : "");

    if (subscriptionGid) {
      const chargeId = subscriptionGid.split("/").pop() ?? "";
      const res = await admin.graphql(
        `#graphql
          mutation AppSubscriptionCancel($id: ID!) {
            appSubscriptionCancel(id: $id) {
              userErrors { field message }
              appSubscription { id status }
            }
          }`,
        { variables: { id: subscriptionGid } },
      );
      const json = await res.json();
      const errs = json?.data?.appSubscriptionCancel?.userErrors ?? [];
      if (errs.length) {
        return {
          ok: false,
          error: errs.map((e: any) => e.message).join("; "),
        };
      }

      const status =
        json?.data?.appSubscriptionCancel?.appSubscription?.status ?? "CANCELLED";

      await prisma.charge.updateMany({
        where: { shop, chargeId },
        data: { status },
      });
    }

    const freePlan = await getPlanByName(FREE_PLAN_NAME);
    await prisma.appUser.update({
      where: { id: user.id },
      data: {
        planId: freePlan?.id ?? null,
        chargeId: null,
        modelLimit: freePlan?.modelLimit ?? FREE_MODEL_LIMIT,
        productLimit: freePlan?.productLimit ?? FREE_PRODUCT_LIMIT,
      },
    });

    invalidateSubscription(shop);
    return { ok: true, cancelled: true };
  };

  if (intent === "cancel") {
    return handleDowngradeToFree();
  }

  if (intent === "subscribe") {
    const planId = String(form.get("planId") ?? "");
    const plan = await getPlanById(planId);
    if (!plan) return { ok: false, error: "Plan not found" };

    if (plan.name === FREE_PLAN_NAME || Number(plan.price) === 0) {
      return handleDowngradeToFree();
    }

    const returnUrl = adminAppUrl(shop, "/app/SuccessBilling");

    const res = await admin.graphql(
      `#graphql
        mutation AppSubscriptionCreate(
          $name: String!
          $lineItems: [AppSubscriptionLineItemInput!]!
          $returnUrl: URL!
          $trialDays: Int
          $test: Boolean
        ) {
          appSubscriptionCreate(
            name: $name
            returnUrl: $returnUrl
            lineItems: $lineItems
            trialDays: $trialDays
            test: $test
          ) {
            userErrors { field message }
            appSubscription { id }
            confirmationUrl
          }
        }`,
      {
        variables: {
          name: plan.title,
          returnUrl,
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
          trialDays: Number(plan.trialDays ?? 0),
          test: BILLING_TEST_MODE,
        },
      },
    );

    const json = await res.json();
    const result = json?.data?.appSubscriptionCreate;
    const errs = result?.userErrors ?? [];
    if (errs.length) {
      return {
        ok: false,
        error: errs.map((e: any) => e.message).join("; "),
      };
    }

    invalidateSubscription(shop);
    return {
      ok: true,
      confirmationUrl: result?.confirmationUrl as string,
    };
  }

  return { ok: false, error: "Unknown request" };
};

export default function ComparePlans() {
  const { plans, currentPlanName, usage } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const submitting = navigation.state === "submitting";
  const [downgradeTo, setDowngradeTo] = useState<PlanRow | null>(null);

  useEffect(() => {
    if (actionData?.ok && (actionData as any).confirmationUrl) {
      const url = (actionData as any).confirmationUrl as string;
      if (typeof window !== "undefined" && (window as any).top) {
        try {
          (window as any).top.location = url;
        } catch {
          window.location.href = url;
        }
      }
    } else if (actionData?.ok && (actionData as any).cancelled) {
      shopify.toast.show("Subscription cancelled");
      setDowngradeTo(null);
    } else if (actionData && !actionData.ok && "error" in actionData && actionData.error) {
      shopify.toast.show(actionData.error, { isError: true });
      setDowngradeTo(null);
    }
  }, [actionData, shopify]);

  function startSubscription(planId: string) {
    const fd = new FormData();
    fd.set("intent", "subscribe");
    fd.set("planId", planId);
    submit(fd, { method: "post" });
  }

  function cancelSubscription() {
    const fd = new FormData();
    fd.set("intent", "cancel");
    submit(fd, { method: "post" });
  }

  // Consistent 4 plans order: Free, Starter, Growth, Advance
  const orderedPlans = useMemo(() => {
    const order = [FREE_PLAN_NAME, STARTER_PLAN_NAME, GROWTH_PLAN_NAME, ADVANCE_PLAN_NAME];
    return [...plans].sort(
      (a, b) => order.indexOf(a.name) - order.indexOf(b.name),
    );
  }, [plans]);

  const checkIcon = (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      <circle cx="8" cy="8" r="7.5" fill="#e4f8ed" />
      <path
        d="M11 5.5L6.5 10L5 8.5"
        stroke="#108043"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  const dashIcon = (
    <span style={{ color: "#8c9196", fontWeight: 600 }}>—</span>
  );

  const renderActionButton = (plan: PlanRow) => {
    const isActive = plan.name === currentPlanName;
    const isPopular = plan.name === GROWTH_PLAN_NAME;
    const isPaid = Number(plan.price) > 0;
    const tooSmall =
      (!isUnlimited(plan.productLimit) && plan.productLimit < usage.products) ||
      (!isUnlimited(plan.modelLimit) && plan.modelLimit < usage.models);

    if (isActive) {
      return (
        <button
          type="button"
          disabled
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: "8px",
            border: "1px solid #e1e3e5",
            background: "#f1f2f3",
            color: "#8c9196",
            fontWeight: 600,
            fontSize: "13px",
            cursor: "default",
            boxSizing: "border-box",
          }}
        >
          Your current plan
        </button>
      );
    }

    if (isPopular) {
      return (
        <button
          type="button"
          disabled={submitting}
          onClick={() =>
            tooSmall ? setDowngradeTo(plan) : startSubscription(plan.id)
          }
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: "8px",
            border: "none",
            background: "#202223",
            color: "#ffffff",
            fontWeight: 600,
            fontSize: "13px",
            cursor: submitting ? "not-allowed" : "pointer",
            opacity: submitting ? 0.7 : 1,
            boxSizing: "border-box",
            transition: "background 0.15s ease",
          }}
        >
          Switch to {plan.name}
        </button>
      );
    }

    return (
      <button
        type="button"
        disabled={submitting}
        onClick={() => {
          if (tooSmall) {
            setDowngradeTo(plan);
          } else if (isPaid) {
            startSubscription(plan.id);
          } else {
            cancelSubscription();
          }
        }}
        style={{
          width: "100%",
          padding: "8px 12px",
          borderRadius: "8px",
          border: "1px solid #dcdcdc",
          background: "#ffffff",
          color: "#202223",
          fontWeight: 600,
          fontSize: "13px",
          cursor: submitting ? "not-allowed" : "pointer",
          opacity: submitting ? 0.7 : 1,
          boxSizing: "border-box",
          transition: "background 0.15s ease, border-color 0.15s ease",
        }}
      >
        Switch to {plan.name}
      </button>
    );
  };

  const featureSections = [
    {
      title: "Publishing & Limits",
      rows: [
        {
          name: "Products with a 3D model",
          values: orderedPlans.map((p) =>
            isUnlimited(p.productLimit) ? "Unlimited" : `${p.productLimit} products`,
          ),
          bold: true,
        },
        {
          name: "Models in your library",
          values: orderedPlans.map((p) =>
            isUnlimited(p.modelLimit) ? "Unlimited" : `${p.modelLimit} models`,
          ),
          bold: true,
        },
        {
          name: "Models per product",
          values: ["1 model", "1 model", "1 model", "1 model"],
        },
        {
          name: "Max 3D file size (GLB / glTF)",
          values: ["20 MB", "20 MB", "20 MB", "20 MB"],
        },
        {
          name: "Shopify CDN Hosting",
          values: [checkIcon, checkIcon, checkIcon, checkIcon],
        },
      ],
    },
    {
      title: "3D Viewer & Experience",
      rows: [
        {
          name: "Interactive 3D Viewer",
          values: [checkIcon, checkIcon, checkIcon, checkIcon],
        },
        {
          name: "Augmented Reality (iOS Quick Look & Android AR)",
          values: [checkIcon, checkIcon, checkIcon, checkIcon],
        },
        {
          name: "Theme App Blocks (Online Store 2.0)",
          values: [checkIcon, checkIcon, checkIcon, checkIcon],
        },
        {
          name: "Universal Iframe Embed Snippet",
          values: [checkIcon, checkIcon, checkIcon, checkIcon],
        },
        {
          name: "Full Viewer Controls (Rotate, Zoom, Camera Angle)",
          values: [checkIcon, checkIcon, checkIcon, checkIcon],
        },
        {
          name: "Auto-rotation & Smooth Inertia",
          values: [checkIcon, checkIcon, checkIcon, checkIcon],
        },
        {
          name: "Studio Lighting & HDR Skybox",
          values: [checkIcon, checkIcon, checkIcon, checkIcon],
        },
        {
          name: "Contact Shadows & Exposure Control",
          values: [checkIcon, checkIcon, checkIcon, checkIcon],
        },
        {
          name: "Animation Playback & Switcher",
          values: [checkIcon, checkIcon, checkIcon, checkIcon],
        },
        {
          name: "glTF Material Color Variants",
          values: [checkIcon, checkIcon, checkIcon, checkIcon],
        },
        {
          name: "Live Admin Realtime Preview",
          values: [checkIcon, checkIcon, checkIcon, checkIcon],
        },
      ],
    },
    {
      title: "Support & Services",
      rows: [
        {
          name: "7-day Free Trial",
          values: [dashIcon, "7 days", "7 days", "7 days"],
        },
        {
          name: "Support Level",
          values: [
            "Standard email",
            "Priority email",
            "Priority email",
            "Premium priority (24/7)",
          ],
        },
        {
          name: "Technical & Integration Assistance",
          values: [checkIcon, checkIcon, checkIcon, checkIcon],
        },
      ],
    },
  ];

  return (
    <s-page heading="Compare plan details" inlineSize="large" {...{ "inline-size": "large" }}>
      <BackButton to="/app/pricing" label="Pricing" />
      <SupportAction />

      <style>{`
        .compare-container {
          width: 100%;
          max-width: 1400px;
          margin: 0 auto;
          padding: 0 32px;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        @media (max-width: 640px) {
          .compare-container {
            padding: 0 16px;
          }
        }
        .compare-table-wrapper {
          width: 100%;
          overflow-x: auto;
          background: #ffffff;
          border: 1px solid #e1e3e5;
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
        }
        .compare-table {
          width: 100%;
          min-width: 760px;
          border-collapse: collapse;
          text-align: left;
        }
        .compare-table th, .compare-table td {
          padding: 14px 18px;
          border-bottom: 1px solid #f1f2f3;
          font-size: 13px;
        }
        .compare-section-row td {
          background-color: #f8f9fa;
          font-size: 14px;
          font-weight: 700;
          color: #202223;
          padding: 12px 18px;
          border-bottom: 1px solid #e1e3e5;
          border-top: 1px solid #e1e3e5;
        }
      `}</style>

      <div className="compare-container">
        {/* Header Intro */}
        <div>
          <h1
            style={{
              fontSize: "20px",
              fontWeight: 700,
              color: "#202223",
              margin: "0 0 6px 0",
              lineHeight: 1.3,
            }}
          >
            Compare plan details
          </h1>
          <div
            style={{
              fontSize: "14px",
              color: "#6d7175",
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            See how our plans compare side by side. Every plan includes our complete 3D viewer feature suite.
          </div>
        </div>

        {/* Comparison Table */}
        <div className="compare-table-wrapper">
          <table className="compare-table">
            <thead>
              <tr style={{ borderBottom: "2px solid #e1e3e5", background: "#ffffff" }}>
                <th style={{ width: "32%", verticalAlign: "bottom" }}>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#6d7175" }}>
                    Plan & Features
                  </div>
                </th>
                {orderedPlans.map((plan) => {
                  const isActive = plan.name === currentPlanName;
                  const isPopular = plan.name === GROWTH_PLAN_NAME;
                  const priceNum = Number(plan.price);

                  return (
                    <th
                      key={plan.id}
                      style={{
                        width: "17%",
                        verticalAlign: "top",
                        backgroundColor: isPopular ? "#f8fbff" : "transparent",
                        borderLeft: "1px solid #f1f2f3",
                      }}
                    >
                      <div style={{ minHeight: "24px", marginBottom: "4px" }}>
                        {isActive ? (
                          <span
                            style={{
                              display: "inline-block",
                              backgroundColor: "#e4f8ed",
                              color: "#108043",
                              fontSize: "11px",
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: "9999px",
                            }}
                          >
                            Current
                          </span>
                        ) : isPopular ? (
                          <span
                            style={{
                              display: "inline-block",
                              backgroundColor: "#e0f2fe",
                              color: "#005bd3",
                              fontSize: "11px",
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: "9999px",
                            }}
                          >
                            Recommended
                          </span>
                        ) : null}
                      </div>

                      <div
                        style={{
                          fontSize: "16px",
                          fontWeight: 700,
                          color: "#202223",
                        }}
                      >
                        {plan.name}
                      </div>

                      <div style={{ margin: "4px 0 12px 0" }}>
                        <span style={{ fontSize: "20px", fontWeight: 800, color: "#202223" }}>
                          ${formatMoney(priceNum)}
                        </span>
                        <span style={{ fontSize: "12px", color: "#6d7175", marginLeft: "4px" }}>
                          / mo
                        </span>
                      </div>

                      <div>{renderActionButton(plan)}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {featureSections.map((section, sIdx) => (
                <Fragment key={sIdx}>
                  <tr className="compare-section-row">
                    <td colSpan={5}>{section.title}</td>
                  </tr>

                  {section.rows.map((row, rIdx) => (
                    <tr key={rIdx} style={{ backgroundColor: rIdx % 2 === 1 ? "#fafbfb" : "#ffffff" }}>
                      <td style={{ color: "#202223", fontWeight: "bold" in row && row.bold ? 600 : 500 }}>
                        {row.name}
                      </td>

                      {row.values.map((val, vIdx) => {
                        const plan = orderedPlans[vIdx];
                        const isPopular = plan?.name === GROWTH_PLAN_NAME;

                        return (
                          <td
                            key={vIdx}
                            style={{
                              textAlign: "center",
                              borderLeft: "1px solid #f1f2f3",
                              backgroundColor: isPopular
                                ? rIdx % 2 === 1
                                  ? "#f4f8fe"
                                  : "#f8fbff"
                                : "transparent",
                              color: "#202223",
                              fontWeight: "bold" in row && row.bold ? 600 : 400,
                            }}
                          >
                            {val}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}

              {/* Bottom Action Footer Row */}
              <tr style={{ borderTop: "2px solid #e1e3e5", background: "#fdfdfd" }}>
                <td style={{ fontWeight: 600, color: "#6d7175" }}>Choose plan</td>
                {orderedPlans.map((plan) => {
                  const isPopular = plan.name === GROWTH_PLAN_NAME;
                  return (
                    <td
                      key={plan.id}
                      style={{
                        padding: "16px 18px",
                        borderLeft: "1px solid #f1f2f3",
                        backgroundColor: isPopular ? "#f8fbff" : "transparent",
                      }}
                    >
                      {renderActionButton(plan)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Back Link at bottom */}
        <div style={{ marginTop: "12px", marginBottom: "32px" }}>
          <Link
            to="/app/pricing"
            style={{
              color: "#005bd3",
              fontSize: "14px",
              fontWeight: 600,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            ← Back to Pricing
          </Link>
        </div>
      </div>

      <ConfirmModal
        id="confirm-downgrade-compare"
        open={downgradeTo !== null}
        heading={`Switch to ${downgradeTo?.name ?? ""}?`}
        confirmLabel="Switch anyway"
        cancelLabel="Keep my plan"
        loading={submitting}
        onConfirm={() => {
          if (downgradeTo) {
            if (
              downgradeTo.name === FREE_PLAN_NAME ||
              Number(downgradeTo.price) <= 0
            ) {
              cancelSubscription();
            } else {
              startSubscription(downgradeTo.id);
            }
          }
          setDowngradeTo(null);
        }}
        onCancel={() => setDowngradeTo(null)}
      >
        <s-paragraph>
          You’re currently using {usage.products} products and {usage.models} models.{" "}
          {downgradeTo?.name} allows {downgradeTo?.productLimit} products and{" "}
          {downgradeTo?.modelLimit} models.
        </s-paragraph>
        <s-paragraph>
          Anything over the new limit stays in your library, but stops rendering on your storefront until you remove enough to fit or move back up.
        </s-paragraph>
      </ConfirmModal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
