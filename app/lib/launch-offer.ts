/*
 * The launch promotion, stated once.
 *
 * Four places have to agree about this offer: the public /demo page's banner
 * and struck-through prices, the in-app Pricing page's banner and cards, the
 * coupon table (so the advertised code still resolves to something), and the
 * `subscribe` action that actually discounts the Shopify charge. When those
 * lived apart, the page could advertise a percentage the charge never applied —
 * which is what happened here: /demo told merchants to enter LAUNCH44 on a
 * Pricing page whose coupon field was switched off.
 *
 * Not a `.server` module: the Pricing page's cards quote the discounted price
 * in the browser, so the percentage and the duration have to be importable from
 * component code. Nothing here is a secret — it is on a public marketing page.
 */

export const LAUNCH_OFFER = {
  /**
   * The advertised code.
   *
   * The discount is applied automatically to anyone subscribing before the
   * deadline, so no merchant needs to type this. It stays because it was
   * published — a code that was advertised has to keep resolving, and
   * `coupons.server.ts` keeps an entry for it worth exactly the same as the
   * automatic offer, so entering it changes nothing rather than failing.
   */
  code: "LAUNCH44",
  /**
   * Share off the recurring price, as a fraction. Shopify's
   * AppSubscriptionDiscountValueInput takes a fraction, not 0–100.
   */
  percentOff: 0.44,
  /** Billing periods the discount survives, i.e. months on a monthly plan. */
  months: 6,
  /**
   * When the offer closes, as UTC midnight on the 28th — so "before
   * September 28, 2026" means through the 27th wherever the merchant is.
   *
   * The deadline is the point of holding this in one place: letting the offer
   * lapse is not a deploy anyone has to remember to make on the day.
   */
  endsAt: Date.UTC(2026, 8, 28),
  endsLabel: "September 28, 2026",
} as const;

/** "44%", for copy that should not drift from the number above. */
export const LAUNCH_OFFER_PERCENT_LABEL = `${Math.round(
  LAUNCH_OFFER.percentOff * 100,
)}%`;

/**
 * Is the offer still open?
 *
 * Callers in a route must evaluate this in the loader and pass the answer down,
 * never inside the component tree: a bare call during render runs once in Node
 * and again in the browser, and around the deadline the two disagree — which
 * React reports as a hydration mismatch.
 */
export function launchOfferActive(now: number = Date.now()): boolean {
  return now < LAUNCH_OFFER.endsAt;
}

/**
 * A price with the launch discount taken off.
 *
 * Rounded to cents for the same reason `annualPrice` is: 8.88 * 0.56 is
 * 4.972800000000001 in binary floating point, which is not a price to show
 * anyone or to send as a charge amount.
 */
export function launchOfferPrice(amount: string | number): number {
  return (
    Math.round(Number(amount) * (1 - LAUNCH_OFFER.percentOff) * 100) / 100
  );
}

/**
 * The offer shaped as `appSubscriptionCreate`'s discount input, or undefined
 * when the offer has closed — so it can be spread into the pricing details
 * without a conditional at the call site. Shopify rejects a null `discount`.
 */
export function launchOfferDiscount(now: number = Date.now()) {
  if (!launchOfferActive(now)) return undefined;
  return {
    value: { percentage: LAUNCH_OFFER.percentOff },
    durationLimitInIntervals: LAUNCH_OFFER.months,
  };
}
