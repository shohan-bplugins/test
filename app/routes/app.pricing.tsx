import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Link,
  useActionData,
  useFetcher,
  useLoaderData,
  redirect,
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
  markPlanChosen,
  parseFeatures,
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
  formatLimit,
  formatMoney,
  GROWTH_PLAN_NAME,
  isUnlimited,
  annualPrice,
  ANNUAL_MONTHS_CHARGED,
  STARTER_PLAN_NAME,
} from "~/lib/billing-constants";
import { fetchShopInfo, notifySwipeone } from "~/lib/swipeone.server";
import {
  couponToDiscount,
  findCoupon,
  getAutoApplyCoupon,
  getActiveBanner,
  type BannerInfo,
} from "~/lib/coupons.server";
import {
  LAUNCH_OFFER,
  LAUNCH_OFFER_PERCENT_LABEL,
  launchOfferActive,
  launchOfferDiscount,
} from "~/lib/launch-offer";
import { MAX_MODEL_FILE_SIZE_MB } from "~/lib/files";
import { adminAppUrl, BILLING_TEST_MODE } from "~/lib/app-config";
import { useLocale, useT, type TFunction } from "~/i18n";
import { getServerT } from "~/i18n/i18n.server";

import { BackButton } from "~/components/BackButton";
import { ConfirmModal } from "~/components/polaris/ConfirmModal";
import { ModalAction } from "~/components/polaris/ModalAction";
import { SupportAction, SUPPORT_FORM_ID } from "~/components/SupportAction";
import {
  fieldChecked,
  fieldValue,
  flag,
  type OverlayElement,
} from "~/components/polaris/helpers";

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
  productLimit: number;
};

/** What the shop is publishing right now, against which a plan is judged. */
type Usage = {
  products: number;
  models: number;
};

type LoaderData = {
  usage: Usage;
  plans: PlanRow[];
  subscription: SubscriptionInfo | null;
  currentPlanName: string;
  offerActive: boolean;
  autoApplyCoupon: {
    code: string;
    description: string;
    percentage: number;
    durationLimitInIntervals: number | null;
    applicablePlans?: string[];
  } | null;
  initialCoupon: {
    code: string;
    description: string;
    percentage: number;
    durationLimitInIntervals: number | null;
    isAutoApply?: boolean;
    applicablePlans?: string[];
  } | null;
  promotionBanner: BannerInfo | null;
};

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  // Called for its side effect: a shop reaching the pricing page before any
  // other route has an AppUser row created here. Its return value used to
  // supply the chargeId that `fetchActiveSubscription` needed — Shopify now
  // reports the active subscription directly, so nothing reads it. It also
  // seeds the plans, which is why the plan list can be read alongside it.
  const [, plans, subscription, models, assignedModels] = await Promise.all([
    getOrCreateUser(shop),
    getPlans(),
    // Was awaited at the end of the loader, behind the notify block below.
    fetchActiveSubscriptionCached(admin, shop),
    // What the shop is actually using, so a plan can be compared against
    // reality rather than against a number the merchant has to remember. Both
    // reads are already cached per shop, so this costs the page nothing.
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

  // `price` is stored as a String column, so a DB-level orderBy sorts
  // lexicographically (e.g. "29.99" before "9.99"). Sort numerically instead.
  const allPlans = [...plans].sort((a, b) => Number(a.price) - Number(b.price));

  /*
   * The "merchant looked at pricing" notification, fired beside the response
   * rather than in front of it.
   *
   * Nothing below reads any of this — it is a one-per-shop marketing signal —
   * and awaiting it made every pricing page load wait on a Mongo round trip
   * (~250ms) just to discover the notification had already been sent months
   * ago. On the one load per shop where it had not, the merchant also waited on
   * an external HTTP call to SwipeOne and a second Mongo write, none of which
   * changes a pixel.
   *
   * `void` rather than `await`: the work still runs, in the same single pm2
   * process, and the upsert still records it. The existing try/catch is now the
   * only thing that could observe a failure, so it keeps logging.
   */
  void (async () => {
    try {
      const existing = await prisma.webhookCall.findUnique({ where: { shop } });
      if (existing?.called) return;
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
    } catch (err) {
      console.error("[pricing loader] swipeone visit notify failed:", err);
    }
  })();

  const currentPlanName =
    subscription?.status === "active" ? subscription.name : FREE_PLAN_NAME;

  const url = new URL(request.url);
  const paramCode = url.searchParams.get("coupon")?.trim();
  const urlCoupon = paramCode ? await findCoupon(paramCode) : null;
  const autoApply = await getAutoApplyCoupon();
  const effectiveCoupon = urlCoupon || autoApply;

  const initialCoupon = effectiveCoupon
    ? {
        code: effectiveCoupon.code,
        description: effectiveCoupon.description,
        percentage: effectiveCoupon.percentage,
        durationLimitInIntervals:
          effectiveCoupon.durationLimitInIntervals ?? null,
        isAutoApply: effectiveCoupon.autoApply ?? false,
        applicablePlans: effectiveCoupon.applicablePlans ?? [],
      }
    : null;

  const autoApplyCouponData = autoApply
    ? {
        code: autoApply.code,
        description: autoApply.description,
        percentage: autoApply.percentage,
        durationLimitInIntervals: autoApply.durationLimitInIntervals ?? null,
        applicablePlans: autoApply.applicablePlans ?? [],
      }
    : null;

  return {
    usage,
    offerActive: launchOfferActive(),
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
      productLimit: p.productLimit,
    })),
    subscription,
    currentPlanName,
    autoApplyCoupon: autoApplyCouponData,
    initialCoupon,
    promotionBanner: await getActiveBanner("pricing"),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const user = await getOrCreateUser(shop);
  const t = getServerT(request, "pricing");

  // Checked before a plan is chosen, so the merchant sees what a code is worth
  // rather than discovering it on Shopify's approval screen.
  if (intent === "validate_coupon") {
    const coupon = await findCoupon(String(form.get("coupon") ?? ""));
    if (!coupon) {
      return { ok: false, error: t("couponInvalid") };
    }
    return {
      ok: true,
      coupon: {
        code: coupon.code,
        description: coupon.description,
        // The share off, so the plan cards can show what each would actually
        // cost. It is still re-read from the server when the charge is created;
        // this copy only drives what is displayed.
        percentage: coupon.percentage,
        durationLimitInIntervals: coupon.durationLimitInIntervals ?? null,
        applicablePlans: coupon.applicablePlans ?? [],
      },
    };
  }

  // A fresh install picking Free on /app/select-plan, which posts here so the
  // charge logic below has one owner. Unlocks the rest of the app (see the plan
  // gate in routes/app.tsx), then on to the dashboard, which starts the
  // onboarding wizard for a new shop.
  if (intent === "choose_free") {
    const freePlan = await getPlanByName(FREE_PLAN_NAME);
    await prisma.appUser.update({
      where: { id: user.id },
      data: {
        planId: freePlan?.id ?? null,
        modelLimit: freePlan?.modelLimit ?? FREE_MODEL_LIMIT,
        productLimit: freePlan?.productLimit ?? FREE_PRODUCT_LIMIT,
      },
    });
    await markPlanChosen(shop);
    return redirect("/app");
  }

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
    const yearly = String(form.get("interval") ?? "") === "yearly";
    // Re-checked here, never trusted from the form: the browser sends a code,
    // not a discount, so an invented code buys nothing.
    const plan = await getPlanById(planId);
    if (!plan) return { ok: false, error: t("planNotFound") };

    // Re-checked here, never trusted from the form: the browser sends a code,
    // not a discount, so an invented code buys nothing.
    const couponInput = String(form.get("coupon") ?? "");
    let coupon = await findCoupon(couponInput, plan.name);
    if (!coupon && !couponInput) {
      coupon = await getAutoApplyCoupon(plan.name);
    }

    if (plan.name === FREE_PLAN_NAME || Number(plan.price) === 0) {
      return handleDowngradeToFree();
    }

    /*
     * The launch discount, applied without anyone entering a code.
     *
     * Decided here, against the clock at the moment the charge is created —
     * never from the form and never from the flag the loader rendered with. A
     * merchant who left the pricing page open across the deadline is charged by
     * this line, not by the banner they are looking at.
     *
     * Monthly only. Shopify counts `durationLimitInIntervals` in billing
     * intervals, so the six that mean six months on EVERY_30_DAYS would mean
     * six *years* on an ANNUAL charge. Yearly billing is switched off in the UI
     * (see SHOW_BILLING_OPTIONS), so this is a guard against turning it back on
     * rather than a path anyone can reach today.
     *
     * Shopify takes one discount per line item, so an entered coupon and the
     * launch offer cannot both apply: whichever takes more off the price wins.
     * Ties go to the launch offer, which runs for six periods — longer than any
     * code currently worth the same.
     */
    const launch = yearly ? undefined : launchOfferDiscount();
    const entered = couponToDiscount(coupon);
    const discount =
      launch &&
      (!entered || entered.value.percentage <= launch.value.percentage)
        ? launch
        : entered;

    const appliedCode = discount === entered && coupon ? coupon.code : "";
    const returnUrl = adminAppUrl(
      shop,
      `/app/SuccessBilling${appliedCode ? `?coupon=${encodeURIComponent(appliedCode)}` : ""}`,
    );

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
                    // A year is billed as one charge of ten months' price.
                    amount: yearly
                      ? annualPrice(plan.price)
                      : Number(plan.price),
                    currencyCode: plan.currencyCode,
                  },
                  interval: yearly ? "ANNUAL" : "EVERY_30_DAYS",
                  ...(discount ? { discount } : {}),
                },
              },
            },
          ],
          trialDays: Number(plan.trialDays ?? 0),
          // Never hardcoded — a test charge is never billed. See
          // BILLING_TEST_MODE for why this is opt-in via env var only.
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
    // The merchant is about to approve a charge and be sent back to
    // SuccessBilling; the cached "no subscription" answer must not outlive it.
    invalidateSubscription(shop);
    return {
      ok: true,
      confirmationUrl: result?.confirmationUrl as string,
    };
  }

  return { ok: false, error: t("unknownIntent") };
};

/**
 * What the app does, stated once. None of this is gated by plan — a plan only
 * buys volume — so it belongs in a shared band rather than repeated down four
 * feature lists where it would read as a per-tier upsell.
 */

const INCLUDED_PLAN_CARDS = [
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
    title: "GLB and glTF models",
    description: "Upload files up to 20 MB each. We host them on the Shopify CDN.",
    href: "/app/documentation",
  },
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
        <line x1="12" y1="18" x2="12.01" y2="18" />
      </svg>
    ),
    title: "Augmented reality",
    description: "Shoppers see products in their space with Quick Look, Scene Viewer, or WebXR. No app needed.",
    href: "/app/documentation",
  },
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
      </svg>
    ),
    title: "Theme app blocks",
    description: "Add the viewer to product pages or any page. Use the iframe snippet everywhere else.",
    href: "/app/documentation",
  },
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="4" y1="21" x2="4" y2="14" />
        <line x1="4" y1="10" x2="4" y2="3" />
        <line x1="12" y1="21" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12" y2="3" />
        <line x1="20" y1="21" x2="20" y2="16" />
        <line x1="20" y1="12" x2="20" y2="3" />
        <line x1="1" y1="14" x2="7" y2="14" />
        <line x1="9" y1="8" x2="15" y2="8" />
        <line x1="17" y1="16" x2="23" y2="16" />
      </svg>
    ),
    title: "Full viewer control",
    description: "Set the camera angle, zoom, auto-rotate, and which control buttons shoppers see.",
    href: "/app/documentation",
  },
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
    ),
    title: "Studio lighting",
    description: "Adjust the HDR skybox, environment maps, exposure, tone mapping, and shadows.",
    href: "/app/documentation",
  },
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    ),
    title: "Animation playback",
    description: "Play built-in animations with a switcher. Choose to loop or play once.",
    href: "/app/documentation",
  },
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="7" width="14" height="14" rx="2" />
        <path d="M8 3h12a2 2 0 0 1 2 2v12" />
      </svg>
    ),
    title: "Material variants",
    description: "Show one glTF material variant, so a single file can cover every color.",
    href: "/app/documentation",
  },
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
    title: "Live admin preview",
    description: "See changes in the same viewer your customers see, before you save.",
    href: "/app/documentation",
  },
];

const INCLUDED_FEATURES: { icon: string; title: string; body: string }[] = [
  {
    icon: "three-d-environment",
    title: "featureModelsTitle",
    body: "featureModelsBody",
  },
  {
    icon: "mobile",
    title: "featureArTitle",
    body: "featureArBody",
  },
  {
    icon: "layout-section",
    title: "featureBlocksTitle",
    body: "featureBlocksBody",
  },
  {
    icon: "adjust",
    title: "featureControlTitle",
    body: "featureControlBody",
  },
  {
    icon: "sun",
    title: "featureLightingTitle",
    body: "featureLightingBody",
  },
  {
    icon: "play",
    title: "featureAnimationTitle",
    body: "featureAnimationBody",
  },
  {
    icon: "color",
    title: "featureVariantsTitle",
    body: "featureVariantsBody",
  },
  {
    icon: "maximize",
    title: "featurePreviewTitle",
    body: "featurePreviewBody",
  },
];

/*
 * Plan names, descriptions and feature rows come from the Plan table in
 * English (seeded in lib/billing.server.ts, and the title is also the name of
 * the Shopify charge), so they are translated here at render time. A known
 * plan or row maps to a message; anything else is shown as stored.
 */
const PLAN_KEYS: Record<string, string> = {
  [FREE_PLAN_NAME]: "planFree",
  [STARTER_PLAN_NAME]: "planStarter",
  [GROWTH_PLAN_NAME]: "planGrowth",
  [ADVANCE_PLAN_NAME]: "planAdvance",
};

const FEATURE_ROWS: [RegExp, string][] = [
  [/^Unlimited products with a 3D model$/, "featureProductsUnlimited"],
  [/^(\d+) products? with a 3D model$/, "featureProducts"],
  [/^Unlimited models in your library$/, "featureModelsUnlimited"],
  [/^(\d+) models? in your library$/, "featureModels"],
  [/^1 model per product$/, "featureOneModelPerProduct"],
  [/^Every viewer feature included$/, "featureEverything"],
  [/^Standard email support$/, "featureStandardSupport"],
  [/^Priority email support$/, "featurePrioritySupport"],
  [/^Premium priority support$/, "featurePremiumSupport"],
];

function planTitle(tb: TFunction, plan: { name: string; title: string }) {
  const key = PLAN_KEYS[plan.name];
  return key ? tb(key) : plan.title;
}

function planDescription(
  tb: TFunction,
  plan: { name: string; description: string | null },
) {
  const key = PLAN_KEYS[plan.name];
  return key && plan.description ? tb(`${key}Description`) : plan.description;
}

function planFeature(tb: TFunction, feature: string) {
  for (const [re, key] of FEATURE_ROWS) {
    const m = re.exec(feature);
    if (m) return m[1] ? tb(key, { count: Number(m[1]) }) : tb(key);
  }
  return feature;
}

function formatPrice(p: PlanRow, free: string) {
  if (Number(p.price) <= 0) return free;
  return `$${formatMoney(p.price)}`;
}

export default function Pricing() {
  const {
    plans,
    subscription,
    currentPlanName,
    usage,
    offerActive,
    autoApplyCoupon,
    initialCoupon,
    promotionBanner,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const submitting = navigation.state === "submitting";
  const t = useT("pricing");
  const tb = useT("billing");
  const tc = useT("common");
  const locale = useLocale();
  // Unlimited is stored as a large number; see formatLimit.
  const limitText = (limit: number) =>
    isUnlimited(limit) ? tb("unlimited") : formatLimit(limit);
  const productsText = (limit: number) =>
    isUnlimited(limit)
      ? tb("unlimitedProducts")
      : tb("productCount", { count: limit });
  const modelsText = (limit: number) =>
    isUnlimited(limit)
      ? tb("unlimitedModels")
      : tb("modelCount", { count: limit });

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
      shopify.toast.show(t("subscriptionCancelled"));
    } else if (actionData && !actionData.ok && "error" in actionData && actionData.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }

    /*
     * The cancel dialog is opened declaratively (command/commandFor), so
     * nothing closes it when the action comes back — it stayed on screen over
     * the page, still offering to cancel a subscription that was already gone.
     * Hidden imperatively for the same reason it is opened by command: an
     * `open` attribute would be stringified by React 18 and pin it open.
     */
    if (actionData) {
      setDowngradeTo(null);
      const dialog = document.getElementById(
        "cancel-subscription",
      ) as OverlayElement | null;
      dialog?.hideOverlay?.();
    }
  }, [actionData, shopify, t]);

  /*
   * Which plan's button was pressed.
   *
   * `submitting` alone is page-wide, so using it for every card's loading state
   * put a spinner on all four buttons at once and gave no clue which one was
   * actually being bought.
   */
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  /*
   * A plan whose limits are below what the shop is publishing right now.
   * Switching to it silently would stop models rendering on the storefront, so
   * it is confirmed first and the dialog states exactly what would be lost.
   */
  const [downgradeTo, setDowngradeTo] = useState<PlanRow | null>(null);
  const [yearly, setYearly] = useState(
    subscription?.interval === "ANNUAL",
  );
  const [couponInput, setCouponInput] = useState("");
  /** The field is revealed on request — most merchants have no code to enter. */
  const [couponOpen, setCouponOpen] = useState(false);
  /*
   * Held locally rather than read straight off the fetcher, so it can be
   * cleared the moment the merchant starts correcting the code. Left on the
   * fetcher it would sit under the field, still saying the previous attempt was
   * invalid, while they typed the right one.
   */
  const [couponError, setCouponError] = useState<string | null>(null);

  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && promotionBanner?.code && promotionBanner.dismissible) {
      if (localStorage.getItem(`dismissed_banner_${promotionBanner.code}`) === "true") {
        setBannerDismissed(true);
      }
    }
  }, [promotionBanner]);

  const handleDismissBanner = () => {
    setBannerDismissed(true);
    if (typeof window !== "undefined" && promotionBanner?.code) {
      localStorage.setItem(`dismissed_banner_${promotionBanner.code}`, "true");
    }
  };

  /** The code once the server has confirmed it, with what it is worth. */
  const [coupon, setCoupon] = useState<{
    code: string;
    description: string;
    percentage: number;
    durationLimitInIntervals: number | null;
    isAutoApply?: boolean;
    applicablePlans?: string[];
  } | null>(initialCoupon ?? null);

  /*
   * The discount actually in force on this page, which is what every card
   * prices against.
   *
   * The launch offer needs no code, so it stands in for one rather than being a
   * second thing the cards have to know about: the struck-through list price,
   * the "for the first N months, then $X" line and the re-subscribe button on
   * the current plan's card all already worked off an applied coupon, and they
   * keep working unchanged.
   *
   * Whichever active promotion is applied (coupon takes precedence if provided,
   * else launch offer if active).
   */
  // LAUNCH_OFFER.endsLabel, in the merchant's language. endsAt is UTC midnight
  // on the closing day, so it is formatted in UTC to name that same day.
  const offerEnds = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(LAUNCH_OFFER.endsAt);
  const launchDiscount =
    offerActive && !yearly
      ? {
          code: LAUNCH_OFFER.code,
          description: t("launchOfferDescription", {
            percent: LAUNCH_OFFER_PERCENT_LABEL,
            count: LAUNCH_OFFER.months,
            date: offerEnds,
          }),
          percentage: LAUNCH_OFFER.percentOff,
          durationLimitInIntervals: LAUNCH_OFFER.months,
        }
      : null;
  const appliedDiscount = coupon || launchDiscount;
  /** True when the price shown is the launch offer rather than a typed code. */
  const showingLaunchOffer = !coupon && appliedDiscount === launchDiscount;
  const showingAutoApply = Boolean(
    coupon &&
      (coupon.isAutoApply ||
        (autoApplyCoupon && coupon.code.toUpperCase() === autoApplyCoupon.code.toUpperCase())),
  );

  // Its own fetcher: checking a code must not disturb the page's own
  // navigation state, which drives every plan button's loading spinner.
  const couponCheck = useFetcher<{
    ok: boolean;
    error?: string;
    coupon?: {
      code: string;
      description: string;
      percentage: number;
      durationLimitInIntervals: number | null;
      applicablePlans?: string[];
    };
  }>();

  useEffect(() => {
    const data = couponCheck.data;
    if (!data) return;
    if (data.ok && data.coupon) {
      setCoupon(data.coupon);
      setCouponError(null);
      setCouponOpen(false);
    } else {
      setCoupon(null);
      setCouponError(data.error ?? t("couponInvalid"));
    }
  }, [couponCheck.data, t]);

  function applyCoupon() {
    const fd = new FormData();
    fd.set("intent", "validate_coupon");
    fd.set("coupon", couponInput);
    couponCheck.submit(fd, { method: "post" });
  }

  function startSubscription(planId: string) {
    setPendingPlanId(planId);
    const fd = new FormData();
    fd.set("intent", "subscribe");
    fd.set("planId", planId);
    fd.set("interval", yearly ? "yearly" : "monthly");
    if (appliedDiscount && !showingLaunchOffer) {
      fd.set("coupon", appliedDiscount.code);
    }
    submit(fd, { method: "post" });
  }

  function cancelSubscription() {
    const freePlan = plans.find((p) => p.name === FREE_PLAN_NAME);
    if (freePlan) setPendingPlanId(freePlan.id);
    const fd = new FormData();
    fd.set("intent", "cancel");
    submit(fd, { method: "post" });
  }

  const currentPlan =
    plans.find((p) => p.name === currentPlanName) ??
    plans.find((p) => p.name === FREE_PLAN_NAME) ??
    null;
  const currentDescription = currentPlan
    ? currentPlanName === ADVANCE_PLAN_NAME
      ? t("currentAdvance", { plan: planTitle(tb, currentPlan) })
      : t(
          currentPlanName === FREE_PLAN_NAME
            ? "currentLimitsFree"
            : "currentLimits",
          {
            plan: planTitle(tb, currentPlan),
            products: limitText(currentPlan.productLimit),
            models: limitText(currentPlan.modelLimit),
          },
        )
    : "";

  const subscriptionActive = subscription?.status === "active";

  /*
   * What the merchant is paying now, so each card can say what pressing its
   * button would actually do. Every paid card used to say "Upgrade", including
   * the ones below the current plan — a merchant on Advance was offered an
   * "Upgrade" to Starter, which is a downgrade and a loss of capacity.
   */
  const currentPrice = Number(currentPlan?.price ?? 0);

  const suggestedPlan = useMemo(() => {
    if (!subscriptionActive || !currentPlan) return null;
    const cheaper = plans.filter(
      (p) =>
        Number(p.price) > 0 &&
        Number(p.price) < currentPrice &&
        usage.products <= p.productLimit &&
        usage.models <= p.modelLimit,
    );
    if (!cheaper.length) return null;
    return cheaper.find((p) => p.name === GROWTH_PLAN_NAME) ?? cheaper[cheaper.length - 1];
  }, [subscriptionActive, currentPlan, currentPrice, plans, usage]);

  const savings = suggestedPlan
    ? (currentPrice - Number(suggestedPlan.price)).toFixed(2)
    : "0.00";

  const sortedPlans = useMemo(() => {
    return [...plans].sort((a, b) => {
      const aActive = a.name === currentPlanName;
      const bActive = b.name === currentPlanName;
      if (aActive) return -1;
      if (bActive) return 1;

      // When current plan is Free, show Starter next, then Growth, then Advance
      if (currentPlanName === FREE_PLAN_NAME) {
        return Number(a.price) - Number(b.price);
      }

      // Free plan always shows last, unless it was the active one (handled above)
      const aIsFree = a.name === FREE_PLAN_NAME;
      const bIsFree = b.name === FREE_PLAN_NAME;
      if (aIsFree) return 1;
      if (bIsFree) return -1;

      // Recommended plan (Growth) shows next
      const aIsRec = a.name === GROWTH_PLAN_NAME;
      const bIsRec = b.name === GROWTH_PLAN_NAME;
      if (aIsRec) return -1;
      if (bIsRec) return 1;

      return Number(a.price) - Number(b.price);
    });
  }, [plans, currentPlanName]);

  return (
    <s-page heading={t("heading")} inlineSize="large" {...{ "inline-size": "large" }}>
      <BackButton to="/app" label={t("dashboard")} />
      <SupportAction />

      <style>{`
        .pricing-container {
          width: 100%;
          max-width: 1400px;
          margin: 0 auto;
          padding: 0 32px;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        @media (max-width: 640px) {
          .pricing-container {
            padding: 0 16px;
          }
        }
        .pricing-cards-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          align-items: stretch;
          width: 100%;
          margin-top: 6px;
          margin-bottom: 16px;
        }
        @media (max-width: 1024px) {
          .pricing-cards-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (max-width: 640px) {
          .pricing-cards-grid {
            grid-template-columns: 1fr;
          }
        }
        .included-features-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          align-items: stretch;
          width: 100%;
        }
        @media (max-width: 1024px) {
          .included-features-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (max-width: 640px) {
          .included-features-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div className="pricing-container">

      <div style={{ marginBottom: "20px" }}>
        <h1
          style={{
            fontSize: "20px",
            fontWeight: 700,
            color: "var(--p-color-text, #202223)",
            margin: "0 0 6px 0",
            lineHeight: 1.3,
          }}
        >
          {t("heading")}
        </h1>
        <div
          style={{
            fontSize: "14px",
            color: "var(--p-color-text-subdued, #6d7175)",
            margin: 0,
            lineHeight: 1.4,
          }}
        >
          Choose a plan based on how many products you show in 3D. Every plan includes every feature.
        </div>
      </div>

      {/*
        Rendered as well as toasted. A toast is gone in seconds, and a refused
        charge is the one message on this page worth keeping on screen — its
        wording is usually the whole explanation, and a merchant needs to be
        able to read it twice or quote it to support.
      */}
      {actionData && !actionData.ok && "error" in actionData && actionData.error ? (
        <s-banner tone="critical" heading={t("changeFailed")}>
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-banner>
      ) : null}

      {promotionBanner && (!promotionBanner.dismissible || !bannerDismissed) ? (
        <s-banner
          tone={promotionBanner.tone || "success"}
          heading={promotionBanner.heading}
          dismissible={promotionBanner.dismissible ? true : undefined}
          onDismiss={promotionBanner.dismissible ? handleDismissBanner : undefined}
        >
          <s-paragraph>
            {promotionBanner.text}
          </s-paragraph>
          {promotionBanner.dismissible ? (
            <s-button
              slot="secondary-actions"
              onClick={handleDismissBanner}
            >
              Dismiss
            </s-button>
          ) : null}
        </s-banner>
      ) : null}

      <s-section>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Top row: Left details & Right stat tiles */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "24px",
              flexWrap: "wrap",
            }}
          >
            {/* Left Column */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                flex: "1 1 300px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <s-heading>{t("currentPlanHeading")}</s-heading>
                {subscriptionActive ? (
                  <s-badge tone="success">Active</s-badge>
                ) : (
                  <s-badge tone="neutral">{FREE_PLAN_NAME}</s-badge>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "10px",
                  marginTop: "4px",
                }}
              >
                <span
                  style={{
                    fontSize: "24px",
                    fontWeight: 700,
                    color: "var(--p-color-text, #202223)",
                    lineHeight: 1.2,
                  }}
                >
                  {currentPlan ? planTitle(tb, currentPlan) : "Free"}
                </span>
                <span
                  style={{
                    fontSize: "14px",
                    color: "var(--p-color-text-subdued, #6d7175)",
                  }}
                >
                  {subscriptionActive && Number(subscription?.price) > 0
                    ? `$${formatMoney(subscription.price)} ${
                        subscription?.interval === "ANNUAL"
                          ? "per year"
                          : "per month"
                      }`
                    : currentPrice > 0
                    ? `$${formatMoney(currentPrice)} per month`
                    : "Free"}
                </span>
              </div>

              <div
                style={{
                  fontSize: "14px",
                  color: "var(--p-color-text-subdued, #6d7175)",
                  marginTop: "2px",
                  lineHeight: 1.4,
                }}
              >
                {isUnlimited(currentPlan?.productLimit ?? 0)
                  ? "No limits on products or 3D models. Each product can have one model."
                  : `Up to ${limitText(currentPlan?.productLimit ?? 0)} products and ${limitText(currentPlan?.modelLimit ?? 0)} 3D models. Each product can have one model.`}
              </div>
            </div>

            {/* Right Column: Stat Cards */}
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
              <div
                style={{
                  border: "1px solid var(--p-color-border, #e1e3e5)",
                  borderRadius: "8px",
                  padding: "14px 18px",
                  minWidth: "150px",
                  backgroundColor: "var(--p-color-bg-surface, #ffffff)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                <div
                  style={{
                    fontSize: "13px",
                    color: "var(--p-color-text-subdued, #6d7175)",
                    lineHeight: 1.3,
                  }}
                >
                  Products with a 3D model
                </div>
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: 700,
                    color: "var(--p-color-text, #202223)",
                    lineHeight: 1.2,
                  }}
                >
                  {usage.products}
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--p-color-text-subdued, #6d7175)",
                  }}
                >
                  {isUnlimited(currentPlan?.productLimit ?? 0)
                    ? "No limit"
                    : `${currentPlan?.productLimit ?? 0} limit`}
                </div>
              </div>

              <div
                style={{
                  border: "1px solid var(--p-color-border, #e1e3e5)",
                  borderRadius: "8px",
                  padding: "14px 18px",
                  minWidth: "150px",
                  backgroundColor: "var(--p-color-bg-surface, #ffffff)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                <div
                  style={{
                    fontSize: "13px",
                    color: "var(--p-color-text-subdued, #6d7175)",
                    lineHeight: 1.3,
                  }}
                >
                  Models in your library
                </div>
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: 700,
                    color: "var(--p-color-text, #202223)",
                    lineHeight: 1.2,
                  }}
                >
                  {usage.models}
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--p-color-text-subdued, #6d7175)",
                  }}
                >
                  {isUnlimited(currentPlan?.modelLimit ?? 0)
                    ? "No limit"
                    : `${currentPlan?.modelLimit ?? 0} limit`}
                </div>
              </div>
            </div>
          </div>

          {/* Divider */}
          <s-divider />

          {/* Bottom row: Keep access notice & Cancel button */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "16px",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                fontSize: "13px",
                color: "var(--p-color-text-subdued, #6d7175)",
              }}
            >
              {t("keepAccess")}
            </div>

            {/* Cancel Button */}
            <button
              type="button"
              disabled={submitting}
              commandFor="cancel-subscription"
              command="--show"
              onClick={() => {
                const dialog = document.getElementById(
                  "cancel-subscription",
                ) as any;
                dialog?.showOverlay?.();
              }}
              style={{
                backgroundColor: "#ffffff",
                border: "1px solid #dcdcdc",
                color: "#bc2200",
                borderRadius: "8px",
                padding: "7px 16px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: submitting ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                boxSizing: "border-box",
                transition: "background 0.15s ease, border-color 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#fff8f8";
                e.currentTarget.style.borderColor = "#bc2200";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "#ffffff";
                e.currentTarget.style.borderColor = "#dcdcdc";
              }}
            >
              Cancel subscription
            </button>
          </div>
        </div>
      </s-section>

      {/* Recommendation Banner */}
      {suggestedPlan ? (
        <div
          style={{
            backgroundColor: "#edf5ff",
            border: "1px solid #cfe2fe",
            borderRadius: "12px",
            padding: "16px 20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "16px",
            flexWrap: "wrap",
            marginTop: "16px",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div
              style={{
                fontSize: "15px",
                fontWeight: 700,
                color: "#1a1a1a",
              }}
            >
              {suggestedPlan.name} fits your store and costs less
            </div>
            <div style={{ fontSize: "13px", color: "#4a4d50" }}>
              You use {usage.products} products and {usage.models} models.{" "}
              {suggestedPlan.name} includes up to{" "}
              {suggestedPlan.productLimit} of each and costs ${savings} less
              each month.
            </div>
          </div>

          <s-button
            variant="primary"
            loading={flag(submitting && pendingPlanId === suggestedPlan.id)}
            disabled={flag(submitting)}
            onClick={() => startSubscription(suggestedPlan.id)}
          >
            Switch to {suggestedPlan.name}
          </s-button>
        </div>
      ) : null}

      <ConfirmModal
        id="confirm-downgrade"
        open={downgradeTo !== null}
        heading={t("downgradeHeading", {
          plan: downgradeTo ? planTitle(tb, downgradeTo) : "",
        })}
        confirmLabel={t("switchAnyway")}
        cancelLabel={t("keepMyPlan")}
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
          {t("downgradeUsage", {
            products: tb("productCount", { count: usage.products }),
            models: tb("modelCount", { count: usage.models }),
            plan: downgradeTo ? planTitle(tb, downgradeTo) : "",
            productLimit: productsText(downgradeTo?.productLimit ?? 0),
            modelLimit: modelsText(downgradeTo?.modelLimit ?? 0),
          })}
        </s-paragraph>
        <s-paragraph>{t("downgradeOverLimit")}</s-paragraph>
      </ConfirmModal>

      <s-modal
        id="cancel-subscription"
        heading={t("cancelHeading")}
        accessibilityLabel={t("cancelHeading")}
      >
        <s-paragraph>
          {t("cancelBody", { plan: tb("planFree") })}
        </s-paragraph>
        {/*
          ModalAction, not a bare s-button with onClick: s-modal lifts its
          content into the browser's top layer, outside React 18's delegated
          root, so a JSX click handler in here never fires. See ModalAction.
        */}
        <ModalAction
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={submitting}
          onClick={cancelSubscription}
        >
          {t("cancelSubscription")}
        </ModalAction>
        <s-button
          slot="secondary-actions"
          commandFor="cancel-subscription"
          command="--hide"
        >
          {t("keepMyPlan")}
        </s-button>
      </s-modal>

      {/*
        A row of plan cards, laid out like Shopify's own pricing page: the plan
        name and its price share the top line, a one-line descriptor sits under
        the name, the action spans the card, and what you get is a list of rows
        separated by hairlines rather than bullets or ticks.

        auto-fit/minmax rather than a fixed `repeat(2, …)`: the plan count comes
        from the Plan table, so the track count follows the data. The floor is
        what sets how many fit — at 320px two tracks need 640px and three need
        960px, which is wider than the page, so the row settles at two.
        `min(100%, 320px)` lets a track shrink below the floor on a phone, so the
        cards stack rather than forcing a sideways scroll.
      */}
      {/*
        Billing period and coupon, on one line above the cards — not in a card
        of their own.

        They were a heading-less section, which is to say a card containing two
        controls and nothing to say what it was, sitting between the current
        plan and the plans themselves and pushing both apart. Shopify's own
        pricing page puts these controls loose above the cards for the same
        reason: they are settings *for* the grid below, not content in their own
        right.

        The coupon field is width-capped. As a full-width field it ran the
        entire card for a code of about eight characters, which read as the most
        important input on a page whose purpose is choosing a plan.
      */}
      {/* Billing Cycle Toggle & Optional Coupon */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          margin: "28px 0 6px 0",
          gap: "12px",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "inline-grid",
            gridTemplateColumns: "1fr 1fr",
            backgroundColor: "#ebecef",
            padding: "4px",
            borderRadius: "12px",
            border: "1px solid #dfe1e5",
            userSelect: "none",
            boxSizing: "border-box",
          }}
        >
          {/* Smooth sliding indicator */}
          <div
            style={{
              position: "absolute",
              top: "4px",
              bottom: "4px",
              left: "4px",
              width: "calc(50% - 4px)",
              backgroundColor: "#ffffff",
              borderRadius: "8px",
              boxShadow:
                "0 2px 8px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)",
              transform: yearly ? "translateX(100%)" : "translateX(0%)",
              transition: "transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)",
              pointerEvents: "none",
            }}
          />
          <button
            type="button"
            aria-pressed={!yearly}
            onClick={() => setYearly(false)}
            style={{
              position: "relative",
              zIndex: 1,
              padding: "8px 22px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: !yearly ? 600 : 500,
              backgroundColor: "transparent",
              color: !yearly ? "#202223" : "#6d7175",
              border: "none",
              cursor: "pointer",
              transition: "color 0.2s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              whiteSpace: "nowrap",
            }}
          >
            Monthly billing
          </button>
          <button
            type="button"
            aria-pressed={yearly}
            onClick={() => setYearly(true)}
            style={{
              position: "relative",
              zIndex: 1,
              padding: "8px 22px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: yearly ? 600 : 500,
              backgroundColor: "transparent",
              color: yearly ? "#202223" : "#6d7175",
              border: "none",
              cursor: "pointer",
              transition: "color 0.2s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              whiteSpace: "nowrap",
            }}
          >
            <span>Yearly billing</span>
            <span
              style={{
                backgroundColor: "#e4f8ed",
                color: "#108043",
                fontSize: "11px",
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: "9999px",
                lineHeight: "14px",
                letterSpacing: "0.2px",
              }}
            >
              Save 17%
            </span>
          </button>
        </div>

        {/* Have coupon toggle */}
        {!coupon && !couponOpen ? (
          <button
            type="button"
            onClick={() => setCouponOpen(true)}
            style={{
              background: "none",
              border: "none",
              color: "#005bd3",
              fontSize: "13px",
              cursor: "pointer",
              textDecoration: "underline",
              padding: "4px",
            }}
          >
            {t("haveCoupon")}
          </button>
        ) : null}

        {couponOpen ? (
          <div
            style={{
              maxWidth: "460px",
              width: "100%",
              margin: "6px auto 0 auto",
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (couponInput.trim()) applyCoupon();
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "8px",
                alignItems: "center",
              }}
            >
              <input
                type="text"
                aria-label={t("couponPlaceholder")}
                aria-invalid={couponError ? true : undefined}
                aria-describedby={couponError ? "coupon-error" : undefined}
                placeholder={t("couponPlaceholder")}
                value={couponInput}
                onChange={(e) => {
                  setCouponInput(e.target.value);
                  setCouponError(null);
                }}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: couponError
                    ? "1px solid #d82c0d"
                    : "1px solid #8a8a8a",
                  fontSize: "13px",
                  backgroundColor: "#ffffff",
                  color: "#202223",
                }}
              />
              <button
                type="button"
                disabled={!couponInput.trim() || couponCheck.state !== "idle"}
                onClick={applyCoupon}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#202223",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: !couponInput.trim() ? "not-allowed" : "pointer",
                  opacity: !couponInput.trim() ? 0.6 : 1,
                }}
              >
                {t("apply")}
              </button>
              <button
                type="button"
                aria-label={tc("close")}
                onClick={() => {
                  setCouponOpen(false);
                  setCouponInput("");
                  setCouponError(null);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#6d7175",
                  fontSize: "18px",
                  cursor: "pointer",
                  padding: "4px 8px",
                }}
              >
                ✕
              </button>
            </div>
            {couponError ? (
              <div
                id="coupon-error"
                role="alert"
                style={{
                  color: "#d82c0d",
                  fontSize: "12px",
                  marginTop: "4px",
                }}
              >
                {couponError}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/*
        One banner for whichever discount is in force.

        The launch offer gets no Remove button — there is nothing to remove,
        since no code was entered and declining a discount is not a thing anyone
        wants to do. An entered coupon keeps it, because clearing the field is
        the only way back to the list price once a code has been applied.
      */}
      {appliedDiscount ? (
        <s-banner
          tone="success"
          heading={
            showingAutoApply
              ? `🎉 Special Promotion: ${Math.round(appliedDiscount.percentage * 100)}% Discount Auto-Applied!`
              : showingLaunchOffer
              ? t("launchOfferHeading", {
                  percent: LAUNCH_OFFER_PERCENT_LABEL,
                  date: offerEnds,
                })
              : t("couponApplied", { code: appliedDiscount.code })
          }
        >
          <s-paragraph>
            {showingAutoApply
              ? `Coupon ${appliedDiscount.code} has been automatically applied to your subscription: ${appliedDiscount.description}`
              : appliedDiscount.description}
          </s-paragraph>
          {showingLaunchOffer ? null : (
            <s-button
              slot="secondary-actions"
              onClick={() => {
                setCoupon(null);
                setCouponInput("");
                setCouponError(null);
              }}
            >
              {tc("remove")}
            </s-button>
          )}
        </s-banner>
      ) : null}

      {/*
        A row of plan cards, laid out like Shopify's own pricing page: the plan
        name and its price share the top line, a one-line descriptor sits under
        the name, the action spans the card, and what you get is a list of rows
        separated by hairlines rather than bullets or ticks.

        One column on a phone, two on a tablet, and the whole row on a single
        line on a desktop — see .plan-grid in critical.css for why that is a
        stylesheet class and not s-grid's track sizing. The plan count comes from
        the Plan table, so it is handed to CSS as a custom property rather than
        being baked into the rule.
      */}

      <div className="pricing-cards-grid">
        {sortedPlans.map((plan) => {
          const isActive = plan.name === currentPlanName;
          const isPaid = Number(plan.price) > 0;
          const isPopular = plan.name === GROWTH_PLAN_NAME;
          const isCurrentPlanActive =
            isActive &&
            (!isPaid ||
              (subscription?.interval === "ANNUAL" ? yearly : !yearly));

          const listPrice = yearly
            ? annualPrice(plan.price)
            : Number(plan.price);

          const discountPlans = (
            appliedDiscount as { applicablePlans?: string[] } | null
          )?.applicablePlans;
          const hasDiscount = isPaid && Boolean(appliedDiscount) && (
            !discountPlans ||
            discountPlans.length === 0 ||
            discountPlans.includes(plan.name)
          );

          const discountPct = hasDiscount ? appliedDiscount!.percentage : 0;
          const payPrice = hasDiscount
            ? Math.round(listPrice * (1 - discountPct) * 100) / 100
            : listPrice;

          const durationCycles = appliedDiscount?.durationLimitInIntervals;
          const isLifetime = durationCycles === null || durationCycles === undefined;

          const tooSmall =
            (!isUnlimited(plan.productLimit) &&
              plan.productLimit < usage.products) ||
            (!isUnlimited(plan.modelLimit) && plan.modelLimit < usage.models);

          const excessProducts = Math.max(0, usage.products - plan.productLimit);
          const excessModels = Math.max(0, usage.models - plan.modelLimit);
          let warningText = "";
          if (excessProducts > 0 && excessModels > 0) {
            warningText = `Remove ${excessProducts} products and ${excessModels} models to switch.`;
          } else if (excessProducts > 0) {
            warningText = `Remove ${excessProducts} products to switch.`;
          } else if (excessModels > 0) {
            warningText = `Remove ${excessModels} models to switch.`;
          }

          return (
            <div
              key={plan.id}
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "12px",
                padding: "24px 20px",
                display: "flex",
                flexDirection: "column",
                border: isCurrentPlanActive
                  ? "2px solid #202223"
                  : isPopular
                  ? "2px solid #005bd3"
                  : "1px solid #e1e3e5",
                boxShadow:
                  isPopular || isCurrentPlanActive
                    ? "0 4px 12px rgba(0, 0, 0, 0.05)"
                    : "none",
                position: "relative",
                height: "100%",
                boxSizing: "border-box",
              }}
            >
              {/* Badge Area */}
              <div style={{ minHeight: "26px", marginBottom: "8px" }}>
                {isCurrentPlanActive ? (
                  <span
                    style={{
                      display: "inline-block",
                      backgroundColor: "#e4f8ed",
                      color: "#108043",
                      fontSize: "12px",
                      fontWeight: 600,
                      padding: "3px 10px",
                      borderRadius: "9999px",
                      lineHeight: "16px",
                    }}
                  >
                    Current plan
                  </span>
                ) : isPopular ? (
                  <span
                    style={{
                      display: "inline-block",
                      backgroundColor: "#e0f2fe",
                      color: "#005bd3",
                      fontSize: "12px",
                      fontWeight: 600,
                      padding: "3px 10px",
                      borderRadius: "9999px",
                      lineHeight: "16px",
                    }}
                  >
                    Recommended
                  </span>
                ) : null}
              </div>

              {/* Title & Price */}
              <div
                style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  color: "#202223",
                  lineHeight: "1.2",
                }}
              >
                {planTitle(tb, plan)}
              </div>

              {/* Price Container */}
              <div style={{ margin: "10px 0 4px 0" }}>
                {hasDiscount ? (
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: "8px",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "30px",
                          fontWeight: 800,
                          color: "#108043",
                          lineHeight: "1",
                        }}
                      >
                        ${formatMoney(payPrice)}
                      </span>
                      <span
                        style={{
                          fontSize: "18px",
                          fontWeight: 600,
                          color: "#8c9196",
                          textDecoration: "line-through",
                          lineHeight: "1",
                        }}
                        title="Regular price before discount"
                      >
                        ${formatMoney(listPrice)}
                      </span>
                      <span
                        style={{
                          backgroundColor: "#dcfce7",
                          color: "#15803d",
                          fontSize: "12px",
                          fontWeight: 700,
                          padding: "3px 8px",
                          borderRadius: "12px",
                          border: "1px solid #86efac",
                          lineHeight: "1",
                        }}
                      >
                        {Math.round(discountPct * 100)}% OFF
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "13px",
                        color: "#6d7175",
                        marginTop: "4px",
                      }}
                    >
                      {yearly ? "billed annually" : "billed every 30 days"}
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: "6px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "28px",
                        fontWeight: 800,
                        color: "#202223",
                        lineHeight: "1",
                      }}
                    >
                      ${formatMoney(isPaid ? listPrice : 0)}
                    </span>
                    <span
                      style={{
                        fontSize: "13px",
                        color: "#6d7175",
                      }}
                    >
                      {isPaid && yearly ? "per year" : isPaid ? "per month" : ""}
                    </span>
                  </div>
                )}
              </div>

              {/* Sub-price breakdown */}
              <div
                style={{
                  minHeight: "18px",
                  marginBottom: hasDiscount ? "8px" : "14px",
                  fontSize: "12px",
                }}
              >
                {isPaid && yearly ? (
                  <span style={{ color: "#108043", fontWeight: 600 }}>
                    ${formatMoney(payPrice / 12)}/mo • {hasDiscount ? `Includes ${Math.round(discountPct * 100)}% coupon discount + annual savings` : "Save 17%"}
                  </span>
                ) : isPaid && !hasDiscount ? (
                  <span style={{ color: "#6d7175" }}>
                    Billed every 30 days
                  </span>
                ) : !isPaid ? (
                  <span style={{ color: "#6d7175" }}>Free forever</span>
                ) : null}
              </div>

              {/* Discount Duration Breakdown Banner */}
              {hasDiscount ? (
                <div
                  style={{
                    backgroundColor: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    marginBottom: "14px",
                    fontSize: "12px",
                    lineHeight: "1.35",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      color: "#166534",
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      marginBottom: "3px",
                    }}
                  >
                    <span>{isLifetime ? "♾️" : "⏳"}</span>
                    <span>
                      {isLifetime
                        ? "Lifetime Recurring Discount"
                        : durationCycles === 1
                        ? `1 Billing Cycle (${yearly ? "1 Year" : "1 Month"})`
                        : `${durationCycles} Billing Cycles (${durationCycles} ${yearly ? "Years" : "Months"})`}
                    </span>
                  </div>
                  <div style={{ color: "#15803d" }}>
                    {isLifetime ? (
                      <>
                        Discount applies to <strong>every recurring charge</strong> (${formatMoney(payPrice)}/{yearly ? "yr" : "mo"}) for as long as your subscription stays active.
                      </>
                    ) : durationCycles === 1 ? (
                      <>
                        Pay <strong>${formatMoney(payPrice)}</strong> for the <strong>1st {yearly ? "year" : "month"}</strong> (1 charge), then renews at regular price of <strong>${formatMoney(listPrice)}/{yearly ? "yr" : "mo"}</strong>.
                      </>
                    ) : (
                      <>
                        Pay <strong>${formatMoney(payPrice)}/{yearly ? "yr" : "mo"}</strong> for the <strong>first ${durationCycles} {yearly ? "years" : "months"}</strong> (${durationCycles} charges), then renews at regular price of <strong>${formatMoney(listPrice)}/{yearly ? "yr" : "mo"}</strong>.
                      </>
                    )}
                  </div>
                </div>
              ) : null}

              {/* Features List */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  marginBottom: "20px",
                  fontSize: "13px",
                  color: "#202223",
                  lineHeight: "1.4",
                }}
              >
                {[
                  {
                    boldPrefix: isUnlimited(plan.productLimit)
                      ? "Unlimited"
                      : `${plan.productLimit}`,
                    boldSuffix: "products with a 3D model",
                  },
                  {
                    boldPrefix: isUnlimited(plan.modelLimit)
                      ? "Unlimited"
                      : `${plan.modelLimit}`,
                    boldSuffix: "models in your library",
                  },
                  { label: "1 model per product" },
                  { label: "GLB & glTF models (up to 20 MB)" },
                  { label: "Augmented reality (iOS & Android AR)" },
                  { label: "Theme app blocks & embed snippet" },
                  { label: "Full viewer controls & studio lighting" },
                  { label: "Animation playback & material variants" },
                  {
                    label:
                      plan.name === ADVANCE_PLAN_NAME
                        ? "Premium priority support"
                        : plan.name === FREE_PLAN_NAME
                        ? "Standard email support"
                        : "Priority email support",
                  },
                ].map((feat, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "8px",
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      style={{ flexShrink: 0, marginTop: "2px" }}
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
                    <span>
                      {feat.boldPrefix ? (
                        <>
                          <strong>{feat.boldPrefix}</strong> {feat.boldSuffix}
                        </>
                      ) : (
                        feat.label
                      )}
                    </span>
                  </div>
                ))}
              </div>

              {/* Notice / Warning / Savings Box */}
              <div
                style={{
                  marginTop: "auto",
                  marginBottom: "18px",
                  minHeight: "52px",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {hasDiscount && !isActive && !tooSmall ? (
                  <div
                    style={{
                      backgroundColor: "#dcfce7",
                      color: "#166534",
                      borderRadius: "8px",
                      padding: "10px 12px",
                      fontSize: "13px",
                      fontWeight: 600,
                      lineHeight: "1.3",
                      width: "100%",
                      boxSizing: "border-box",
                    }}
                  >
                    🎉 Coupon applied! You save ${formatMoney(listPrice - payPrice)} {yearly ? "this year" : "every month"}.
                  </div>
                ) : isPopular &&
                !isActive &&
                currentPrice > Number(plan.price) &&
                !tooSmall ? (
                  <div
                    style={{
                      backgroundColor: "#dcfce7",
                      color: "#166534",
                      borderRadius: "8px",
                      padding: "10px 12px",
                      fontSize: "13px",
                      fontWeight: 500,
                      lineHeight: "1.3",
                      width: "100%",
                      boxSizing: "border-box",
                    }}
                  >
                    Fits your store. Save ${savings} a month.
                  </div>
                ) : tooSmall && !isActive ? (
                  <div
                    style={{
                      backgroundColor: "#fef3c7",
                      color: "#92400e",
                      borderRadius: "8px",
                      padding: "10px 12px",
                      fontSize: "13px",
                      fontWeight: 500,
                      lineHeight: "1.3",
                      width: "100%",
                      boxSizing: "border-box",
                    }}
                  >
                    {warningText}
                  </div>
                ) : null}
              </div>

              {/* Action Button */}
              {isCurrentPlanActive ? (
                hasDiscount && !showingLaunchOffer ? (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => startSubscription(plan.id)}
                    style={{
                      width: "100%",
                      padding: "10px 16px",
                      borderRadius: "8px",
                      border: "1px solid #16a34a",
                      background: "#f0fdf4",
                      color: "#15803d",
                      fontWeight: 700,
                      fontSize: "14px",
                      cursor: submitting ? "not-allowed" : "pointer",
                      boxSizing: "border-box",
                      transition: "all 0.15s ease",
                    }}
                  >
                    Apply {Math.round(discountPct * 100)}% Discount to Current Plan
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    style={{
                      width: "100%",
                      padding: "10px 16px",
                      borderRadius: "8px",
                      border: "1px solid #e1e3e5",
                      background: "#f1f2f3",
                      color: "#8c9196",
                      fontWeight: 600,
                      fontSize: "14px",
                      cursor: "default",
                      boxSizing: "border-box",
                    }}
                  >
                    Your current plan
                  </button>
                )
              ) : isPopular ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() =>
                    tooSmall
                      ? setDowngradeTo(plan)
                      : startSubscription(plan.id)
                  }
                  style={{
                    width: "100%",
                    padding: "10px 16px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#202223",
                    color: "#ffffff",
                    fontWeight: 600,
                    fontSize: "14px",
                    cursor: submitting ? "not-allowed" : "pointer",
                    opacity: submitting ? 0.7 : 1,
                    boxSizing: "border-box",
                    transition: "background 0.15s ease",
                  }}
                >
                  {plan.name === currentPlanName && isPaid
                    ? yearly
                      ? "Switch to Yearly"
                      : "Switch to Monthly"
                    : hasDiscount
                    ? `Switch to ${plan.name} (${Math.round(discountPct * 100)}% OFF)`
                    : `Switch to ${plan.name}`}
                </button>
              ) : (
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
                    padding: "10px 16px",
                    borderRadius: "8px",
                    border: hasDiscount ? "1px solid #16a34a" : "1px solid #dcdcdc",
                    background: hasDiscount ? "#f0fdf4" : "#ffffff",
                    color: hasDiscount ? "#15803d" : "#202223",
                    fontWeight: 600,
                    fontSize: "14px",
                    cursor: submitting ? "not-allowed" : "pointer",
                    opacity: submitting ? 0.7 : 1,
                    boxSizing: "border-box",
                    transition:
                      "background 0.15s ease, border-color 0.15s ease",
                  }}
                >
                  {isPaid
                    ? hasDiscount
                      ? `Switch to ${plan.name} (${Math.round(discountPct * 100)}% OFF)`
                      : `Switch to ${plan.name}`
                    : "Downgrade to Free"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Row Below Cards */}
      <div
        style={{
          marginTop: "16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div style={{ fontSize: "13px", color: "#6d7175" }}>
          Starter and Growth include a 7-day free trial and priority email support. Advance includes premium priority support.
        </div>
        <Link
          to="/app/pricing/compare"
          style={{
            color: "#005bd3",
            fontSize: "13px",
            fontWeight: 600,
            textDecoration: "none",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          Compare plan details
        </Link>
      </div>

      {/* "Included in every plan" section */}
      <div style={{ marginTop: "40px", marginBottom: "40px" }}>
        <div style={{ marginBottom: "20px" }}>
          <h2
            style={{
              fontSize: "18px",
              fontWeight: 700,
              color: "#202223",
              margin: "0 0 6px 0",
              lineHeight: 1.3,
            }}
          >
            Included in every plan
          </h2>
          <div
            style={{
              fontSize: "14px",
              color: "#6d7175",
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            Every feature is on every plan, including Free. Plans only differ by how many products and models you can show.
          </div>
        </div>

        <div className="included-features-grid">
          {INCLUDED_PLAN_CARDS.map((feat, idx) => (
            <div
              key={idx}
              style={{
                backgroundColor: "#ffffff",
                border: "1px solid #e1e3e5",
                borderRadius: "12px",
                padding: "20px",
                display: "flex",
                flexDirection: "column",
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "8px",
                  backgroundColor: "#f6f6f7",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#202223",
                  marginBottom: "14px",
                }}
              >
                {feat.icon}
              </div>

              <div
                style={{
                  fontSize: "15px",
                  fontWeight: 700,
                  color: "#202223",
                  marginBottom: "8px",
                  lineHeight: 1.3,
                }}
              >
                {feat.title}
              </div>

              <div
                style={{
                  fontSize: "13px",
                  color: "#6d7175",
                  lineHeight: 1.45,
                  marginBottom: "18px",
                }}
              >
                {feat.description}
              </div>

              <div style={{ marginTop: "auto" }}>
                <Link
                  to={feat.href}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    borderRadius: "8px",
                    border: "1px solid #dcdcdc",
                    backgroundColor: "#ffffff",
                    color: "#202223",
                    fontSize: "13px",
                    fontWeight: 600,
                    textDecoration: "none",
                    boxSizing: "border-box",
                    transition:
                      "background 0.15s ease, border-color 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#f6f6f7";
                    e.currentTarget.style.borderColor = "#c9cccf";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "#ffffff";
                    e.currentTarget.style.borderColor = "#dcdcdc";
                  }}
                >
                  Learn more
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M3.5 2.5H9.5V8.5M9.5 2.5L2.5 9.5"
                      stroke="#5c5f62"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Link>
              </div>
            </div>
          ))}
        </div>

        {/* Footer Support Row */}
        <div
          style={{
            marginTop: "24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
            paddingTop: "8px",
          }}
        >
          <div style={{ fontSize: "14px", color: "#6d7175" }}>
            Not sure which plan to choose? We can help.
          </div>
          <button
            type="button"
            commandFor={SUPPORT_FORM_ID}
            command="--show"
            style={{
              background: "none",
              border: "none",
              color: "#005bd3",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              padding: 0,
              textDecoration: "none",
            }}
          >
            Contact support
          </button>
        </div>
      </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
