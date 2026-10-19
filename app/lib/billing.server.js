import prisma from "../db.server";

// Player credits per paid plan; anything else is the Free plan.
const PLAN_CREDITS = { Pro: 10, "Pro Plus": 9999999 };
const FREE_CREDITS = 5;

const FREE_STATE = { planId: "", chargeId: "", cardits: FREE_CREDITS };

// True when the stored user claims any paid access.
const claimsPaid = (user) =>
  Boolean(user?.planId) ||
  Boolean(user?.chargeId) ||
  Number(user?.cardits ?? FREE_CREDITS) > FREE_CREDITS;

// Make the stored plan match what Shopify actually bills this shop for.
//
// Shopify's ACTIVE app subscription is the only thing that grants a paid plan:
// clicking Upgrade, then declining or abandoning the approval page, leaves the
// shop on Free; a cancelled, expired, frozen or declined subscription drops it
// back to Free. If Shopify can't be reached, nothing is changed.
//
// `onlyIfPaid` skips the Shopify call for shops the database already treats as
// Free (used on every app load, where a Free shop has nothing to reconcile).
export async function syncPlanWithShopify(
  admin,
  shop,
  { onlyIfPaid = false } = {},
) {
  if (!admin || !shop) return null;

  const user = await prisma.Users.findUnique({ where: { shop } });
  if (!user) return null;
  if (onlyIfPaid && !claimsPaid(user)) return user;

  let active;
  try {
    const response = await admin.graphql(
      `#graphql
      query PlanSyncActiveSubscriptions {
        currentAppInstallation {
          activeSubscriptions { id name status }
        }
      }`,
    );
    const json = await response.json();
    const subs = json?.data?.currentAppInstallation?.activeSubscriptions;
    if (!Array.isArray(subs)) {
      console.error(
        "Plan sync: unexpected subscription response",
        json?.errors,
      );
      return user;
    }
    active = subs.find((s) => s?.status === "ACTIVE" && PLAN_CREDITS[s?.name]);
  } catch (error) {
    console.error(`Plan sync: couldn't read subscriptions for ${shop}:`, error);
    return user;
  }

  let next = FREE_STATE;
  if (active) {
    const plan = await prisma.plans.findFirst({ where: { name: active.name } });
    next = {
      planId: plan?.id || "",
      chargeId: String(active.id).split("/").pop(),
      cardits: PLAN_CREDITS[active.name],
    };
  }

  const changed =
    (user.planId || "") !== next.planId ||
    (user.chargeId || "") !== next.chargeId ||
    Number(user.cardits ?? FREE_CREDITS) !== next.cardits;
  if (!changed) return user;

  return prisma.Users.update({ where: { id: user.id }, data: next });
}

// Look up a plan the merchant picked. Name, price and currency always come
// from the Plans table, never from the client (otherwise a shop could
// subscribe to any plan at any price). Returns null for unknown/free plans.
export async function findPaidPlan({ id, name } = {}) {
  const planId = String(id || "");
  const plan = /^[a-f0-9]{24}$/i.test(planId)
    ? await prisma.plans.findUnique({ where: { id: planId } })
    : await prisma.plans.findFirst({ where: { name: String(name || "") } });
  const price = Number(plan?.price);
  if (!plan || !Number.isFinite(price) || price <= 0) return null;
  return { ...plan, price, currencyCode: plan.currencyCode || "USD" };
}

// Start a 7-day-trial subscription for `plan` (from findPaidPlan). Returns the
// raw GraphQL JSON; the merchant must approve it at `confirmationUrl`. The
// stored plan is only changed once Shopify reports it ACTIVE.
export async function createPlanSubscription(admin, shop, plan) {
  const response = await admin.graphql(
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
        returnUrl: `https://admin.shopify.com/store/${shop.split(".")[0]}/apps/audio-player-v2/app/SuccessBilling`,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: plan.price, currencyCode: plan.currencyCode },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
        trialDays: 7,
        test: false,
      },
    },
  );
  return response.json();
}
