import type { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";

/**
 * An in-memory read cache in front of another SessionStorage.
 *
 * Every authenticated request loads a session before it can do anything else,
 * and this app's sessions live in a MongoDB Atlas shared-tier cluster where a
 * single round trip costs on the order of 250ms. That read is therefore the
 * floor under TTFB on every admin page — and under FCP and LCP with it, since
 * neither can happen before the response starts.
 *
 * It is also the same read, over and over. A session changes on install, on
 * token exchange and on uninstall; in between, every request re-fetches a
 * document that has not moved.
 *
 * Two layers, with quite different safety profiles:
 *
 *   Single-flight  Concurrent loads of the same id share one promise. This
 *                  cannot go stale — the reads it collapses were simultaneous —
 *                  and it matters here because React Router runs the /app
 *                  layout loader and the page's own loader in parallel and both
 *                  call `authenticate.admin`, so every page load asked Atlas
 *                  for the same session twice.
 *
 *   TTL cache      A hit inside the window skips Atlas entirely. This can go
 *                  stale, so it is bounded and evicted precisely: every write
 *                  and delete goes through this object, and the app runs as a
 *                  single pm2 fork process, so nothing changes a session
 *                  without passing through here. The TTL is the backstop for
 *                  what remains — a row edited directly in Atlas, or a second
 *                  process someone adds later.
 *
 * `findSessionsByShop` is deliberately not cached. It is not on the request
 * path, and a stale list there would be a worse failure than a slow one.
 */

const DEFAULT_TTL_MS = 60_000;

type Entry = { session: Session | undefined; expiresAt: number };

export class CachedSessionStorage implements SessionStorage {
  readonly #inner: SessionStorage;
  readonly #ttlMs: number;
  readonly #entries = new Map<string, Entry>();
  readonly #inFlight = new Map<string, Promise<Session | undefined>>();

  constructor(inner: SessionStorage, ttlMs: number = DEFAULT_TTL_MS) {
    this.#inner = inner;
    this.#ttlMs = ttlMs;
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const cached = this.#entries.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.session;

    const pending = this.#inFlight.get(id);
    if (pending) return pending;

    const request = this.#inner
      .loadSession(id)
      .then((session) => {
        /*
         * A miss is cached as well as a hit. Without that, a request carrying
         * an id that is not in the database — a stale cookie, a session deleted
         * by an uninstall — would go to Atlas on every single retry.
         */
        this.#entries.set(id, {
          session,
          expiresAt: Date.now() + this.#ttlMs,
        });
        return session;
      })
      .finally(() => {
        this.#inFlight.delete(id);
      });

    this.#inFlight.set(id, request);
    return request;
  }

  async storeSession(session: Session): Promise<boolean> {
    const stored = await this.#inner.storeSession(session);
    /*
     * Cached only on success, and only after the write returns. Seeding the
     * cache before the database confirms would leave this process serving a
     * session that does not exist anywhere else if the write failed.
     */
    if (stored) {
      this.#entries.set(session.id, {
        session,
        expiresAt: Date.now() + this.#ttlMs,
      });
    } else {
      this.#entries.delete(session.id);
    }
    return stored;
  }

  async deleteSession(id: string): Promise<boolean> {
    // Evicted before the delete, not after: if the call throws, the safe state
    // is an empty cache that re-reads, not a populated one still serving a
    // session somebody tried to revoke.
    this.#entries.delete(id);
    return this.#inner.deleteSession(id);
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    for (const id of ids) this.#entries.delete(id);
    return this.#inner.deleteSessions(ids);
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const sessions = await this.#inner.findSessionsByShop(shop);
    // Not cached as a list, but the rows it returns are fresh, so they may as
    // well seed the by-id cache the request path actually reads.
    for (const session of sessions) {
      this.#entries.set(session.id, {
        session,
        expiresAt: Date.now() + this.#ttlMs,
      });
    }
    return sessions;
  }
}
