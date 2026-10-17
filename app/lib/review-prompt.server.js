import prisma from "../db.server";

// Rules for asking a store to review the app (in-app popup via
// shopify.reviews.request()). Every rule must pass:
//   1. Not reviewed yet   – Shopify never told us "already-reviewed"
//   2. Yearly limit       – shown fewer than 3 times in the last 365 days
//   3. Cooldown           – never shown, or last shown 60+ days ago
//   4. Time since install – installed more than 24 hours ago
//   5. Store is set up    – at least one audio player created
//   6. Lifetime plays     – more than 5 storefront plays in total
// Rule 7 (once per visit) is enforced in the browser, app/utils/reviewPrompt.js.
// Shopify applies its own limits on top of these.

const DAY = 24 * 60 * 60 * 1000;
export const REVIEW_RULES = {
  maxShownPerYear: 3,
  cooldownDays: 60,
  minHoursSinceInstall: 24,
  minLifetimePlays: 5, // more than this many
};

export async function getReviewEligibility(shop) {
  try {
    const now = Date.now();
    const [reviewed, shownThisYear, lastShown, user, players, plays] =
      await Promise.all([
        prisma.reviewPrompt.count({ where: { shop, code: "already-reviewed" } }),
        prisma.reviewPrompt.count({
          where: { shop, shown: true, createdAt: { gte: new Date(now - 365 * DAY) } },
        }),
        prisma.reviewPrompt.findFirst({
          where: { shop, shown: true },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        prisma.Users.findUnique({ where: { shop }, select: { createdAt: true } }),
        prisma.audio.count({ where: { shop } }),
        prisma.analytics.count({ where: { shop, event: "play" } }),
      ]);

    const installedAt = user?.createdAt ? new Date(user.createdAt).getTime() : 0;
    const rules = {
      notReviewed: reviewed === 0,
      yearlyLimit: shownThisYear < REVIEW_RULES.maxShownPerYear,
      cooldown:
        !lastShown ||
        now - new Date(lastShown.createdAt).getTime() >=
          REVIEW_RULES.cooldownDays * DAY,
      // No install date on very old records: they're long past 24 hours.
      installedLongEnough:
        !installedAt ||
        now - installedAt > REVIEW_RULES.minHoursSinceInstall * 60 * 60 * 1000,
      storeSetUp: players > 0,
      lifetimePlays: plays > REVIEW_RULES.minLifetimePlays,
    };
    return { eligible: Object.values(rules).every(Boolean), rules };
  } catch (error) {
    // e.g. database client not regenerated yet: just never ask.
    console.error("Review prompt: eligibility check failed:", error?.message);
    return { eligible: false };
  }
}

export async function recordReviewRequest(shop, { shown, code }) {
  try {
    await prisma.reviewPrompt.create({
      data: {
        shop,
        shown: Boolean(shown),
        code: code ? String(code).slice(0, 64) : null,
      },
    });
  } catch (error) {
    console.error("Review prompt: couldn't record request:", error?.message);
  }
}
