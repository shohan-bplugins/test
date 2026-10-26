import { Fragment, useEffect, useState, type CSSProperties } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
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
import { couponToDiscount, findCoupon } from "~/lib/coupons.server";
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
import { SupportAction } from "~/components/SupportAction";
import {
  BUTTON_FILL,
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
  /**
   * Whether the launch discount is still open, decided on the server so the
   * server render and the hydration agree on it. A `launchOfferActive()` call
   * inside the component tree would be evaluated twice, and around the deadline
   * the two answers would differ — which React reports as a hydration mismatch.
   *
   * Only ever what is *displayed*. What the merchant is actually charged is
   * decided by the `subscribe` action below, at the moment the charge is
   * created, so a page left open across the deadline cannot buy a stale price.
   */
  offerActive: boolean;
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
    const coupon = findCoupon(String(form.get("coupon") ?? ""));
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

  if (intent === "subscribe") {
    const planId = String(form.get("planId") ?? "");
    const yearly = String(form.get("interval") ?? "") === "yearly";
    // Re-checked here, never trusted from the form: the browser sends a code,
    // not a discount, so an invented code buys nothing.
    const coupon = findCoupon(String(form.get("coupon") ?? ""));
    const plan = await getPlanById(planId);
    if (!plan) return { ok: false, error: t("planNotFound") };

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

    // await prisma.appUser.update({
    //   where: { id: user.id },
    //   data: { planId: plan.id },
    // });

    // Where Shopify sends the merchant after they approve or decline the
    // charge. Must be an absolute admin URL built from the app's *handle* — the
    // literal "3d-viewer-15" that used to sit here was a dev app's handle, so
    // every approval in production would have landed on an admin 404.
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

  if (intent === "cancel") {
    /*
     * Which subscription to cancel comes from Shopify, not from `user.chargeId`.
     *
     * That column is only ever written by the billing return page and the
     * subscriptions_update webhook, so it is null for any shop whose charge was
     * approved outside that path (a webhook that failed, a subscription started
     * from the admin, a reset database). The page itself reads
     * `currentAppInstallation.activeSubscriptions`, so it would show an active
     * plan and a Cancel button while this branch refused with "No active
     * subscription" — the plan was uncancellable from inside the app.
     *
     * Read live rather than through the cache: a stale "no subscription" answer
     * here would refuse a cancel the merchant is entitled to.
     */
    const live = await fetchActiveSubscription(admin);
    const subscriptionGid =
      live?.id ||
      (user.chargeId ? `gid://shopify/AppSubscription/${user.chargeId}` : "");
    if (!subscriptionGid) {
      return { ok: false, error: t("noActiveSubscription") };
    }
    // The numeric half, for the local Charge rows, which are keyed by it.
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

    const freePlan = await getPlanByName(FREE_PLAN_NAME);
    await prisma.appUser.update({
      where: { id: user.id },
      data: {
        planId: freePlan?.id ?? null,
        // Cleared alongside the plan, the way the subscriptions_update webhook
        // clears it — leaving the id of a cancelled charge behind is what makes
        // this column untrustworthy in the first place.
        chargeId: null,
        modelLimit: freePlan?.modelLimit ?? FREE_MODEL_LIMIT,
        productLimit: freePlan?.productLimit ?? FREE_PRODUCT_LIMIT,
      },
    });

    invalidateSubscription(shop);
    return { ok: true, cancelled: true };
  }

  return { ok: false, error: t("unknownIntent") };
};

/**
 * What the app does, stated once. None of this is gated by plan — a plan only
 * buys volume — so it belongs in a shared band rather than repeated down four
 * feature lists where it would read as a per-tier upsell.
 */
/*
 * Yearly billing and coupon codes, both switched off in the UI.
 *
 * A flag rather than commented-out JSX: the block carries JSX comments of its
 * own and those do not nest, so commenting it out would mean mangling the
 * comment markers inside it — exactly the kind of edit that does not survive
 * being put back. Flipping this to `true` restores the row intact.
 *
 * Only the controls are hidden; the server side of both features is untouched.
 * `subscribe` still reads `interval` and `coupon` from the form and the
 * `validate_coupon` intent still answers, so nothing has to be rebuilt to turn
 * them back on. With the row gone `yearly` stays false and `coupon` stays null,
 * so every card quotes the monthly price at full rate and the applied-coupon
 * banner further down can never render.
 */
const SHOW_BILLING_OPTIONS = false;

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
  const { plans, subscription, currentPlanName, usage, offerActive } =
    useLoaderData<typeof loader>();
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
    } else if (actionData && !actionData.ok && actionData.error) {
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
  const [yearly, setYearly] = useState(false);
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
  /** The code once the server has confirmed it, with what it is worth. */
  const [coupon, setCoupon] = useState<{
    code: string;
    description: string;
    percentage: number;
    durationLimitInIntervals: number | null;
  } | null>(null);

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
   * The ordering mirrors the `subscribe` action exactly — whichever takes more
   * off wins, ties to the launch offer, and nothing applies on a yearly charge.
   * If these two disagreed, the card would quote a price the charge did not
   * honour.
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
  const appliedDiscount =
    launchDiscount &&
    (!coupon || coupon.percentage <= launchDiscount.percentage)
      ? launchDiscount
      : coupon;
  /** True when the price shown is the launch offer rather than a typed code. */
  const showingLaunchOffer = appliedDiscount === launchDiscount;

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
    if (coupon) fd.set("coupon", coupon.code);
    submit(fd, { method: "post" });
  }

  function cancelSubscription() {
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

  return (
    <s-page heading={t("heading")}>
      <BackButton to="/app" label={t("dashboard")} />
      <SupportAction />

      {/*
        Rendered as well as toasted. A toast is gone in seconds, and a refused
        charge is the one message on this page worth keeping on screen — its
        wording is usually the whole explanation, and a merchant needs to be
        able to read it twice or quote it to support.
      */}
      {actionData && !actionData.ok && actionData.error ? (
        <s-banner tone="critical" heading={t("changeFailed")}>
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading={t("currentPlanHeading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{currentDescription}</s-paragraph>

          {/*
            What the shop is using, stated plainly. Comparing plans is guesswork
            without it — every card quotes a limit, and nothing on the page said
            how much of the current one was already spent.
          */}
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge
              tone={
                currentPlan &&
                !isUnlimited(currentPlan.productLimit) &&
                usage.products >= currentPlan.productLimit
                  ? "warning"
                  : "neutral"
              }
            >
              {t("productsInUse", {
                used: usage.products,
                limit: limitText(currentPlan?.productLimit ?? 0),
              })}
            </s-badge>
            <s-badge
              tone={
                currentPlan &&
                !isUnlimited(currentPlan.modelLimit) &&
                usage.models >= currentPlan.modelLimit
                  ? "warning"
                  : "neutral"
              }
            >
              {t("modelsInUse", {
                used: usage.models,
                limit: limitText(currentPlan?.modelLimit ?? 0),
              })}
            </s-badge>
          </s-stack>

          {/*
            Cancelling sits in the section body, not its primary-action slot.
            That slot is where a merchant's eye goes first, and pointing it at
            the one irreversible action on the page — on a page whose purpose is
            choosing a plan — was exactly backwards. It is only rendered while
            there is a subscription to cancel, rather than shown permanently
            disabled on the free plan.

            The confirmation opens declaratively with command/commandFor: React
            18 stringifies every value it sets on a custom element, so a boolean
            `open` would render open="false" and pin the dialog open.
          */}
          {subscriptionActive ? (
            <s-stack direction="block" gap="small-500">
              <s-text color="subdued">
                {t("keepAccess")}
              </s-text>
              <s-stack direction="inline" gap="small">
                <s-button
                  variant="secondary"
                  tone="critical"
                  disabled={flag(submitting)}
                  commandFor="cancel-subscription"
                  command="--show"
                >
                  {t("cancelSubscription")}
                </s-button>
              </s-stack>
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>

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
          if (downgradeTo) startSubscription(downgradeTo.id);
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
      {SHOW_BILLING_OPTIONS ? (
        <div style={{ marginBottom: "18px", marginTop: "28px" }}>
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 260px), 1fr))"
            gap="base"
            alignItems="center"
            inlineSize="100%"
          >
            <s-switch
              label={t("payYearly", { count: 12 - ANNUAL_MONTHS_CHARGED })}
              checked={flag(yearly)}
              onInput={(e) => setYearly(fieldChecked(e))}
            />

            {/*
          Revealed on request, not always on show. A permanently visible coupon
          field asks every merchant about a code most of them do not have, and
          it competes for the header with the billing period — which everyone
          uses. Behind a link it costs nothing until it is wanted, and when it
          is wanted it gets enough width to show what is being typed.
        */}

            {couponOpen ? (
              /*
            The cap is on the whole control, and the Apply and dismiss buttons
            take a fixed share of it — so the input is what grows when this
            number does, to roughly 560px here.

            Still a max rather than a fixed width: it shrinks to fit a phone,
            where this row stacks under the billing switch.
          */

              <s-box maxInlineSize="680px">
                {/*
              The Enter handler sits on a plain wrapper, not on the field.
              `keydown` bubbles, so it still catches the key pressed inside the
              input — but s-text-field's React binding does not declare
              onKeyDown, and a div is a cheaper way through that than casting
              the prop past the type.
            */}
                <div
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    if (couponInput.trim()) applyCoupon();
                  }}
                >
                  <s-grid
                    gridTemplateColumns="1fr auto auto"
                    gap="small"
                    alignItems="end"
                    inlineSize="100%"
                  >
                    <s-text-field
                      label={t("couponLabel")}
                      placeholder={t("couponPlaceholder")}
                      value={couponInput}
                      error={couponError ?? undefined}
                      onInput={(e) => {
                        setCouponInput(fieldValue(e));
                        setCouponError(null);
                      }}
                    />
                    <s-button
                      variant="primary"
                      loading={flag(couponCheck.state !== "idle")}
                      disabled={flag(!couponInput.trim())}
                      onClick={applyCoupon}
                    >
                      {t("apply")}
                    </s-button>
                    <s-button
                      variant="tertiary"
                      accessibilityLabel={t("couponDismiss")}
                      icon="x"
                      onClick={() => {
                        setCouponOpen(false);
                        setCouponInput("");
                        setCouponError(null);
                      }}
                    />
                  </s-grid>
                </div>
              </s-box>
            ) : coupon ? null : (
              <div className="align-end-from-tablet">
                <s-button
                  variant="tertiary"
                  onClick={() => setCouponOpen(true)}
                >
                  {t("haveCoupon")}
                </s-button>
              </div>
            )}
          </s-grid>
        </div>
      ) : null}

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
            showingLaunchOffer
              ? t("launchOfferHeading", {
                  percent: LAUNCH_OFFER_PERCENT_LABEL,
                  date: offerEnds,
                })
              : t("couponApplied", { code: appliedDiscount.code })
          }
        >
          <s-paragraph>{appliedDiscount.description}</s-paragraph>
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
      <div
        className="plan-grid"
        style={{ "--plan-count": plans.length } as CSSProperties}
      >
        {plans.map((plan) => {
          const isActive = plan.name === currentPlanName;
          const isPaid = Number(plan.price) > 0;
          const isPopular = plan.name === GROWTH_PLAN_NAME;
          const trialDays = Number(plan.trialDays ?? 0);
          const price = Number(plan.price);
          // Says what the button does, rather than assuming every move is up.
          const changeLabel =
            price > currentPrice
              ? tc("upgrade")
              : price < currentPrice
                ? t("downgrade")
                : t("switchToPlan");

          /*
           * What this plan costs, before and after any coupon.
           *
           * The discount is applied by Shopify on the charge itself, so this is
           * not an estimate — it is what the merchant will be billed. Rounded to
           * cents for the same reason annualPrice is: a percentage of a price is
           * rarely a clean number in binary floating point.
           */
          const listPrice = yearly
            ? annualPrice(plan.price)
            : Number(plan.price);
          const payPrice = appliedDiscount
            ? Math.round(listPrice * (1 - appliedDiscount.percentage) * 100) /
              100
            : listPrice;
          const discounted =
            isPaid && appliedDiscount !== null && payPrice < listPrice;

          /*
           * Would this plan fit what the shop already publishes? A plan below
           * current usage is still offered — a merchant may intend to trim —
           * but it says so, and it asks before it is applied.
           */
          /*
           * The one badge a card can carry. Current wins over Recommended: a
           * merchant already on the popular plan is told what they have, not
           * what to buy.
           */
          const badgeLabel = isActive
            ? t("badgeCurrent")
            : isPopular
              ? tb("recommended")
              : null;
          const badgeTone = isActive ? "success" : "info";

          const tooSmall =
            (!isUnlimited(plan.productLimit) &&
              plan.productLimit < usage.products) ||
            (!isUnlimited(plan.modelLimit) && plan.modelLimit < usage.models);

          /*
           * The plan's own feature copy, not a synthesized list.
           *
           * This used to prepend the limits — "15 products", "15 3D models" —
           * ahead of plan.features, which already states them in its own words
           * ("15 products with a 3D model", "15 models in your library"). Every
           * card therefore listed each limit twice, in two different phrasings,
           * which read as five entitlements where there are two.
           *
           * The derived lines survive only as a fallback, for a plan whose
           * feature copy has not been filled in — an empty card would be worse
           * than a terse one.
           */
          const includes = [
            ...(trialDays > 0 && !isActive
              ? [tb("trialDays", { count: trialDays })]
              : []),
            ...(plan.features.length > 0
              ? plan.features.map((f) => planFeature(tb, f))
              : [
                  productsText(plan.productLimit),
                  modelsText(plan.modelLimit),
                  tb("featureOneModelPerProduct"),
                ]),
          ];

          return (
            /*
              The card, in a positioned wrapper so the badge can sit astride its
              top border — half above the line, half below it.

              The wrapper exists because the badge has to be taken out of the
              card's flow to overlap its own edge, and `position: absolute`
              resolves against the nearest positioned ancestor. s-box takes no
              position prop, so a plain div supplies the containing block. It is
              also what carries the React key now, being the outermost element of
              the card.
            */
            <div
              key={plan.id}
              style={{ position: "relative", blockSize: "100%" }}
            >
              {badgeLabel ? (
                /*
                  `top: 0` puts the badge's own top edge on the card's border
                  line; translateY(-50%) then lifts it by half its height, so
                  exactly half hangs outside and half sits inside — without this
                  file needing to know how tall a badge is.

                  Left-aligned to the card's inline padding rather than centred,
                  which is where the badge sat on the line above the title before
                  it moved onto the border.
                */
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    insetInlineStart: "12px",
                    transform: "translateY(-50%)",
                    // Above the card's background and border, which are painted
                    // by the s-box below and would otherwise cross the badge.
                    zIndex: 1,
                  }}
                >
                  <s-badge tone={badgeTone}>{badgeLabel}</s-badge>
                </div>
              ) : null}

              <s-box
                /*
                  Every card the height of the tallest, so the row's bottom edges
                  line up however many features each plan lists.

                  Grid items stretch to their row by default, so the wrapper div
                  already fills the row — but the s-box inside it is a block
                  element sized by its own content, and stops short. Both halves
                  are needed: `blockSize: 100%` on the wrapper (which resolves
                  against the stretched grid area) and this on the card.
                */
                blockSize="100%"
                padding="small"
                /*
                  Extra room at the top, on every card and not only the badged
                  ones. The badge's lower half lands in this padding, and card
                  padding alone is shorter than half a badge, so without it the
                  badge would touch the plan name. Applying it everywhere keeps
                  the four titles on one line across the row.
                */
                paddingBlockStart="base"
                borderWidth="base"
                borderStyle="solid"
                borderColor={isActive || isPopular ? "strong" : "base"}
                borderRadius="large"
                background={isPopular && !isActive ? "subdued" : "base"}
              >
                <s-stack direction="block" gap="small">
                  <s-stack direction="block" gap="small-500">
                    {/*
                    Name and price on one line. `1fr auto` rather than a flex row
                    with space-between: the row has no spare width for
                    space-between to distribute, so the price would sit against
                    the name instead of at the card's edge.
                  */}
                    <s-grid
                      gridTemplateColumns="1fr auto"
                      gap="small"
                      alignItems="baseline"
                      inlineSize="100%"
                    >
                      <s-heading>{planTitle(tb, plan)}</s-heading>
                      <s-stack
                        direction="inline"
                        gap="small-500"
                        alignItems="baseline"
                      >
                        {/*
                        A plain span with an explicit size, and the only place
                        on this page that leaves the component set.

                        The price is the number a pricing card exists to
                        communicate and it should be the largest thing on the
                        card — but Polaris exposes no font size on s-text, so as
                        an s-text it rendered at body size, no bigger than the
                        feature rows beneath it. Colour and family are inherited
                        rather than declared, so it still follows the admin's
                        type and theme; only the scale is ours.
                      */}
                        {/*
                        The list price, struck through, when a coupon has
                        changed it. `type="redundant"` renders an <s> element —
                        the component set's own way of saying "no longer
                        applies" — so the discount is legible rather than the
                        price silently becoming a different number.
                      */}
                        {discounted ? (
                          <s-text type="redundant" color="subdued">
                            {`$${formatMoney(listPrice)}`}
                          </s-text>
                        ) : null}
                        <span
                          style={{
                            fontSize: "1.25rem",
                            fontWeight: 600,
                            lineHeight: 1.1,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {isPaid
                            ? `$${formatMoney(payPrice)}`
                            : formatPrice(plan, tb("free"))}
                        </span>
                        {isPaid ? (
                          <s-text color="subdued">
                            {yearly ? t("perYear") : t("perMonth")}
                          </s-text>
                        ) : null}
                      </s-stack>
                    </s-grid>

                    {/*
                    The badge that used to share this line now sits beside the
                    title, so this renders only when there is a description to
                    render — an empty stack would still occupy a row's gap.
                  */}
                    {plan.description ? (
                      <s-text color="subdued">
                        {planDescription(tb, plan)}
                      </s-text>
                    ) : null}

                    {isPaid && yearly ? (
                      <s-text color="subdued">
                        {t("worksOutAt", {
                          price: `$${formatMoney(payPrice / 12)}`,
                        })}
                      </s-text>
                    ) : null}
                    {/*
                    A discount that expires has to say so on the card. Without
                    it the price shown is the price for a few periods only, and
                    the merchant finds out when the bill changes.
                  */}
                    {discounted && appliedDiscount?.durationLimitInIntervals ? (
                      <s-text color="subdued">
                        {t(
                          yearly ? "discountForYears" : "discountForMonths",
                          {
                            count: appliedDiscount.durationLimitInIntervals,
                            price: `$${formatMoney(listPrice)}`,
                          },
                        )}
                      </s-text>
                    ) : null}
                    {tooSmall && !isActive ? (
                      <s-text tone="warning">
                        {t("belowUsage")}
                      </s-text>
                    ) : null}
                  </s-stack>

                  {/* Spans the card, as in the reference. */}
                  {isActive ? (
                    /*
                    The plan they are already on. Normally there is nothing to
                    do here, so the button is inert — but a coupon changes the
                    terms of this plan too, and re-subscribing is the only way
                    to take it up.

                    Without this the discount was unreachable for exactly the
                    people most likely to be given one: every other card offered
                    a repriced plan, while the card for the plan they actually
                    hold sat disabled saying "Current plan".

                    Entered codes only. The launch offer applies to itself
                    automatically at checkout, and a merchant who subscribed
                    after it opened already has it on their charge — so offering
                    them "Apply discount" would push them to replace a working
                    subscription to buy a discount they are already getting.
                    Nothing Shopify returns says whether a live subscription
                    carries a discount, so the safe reading is the one that does
                    not restart anyone's billing.
                  */
                    discounted && !showingLaunchOffer ? (
                      <s-button
                        {...BUTTON_FILL}
                        variant="primary"
                        loading={flag(submitting && pendingPlanId === plan.id)}
                        disabled={flag(submitting && pendingPlanId !== plan.id)}
                        onClick={() => startSubscription(plan.id)}
                      >
                        {t("applyDiscount")}
                      </s-button>
                    ) : (
                      <s-button {...BUTTON_FILL} disabled={flag(true)}>
                        {t("currentPlanButton")}
                      </s-button>
                    )
                  ) : isPaid ? (
                    <s-button
                      {...BUTTON_FILL}
                      variant={isPopular ? "primary" : "secondary"}
                      loading={flag(submitting && pendingPlanId === plan.id)}
                      disabled={flag(submitting && pendingPlanId !== plan.id)}
                      onClick={() =>
                        tooSmall
                          ? setDowngradeTo(plan)
                          : startSubscription(plan.id)
                      }
                    >
                      {changeLabel}
                    </s-button>
                  ) : (
                    /*
                    The free plan, while a paid subscription is running: this is
                    the only way down to it, so the card offers it rather than
                    sitting inert. It opens the same confirmation as "Cancel
                    subscription", because that is exactly what it does — the
                    two used to be the same action wearing different names, with
                    only one of them reachable from here.
                  */
                    <s-button
                      {...BUTTON_FILL}
                      variant="secondary"
                      disabled={flag(submitting)}
                      commandFor="cancel-subscription"
                      command="--show"
                    >
                      {t("downgradeTo", { plan: tb("planFree") })}
                    </s-button>
                  )}

                  {/*
                  Rows ruled between, not bulleted. A divider per row is what
                  makes these scan as a comparable list down the row of cards —
                  the same item sits at the same height in every card.
                */}
                  <s-stack direction="block" gap="none">
                    {includes.map((item, i) => (
                      <Fragment key={i}>
                        {i > 0 ? <s-divider /> : null}
                        <s-box paddingBlock="small-500">
                          <s-text>{item}</s-text>
                        </s-box>
                      </Fragment>
                    ))}
                  </s-stack>
                </s-stack>
              </s-box>
            </div>
          );
        })}
      </div>

      <div style={{ margin: "20px 0" }}>
        <s-section heading={t("includedHeading")}>
          <s-paragraph color="subdued">{t("includedBody")}</s-paragraph>

          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 240px), 1fr))"
            gap="base"
          >
            {INCLUDED_FEATURES.map((f) => (
              <s-stack
                key={f.title}
                direction="inline"
                gap="small"
                alignItems="start"
              >
                <s-icon type={f.icon as any} tone="info" />
                <s-stack direction="block" gap="small-500">
                  <s-text type="strong">{t(f.title)}</s-text>
                  <s-text color="subdued">
                    {t(f.body, { size: MAX_MODEL_FILE_SIZE_MB })}
                  </s-text>
                </s-stack>
              </s-stack>
            ))}
          </s-grid>
        </s-section>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
