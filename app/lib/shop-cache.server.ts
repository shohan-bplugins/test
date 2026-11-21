/*
 * Short-lived per-shop caches for Shopify Admin API reads.
 *
 * Every admin page load repeats the same handful of questions about a store —
 * are the metafield definitions in place, is the theme block installed, what is
 * the active subscription — and each answer is a round trip to Shopify measured
 * in hundreds of milliseconds. They are also the slowest part of a loader by a
 * wide margin: the Prisma queries beside them are local.
 *
 * None of these is a decision point. They render a checklist tick, a plan name,
 * a badge. So they read through a cache with a short TTL, and every path in
 * this app that *changes* one of them drops the entry, which is what keeps the
 * merchant's own actions feeling immediate. The TTL only has to cover changes
 * made outside the app — a definition deleted in the Shopify admin, a block
 * removed in the theme editor.
 *
 * Deliberately a plain module-level Map, matching getAssignedModelGidsCached
 * which this generalises. That means per-process, so it is lost on deploy and
 * not shared between instances; both are fine for data whose worst failure is
 * being up to a minute stale, and neither is worth a Redis dependency.
 */

type Entry<T> = { at: number; value: T };

export type ShopCache<T> = {
  /** Read through the cache, calling `load` only on a miss or expiry. */
  read(shop: string, load: () => Promise<T>): Promise<T>;
  /** Drop a shop's entry. Call from any action that changes the underlying state. */
  invalidate(shop: string): void;
  /** Load now and store the answer, sharing a load already in the air. */
  refresh(shop: string, load: () => Promise<T>): Promise<T>;
};

export function createShopCache<T>(ttlMs: number): ShopCache<T> {
  const store = new Map<string, Entry<T>>();
  /*
   * Loads currently in the air, so a miss is paid for once rather than once per
   * caller. Without this, a TTL expiry lets every concurrent loader issue its
   * own round trip for the same answer — and these arrive in bursts, because
   * React Router runs a page's loaders in parallel and a merchant clicking
   * between pages after a minute idle hits every expiry at once. The collapsed
   * reads are simultaneous, so nothing here can serve a staler value than the
   * uncollapsed version would have.
   */
  const inFlight = new Map<string, Promise<T>>();
  /*
   * Bumped on every invalidation. A read that was already in the air when an
   * action changed this state would otherwise land afterwards and write the
   * pre-change answer back into the cache — the one case where a merchant's own
   * action appears not to have taken effect. Comparing the generation at write
   * time makes that result returnable to its caller but unstorable.
   */
  const generation = new Map<string, number>();

  const cache: ShopCache<T> = {
    async read(shop, load) {
      const hit = store.get(shop);
      const age = hit ? Date.now() - hit.at : Infinity;
      if (hit && age < ttlMs) return hit.value;

      const pending = inFlight.get(shop);

      /*
       * Stale-while-revalidate. Past the TTL but inside SHOP_CACHE_STALE_MS,
       * the old answer is returned at once and the refresh runs beside the
       * response rather than in front of it.
       *
       * Without this, a merchant who came back after a minute away paid every
       * Shopify read on the page in full — which made most real first loads
       * cold ones, and the slowest part of LCP. The values here are checklist
       * ticks and badges (see the note at the top), so one load of staleness
       * for a change made *outside* the app is the right trade; the app's own
       * changes still invalidate, which drops the entry and skips this path.
       */
      if (hit && age < SHOP_CACHE_STALE_MS) {
        if (!pending) {
          void cache.refresh(shop, load).catch((error) => {
            console.error("[shop-cache] background refresh failed", error);
          });
        }
        return hit.value;
      }

      if (pending) return pending;
      return this.refresh(shop, load);
    },

    refresh(shop, load) {
      const pending = inFlight.get(shop);
      if (pending) return pending;

      const startedAt = generation.get(shop) ?? 0;
      const request = load()
        .then((value) => {
          if ((generation.get(shop) ?? 0) === startedAt) {
            // Keyed on shop, so one store's answer can never be served to
            // another.
            store.set(shop, { at: Date.now(), value });
          }
          return value;
        })
        .finally(() => {
          // Only if it is still ours: an invalidation mid-flight may already
          // have cleared the slot for a newer read.
          if (inFlight.get(shop) === request) inFlight.delete(shop);
        });

      inFlight.set(shop, request);
      return request;
    },

    invalidate(shop) {
      store.delete(shop);
      inFlight.delete(shop);
      generation.set(shop, (generation.get(shop) ?? 0) + 1);
    },
  };
  return cache;
}

/**
 * The shared TTL. A minute is long enough that clicking between the dashboard,
 * products and the library costs one round trip rather than three per page, and
 * short enough that a change made in the Shopify admin shows up before a
 * merchant would think to reload twice.
 */
export const SHOP_CACHE_TTL_MS = 60_000;

/**
 * How long past the TTL an entry may still be served while it refreshes in the
 * background. Beyond this the read waits for fresh data.
 *
 * A day, so a merchant's first page of the day is fast too — at 15 minutes
 * nearly every real first load still paid for every Shopify read. What that
 * risks is one page load showing a value changed *outside* the app since the
 * last visit (a theme block removed in the theme editor, say); that load
 * itself triggers the refresh, so the next one is current. Plan changes do not
 * wait for that: the subscriptions webhook invalidates the subscription entry.
 */
export const SHOP_CACHE_STALE_MS = 24 * 60 * 60_000;
