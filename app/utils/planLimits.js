/**
 * One place that answers "what plan is this shop on, and what is its player
 * limit". Pure — no Prisma, no Remix — so loaders and components both import it.
 *
 * Six places used to answer that question independently and they did not agree:
 *
 *   - `Dashboard.jsx` carried its own hardcoded STATIC_PLANS (Pro = 50 credits)
 *     while the Plans catalogue in Mongo says Pro = 10. The dashboard therefore
 *     told a Pro merchant they had 50 players while `app.videos` blocked them
 *     at 10.
 *   - That same hardcoded list broke the dashboard's fallback path: when the
 *     live Shopify subscription lookup returned nothing it matched the user's
 *     stored credits against the static list (`p.cradit === localCredits`), and
 *     10 matches none of [5, 50, 99999999999999] — so a paying Pro shop fell
 *     through to plans[0] and was shown as Free.
 *   - `app.product-video` hardcoded the string "Unlimited" for every shop,
 *     including Free ones limited to 5.
 *   - `app.videos`, `app.customize`, `app.analytics` and `app.api.ticket` each
 *     inlined the magic number 5 to mean "more than Free".
 *
 * The Plans collection in Mongo is the catalogue of record. Everything here
 * derives from it; the only hardcoded numbers are the fallbacks used when that
 * catalogue cannot be read.
 */

export const FREE_PLAN_NAME = "Free";

// Fallback only — used when the Plans catalogue has no "Free" row. Every normal
// path reads the real number off that row.
export const FREE_PLAN_CREDITS = 5;

// "Unlimited" tiers are modelled as a very large credit count rather than a
// flag (Pro Plus is 999999999 in the catalogue). Anything at or above this is
// presented as unlimited instead of printing the sentinel to the merchant.
export const UNLIMITED_MIN_CREDITS = 1_000_000;

export const isUnlimitedCredits = (credits) =>
  Number(credits) >= UNLIMITED_MIN_CREDITS;

/**
 * Does this credit count mean a paid plan? The threshold is the Free tier's
 * allowance, so this stays correct if Free's size ever changes in the catalogue
 * — pass the catalogue's Free credits in when you have them.
 */
export const isPaidCredits = (credits, freeCredits = FREE_PLAN_CREDITS) =>
  Number(credits || 0) > Number(freeCredits || FREE_PLAN_CREDITS);

/** Plan names that denote a paid tier, matched the way the app has always done. */
export const isPaidPlanName = (name) =>
  String(name || "")
    .trim()
    .toLowerCase()
    .startsWith("pro");

/** "Unlimited" or "10 Videos" — the label shown in the plan comparison table. */
export const creditLabel = (credits) =>
  isUnlimitedCredits(credits) ? "Unlimited" : `${Number(credits) || 0} Videos`;

const normalizePlan = (plan) => {
  if (!plan) return null;
  const credits = Number(plan.cradit) || 0;
  return {
    id: plan.id,
    name: plan.name,
    title: plan.title || plan.name,
    // The catalogue stores price as a string ("4.99"); comparisons like
    // `plan.price > currentPrice` are wrong on strings once a price reaches
    // two digits ("10.00" > "9.99" is false).
    price: Number(plan.price) || 0,
    credits,
    unlimited: isUnlimitedCredits(credits),
    limitLabel: creditLabel(credits),
    trialDays: Number(plan.trial_days) || 0,
  };
};

/** The catalogue as the UI wants it: numeric prices and derived limit labels. */
export const normalizePlans = (plans = []) =>
  plans.map(normalizePlan).filter(Boolean);

// Used when the catalogue is unavailable, so the UI still renders something
// truthful rather than crashing or silently granting paid limits.
const FALLBACK_FREE = {
  id: null,
  name: FREE_PLAN_NAME,
  title: FREE_PLAN_NAME,
  price: 0,
  credits: FREE_PLAN_CREDITS,
  unlimited: false,
  limitLabel: creditLabel(FREE_PLAN_CREDITS),
  trialDays: 0,
};

/**
 * Resolve the shop's current plan.
 *
 * Precedence, most to least authoritative:
 *   1. A live ACTIVE Shopify subscription, matched to the catalogue by name.
 *      Shopify is the billing authority, so this outranks our own rows.
 *   2. `Users.planId` — what the app last recorded for the shop.
 *   3. `Users.cardits` — matched back to whichever plan grants that many.
 *   4. The catalogue's Free row, else the hardcoded free fallback.
 *
 * @param {object}   args
 * @param {Array}    args.plans        rows from the Plans collection
 * @param {object}   [args.user]       the shop's Users row
 * @param {object}   [args.subscription] REST recurring_application_charge, if fetched
 * @returns {{id, name, title, price, credits, unlimited, limitLabel, isPaid, source}}
 */
export function resolvePlan({ plans = [], user, subscription } = {}) {
  const catalogue = normalizePlans(plans);
  const byName = (name) =>
    catalogue.find(
      (p) =>
        String(p.name || "")
          .trim()
          .toLowerCase() ===
        String(name || "")
          .trim()
          .toLowerCase(),
    );

  const free = byName(FREE_PLAN_NAME) || FALLBACK_FREE;
  const freeCredits = free.credits;

  const decorate = (plan, source) => ({
    ...plan,
    isPaid:
      isPaidCredits(plan.credits, freeCredits) || isPaidPlanName(plan.name),
    source,
  });

  // (1) Shopify's live view of the subscription.
  const status = String(subscription?.status || "").toLowerCase();
  if (status === "active") {
    const fromSub = byName(subscription?.name);
    if (fromSub) return decorate(fromSub, "subscription");
  }

  // (2) The plan we last recorded against the shop.
  if (user?.planId) {
    const fromId = catalogue.find((p) => p.id === user.planId);
    if (fromId) return decorate(fromId, "planId");
  }

  // (3) Credits, matched back to the plan that grants them. Guarded on a real
  //     number so a missing/0 `cardits` cannot accidentally match a plan.
  const credits = Number(user?.cardits);
  if (Number.isFinite(credits) && credits > 0) {
    const fromCredits = catalogue.find((p) => p.credits === credits);
    if (fromCredits) return decorate(fromCredits, "credits");

    // Credits that match no plan (a catalogue edited after the shop
    // subscribed). Trust the number — it is what the rest of the app enforces —
    // rather than silently demoting a paying shop to Free.
    return decorate(
      {
        ...free,
        credits,
        unlimited: isUnlimitedCredits(credits),
        limitLabel: creditLabel(credits),
        title: isPaidCredits(credits, freeCredits) ? "Paid" : free.title,
        name: isPaidCredits(credits, freeCredits) ? "Paid" : free.name,
      },
      "credits-unmatched",
    );
  }

  // (4) Nothing known — Free.
  return decorate(free, "default");
}

/**
 * Usage of a resolved plan, in the shape every page needs to render it.
 * `used` is the shop's real player count.
 */
export function planUsage(used, plan) {
  const count = Number(used) || 0;
  const max = Number(plan?.credits) || 0;
  const unlimited = Boolean(plan?.unlimited);

  return {
    used: count,
    max,
    unlimited,
    atLimit: !unlimited && max > 0 && count >= max,
    over: !unlimited && max > 0 && count > max,
    remaining: unlimited ? Infinity : Math.max(0, max - count),
    percent:
      unlimited || !max ? 0 : Math.min(100, Math.round((count / max) * 100)),
    // "3 of 10" / "3 of Unlimited" — the one phrasing used app-wide.
    label: `${count} of ${unlimited ? "Unlimited" : max}`,
  };
}
