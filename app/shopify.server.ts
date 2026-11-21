import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { CachedSessionStorage } from "./lib/session-cache.server";
import prisma from "./db.server";
import { fetchShopInfo, notifySwipeone } from "./lib/swipeone.server";

/*
 * Refuse to boot without the three variables the auth flow cannot work without,
 * instead of coercing them to "" and failing later.
 *
 * The `|| ""` these replace is the single most expensive line this app has had.
 * An empty `apiSecretKey` does not error anywhere: the server starts, the admin
 * frames it, `/` redirects to `/app`, `/app` bounces to `/auth/session-token`,
 * App Bridge hands back a session token — and then the token exchange fails
 * because it is signed against a secret we do not have. The library's only move
 * at that point is to redirect to `/auth/login`, which without a shop renders a
 * "Shop domain" form. So a missing environment variable surfaces as a *login
 * screen inside the admin on first install*, with nothing in the logs, and every
 * plausible reading of that symptom — OAuth setup, managed installation,
 * distribution mode, the redirect URLs — is the wrong place to look.
 *
 * Named individually because "one of these is missing" is not a useful error at
 * 2am. A misnamed key is the likely cause: `.env` wants SHOPIFY_APP_URL and
 * SCOPES, not the `application_url` and `scopes` that shopify.app.toml uses, and
 * copying the TOML's names across is an easy mistake to make.
 *
 * `shopify app env pull` writes all of them correctly. See DEPLOY-VPS.md.
 */
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  throw new Error(
    `[shopify.server] ${name} is missing. The app cannot authenticate without ` +
      `it and would show merchants a login form on install. Run ` +
      `\`shopify app env pull\` to write .env, and remember pm2 loads it via ` +
      `--env-file at boot, so restart after changing it.`,
  );
}

const shopify = shopifyApp({
  apiKey: required("SHOPIFY_API_KEY"),
  apiSecretKey: required("SHOPIFY_API_SECRET"),
  apiVersion: ApiVersion.January26,
  scopes: process.env.SCOPES?.split(",").map((s) => s.trim()),
  appUrl: required("SHOPIFY_APP_URL"),
  authPathPrefix: "/auth",
  /*
   * Wrapped in a read cache. Loading the session is the first thing every
   * authenticated request does, Atlas shared-tier round trips run ~250ms, and
   * the /app layout and the page loader each ask for the same one. See
   * lib/session-cache.server.ts for what is and is not safe to cache.
   */
  sessionStorage: new CachedSessionStorage(
    new PrismaSessionStorage(prisma, {
      // Defaults are 2 attempts, 5s apart. That is not enough in front of a
      // MongoDB Atlas shared-tier cluster, which can take the better part of a
      // minute to accept its first connection after idling — and the cost of
      // losing the race is not one slow request, it is the whole process.
      //
      // PrismaSessionStorage probes with `session.count()` once, in its
      // constructor, and stores the resulting promise on `this.ready`; every
      // later call awaits that same promise. When the probe loses, the rejection
      // is cached for the lifetime of the process, so every subsequent request
      // fails with "Prisma session table does not exist" long after the database
      // has come back — the server has to be restarted to clear it. The message
      // is also a red herring: the probe reports a missing table for any error it
      // throws, connection refusals included.
      //
      // ~60s of patience at boot costs nothing when the database is healthy (the
      // first attempt succeeds and no retry runs) and covers the cold start when
      // it is not.
      connectionRetries: 12,
      connectionRetryIntervalMs: 5000,
    }),
  ),
  distribution: AppDistribution.AppStore,
  hooks: {
    afterAuth: async ({ session }) => {
      try {
        const shop = session?.shop;
        const accessToken = session?.accessToken;
        if (!shop || !accessToken) return;
        const shopInfo = await fetchShopInfo(shop, accessToken);
        await notifySwipeone({
          type: "app.installed",
          shop,
          userId: session?.id,
          installId: shopInfo?.id,
          shopInfo: shopInfo ?? undefined,
        });
      } catch (err) {
        console.error("[afterAuth] swipeone notify failed:", err);
      }
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
