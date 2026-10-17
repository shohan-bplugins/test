import prisma from "../db.server";
import { FREE_PLAN_NAME, FREE_PLAN_CREDITS } from "./planLimits";

/**
 * One place that decides what a shop's billing row should look like for a
 * given Shopify subscription status.
 *
 * Three different code paths used to answer that question, and they disagreed:
 *
 *   - `app.SuccessBilling` wrote `cardits` on activation, by hardcoded plan
 *     name ("Pro" / "Pro Plus"), and never touched `planId`.
 *   - `app.pricing`'s in-app cancel wrote `cardits` and one `Charges.status`,
 *     but left `planId` on the paid plan and `chargeId` on the dead charge.
 *   - The `app_subscriptions/update` webhook wrote nothing at all, so a
 *     cancellation made from the Shopify admin — or a frozen/expired/declined
 *     subscription — never reached the database and the shop kept its Pro
 *     credits indefinitely.
 *
 * `cardits` is what gates every premium feature in the app (`cardits > 5`), so
 * a stale value is the difference between a free shop and a Pro one.
 */

// Shopify AppSubscription statuses. ACTIVE is the only one that grants a paid
// plan; these four all mean the shop is back on Free. PENDING and ACCEPTED are
// deliberately in neither set — the merchant has approved nothing yet, so they
// must not move an existing plan in either direction.
const INACTIVE_STATUSES = new Set([
  "CANCELLED",
  "DECLINED",
  "EXPIRED",
  "FROZEN",
]);

// FREE_PLAN_CREDITS is the floor used when the Plans catalogue has no "Free"
// row. Without it the downgrade would pass `cardits: undefined` to Prisma,
// which means "leave this column alone" — a cancelled shop would silently keep
// its paid credits, the one failure mode this module exists to prevent. Shared
// with planLimits so the write side and the display side cannot drift apart.

const normalize = (status) => String(status || "").toUpperCase();

export const isActiveStatus = (status) => normalize(status) === "ACTIVE";

export const isInactiveStatus = (status) =>
  INACTIVE_STATUSES.has(normalize(status));

/**
 * Pull the numeric charge id out of whatever Shopify handed us. The webhook
 * payload carries `gid://shopify/AppSubscription/1234567890`, while the REST
 * charge and the billing return URL carry a bare `1234567890`. Both refer to
 * the same subscription, and `Users.chargeId` stores the bare form.
 */
export const toChargeId = (value) => {
  if (value == null) return null;
  const id = String(value).trim();
  if (!id) return null;
  const gid = id.match(/\/(\d+)(?:\?.*)?$/);
  return gid ? gid[1] : id;
};

/**
 * Bring a shop's `Users` and `Charges` rows in line with a subscription status.
 *
 * @param {object}  args
 * @param {string}  args.shop        myshopify domain
 * @param {string}  args.status      Shopify AppSubscription status
 * @param {string}  [args.planName]  subscription name, matched against Plans.name
 * @param {string}  [args.chargeId]  charge id or gid the status refers to
 * @param {string}  [args.occurredAt] ISO timestamp of the change
 * @returns {Promise<{applied: boolean, reason?: string, plan?: string, credits?: number}>}
 */
export async function syncSubscriptionState({
  shop,
  status,
  planName,
  chargeId,
  occurredAt,
}) {
  if (!shop) return { applied: false, reason: "no-shop" };

  const active = isActiveStatus(status);
  const inactive = isInactiveStatus(status);

  // PENDING / ACCEPTED / anything unrecognised: not a state change we can act
  // on without risking a wrong downgrade.
  if (!active && !inactive) {
    return { applied: false, reason: `ignored-status:${normalize(status)}` };
  }

  const user = await prisma.users.findUnique({
    where: { shop },
    select: { id: true, chargeId: true },
  });
  if (!user) return { applied: false, reason: "no-user" };

  const incomingChargeId = toChargeId(chargeId);

  // Webhooks are not ordered, and a cancellation for the subscription a shop
  // just replaced can land after the replacement is already active. Applying it
  // blindly would downgrade a paying shop. So a downgrade is only honoured when
  // it concerns the subscription we currently believe is live (or when we have
  // no opinion, e.g. the row predates chargeId tracking).
  if (
    inactive &&
    user.chargeId &&
    incomingChargeId &&
    user.chargeId !== incomingChargeId
  ) {
    return { applied: false, reason: "stale-charge" };
  }

  const targetName = active ? planName : FREE_PLAN_NAME;
  const plan = targetName
    ? await prisma.plans.findFirst({ where: { name: targetName } })
    : null;

  // An active subscription whose name matches no Plans row is not something we
  // can price. Leaving the shop untouched is safer than guessing at its credits.
  if (active && !plan) {
    return { applied: false, reason: `unknown-plan:${planName}` };
  }

  const credits = active ? plan?.cradit : (plan?.cradit ?? FREE_PLAN_CREDITS);
  const changedAt = occurredAt || new Date().toISOString();

  await prisma.users.update({
    where: { id: user.id },
    data: {
      // A downgrade still counts as a chosen plan (Free), so the shop is not
      // sent back through the first-run pricing gate.
      planId: plan?.id ?? (active ? null : FREE_CHOICE_ID),
      cardits: credits,
      // Dropping chargeId is what stops the dashboard and pricing loaders from
      // re-fetching a dead charge on every page load.
      chargeId: active ? (incomingChargeId ?? user.chargeId) : null,
    },
  });

  // updateMany keyed on (shop, chargeId), not `Charges[0]`: the old code took
  // the first row `findMany` happened to return, which is the shop's oldest
  // charge once it has subscribed more than once.
  if (incomingChargeId) {
    await prisma.charges.updateMany({
      where: { shop, chargeId: incomingChargeId },
      data: {
        status: normalize(status).toLowerCase(),
        ...(inactive ? { cancelled_on: changedAt } : {}),
        ...(plan ? { planId: plan.id, cradit: plan.cradit ?? null } : {}),
      },
    });
  }

  return {
    applied: true,
    plan: plan?.name ?? FREE_PLAN_NAME,
    credits: credits ?? null,
  };
}

// Marker stored in Users.planId when the shop chose Free but the catalogue has
// no "Free" row to point at.
export const FREE_CHOICE_ID = "free";

const isFreeChoice = (planId, freePlan) =>
  Boolean(planId) && (planId === FREE_CHOICE_ID || planId === freePlan?.id);

/**
 * Record that the shop chose the Free plan (the first-run pricing gate).
 * Refused while a paid subscription is active — that has to be cancelled.
 */
export async function chooseFreePlan(admin, shop) {
  await verifyShopPlan(admin, shop, { force: true });
  const user = await prisma.users.findUnique({
    where: { shop },
    select: { id: true, chargeId: true },
  });
  if (!user) return { ok: false, error: "User not found" };
  if (user.chargeId) {
    return {
      ok: false,
      error: "Cancel your current subscription to switch to the Free plan.",
    };
  }
  const freePlan = await prisma.plans.findFirst({
    where: { name: FREE_PLAN_NAME },
    select: { id: true, cradit: true },
  });
  await prisma.users.update({
    where: { id: user.id },
    data: {
      planId: freePlan?.id ?? FREE_CHOICE_ID,
      cardits: freePlan?.cradit ?? FREE_PLAN_CREDITS,
    },
  });
  return { ok: true };
}

/** Has the shop picked a plan yet? Free counts; an unapproved paid pick doesn't. */
export async function hasChosenPlan(shop) {
  const user = await prisma.users.findUnique({
    where: { shop },
    select: { planId: true },
  });
  return Boolean(user?.planId);
}

// ── Live plan check ─────────────────────────────────────────────────────────
// `Users.planId` / `cardits` / `chargeId` are only a cache of what Shopify
// billing says. They can drift: `app.pricing` records the chosen plan before
// the merchant approves the charge, a webhook can be missed, and a charge can
// be declined, frozen or cancelled from the Shopify admin. So every time the
// app is opened we ask Shopify which subscription is really ACTIVE and correct
// the row if it disagrees.
//
// Remix runs the parent (app.jsx) loader and the page loader in parallel, and
// both need the verified plan. Calls for the same shop within PLAN_CHECK_TTL_MS
// share one in-flight check, so a page load costs a single Shopify request
// however many loaders ask.
const PLAN_CHECK_TTL_MS = 10_000;
const planChecks = new Map(); // shop -> { at, promise }

const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query VerifyShopPlan {
    currentAppInstallation {
      activeSubscriptions { id name status }
    }
  }`;

const SUBSCRIPTION_STATUS_QUERY = `#graphql
  query SubscriptionStatus($id: ID!) {
    node(id: $id) { ... on AppSubscription { id status } }
  }`;

async function checkShopPlan(admin, shop) {
  const user = await prisma.users.findUnique({
    where: { shop },
    select: { id: true, chargeId: true, planId: true, cardits: true },
  });
  if (!user) return { applied: false, reason: "no-user" };

  const response = await admin.graphql(ACTIVE_SUBSCRIPTIONS_QUERY);
  const body = await response.json();
  const subscriptions = body?.data?.currentAppInstallation?.activeSubscriptions;
  // No answer from Shopify is not the same as "no subscription": never
  // downgrade a shop on a failed or malformed response.
  if (body?.errors || !Array.isArray(subscriptions)) {
    throw new Error(
      `activeSubscriptions unavailable: ${JSON.stringify(body?.errors || body)}`,
    );
  }

  const active = subscriptions.find((s) => isActiveStatus(s?.status));

  if (active) {
    // Payment approved and the charge is live. Make sure the row points at it.
    const chargeId = toChargeId(active.id);
    const plan = await prisma.plans.findFirst({
      where: { name: active.name },
      select: { id: true, cradit: true },
    });
    const inSync =
      plan &&
      user.chargeId === chargeId &&
      user.planId === plan.id &&
      user.cardits === plan.cradit;
    if (inSync) return { applied: false, reason: "in-sync" };
    return syncSubscriptionState({
      shop,
      status: "ACTIVE",
      planName: active.name,
      chargeId,
    });
  }

  // No approved, active charge: the shop must be on Free.
  const freePlan = await prisma.plans.findFirst({
    where: { name: FREE_PLAN_NAME },
    select: { id: true, cradit: true },
  });
  const freeCredits = freePlan?.cradit ?? FREE_PLAN_CREDITS;
  const choseFree = isFreeChoice(user.planId, freePlan);
  const alreadyFree =
    !user.chargeId &&
    (!user.planId || choseFree) &&
    (user.cardits == null || user.cardits <= freeCredits);
  if (alreadyFree) return { applied: false, reason: "in-sync" };

  // No charge was ever approved: either a paid plan was picked and checkout
  // was abandoned/declined, or credits were never backed by a charge. Either
  // way no plan has really been chosen — clear planId (unless it is the Free
  // choice) so the shop is sent back to the pricing page.
  if (!user.chargeId) {
    await prisma.users.update({
      where: { id: user.id },
      data: { planId: choseFree ? user.planId : null, cardits: freeCredits },
    });
    return {
      applied: true,
      plan: FREE_PLAN_NAME,
      credits: freeCredits,
      reason: choseFree ? "free" : "plan-not-approved",
    };
  }

  // Record the charge's real end state (declined / expired / frozen /
  // cancelled) on its Charges row when Shopify can tell us. A charge that was
  // never approved (pending) just has the plan taken back, row untouched.
  let status = "CANCELLED";
  let chargeId = null;
  // DECLINED / EXPIRED / PENDING: the charge was never approved, so no plan
  // was really chosen — the shop goes back through the pricing gate. A charge
  // that was active and then CANCELLED / FROZEN lands on Free, chosen.
  let neverApproved = false;
  if (user.chargeId) {
    try {
      const r = await admin.graphql(SUBSCRIPTION_STATUS_QUERY, {
        variables: { id: `gid://shopify/AppSubscription/${user.chargeId}` },
      });
      const j = await r.json();
      const real = normalize(j?.data?.node?.status);
      neverApproved = ["DECLINED", "EXPIRED", "PENDING"].includes(real);
      if (isInactiveStatus(real)) {
        status = real;
        chargeId = user.chargeId;
      }
    } catch {
      // Status is only for the Charges row; the downgrade stands without it.
    }
  }

  const result = await syncSubscriptionState({ shop, status, chargeId });
  if (neverApproved && result.applied) {
    await prisma.users.update({
      where: { id: user.id },
      data: { planId: null },
    });
  }
  return result;
}

/**
 * Verify the shop's plan against Shopify billing and fix the stored plan if it
 * is wrong. Never throws: on any failure the stored plan is left as it is.
 *
 * @param {object} admin  the `admin` client from authenticate.admin
 * @param {string} shop   myshopify domain
 * @param {{force?: boolean}} [opts]  force: skip the shared recent result
 */
export function verifyShopPlan(admin, shop, { force = false } = {}) {
  if (!admin || !shop) {
    return Promise.resolve({ applied: false, reason: "no-shop" });
  }

  const now = Date.now();
  const cached = planChecks.get(shop);
  if (!force && cached && now - cached.at < PLAN_CHECK_TTL_MS) {
    return cached.promise;
  }

  const promise = checkShopPlan(admin, shop).catch((error) => {
    console.error(`[plan] could not verify plan for ${shop}:`, error);
    return { applied: false, reason: "error" };
  });
  planChecks.set(shop, { at: now, promise });

  if (planChecks.size > 1000) {
    for (const [key, entry] of planChecks) {
      if (now - entry.at >= PLAN_CHECK_TTL_MS) planChecks.delete(key);
    }
  }

  return promise;
}
