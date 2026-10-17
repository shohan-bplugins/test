import { Session } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";

// Shopify deprecated non-expiring offline access tokens: from January 1, 2027
// GraphQL Admin requests made with one are rejected.
// https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens
//
// With `future.expiringOfflineAccessTokens` on, new token exchanges already
// return expiring tokens that the library refreshes. This storage also moves
// shops that still have an OLD token: the first time such a session is loaded
// (admin page, webhook, app proxy, background job) it's exchanged for an
// expiring token + refresh token and saved over the old row.
//
// Migration revokes the old token. Repeating the same request within 7 days
// returns the same token pair, so concurrent or retried migrations are safe.

const TOKEN_TYPE = "urn:shopify:params:oauth:token-type:offline-access-token";
// Don't retry a shop whose migration failed (e.g. app uninstalled, token
// already revoked) on every load.
const RETRY_AFTER_MS = 60 * 60 * 1000;

const isNonExpiringOffline = (session) =>
  session &&
  !session.isOnline &&
  !session.expires &&
  !session.refreshToken &&
  !!session.accessToken;

// One migration request, exactly as documented (and as shopify-api's
// auth.migrateToExpiringToken sends it).
export async function migrateOfflineToken({
  shop,
  accessToken,
  apiKey,
  apiSecretKey,
}) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: apiKey,
      client_secret: apiSecretKey,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: accessToken,
      subject_token_type: TOKEN_TYPE,
      requested_token_type: TOKEN_TYPE,
      expiring: "1",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token || !body.expires_in) {
    throw new Error(
      `migration failed (${res.status}): ${body.error_description || body.error || "no expiring token returned"}`,
    );
  }
  const now = Date.now();
  return {
    accessToken: body.access_token,
    scope: body.scope,
    expires: new Date(now + body.expires_in * 1000),
    refreshToken: body.refresh_token,
    refreshTokenExpires: body.refresh_token_expires_in
      ? new Date(now + body.refresh_token_expires_in * 1000)
      : undefined,
  };
}

export class ExpiringOfflineTokenStorage extends PrismaSessionStorage {
  constructor(prisma, { apiKey, apiSecretKey, ...options } = {}) {
    super(prisma, options);
    this.credentials = { apiKey, apiSecretKey };
    this.inFlight = new Map(); // shop → Promise<Session>
    this.failedAt = new Map(); // shop → timestamp
  }

  async loadSession(id) {
    const session = await super.loadSession(id);
    if (!isNonExpiringOffline(session)) return session;
    return this.migrate(session);
  }

  migrate(session) {
    const { shop } = session;
    if (Date.now() - (this.failedAt.get(shop) || 0) < RETRY_AFTER_MS) {
      return session;
    }
    if (!this.inFlight.has(shop)) {
      const run = (async () => {
        try {
          const tokens = await migrateOfflineToken({
            shop,
            accessToken: session.accessToken,
            ...this.credentials,
          });
          const migrated = new Session({
            id: session.id,
            shop,
            state: session.state || "",
            isOnline: false,
            scope: tokens.scope || session.scope,
            accessToken: tokens.accessToken,
            expires: tokens.expires,
            refreshToken: tokens.refreshToken,
            refreshTokenExpires: tokens.refreshTokenExpires,
          });
          await this.storeSession(migrated);
          this.failedAt.delete(shop);
          console.log(`Migrated ${shop} to an expiring offline token`);
          return migrated;
        } catch (error) {
          this.failedAt.set(shop, Date.now());
          console.error(`Offline token migration for ${shop}:`, error.message);
          return session;
        } finally {
          this.inFlight.delete(shop);
        }
      })();
      this.inFlight.set(shop, run);
    }
    return this.inFlight.get(shop);
  }
}
