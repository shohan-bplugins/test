import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Check, Sparkles } from "lucide-react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  ensurePlans,
  fetchActiveSubscription,
  getOrCreateUser,
  parseFeatures,
  type SubscriptionInfo,
} from "~/lib/billing.server";
import {
  FREE_PLAN_NAME,
  PRO_PLAN_NAME,
  PRO_PLUS_PLAN_NAME,
} from "~/lib/billing-constants";
import { fetchShopInfo, notifySwipeone } from "~/lib/swipeone.server";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

type PlanRow = {
  id: string;
  title: string;
  name: string;
  description: string | null;
  features: string[];
  price: string;
  currencyCode: string;
  trialDays: string | null;
  modelLimit: number;
};

type LoaderData = {
  plans: PlanRow[];
  subscription: SubscriptionInfo | null;
  currentPlanName: string;
};

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  await ensurePlans();
  const user = await getOrCreateUser(shop);

  const allPlans = await prisma.plan.findMany({
    orderBy: { price: "asc" },
  });

  try {
    const existing = await prisma.webhookCall.findUnique({ where: { shop } });
    if (!existing?.called) {
      const accessToken = session?.accessToken ?? "";
      const shopInfo = accessToken
        ? await fetchShopInfo(shop, accessToken)
        : null;
      notifySwipeone({
        type: "app.visit_pricing_page",
        shop,
        userId: session?.id,
        shopInfo: shopInfo ?? undefined,
      });
      await prisma.webhookCall.upsert({
        where: { shop },
        update: { called: true, calledAt: new Date() },
        create: { shop, called: true },
      });
    }
  } catch (err) {
    console.error("[pricing loader] swipeone visit notify failed:", err);
  }

  const subscription = await fetchActiveSubscription(
    shop,
    session.accessToken ?? "",
    user.chargeId,
  );

  const currentPlanName =
    subscription?.status === "active" ? subscription.name : FREE_PLAN_NAME;

  return {
    plans: allPlans.map((p) => ({
      id: p.id,
      title: p.title,
      name: p.name,
      description: p.description,
      features: parseFeatures(p.features),
      price: p.price,
      currencyCode: p.currencyCode,
      trialDays: p.trialDays,
      modelLimit: p.modelLimit,
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

  if (intent === "subscribe") {
    const planId = String(form.get("planId") ?? "");
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return { ok: false, error: "Plan not found" };

    await prisma.appUser.update({
      where: { id: user.id },
      data: { planId: plan.id },
    });

    const shopHandle = shop.split(".")[0];
    const returnUrl = `https://admin.shopify.com/store/${shopHandle}/apps/viewer-3d/app/SuccessBilling`;

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
          test: process.env.NODE_ENV !== "production",
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
    return {
      ok: true,
      confirmationUrl: result?.confirmationUrl as string,
    };
  }

  if (intent === "cancel") {
    if (!user.chargeId) {
      return { ok: false, error: "No active subscription" };
    }
    const subscriptionGid = `gid://shopify/AppSubscription/${user.chargeId}`;
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
      where: { shop, chargeId: user.chargeId },
      data: { status },
    });

    const freePlan = await prisma.plan.findUnique({
      where: { name: FREE_PLAN_NAME },
    });
    await prisma.appUser.update({
      where: { id: user.id },
      data: {
        planId: freePlan?.id ?? null,
        modelLimit: freePlan?.modelLimit ?? 5,
      },
    });

    return { ok: true, cancelled: true };
  }

  return { ok: false, error: "Unknown intent" };
};

function formatPrice(p: PlanRow) {
  if (Number(p.price) <= 0) return "Free";
  return `$${p.price}`;
}

export default function Pricing() {
  const { plans, subscription, currentPlanName } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const submitting = navigation.state === "submitting";

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
    } else if (actionData && !actionData.ok && actionData.error) {
      shopify.toast.show(actionData.error, { isError: true });
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

  const currentDescription =
    currentPlanName === PRO_PLUS_PLAN_NAME
      ? "You're currently on the Pro Plus plan. All premium features are unlocked."
      : currentPlanName === PRO_PLAN_NAME
        ? "You're currently on the Pro plan. Up to 50 3D models unlocked."
        : "You're currently on the Free plan. Upgrade to lift the 5-model limit and unlock premium features.";

  const subscriptionActive = subscription?.status === "active";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Your Current Plan</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {currentDescription}
            </p>
          </div>
          <Button
            variant="destructive"
            disabled={!subscriptionActive || submitting}
            onClick={cancelSubscription}
          >
            Cancel Subscription
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {plans.map((plan) => {
            const isActive = plan.name === currentPlanName;
            const isPaid = Number(plan.price) > 0;
            const isPremium =
              plan.name === PRO_PLAN_NAME ||
              plan.name === PRO_PLUS_PLAN_NAME;

            return (
              <Card
                key={plan.id}
                className={
                  isActive
                    ? "relative border-t-[3px] border-t-primary bg-accent/40 flex flex-col"
                    : "relative flex flex-col"
                }
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-lg">{plan.title}</CardTitle>
                    {isActive ? (
                      <Badge>Active</Badge>
                    ) : isPremium ? (
                      <Badge variant="secondary">
                        <Sparkles className="size-3 mr-1" />
                        {plan.trialDays && Number(plan.trialDays) > 0
                          ? `${plan.trialDays}-Day Free Trial`
                          : "Premium"}
                      </Badge>
                    ) : null}
                  </div>
                  <CardDescription>{plan.description}</CardDescription>
                </CardHeader>

                <CardContent className="flex-1 flex flex-col gap-5">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-semibold tracking-tight">
                      {formatPrice(plan)}
                    </span>
                    {isPaid && (
                      <span className="text-sm text-muted-foreground">
                        / month
                      </span>
                    )}
                  </div>

                  <ul className="space-y-2 flex-1">
                    {plan.features.map((f, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm leading-snug"
                      >
                        <Check
                          className={
                            isActive
                              ? "size-4 text-primary shrink-0 mt-0.5"
                              : "size-4 text-muted-foreground shrink-0 mt-0.5"
                          }
                        />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-auto">
                    {isActive ? (
                      <Button disabled variant="outline" className="w-full">
                        Current Plan
                      </Button>
                    ) : isPaid ? (
                      <Button
                        disabled={submitting}
                        onClick={() => startSubscription(plan.id)}
                        className="w-full"
                      >
                        {submitting ? "Processing…" : "Upgrade"}
                      </Button>
                    ) : (
                      <Button disabled variant="outline" className="w-full">
                        Included Standard
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
