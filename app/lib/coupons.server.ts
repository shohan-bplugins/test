/*
 * Coupon codes for app subscriptions.
 *
 * Shopify's billing API takes the discount as part of the subscription line
 * item, so a code is never a thing the storefront or the browser applies — it
 * is looked up here, server-side, and turned into a discount on the charge
 * Shopify creates.
 *
 * Supports both dynamic MongoDB-stored coupons (managed from the Super Admin
 * Dashboard) and static fallback promotion codes.
 */

import prisma from "~/db.server";
import {
  LAUNCH_OFFER,
  LAUNCH_OFFER_PERCENT_LABEL,
} from "./launch-offer";

export type Coupon = {
  id?: string;
  /** Compared case-insensitively; store it however reads best. */
  code: string;
  /**
   * Share off the recurring price, as a fraction — 0.2 is 20% off. Shopify's
   * AppSubscriptionDiscountValueInput takes a fraction, not 0–100.
   */
  percentage: number;
  /**
   * How many billing intervals the discount survives. Omitted means it lasts
   * for the life of the subscription.
   */
  durationLimitInIntervals?: number | null;
  /** Shown to the merchant once the code is accepted. */
  description: string;
  /** When the code starts being accepted, as a UTC timestamp. */
  startsAt?: number | null;
  /** When the code stops being accepted, as a UTC timestamp. */
  expiresAt?: number | null;
  /** Whether the code is automatically applied without user typing it. */
  autoApply?: boolean;
  /** Optional max redemptions limit. */
  usageLimit?: number | null;
  /** Redemptions count so far. */
  usageCount?: number;
  /** Specific plan names this coupon applies to. Empty array means all plans. */
  applicablePlans?: string[];
  /** Banner display settings */
  showBanner?: boolean | null;
  bannerHeading?: string | null;
  bannerText?: string | null;
  bannerTone?: string | null;
  bannerPlacements?: string[];
  bannerDismissible?: boolean | null;
  bannerButtonText?: string | null;
};

const STATIC_COUPONS: Coupon[] = [
  {
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

/** Look a code up from DB with fallback to static coupons. */
export async function findCoupon(
  code: string,
  planName?: string,
): Promise<Coupon | null> {
  const wanted = code.trim().toLowerCase();
  if (!wanted) return null;

  const now = new Date();

  // 1. Check MongoDB Coupon table
  try {
    if ((prisma as any).coupon) {
      const dbCoupon = await (prisma as any).coupon.findFirst({
        where: {
          code: { equals: wanted, mode: "insensitive" },
          active: true,
        },
      });

      if (dbCoupon) {
        // Check start date
        if (dbCoupon.startsAt && dbCoupon.startsAt > now) {
          return null;
        }
        // Check expiration date
        if (dbCoupon.expiresAt && dbCoupon.expiresAt <= now) {
          return null;
        }
        // Check usage limit
        if (
          dbCoupon.usageLimit !== null &&
          dbCoupon.usageLimit !== undefined &&
          dbCoupon.usageCount >= dbCoupon.usageLimit
        ) {
          return null;
        }
        // Check applicable plans
        if (
          planName &&
          dbCoupon.applicablePlans &&
          dbCoupon.applicablePlans.length > 0 &&
          !dbCoupon.applicablePlans.includes(planName)
        ) {
          return null;
        }

        return {
          id: dbCoupon.id,
          code: dbCoupon.code,
          description: dbCoupon.description,
          percentage: dbCoupon.percentage,
          durationLimitInIntervals: dbCoupon.durationLimitInIntervals,
          startsAt: dbCoupon.startsAt ? dbCoupon.startsAt.getTime() : null,
          expiresAt: dbCoupon.expiresAt ? dbCoupon.expiresAt.getTime() : null,
          autoApply: dbCoupon.autoApply,
          usageLimit: dbCoupon.usageLimit,
          usageCount: dbCoupon.usageCount,
          applicablePlans: dbCoupon.applicablePlans,
          showBanner: dbCoupon.showBanner,
          bannerHeading: dbCoupon.bannerHeading,
          bannerText: dbCoupon.bannerText,
          bannerTone: dbCoupon.bannerTone,
          bannerPlacements: dbCoupon.bannerPlacements,
          bannerDismissible: dbCoupon.bannerDismissible,
          bannerButtonText: dbCoupon.bannerButtonText,
        };
      }
    }
  } catch (err) {
    console.error("[coupons] DB lookup failed, falling back to static:", err);
  }

  // 2. Fallback to static coupons
  const found = STATIC_COUPONS.find((c) => c.code.toLowerCase() === wanted);
  if (!found || (found.expiresAt !== undefined && found.expiresAt !== null && Date.now() >= found.expiresAt)) {
    return null;
  }
  return found;
}

/**
 * Find an active auto-apply coupon for the given plan if available.
 */
export async function getAutoApplyCoupon(
  planName?: string,
): Promise<Coupon | null> {
  const now = new Date();
  try {
    if (!(prisma as any).coupon) return null;
    const coupons = await (prisma as any).coupon.findMany({
      where: {
        active: true,
        autoApply: true,
      },
      orderBy: { percentage: "desc" },
    });

    for (const c of coupons) {
      if (c.startsAt && c.startsAt > now) continue;
      if (c.expiresAt && c.expiresAt <= now) continue;
      if (c.usageLimit !== null && c.usageLimit !== undefined && c.usageCount >= c.usageLimit) continue;
      if (
        planName &&
        c.applicablePlans &&
        c.applicablePlans.length > 0 &&
        !c.applicablePlans.includes(planName)
      ) {
        continue;
      }

      return {
        id: c.id,
        code: c.code,
        description: c.description,
        percentage: c.percentage,
        durationLimitInIntervals: c.durationLimitInIntervals,
        startsAt: c.startsAt ? c.startsAt.getTime() : null,
        expiresAt: c.expiresAt ? c.expiresAt.getTime() : null,
        autoApply: true,
        usageLimit: c.usageLimit,
        usageCount: c.usageCount,
        applicablePlans: c.applicablePlans,
        showBanner: c.showBanner,
        bannerHeading: c.bannerHeading,
        bannerText: c.bannerText,
        bannerTone: c.bannerTone,
        bannerPlacements: c.bannerPlacements,
        bannerDismissible: c.bannerDismissible,
        bannerButtonText: c.bannerButtonText,
      };
    }
  } catch (err) {
    console.error("[coupons] getAutoApplyCoupon failed:", err);
  }

  return null;
}

export type BannerInfo = {
  couponId?: string;
  code: string;
  heading: string;
  text: string;
  tone: "success" | "info" | "warning";
  dismissible: boolean;
  buttonText: string;
  percentage: number;
  discountLabel: string;
};

/**
 * Get active promotion banner for a placement ("pricing" or "dashboard").
 */
export async function getActiveBanner(
  placement: "pricing" | "dashboard",
  planName?: string,
): Promise<BannerInfo | null> {
  const now = new Date();
  try {
    if (!(prisma as any).coupon) return null;
    const coupons = await (prisma as any).coupon.findMany({
      where: {
        active: true,
      },
      orderBy: { percentage: "desc" },
    });

    for (const c of coupons) {
      if (c.startsAt && c.startsAt > now) continue;
      if (c.expiresAt && c.expiresAt <= now) continue;
      if (c.usageLimit !== null && c.usageLimit !== undefined && c.usageCount >= c.usageLimit) continue;
      if (
        planName &&
        c.applicablePlans &&
        c.applicablePlans.length > 0 &&
        !c.applicablePlans.includes(planName)
      ) {
        continue;
      }

      // Check if banner is enabled for this coupon
      const isBannerActive = c.showBanner === true || (c.autoApply && c.showBanner !== false);
      if (!isBannerActive) continue;

      // Check placement: default to both if empty
      const placements =
        c.bannerPlacements && c.bannerPlacements.length > 0
          ? c.bannerPlacements
          : ["pricing", "dashboard"];

      if (!placements.includes(placement)) continue;

      const pctLabel = `${Math.round(c.percentage * 100)}%`;
      const defaultHeading = c.autoApply
        ? `🎉 Special Offer: ${pctLabel} Discount Auto-Applied!`
        : `🎉 Special Offer: Use Code ${c.code} For ${pctLabel} OFF!`;
      const defaultText = c.description || `Get ${pctLabel} off subscription plans.`;
      const defaultBtn = placement === "dashboard" ? "View Plans & Upgrade" : "Choose a Plan";

      return {
        couponId: c.id,
        code: c.code,
        heading: c.bannerHeading || defaultHeading,
        text: c.bannerText || defaultText,
        tone: (c.bannerTone as any) || "success",
        dismissible: c.bannerDismissible !== false,
        buttonText: c.bannerButtonText || defaultBtn,
        percentage: c.percentage,
        discountLabel: pctLabel,
      };
    }
  } catch (err) {
    console.error("[coupons] getActiveBanner failed:", err);
  }
  return null;
}

/**
 * Record coupon redemption in database and increment usage count.
 */
export async function recordCouponRedemption({
  code,
  shop,
  planName,
  chargeId,
  discountPct,
}: {
  code: string;
  shop: string;
  planName?: string;
  chargeId?: string;
  discountPct: number;
}) {
  try {
    const coupon = (prisma as any).coupon
      ? await (prisma as any).coupon.findFirst({
          where: { code: { equals: code.trim(), mode: "insensitive" } },
        })
      : null;

    if (coupon) {
      await prisma.$transaction([
        prisma.couponRedemption.create({
          data: {
            couponId: coupon.id,
            couponCode: coupon.code,
            shop,
            planName: planName ?? null,
            chargeId: chargeId ?? null,
            discountPct,
          },
        }),
        prisma.coupon.update({
          where: { id: coupon.id },
          data: { usageCount: { increment: 1 } },
        }),
        prisma.appStoreEvent.create({
          data: {
            shop,
            type: "coupon_used",
            detail: JSON.stringify({
              code: coupon.code,
              planName,
              chargeId,
              discountPct,
            }),
          },
        }),
      ]);
    } else {
      // Record event even if it's a static coupon
      await prisma.appStoreEvent.create({
        data: {
          shop,
          type: "coupon_used",
          detail: JSON.stringify({
            code: code.trim().toUpperCase(),
            planName,
            chargeId,
            discountPct,
          }),
        },
      });
    }
  } catch (err) {
    console.error("[coupons] recordCouponRedemption error:", err);
  }
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
