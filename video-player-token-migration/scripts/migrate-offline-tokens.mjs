// One-off migration: swap stored non-expiring offline tokens for expiring ones.
//
// `future.expiringOfflineAccessTokens` in app/shopify.server.js only affects
// *new* token exchanges. The library re-exchanges a token when the stored
// session is missing or expired — and a legacy offline session has
// `expires: null`, so it never counts as expired. Every shop installed before
// the flag was turned on keeps using its old non-expiring token indefinitely,
// which is what the Dev Dashboard reports as "Deprecated offline tokens".
//
// Shopify deadlines (public apps):
//   2027-01-01  apps still using non-expiring tokens are delisted
//   2027-04-01  Admin API rejects non-expiring tokens with 403
//
// This script runs Shopify's "exchange existing non-expiring tokens" flow
// (https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens)
// for every offline session that has no refresh token yet, and writes the new
// expiring token + refresh token back into the Session row. After that, the
// library refreshes them automatically.
//
// CAUTION: a successful exchange permanently invalidates the old token. The new
// pair is written immediately; if a write fails, re-running within 7 days with
// the same old token returns the same pair (Shopify's recovery window).
//
//   node scripts/migrate-offline-tokens.mjs                         # dry run
//   node scripts/migrate-offline-tokens.mjs --apply --shop x.myshopify.com
//   node scripts/migrate-offline-tokens.mjs --apply --limit 20
//   node scripts/migrate-offline-tokens.mjs --apply                 # all
//
// Each new token pair is appended to scripts/.token-migration-backup.jsonl
// *before* the DB write, so a failed write can be recovered from disk. The file
// holds secrets: it is gitignored — delete it once the migration is verified.
//
// Needs DATABASE_URL, SHOPIFY_API_KEY and SHOPIFY_API_SECRET in the environment
// (e.g. `node --env-file=.env scripts/migrate-offline-tokens.mjs`).
// Safe to re-run: sessions that already have a refresh token are skipped.

import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const APPLY = args.includes("--apply");
const ONLY_SHOP = argValue("--shop");
const LIMIT = argValue("--limit") ? Number(argValue("--limit")) : undefined;
const DELAY_MS = 300;
const BACKUP_FILE = fileURLToPath(
  new URL("./.token-migration-backup.jsonl", import.meta.url),
);
const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET } = process.env;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function exchange(shop, legacyToken) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      subject_token: legacyToken,
      subject_token_type:
        "urn:shopify:params:oauth:token-type:offline-access-token",
      requested_token_type:
        "urn:shopify:params:oauth:token-type:offline-access-token",
      expiring: "1",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${res.status} ${JSON.stringify(body)}`);
    err.code = body?.error;
    throw err;
  }
  return body;
}

async function main() {
  if (APPLY && (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET)) {
    throw new Error("SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be set");
  }
  if (LIMIT !== undefined && !(LIMIT > 0)) {
    throw new Error("--limit must be a positive number");
  }

  // Filtered in JS: on MongoDB a missing field and an explicit null are
  // different to Prisma, and legacy rows may have either.
  // An expiring token always has `expires`. A row with a refresh token but no
  // `expires` was overwritten by a server running pre-flag code: it holds a
  // fresh non-expiring token next to a stale refresh token, so migrate it too.
  const pending = (
    await prisma.session.findMany({
      where: { isOnline: false, ...(ONLY_SHOP ? { shop: ONLY_SHOP } : {}) },
    })
  ).filter((s) => s.accessToken && (!s.refreshToken || !s.expires));
  const sessions = LIMIT ? pending.slice(0, LIMIT) : pending;

  console.log(
    `${pending.length} offline session(s) still on non-expiring tokens` +
      (ONLY_SHOP ? ` for ${ONLY_SHOP}` : "") +
      (APPLY
        ? ` — migrating ${sessions.length}`
        : ` (dry run — would migrate ${sessions.length}; pass --apply)`),
  );
  if (!APPLY) {
    for (const s of sessions) console.log(`  ${s.shop}`);
    return;
  }

  let ok = 0;
  const failed = [];
  for (const s of sessions) {
    try {
      const t = await exchange(s.shop, s.accessToken);
      const now = Date.now();
      appendFileSync(
        BACKUP_FILE,
        JSON.stringify({
          shop: s.shop,
          sessionId: s.id,
          at: new Date(now).toISOString(),
          response: t,
        }) + "\n",
        { mode: 0o600 },
      );
      await prisma.session.update({
        where: { id: s.id },
        data: {
          accessToken: t.access_token,
          scope: t.scope ?? s.scope,
          expires: t.expires_in ? new Date(now + t.expires_in * 1000) : null,
          refreshToken: t.refresh_token ?? null,
          refreshTokenExpires: t.refresh_token_expires_in
            ? new Date(now + t.refresh_token_expires_in * 1000)
            : null,
        },
      });
      ok++;
      console.log(`  ✓ ${s.shop}`);
    } catch (e) {
      // invalid_subject_token usually means the shop uninstalled the app or the
      // token is already dead; that shop gets a fresh expiring token through
      // token exchange the next time a merchant opens the app.
      failed.push(s.shop);
      console.log(`  ✗ ${s.shop}: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  console.log(`Migrated ${ok}, failed ${failed.length}`);
  if (failed.length) console.log(`Failed shops: ${failed.join(", ")}`);
  if (ok)
    console.log(`Backup written to ${BACKUP_FILE} — delete after verifying.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
