export const FREE_PLAN_NAME = "Free";
export const STARTER_PLAN_NAME = "Starter";
export const GROWTH_PLAN_NAME = "Growth";
export const ADVANCE_PLAN_NAME = "Advance";

/**
 * "Unlimited" is stored as a large finite number rather than null/-1 so every
 * `used >= limit` comparison and `limit - used` remaining count in the app
 * keeps working unchanged. Use `isUnlimited`/`formatLimit` for display.
 */
export const UNLIMITED = 1_000_000;

export const isUnlimited = (limit: number) => limit >= UNLIMITED;

export const formatLimit = (limit: number) =>
  isUnlimited(limit) ? "Unlimited" : String(limit);

/** Every plan allows exactly one 3D model per product. */
export const MODELS_PER_PRODUCT = 1;

/** Fallbacks for a shop with no plan row yet — same caps as the Free plan. */
export const FREE_MODEL_LIMIT = 3;
export const FREE_PRODUCT_LIMIT = 3;

/**
 * Months charged for a year's subscription — so a yearly plan is ten months'
 * price, i.e. two months free.
 *
 * The Plan table stores one monthly price per plan, so the annual figure is
 * derived from it rather than stored. Change this one number to change the
 * annual discount across every plan; give Plan its own annual price column if
 * the tiers ever need to discount by different amounts.
 */
export const ANNUAL_MONTHS_CHARGED = 10;

/**
 * A plan's yearly price, from its monthly one.
 *
 * Rounded to cents, not left as raw floating point. This value is not only
 * displayed — it is the `amount` sent to appSubscriptionCreate — and
 * 99.99 * 10 evaluates to 999.9000000000001 in binary floating point, which is
 * not a price anyone should be charged or shown.
 */
export function annualPrice(monthly: string | number): number {
  return Math.round(Number(monthly) * ANNUAL_MONTHS_CHARGED * 100) / 100;
}

/**
 * A money amount with at most two decimal places, and thousands separated.
 *
 * `maximumFractionDigits: 2` with no minimum means a whole price stays whole —
 * "$25", not "$25.00" — while anything with cents keeps them and a long
 * floating-point tail is cut off.
 *
 * The locale is pinned rather than left to the environment. These pages are
 * server-rendered, so an unpinned Intl formatter runs once in Node and again in
 * the browser, and the two disagree wherever their locales differ — which React
 * reports as a hydration mismatch.
 */
const MONEY = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function formatMoney(value: string | number): string {
  const amount = Number(value);
  // A price that will not parse is shown as it was stored rather than as NaN.
  return Number.isFinite(amount) ? MONEY.format(amount) : String(value);
}
