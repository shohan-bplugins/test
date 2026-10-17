import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { buildAnalytics, loadShopPlan } from "../lib/analytics.server";
import { COMING_SOON_PLAYER_TYPES } from "../lib/analytics-shared";
import { loadProductAssignments } from "../lib/product-audio.server";

export async function loader({ request }) {
  // Auth stays outside the try so its redirects / responses still propagate.
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop;

  // Any failure here returns `{ error: true }` so the Dashboard can show an
  // inline error instead of the whole page hitting the error boundary.
  try {
    return await loadDashboardAnalytics({ admin, shop });
  } catch (e) {
    console.error("dashboard-analytics failed:", e);
    return json({ error: true });
  }
}

async function loadDashboardAnalytics({ admin, shop }) {
  const { isFree } = await loadShopPlan(shop);

  const audios = await prisma.audio.findMany({
    where: { shop },
    select: { id: true, title: true, playerType: true },
  });

  const allIds = audios
    .filter((a) => !COMING_SOON_PLAYER_TYPES.has(a.playerType))
    .map((a) => a.id);

  if (allIds.length === 0) {
    return json({
      totalPlays: 0,
      todayPlays: 0,
      weekPlays: 0,
      monthPlays: 0,
      topPlayer: null,
      product: null,
      isFree,
    });
  }

  // Run all ranges in parallel — same buildAnalytics used by Analytics V2
  const [allTime, today, lastWeek, lastMonth] = await Promise.all([
    buildAnalytics({ shop, audioIds: allIds, filter: "all", isFree: false }),
    buildAnalytics({ shop, audioIds: allIds, filter: "today", isFree: false }),
    buildAnalytics({ shop, audioIds: allIds, filter: "last7", isFree: false }),
    buildAnalytics({ shop, audioIds: allIds, filter: "last30", isFree: false }),
  ]);

  // Top player by all-time plays (per-audio breakdown via groupBy)
  let topPlayer = null;
  try {
    const topRows = await prisma.analytics.groupBy({
      by: ["audioId"],
      where: { shop, audioId: { in: allIds }, event: "play" },
      _count: { audioId: true },
      orderBy: { _count: { audioId: "desc" } },
      take: 1,
    });
    if (topRows.length > 0) {
      const found = audios.find((a) => a.id === topRows[0].audioId);
      if (found) topPlayer = { ...found, plays: topRows[0]._count.audioId };
    }
  } catch (e) {
    console.error("dashboard-analytics top player failed:", e.message);
  }

  // Product-page analytics: only players assigned to one or more products.
  let product = null;
  try {
    const assignments = await loadProductAssignments(admin);
    const supportedIdSet = new Set(allIds);
    const assignedIds = Array.from(
      new Set(assignments.map((a) => a.audioId)),
    ).filter((id) => supportedIdSet.has(id));

    if (assignedIds.length > 0) {
      const [pAll, pToday, pWeek, pMonth] = await Promise.all([
        buildAnalytics({ shop, audioIds: assignedIds, filter: "all", isFree: false }),
        buildAnalytics({ shop, audioIds: assignedIds, filter: "today", isFree: false }),
        buildAnalytics({ shop, audioIds: assignedIds, filter: "last7", isFree: false }),
        buildAnalytics({ shop, audioIds: assignedIds, filter: "last30", isFree: false }),
      ]);

      let topProduct = null;
      const topRows = await prisma.analytics.groupBy({
        by: ["audioId"],
        where: { shop, audioId: { in: assignedIds }, event: "play" },
        _count: { audioId: true },
        orderBy: { _count: { audioId: "desc" } },
        take: 1,
      });
      if (topRows.length > 0) {
        const assignment = assignments.find(
          (a) => a.audioId === topRows[0].audioId,
        );
        topProduct = {
          productTitle: assignment?.productTitle ?? "Product",
          productId: assignment?.productId ?? null,
          plays: topRows[0]._count.audioId,
        };
      }

      const productsTracked = new Set(
        assignments
          .filter((a) => supportedIdSet.has(a.audioId))
          .map((a) => a.productId),
      ).size;

      product = {
        totalPlays: pAll.totalPlay,
        todayPlays: pToday.totalPlay,
        weekPlays: pWeek.totalPlay,
        monthPlays: pMonth.totalPlay,
        topProduct,
        productsTracked,
      };
    }
  } catch (e) {
    console.error("dashboard-analytics product data failed:", e.message);
  }

  return json({
    totalPlays: allTime.totalPlay,
    todayPlays: today.totalPlay,
    weekPlays: lastWeek.totalPlay,
    monthPlays: lastMonth.totalPlay,
    topPlayer,
    product,
    isFree,
  });
}
