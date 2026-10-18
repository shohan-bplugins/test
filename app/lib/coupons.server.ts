/*
 * Coupon codes for app subscriptions.
 *
 * Shopify's billing API takes the discount as part of the subscription line
 * item, so a code is never a thing the storefront or the browser applies — it
 * is looked up here, server-side, and turned into a discount on the charge
 * Shopify creates. A code the browser could define would be a code any merchant
 * could invent.
 *
 * Held in code rather than a table on purpose: there are a handful, they change
 * when marketing says so rather than at runtime, and a Prisma model would need
 * a migration and an admin screen to manage something an edit here covers. Move
 * it to the database the moment codes need to be created without a deploy.
 */

import {
  LAUNCH_OFFER,
  LAUNCH_OFFER_PERCENT_LABEL,
} from "./launch-offer";

export type Coupon = {
  /** Compared case-insensitively; store it however reads best. */
  code: string;
  /**
   * Share off the recurring price, as a fraction — 0.2 is 20% off. Shopify's
   * AppSubscriptionDiscountValueInput takes a fraction, not 0–100, and sending
   * `20` would be read as 2000% and rejected.
   */
  percentage: number;
  /**
   * How many billing intervals the discount survives. Omitted means it lasts
   * for the life of the subscription.
   */
  durationLimitInIntervals?: number;
  /** Shown to the merchant once the code is accepted. */
  description: string;
  /**
   * When the code stops being accepted, as a UTC timestamp. Omitted means it
   * runs until it is deleted from the list below.
   *
   * This is the deadline on a dated promotion — the point of it is that letting
   * the offer lapse is not a deploy anyone has to remember to make on the day.
   * It bounds when a code can be *redeemed*; how long the discount then lasts on
   * that subscription is durationLimitInIntervals, above.
   */
  expiresAt?: number;
};

const COUPONS: Coupon[] = [
  {
    /*
     * The launch promotion. Every merchant subscribing before the deadline gets
     * this automatically — see launchOfferDiscount() — so nobody has to enter
     * it. The entry stays because the code was advertised on the public /demo
     * page, and an advertised code has to keep resolving rather than being
     * rejected as unrecognised; it is worth exactly what the automatic offer is
     * worth, so entering it changes nothing.
     *
     * Every field is taken from LAUNCH_OFFER rather than repeated. A code worth
     * less than the offer it names would quietly *cost* the merchant who typed
     * it, since the better of the two is what gets sent.
     */
    code: LAUNCH_OFFER.code,
    percentage: LAUNCH_OFFER.percentOff,
    durationLimitInIntervals: LAUNCH_OFFER.months,
    description: `${LAUNCH_OFFER_PERCENT_LABEL} off your first ${LAUNCH_OFFER.months} billing periods`,
    expiresAt: LAUNCH_OFFER.endsAt,
  },
  {
    code: "LAUNCH20",
    percentage: 0.2,
    durationLimitInIntervals: 3,
    description: "20% off your first 3 billing periods",
  },
  {
    code: "WELCOME10",
    percentage: 0.1,
    description: "10% off for as long as your subscription runs",
  },
];

/** Look a code up. Returns null for anything unrecognised. */
export function findCoupon(code: string): Coupon | null {
  const wanted = code.trim().toLowerCase();
  if (!wanted) return null;
  const found = COUPONS.find((c) => c.code.toLowerCase() === wanted);
  // An expired code is treated as one that does not exist, so the merchant gets
  // the ordinary "we don't recognise that" answer rather than a dead end that
  // says the code is real but no longer worth anything.
  if (!found || (found.expiresAt !== undefined && Date.now() >= found.expiresAt)) {
    return null;
  }
  return found;
}

/**
 * The discount, shaped for `appSubscriptionCreate`.
 *
 * Returns undefined for no coupon, so it can be spread into the pricing details
 * without a conditional at the call site — Shopify rejects a null `discount`.
 */
export function couponToDiscount(coupon: Coupon | null) {
  if (!coupon) return undefined;
  return {
    value: { percentage: coupon.percentage },
    ...(coupon.durationLimitInIntervals
      ? { durationLimitInIntervals: coupon.durationLimitInIntervals }
      : {}),
  };
}
