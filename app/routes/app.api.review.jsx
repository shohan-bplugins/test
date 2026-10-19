// App Store review popup — eligibility and bookkeeping.
//
// GET  → { eligible, rules } — may the app ask this store for a review now?
// POST → { code } — record what shopify.reviews.request() answered.
//
// The popup is only requested when ALL of these hold:
//   1. Not reviewed yet   — Shopify never answered "already-reviewed"
//   2. Yearly limit       — shown fewer than 3 times in the last 365 days
//   3. Cooldown           — never asked, or the last ask was 60+ days ago
//   4. Time since install — installed more than 24 hours ago
//   5. Store is set up    — at least one player (single or multiple) exists;
//                           every placement (product video, theme block,
//                           embed) needs one
//   6. Lifetime plays     — more than 5 storefront plays, all placements
//   7. Once per visit     — enforced in the browser (reviewPrompt.client.js)
//
// Shopify enforces 1–4 itself as well; checking them here first means the app
// never spends a request Shopify is going to refuse, and keeps a record when
// it does refuse (e.g. a popup shown from another device).

import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

const DAY_MS = 24 * 60 * 60 * 1000;
const YEARLY_LIMIT = 3;
const COOLDOWN_DAYS = 60;
const MIN_INSTALL_HOURS = 24;
const MIN_PLAYS = 5;

// Every code shopify.reviews.request() can return.
const KNOWN_CODES = new Set([
  "success",
  "already-open",
  "already-reviewed",
  "annual-limit-reached",
  "cancelled",
  "cooldown-period",
  "merchant-ineligible",
  "mobile-app",
  "open-in-progress",
  "recently-installed",
]);

// Codes that mean the store was asked (or Shopify says it was, elsewhere) —
// they start the 60-day cooldown.
const ASKED_CODES = ["success", "cooldown-period", "merchant-ineligible"];

async function evaluate(shop) {
  const now = Date.now();
  const yearAgo = new Date(now - 365 * DAY_MS);

  const [user, reviewed, shownThisYear, lastAsk, annualCap, players, plays] =
    await Promise.all([
      prisma.users.findUnique({ where: { shop }, select: { createdAt: true } }),
      prisma.reviewPrompt.count({ where: { shop, code: "already-reviewed" } }),
      prisma.reviewPrompt.count({
        where: { shop, code: "success", createdAt: { gte: yearAgo } },
      }),
      prisma.reviewPrompt.findFirst({
        where: { shop, code: { in: ASKED_CODES } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.reviewPrompt.count({
        where: { shop, code: "annual-limit-reached", createdAt: { gte: yearAgo } },
      }),
      prisma.video.count({ where: { shop } }),
      // Only "more than 5" matters, so stop counting at 6.
      prisma.videoPlay.count({ where: { shop }, take: MIN_PLAYS + 1 }),
    ]);

  const installedAt = user?.createdAt ? new Date(user.createdAt).getTime() : now;

  const rules = {
    notReviewed: reviewed === 0,
    yearlyLimit: shownThisYear < YEARLY_LIMIT && annualCap === 0,
    cooldown:
      !lastAsk ||
      now - new Date(lastAsk.createdAt).getTime() >= COOLDOWN_DAYS * DAY_MS,
    installAge: now - installedAt > MIN_INSTALL_HOURS * 60 * 60 * 1000,
    storeSetUp: players > 0,
    lifetimePlays: plays > MIN_PLAYS,
  };

  return { eligible: Object.values(rules).every(Boolean), rules };
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  try {
    return json(await evaluate(session.shop));
  } catch (error) {
    console.error("[review] eligibility check failed:", error);
    return json({ eligible: false });
  }
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const code = typeof body?.code === "string" ? body.code : "";
    if (!KNOWN_CODES.has(code)) {
      return json({ error: "Unknown code" }, { status: 400 });
    }
    await prisma.reviewPrompt.create({ data: { shop: session.shop, code } });
    return json({ ok: true });
  } catch (error) {
    console.error("[review] could not record result:", error);
    return json({ ok: false }, { status: 500 });
  }
};
