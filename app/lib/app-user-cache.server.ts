import type { AppUser } from "@prisma/client";

/*
 * Per-shop AppUser rows, kept in memory.
 *
 * Nearly every admin page reads the shop's row (getOrCreateUser) and nothing
 * else on the page could start until it came back — one Mongo round trip,
 * ~250ms against a remote Atlas cluster, on the critical path of every load.
 *
 * Correctness comes from db.server.ts, not from a TTL: its query extension
 * calls clearAppUserCache() around *every* AppUser write, from any route,
 * webhook or helper. That is only sound because the app runs as a single
 * process (ecosystem.config: fork mode, one instance) — a second instance
 * would not see the other's writes, and this would need a shared store.
 *
 * The TTL is a backstop for writes made outside the app (a manual DB edit).
 *
 * Kept on globalThis so a dev hot reload of this module and the long-lived
 * Prisma client in db.server.ts keep pointing at the same cache.
 */

const TTL_MS = 5 * 60_000;

type State = {
  rows: Map<string, { at: number; gen: number; value: AppUser }>;
  gen: number;
};

const g = globalThis as typeof globalThis & { __appUserCache?: State };
const state: State = (g.__appUserCache ??= { rows: new Map(), gen: 0 });

export function getCachedAppUser(shop: string): AppUser | null {
  const hit = state.rows.get(shop);
  if (!hit || hit.gen !== state.gen || Date.now() - hit.at > TTL_MS) {
    return null;
  }
  return hit.value;
}

/**
 * Stores a row read at generation `gen`. Dropped if any write happened since
 * the read began, so a read racing a write can never cache the old row.
 */
export function storeAppUser(shop: string, value: AppUser, gen: number): void {
  if (gen !== state.gen) return;
  state.rows.set(shop, { at: Date.now(), gen, value });
}

export function appUserCacheGeneration(): number {
  return state.gen;
}

/** Called by db.server.ts around every AppUser write. */
export function clearAppUserCache(): void {
  state.gen += 1;
  state.rows.clear();
}
