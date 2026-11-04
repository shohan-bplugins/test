import type { Prisma } from "@prisma/client";

import prisma from "../db.server";

/*
 * Storefront engagement counters for the Analytics page.
 *
 * Events arrive from three places — the theme blocks (through the app proxy,
 * routes/proxy.track.tsx), the public /viewer/:id embed, and its interaction
 * beacon (routes/api.viewer-event.tsx) — and are summed in memory, then flushed
 * to Mongo as one upsert-and-increment per daily bucket every few seconds.
 *
 * Buffered rather than written per event because a busy storefront can send
 * many events a second, each of which would otherwise be its own Mongo upsert
 * (several round trips) on this single process. The cost is that a crash loses
 * at most one flush interval of counts, which is fine for analytics.
 *
 * Nothing about the shopper is stored: no IP, no user agent, no session — only
 * how many times each viewer was seen, used, or opened in AR, per day.
 */

import {
  type AnalyticsOverview,
  type Device,
  type Placement,
  type ViewerEvent,
} from "~/lib/viewer-stats";

export {
  EVENTS,
  PLACEMENTS,
  isPlacement,
  isViewerEvent,
  toDevice,
  type Device,
  type Placement,
  type ViewerEvent,
} from "~/lib/viewer-stats";

/**
 * Normalises what the storefront says it viewed into a bounded target key.
 * Anything unrecognisable becomes "-" so a crafted request cannot mint
 * arbitrary rows.
 */
export function toTarget(raw: unknown): string {
  const value = String(raw ?? "");
  const product = value.match(/^(?:gid:\/\/shopify\/Product\/)?(\d{1,20})$/);
  if (product) return `product:${product[1]}`;
  const model = value.match(/^model:([0-9a-f-]{36})$/i);
  if (model) return `model:${model[1].toLowerCase()}`;
  return "-";
}

const FLUSH_MS = 5_000;
/** A runaway client must not grow the buffer without bound. */
const MAX_BUCKETS = 50_000;
/*
 * Upserts in flight at once during a flush. A burst of traffic touches many
 * buckets; firing them all together would queue thousands of operations on the
 * Mongo connection pool and stall every other query in the app behind them.
 */
const FLUSH_CONCURRENCY = 16;

type State = {
  pending: Map<string, number>;
  timer: ReturnType<typeof setTimeout> | null;
  /** The flush in progress, so two never overlap. */
  flushing: Promise<void> | null;
  /** Per shop: when its counters last changed in the database. */
  lastWrite: Map<string, number>;
  /** Analytics query results, valid until the shop's next write. */
  results: Map<string, { at: number; value: unknown }>;
};
// globalThis, so a dev hot reload does not strand counts in an old module.
const g = globalThis as typeof globalThis & { __viewerStats?: State };
const state: State = (g.__viewerStats ??= {
  pending: new Map(),
  timer: null,
  flushing: null,
  lastWrite: new Map(),
  results: new Map(),
});
// Fields added after the first version of this state object.
state.flushing ??= null;
state.lastWrite ??= new Map();
state.results ??= new Map();

const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

function scheduleFlush() {
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    void flushViewerStats();
  }, FLUSH_MS);
  // Never the reason the process stays alive.
  state.timer.unref?.();
}

export function recordViewerEvent(
  shop: string,
  placement: Placement,
  event: ViewerEvent,
  target: string,
  device: Device,
  /** How much to add: 1 for a count, a number of seconds for dwell_s. */
  amount = 1,
): void {
  if (!shop || !(amount > 0)) return;
  const key = JSON.stringify([
    shop,
    utcDay(),
    placement,
    event,
    target,
    device,
  ]);
  if (!state.pending.has(key) && state.pending.size >= MAX_BUCKETS) return;
  state.pending.set(key, (state.pending.get(key) ?? 0) + Math.round(amount));
  scheduleFlush();
}

async function writeBucket(key: string, count: number): Promise<void> {
  const [shop, day, placement, event, target, device] = JSON.parse(
    key,
  ) as string[];
  const where = {
    shop_day_placement_event_target_device: {
      shop,
      day,
      placement,
      event,
      target,
      device,
    },
  };
  try {
    await prisma.viewerStat.upsert({
      where,
      create: { shop, day, placement, event, target, device, count },
      update: { count: { increment: count } },
    });
  } catch (error) {
    // Two upserts creating the same new bucket at once: the loser hits the
    // unique index, and by then the row exists, so increment it.
    if ((error as { code?: string })?.code === "P2002") {
      await prisma.viewerStat
        .update({ where, data: { count: { increment: count } } })
        .catch((e) => console.error("[viewer-stats] retry failed", e));
    } else {
      console.error("[viewer-stats] flush failed", error);
    }
  }
}

export function flushViewerStats(): Promise<void> {
  // One flush at a time; anything recorded meanwhile waits for the next.
  if (state.flushing) return state.flushing;
  if (state.pending.size === 0) return Promise.resolve();
  const batch = [...state.pending];
  state.pending = new Map();

  state.flushing = (async () => {
    const shops = new Set<string>();
    for (let i = 0; i < batch.length; i += FLUSH_CONCURRENCY) {
      const slice = batch.slice(i, i + FLUSH_CONCURRENCY);
      await Promise.all(slice.map(([key, count]) => writeBucket(key, count)));
      for (const [key] of slice) shops.add(JSON.parse(key)[0]);
    }
    const now = Date.now();
    for (const shop of shops) state.lastWrite.set(shop, now);
  })().finally(() => {
    state.flushing = null;
    if (state.pending.size) scheduleFlush();
  });
  return state.flushing;
}

/*
 * Read-side cache. A result stays valid until that shop's counters next change
 * (a flush that touched it), with an upper age as a backstop — so a merchant
 * leaving Analytics open on a quiet store, refreshing every minute, costs no
 * database work at all, and several staff on one store share one query.
 */
const RESULT_MAX_AGE_MS = 10 * 60_000;
const RESULT_MAX_ENTRIES = 2_000;

async function cached<T>(key: string, shop: string, load: () => Promise<T>) {
  const hit = state.results.get(key);
  const lastWrite = state.lastWrite.get(shop) ?? 0;
  if (hit && hit.at >= lastWrite && Date.now() - hit.at < RESULT_MAX_AGE_MS) {
    return hit.value as T;
  }
  const startedAt = Date.now();
  const value = await load();
  // Timestamped when the read began: a flush landing mid-read invalidates it.
  state.results.set(key, { at: startedAt, value });
  if (state.results.size > RESULT_MAX_ENTRIES) {
    // Oldest first — Map iteration is insertion order.
    const drop = state.results.size - RESULT_MAX_ENTRIES;
    let i = 0;
    for (const k of state.results.keys()) {
      if (i++ >= drop) break;
      state.results.delete(k);
    }
  }
  return value;
}

const HEADLINE = ["view", "interact", "ar"];

export type AnalyticsData = {
  /** Current range, per day, headline events only. */
  daily: { day: string; event: string; count: number }[];
  /** Every event, summed over the current range. */
  current: Record<string, number>;
  /** Every event, summed over the previous range of the same length. */
  previous: Record<string, number>;
  byPlacement: { placement: string; event: string; count: number }[];
  byDevice: { device: string; event: string; count: number }[];
  top: {
    placement: string;
    target: string;
    view: number;
    interact: number;
    ar: number;
  }[];
};

/** aggregateRaw returns Extended JSON: large sums arrive as {$numberLong}. */
function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, string>;
    return Number(o.$numberLong ?? o.$numberInt ?? o.$numberDouble ?? 0);
  }
  return Number(v) || 0;
}

type Grouped = { _id: Record<string, string | null>; count: unknown };

/**
 * Everything the Analytics page shows, summed by MongoDB rather than here.
 *
 * One aggregation, one round trip: a $match on the (shop, day) index, then a
 * $facet that groups the same matched rows several ways at once. What comes
 * back is a few hundred summary rows at most, however many daily counter rows
 * a large store has — the work scales with the index range, not with what the
 * Node process has to hold. Cached until the shop's next write.
 *
 * Raw rather than Prisma's groupBy: the query engine panics grouping on a
 * field some documents lack (`device`, absent on rows written before it
 * existed), and $ifNull handles that here.
 */
export function getAnalytics(
  shop: string,
  range: {
    prevFrom: string;
    from: string;
    to: string;
    placement: Placement | "all";
  },
): Promise<AnalyticsData> {
  // Counts still buffered go out beside this read, never in front of it.
  void flushViewerStats().catch(() => {});

  const { prevFrom, from, to, placement } = range;
  const key = JSON.stringify([
    "analytics",
    shop,
    prevFrom,
    from,
    to,
    placement,
  ]);
  return cached(key, shop, async () => {
    const inCurrent = { day: { $gte: from, $lte: to } };
    const headline = { ...inCurrent, event: { $in: HEADLINE } };
    const sumBy = (id: Prisma.InputJsonObject) => ({
      $group: { _id: id, count: { $sum: "$count" } },
    });

    const result = (await prisma.viewerStat.aggregateRaw({
      pipeline: [
        {
          $match: {
            shop,
            day: { $gte: prevFrom, $lte: to },
            ...(placement === "all" ? {} : { placement }),
          },
        },
        {
          $facet: {
            daily: [
              { $match: headline },
              sumBy({ day: "$day", event: "$event" }),
            ],
            current: [{ $match: inCurrent }, sumBy({ event: "$event" })],
            previous: [
              { $match: { day: { $gte: prevFrom, $lt: from } } },
              sumBy({ event: "$event" }),
            ],
            byPlacement: [
              { $match: headline },
              sumBy({ placement: "$placement", event: "$event" }),
            ],
            byDevice: [
              { $match: headline },
              sumBy({
                device: { $ifNull: ["$device", "unknown"] },
                event: "$event",
              }),
            ],
            // Per product/model, all three headline events in one pass;
            // ranked and cut to ten by MongoDB.
            top: [
              { $match: { ...headline, target: { $ne: "-" } } },
              {
                $group: {
                  _id: { placement: "$placement", target: "$target" },
                  view: {
                    $sum: { $cond: [{ $eq: ["$event", "view"] }, "$count", 0] },
                  },
                  interact: {
                    $sum: {
                      $cond: [{ $eq: ["$event", "interact"] }, "$count", 0],
                    },
                  },
                  ar: {
                    $sum: { $cond: [{ $eq: ["$event", "ar"] }, "$count", 0] },
                  },
                },
              },
              { $match: { view: { $gt: 0 } } },
              { $sort: { view: -1, interact: -1 } },
              { $limit: 10 },
            ],
          },
        },
      ],
    })) as unknown as {
      daily: Grouped[];
      current: Grouped[];
      previous: Grouped[];
      byPlacement: Grouped[];
      byDevice: Grouped[];
      top: {
        _id: { placement: string; target: string };
        view: unknown;
        interact: unknown;
        ar: unknown;
      }[];
    }[];

    const f = result[0] ?? {
      daily: [],
      current: [],
      previous: [],
      byPlacement: [],
      byDevice: [],
      top: [],
    };
    const toRecord = (rows: Grouped[]) =>
      Object.fromEntries(rows.map((r) => [String(r._id.event), num(r.count)]));

    return {
      daily: f.daily.map((r) => ({
        day: String(r._id.day),
        event: String(r._id.event),
        count: num(r.count),
      })),
      current: toRecord(f.current),
      previous: toRecord(f.previous),
      byPlacement: f.byPlacement.map((r) => ({
        placement: String(r._id.placement),
        event: String(r._id.event),
        count: num(r.count),
      })),
      byDevice: f.byDevice.map((r) => ({
        device: String(r._id.device ?? "unknown"),
        event: String(r._id.event),
        count: num(r.count),
      })),
      top: f.top.map((t) => ({
        placement: t._id.placement,
        target: t._id.target,
        view: num(t.view),
        interact: num(t.interact),
        ar: num(t.ar),
      })),
    };
  });
}

export type ViewsOnlyData = {
  daily: { day: string; count: number }[];
  current: number;
  previous: number;
};

/**
 * The Free plan's analytics: 3D views and nothing else. A query of its own,
 * matching only `event: "view"`, so nothing a Free store has not paid for is
 * read from the database, let alone sent to the browser. Every placement.
 */
export function getViewsOnly(
  shop: string,
  range: { prevFrom: string; from: string; to: string },
): Promise<ViewsOnlyData> {
  void flushViewerStats().catch(() => {});
  const { prevFrom, from, to } = range;
  const key = JSON.stringify(["views", shop, prevFrom, from, to]);
  return cached(key, shop, async () => {
    const result = (await prisma.viewerStat.aggregateRaw({
      pipeline: [
        {
          $match: {
            shop,
            event: "view",
            day: { $gte: prevFrom, $lte: to },
          },
        },
        {
          $facet: {
            daily: [
              { $match: { day: { $gte: from } } },
              { $group: { _id: "$day", count: { $sum: "$count" } } },
            ],
            current: [
              { $match: { day: { $gte: from } } },
              { $group: { _id: null, count: { $sum: "$count" } } },
            ],
            previous: [
              { $match: { day: { $lt: from } } },
              { $group: { _id: null, count: { $sum: "$count" } } },
            ],
          },
        },
      ],
    })) as unknown as {
      daily: { _id: string; count: unknown }[];
      current: { count: unknown }[];
      previous: { count: unknown }[];
    }[];
    const f = result[0];
    return {
      daily: (f?.daily ?? []).map((r) => ({
        day: String(r._id),
        count: num(r.count),
      })),
      current: num(f?.current?.[0]?.count ?? 0),
      previous: num(f?.previous?.[0]?.count ?? 0),
    };
  });
}

/** Targets viewed at least once in the range, any placement — for "never viewed". */
export function getViewedTargets(
  shop: string,
  from: string,
  to: string,
): Promise<string[]> {
  const key = JSON.stringify(["viewed", shop, from, to]);
  return cached(key, shop, async () => {
    const rows = (await prisma.viewerStat.aggregateRaw({
      pipeline: [
        {
          $match: {
            shop,
            day: { $gte: from, $lte: to },
            event: "view",
            target: { $ne: "-" },
            count: { $gt: 0 },
          },
        },
        { $group: { _id: "$target" } },
      ],
    })) as unknown as { _id: string }[];
    return rows.map((r) => String(r._id));
  });
}

const OVERVIEW_DAYS = 30;
/** The Free plan's window on the Home card. */
const FREE_OVERVIEW_DAYS = 7;

/**
 * The Home page's analytics card. Built from the same cached aggregations as
 * the Analytics page, so opening Home after Analytics (or the reverse) costs no
 * extra database work. Every number on every plan; the Free plan sees the last
 * 7 days, paid plans the last 30, each compared with the period before.
 */
export async function getAnalyticsOverview(
  shop: string,
  paid: boolean,
): Promise<AnalyticsOverview> {
  const span = paid ? OVERVIEW_DAYS : FREE_OVERVIEW_DAYS;
  const DAY = 86_400_000;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const today = Date.parse(iso(Date.now()));
  const to = iso(today);
  const from = iso(today - (span - 1) * DAY);
  const prevFrom = iso(today - (2 * span - 1) * DAY);
  const days = Array.from({ length: span }, (_, i) =>
    iso(Date.parse(from) + i * DAY),
  );

  const a = await getAnalytics(shop, { prevFrom, from, to, placement: "all" });
  const byDay = new Map<string, number>();
  for (const r of a.daily) {
    if (r.event === "view") byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.count);
  }
  return {
    paid,
    days: span,
    views: a.current.view ?? 0,
    viewsPrev: a.previous.view ?? 0,
    interact: a.current.interact ?? 0,
    interactPrev: a.previous.interact ?? 0,
    ar: a.current.ar ?? 0,
    arPrev: a.previous.ar ?? 0,
    daily: days.map((d) => byDay.get(d) ?? 0),
  };
}
