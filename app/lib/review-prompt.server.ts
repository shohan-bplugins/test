import { randomUUID } from "node:crypto";
import type { AppUser } from "@prisma/client";

import prisma from "../db.server";
import {
  getAssignedModelGidsCached,
  getOrCreateUser,
} from "~/lib/billing.server";
import { checkThemeBlocksCached } from "~/lib/theme-blocks.server";

/*
 * When to ask a merchant for an App Store review.
 *
 * The ask itself is Shopify's own modal (`shopify.reviews.request()`, see
 * components/ReviewPrompt.tsx), which applies its own limits on top of these.
 *
 * Every rule below must pass. If any one fails, the app does not ask.
 *
 *   1. Not reviewed yet         the store has not already reviewed the app
 *   2. Yearly limit             fewer than REVIEW_MAX_PROMPTS popups shown in
 *                               the last 365 days
 *   3. Cooldown                 never asked, or the last ask was at least
 *                               REVIEW_COOLDOWN_DAYS ago
 *   4. Time since install       more than REVIEW_MIN_HOURS since the store
 *                               first opened the app, which happens at install
 *   5. Store is set up          ANY ONE of: a model assigned to a product, a
 *                               model in the 3D Model Library, the product
 *                               viewer block in the live theme, the page
 *                               viewer block in the live theme
 *   6. Lifetime views           more than REVIEW_MIN_VIEWS storefront 3D views
 *                               in total, every placement, since install
 *   7. Once per visit           enforced in the browser (ReviewPrompt.tsx)
 *   8. Success moment           the rule is only evaluated at the moments in
 *                               ReviewTrigger; a plain page load never asks
 *
 * The views-milestone trigger (dashboard and Analytics load) additionally fires
 * only once per store: AppUser.reviewViewsMilestoneAt records that it was used.
 */

/** Hours since install must be more than this before the first ask. */
export const REVIEW_MIN_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;
/** Days between asks. Matches Shopify's own limit. */
export const REVIEW_COOLDOWN_DAYS = 60;
/** Popups shown in any 365 days. Matches Shopify's own limit. */
export const REVIEW_MAX_PROMPTS = 3;
const YEAR_DAYS = 365;
/** Lifetime storefront 3D views must be more than this. */
export const REVIEW_MIN_VIEWS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When the popup was shown to this store in the last 365 days. Rows from
 * before the date list existed fall back to their last recorded ask.
 */
function popupsThisYear(
  user: Pick<
    AppUser,
    "reviewPromptDates" | "lastReviewPromptAt" | "reviewPromptCount"
  >,
  now = Date.now(),
): Date[] {
  const dates =
    user.reviewPromptDates && user.reviewPromptDates.length > 0
      ? user.reviewPromptDates
      : user.lastReviewPromptAt && (user.reviewPromptCount ?? 0) > 0
        ? [user.lastReviewPromptAt]
        : [];
  return dates.filter((d) => now - d.getTime() < YEAR_DAYS * DAY_MS);
}

/** The success moments that may ask. Rule 8. */
export type ReviewTrigger =
  | "views-milestone"
  | "onboarding-finished"
  | "theme-block-confirmed"
  | "settings-saved"
  | "model-assigned";

export const REVIEW_TRIGGERS: readonly ReviewTrigger[] = [
  "views-milestone",
  "onboarding-finished",
  "theme-block-confirmed",
  "settings-saved",
  "model-assigned",
];

export function isReviewTrigger(value: unknown): value is ReviewTrigger {
  return REVIEW_TRIGGERS.includes(value as ReviewTrigger);
}

/**
 * What a loader or action hands the browser at a success moment. A fresh `id`
 * per evaluation lets the browser tell a new moment from a re-render.
 * `debug` is only present when review debugging is allowed on this server.
 */
export type ReviewPromptSignal = {
  id: string;
  trigger: ReviewTrigger;
  ask: boolean;
  debug?: { failed: string[]; views: number | null };
};

/**
 * Debug details (which rule failed, the view count) are sent to the browser
 * only outside production, or when REVIEW_DEBUG=1 is set on the server. The
 * browser still has to opt in with `?review=debug`.
 */
export function reviewDebugAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" || process.env.REVIEW_DEBUG === "1"
  );
}

/*
 * Lifetime view totals, kept briefly. The dashboard and Analytics loaders
 * evaluate the views milestone on every load until it is used, so this keeps
 * that to one aggregate per shop per minute.
 */
const VIEWS_TTL_MS = 60_000;
const viewsCache = new Map<string, { at: number; value: number }>();

/** Every storefront 3D view this store has ever had, across placements. */
export async function getLifetimeViews(shop: string): Promise<number> {
  const hit = viewsCache.get(shop);
  if (hit && Date.now() - hit.at < VIEWS_TTL_MS) return hit.value;
  const result = await prisma.viewerStat.aggregate({
    where: { shop, event: "view" },
    _sum: { count: true },
  });
  const value = result._sum.count ?? 0;
  viewsCache.set(shop, { at: Date.now(), value });
  return value;
}

/** Rules 1 to 4: what the user row alone decides. */
function userRuleFailures(user: AppUser, trigger: ReviewTrigger): string[] {
  const failed: string[] = [];
  const now = Date.now();
  if (user.reviewed) failed.push("Rule 1: store has already reviewed");
  const shown = popupsThisYear(user, now).length;
  if (shown >= REVIEW_MAX_PROMPTS) {
    failed.push(
      `Rule 2: popup shown ${shown} times in the last ${YEAR_DAYS} days, limit ${REVIEW_MAX_PROMPTS}`,
    );
  }
  if (
    user.lastReviewPromptAt &&
    now - user.lastReviewPromptAt.getTime() < REVIEW_COOLDOWN_DAYS * DAY_MS
  ) {
    const days = Math.floor(
      (now - user.lastReviewPromptAt.getTime()) / DAY_MS,
    );
    failed.push(
      `Rule 3: last asked ${days} days ago, needs ${REVIEW_COOLDOWN_DAYS}`,
    );
  }
  // createdAt, not planSelectedAt: a reinstall resets the plan choice but
  // not how long the store has been using the app.
  if (now - user.createdAt.getTime() <= REVIEW_MIN_HOURS * HOUR_MS) {
    failed.push(`Rule 4: installed ${REVIEW_MIN_HOURS} hours ago or less`);
  }
  if (trigger === "views-milestone" && user.reviewViewsMilestoneAt) {
    failed.push("Rule 8: views milestone already used");
  }
  return failed;
}

/** Facts a caller already has in hand, so they are not read twice. */
export type ReviewFacts = {
  user?: AppUser;
  libraryCount?: number;
  assignedCount?: number;
  productBlockAdded?: boolean;
  pageBlockAdded?: boolean;
};

type AdminClient = Parameters<typeof getAssignedModelGidsCached>[0];

/**
 * Runs every rule for one success moment and returns what the browser needs.
 *
 * In production it stops at the first failure, cheapest rules first. With
 * debugging allowed it checks every rule, so the debug toast can list each one
 * that failed.
 *
 * Never throws: a lookup error means no ask.
 */
export async function evaluateReviewPrompt(
  admin: AdminClient,
  shop: string,
  trigger: ReviewTrigger,
  facts: ReviewFacts = {},
): Promise<ReviewPromptSignal> {
  const debug = reviewDebugAllowed();
  const failed: string[] = [];
  let views: number | null = null;

  const done = (): ReviewPromptSignal => ({
    id: randomUUID(),
    trigger,
    ask: failed.length === 0,
    ...(debug ? { debug: { failed, views } } : {}),
  });

  try {
    if (!shop) {
      failed.push("No shop");
      return done();
    }

    const user = facts.user ?? (await getOrCreateUser(shop));
    failed.push(...userRuleFailures(user, trigger));
    if (failed.length && !debug) return done();

    // Rule 6: lifetime views.
    views = await getLifetimeViews(shop);
    if (views <= REVIEW_MIN_VIEWS) {
      failed.push(
        `Rule 6: lifetime views ${views}, needs more than ${REVIEW_MIN_VIEWS}`,
      );
      if (!debug) return done();
    }

    // Rule 5: any one of four setup options. Cheapest first, and stop at the
    // first one that is true.
    const libraryCount =
      facts.libraryCount ?? (await prisma.model3D.count({ where: { shop } }));
    let setUp = libraryCount > 0;
    if (!setUp) {
      const assignedCount =
        facts.assignedCount ??
        (await getAssignedModelGidsCached(admin, shop)).count;
      setUp = assignedCount > 0;
    }
    if (!setUp) {
      let productBlock = facts.productBlockAdded;
      let pageBlock = facts.pageBlockAdded;
      if (productBlock === undefined || pageBlock === undefined) {
        const blocks = await checkThemeBlocksCached(admin, shop);
        productBlock = blocks.productBlockAdded;
        pageBlock = blocks.pageBlockAdded;
      }
      setUp = Boolean(productBlock || pageBlock);
    }
    if (!setUp) {
      failed.push(
        "Rule 5: no model on a product or in the library, and no viewer block in the theme",
      );
    }
    return done();
  } catch (error) {
    console.error("[review] eligibility check failed", error);
    failed.push("Eligibility check failed, see server log");
    return done();
  }
}

/** One line of the debug panel's rule checklist. */
export type ReviewRuleStatus = {
  rule: string;
  pass: boolean;
  detail: string;
};

/**
 * Every server-side rule, each checked in full, for the debug panel
 * (components/ReviewPrompt.tsx). Rules 7 and 8 live in the browser and are
 * added there. Only served when reviewDebugAllowed().
 */
export async function reviewRuleReport(
  admin: AdminClient,
  shop: string,
): Promise<{ rules: ReviewRuleStatus[]; milestoneUsed: boolean }> {
  const now = Date.now();
  const days = (d: Date) => Math.floor((now - d.getTime()) / DAY_MS);
  const [user, views, libraryCount, assigned, blocks] = await Promise.all([
    getOrCreateUser(shop),
    getLifetimeViews(shop),
    prisma.model3D.count({ where: { shop } }),
    getAssignedModelGidsCached(admin, shop),
    checkThemeBlocksCached(admin, shop),
  ]);

  const shown = popupsThisYear(user, now).length;
  const last = user.lastReviewPromptAt;
  const installedHours = Math.floor((now - user.createdAt.getTime()) / HOUR_MS);
  const setUp = [
    assigned.count > 0 && `${assigned.count} on products`,
    libraryCount > 0 && `${libraryCount} in library`,
    blocks.productBlockAdded && "product block",
    blocks.pageBlockAdded && "page block",
  ].filter(Boolean) as string[];

  return {
    milestoneUsed: Boolean(user.reviewViewsMilestoneAt),
    rules: [
      {
        rule: "1. Not reviewed yet",
        pass: !user.reviewed,
        detail: user.reviewed ? "Store has reviewed" : "Not reviewed",
      },
      {
        rule: "2. Yearly limit",
        pass: shown < REVIEW_MAX_PROMPTS,
        detail: `${shown} of ${REVIEW_MAX_PROMPTS} popups in the last ${YEAR_DAYS} days`,
      },
      {
        rule: "3. Cooldown",
        pass: !last || now - last.getTime() >= REVIEW_COOLDOWN_DAYS * DAY_MS,
        detail: last
          ? `Last asked ${days(last)} days ago, needs ${REVIEW_COOLDOWN_DAYS}`
          : "Never asked",
      },
      {
        rule: "4. Time since install",
        pass: now - user.createdAt.getTime() > REVIEW_MIN_HOURS * HOUR_MS,
        detail: `Installed ${installedHours} hours ago, needs more than ${REVIEW_MIN_HOURS}`,
      },
      {
        rule: "5. Store is set up",
        pass: setUp.length > 0,
        detail: setUp.length ? setUp.join(", ") : "No model and no viewer block",
      },
      {
        rule: "6. Lifetime views",
        pass: views > REVIEW_MIN_VIEWS,
        detail: `${views} views, needs more than ${REVIEW_MIN_VIEWS}`,
      },
    ],
  };
}

/**
 * Records what `shopify.reviews.request()` answered.
 *
 *  - shown            counts as an ask and starts the cooldown
 *  - already-reviewed stop asking for good
 *  - cooldown-period / annual-limit-reached
 *                     Shopify is rate-limiting us: back off for a cooldown,
 *                     without counting it as one of our asks
 *  - anything else    (recently installed, mobile app, already open, …)
 *                     nothing recorded; the next success moment may try again
 *
 * The views milestone is marked used whatever Shopify answered, so it fires
 * once per store.
 */
export async function recordReviewPrompt(
  shop: string,
  outcome: { success: boolean; code?: string; trigger?: ReviewTrigger },
): Promise<void> {
  if (!shop) return;
  const milestone =
    outcome.trigger === "views-milestone"
      ? { reviewViewsMilestoneAt: new Date() }
      : {};

  if (outcome.success) {
    // Read and set rather than `increment`: the field is unset on older rows,
    // and an increment of a missing value is not something to rely on.
    const user = await prisma.appUser.findUnique({
      where: { shop },
      select: {
        reviewPromptCount: true,
        reviewPromptDates: true,
        lastReviewPromptAt: true,
      },
    });
    const now = new Date();
    await prisma.appUser.updateMany({
      where: { shop },
      data: {
        lastReviewPromptAt: now,
        // Lifetime total, kept for reporting. Rule 2 reads the dates.
        reviewPromptCount: (user?.reviewPromptCount ?? 0) + 1,
        // Only the last year's dates are kept: older ones no longer count.
        reviewPromptDates: [
          ...(user ? popupsThisYear(user, now.getTime()) : []),
          now,
        ],
        ...milestone,
      },
    });
    return;
  }
  if (outcome.code === "already-reviewed") {
    await prisma.appUser.updateMany({
      where: { shop },
      data: { reviewed: true, ...milestone },
    });
    return;
  }
  if (
    outcome.code === "cooldown-period" ||
    outcome.code === "annual-limit-reached"
  ) {
    await prisma.appUser.updateMany({
      where: { shop },
      data: { lastReviewPromptAt: new Date(), ...milestone },
    });
    return;
  }
  if (outcome.trigger === "views-milestone") {
    await prisma.appUser.updateMany({ where: { shop }, data: milestone });
  }
}
