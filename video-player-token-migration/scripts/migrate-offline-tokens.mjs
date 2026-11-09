// Video Player by bPlugins — migrate offline sessions to expiring tokens.
//
// Why: Shopify deprecates non-expiring offline access tokens (public apps are
// delisted from 2027-01-01; the Admin API rejects them from 2027-04-01).
// `future.expiringOfflineAccessTokens` in app/shopify.server.js only affects
// *new* tokens: a legacy session has `expires: null`, never counts as expired,
// and so is never replaced. This script runs Shopify's "migrate all
// installations at once" exchange for those sessions:
// https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens
//
// It only works for the app in shopify.app.toml: it refuses to run when
// SHOPIFY_API_KEY in the environment is a different app, because Shopify only
// exchanges tokens issued to the app that asks.
//
// Pending = an offline session with an access token and
//   - no refresh token (never migrated), or
//   - no `expires` (overwritten with a non-expiring token by pre-flag code).
//
// CAUTION: a successful exchange permanently invalidates the old token. Each new
// pair is appended to scripts/.token-migration-backup.jsonl (gitignored, holds
// secrets — delete after verifying) *before* the DB write. If a write fails,
// re-running within 7 days returns the same pair.
//
// Usage (on the production server, from the app folder):
//   node --env-file=.env scripts/migrate-offline-tokens.mjs                 # dry run
//   node --env-file=.env scripts/migrate-offline-tokens.mjs --apply --shop x.myshopify.com
//   node --env-file=.env scripts/migrate-offline-tokens.mjs --apply --limit 20
//   node --env-file=.env scripts/migrate-offline-tokens.mjs --apply         # all pending
//
// Safe to re-run: only pending sessions are touched; failures leave rows as-is.

import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const APP_NAME = "Video Player by bPlugins";
const TOML_PATH = fileURLToPath(new URL("../shopify.app.toml", import.meta.url));
const BACKUP_FILE = fileURLToPath(
  new URL("./.token-migration-backup.jsonl", import.meta.url),
);
const DELAY_MS = 300;

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const APPLY = args.includes("--apply");
const ONLY_SHOP = argValue("--shop");
const LIMIT = argValue("--limit") ? Number(argValue("--limit")) : undefined;
const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET } = process.env;

const prisma = new PrismaClient();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isPending = (s) => s.accessToken && (!s.refreshToken || !s.expires);

function checkConfig() {
  const toml = readFileSync(TOML_PATH, "utf8");
  const clientId = toml.match(/^\s*client_id\s*=\s*"([^"]+)"/m)?.[1];
  const handle = toml.match(/^\s*handle\s*=\s*"([^"]+)"/m)?.[1];
  if (!SHOPIFY_API_KEY) throw new Error("SHOPIFY_API_KEY is not set");
  if (clientId !== SHOPIFY_API_KEY) {
    throw new Error(
      `SHOPIFY_API_KEY (${SHOPIFY_API_KEY.slice(0, 8)}…) is not the app in ` +
        `shopify.app.toml (${clientId?.slice(0, 8)}…, ${handle}). Refusing to run.`,
    );
  }
  if (APPLY && !SHOPIFY_API_SECRET) {
    throw new Error("SHOPIFY_API_SECRET is not set");
  }
  if (LIMIT !== undefined && !(LIMIT > 0)) {
    throw new Error("--limit must be a positive number");
  }
  console.log(`App: ${APP_NAME} (${handle}, ${clientId.slice(0, 8)}…)`);
}

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
    err.code = body?.error || `http_${res.status}`;
    throw err;
  }
  if (!body.access_token || !body.refresh_token || !body.expires_in) {
    // Never store a response that is not an expiring pair.
    const err = new Error(`unexpected response: ${Object.keys(body)}`);
    err.code = "unexpected_response";
    throw err;
  }
  return body;
}

async function main() {
  checkConfig();

  // Filtered in JS: on MongoDB a missing field and an explicit null differ for
  // Prisma, and legacy rows may have either.
  const offline = await prisma.session.findMany({
    where: { isOnline: false, ...(ONLY_SHOP ? { shop: ONLY_SHOP } : {}) },
  });
  const pending = offline.filter(isPending);
  const sessions = LIMIT ? pending.slice(0, LIMIT) : pending;
  const expiring = offline.filter((s) => s.refreshToken && s.expires).length;

  console.log(
    `Offline sessions: ${offline.length} | expiring: ${expiring} | ` +
      `pending: ${pending.length}` +
      (ONLY_SHOP ? ` (shop ${ONLY_SHOP})` : ""),
  );
  if (!APPLY) {
    for (const s of sessions) console.log(`  ${s.shop}`);
    console.log(`Dry run — would migrate ${sessions.length}. Pass --apply.`);
    return;
  }
  console.log(`Migrating ${sessions.length}…`);

  let ok = 0;
  const failures = {};
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
          expires: new Date(now + t.expires_in * 1000),
          refreshToken: t.refresh_token,
          refreshTokenExpires: t.refresh_token_expires_in
            ? new Date(now + t.refresh_token_expires_in * 1000)
            : null,
        },
      });
      ok++;
      console.log(`  ✓ ${s.shop}`);
    } catch (e) {
      // invalid_subject_token: the store uninstalled the app, the token is
      // dead, or it was issued to a different app sharing this database.
      // The row is left exactly as it was.
      (failures[e.code || "error"] ||= []).push(s.shop);
      console.log(`  ✗ ${s.shop}: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }

  const failed = Object.values(failures).flat().length;
  console.log(`\nMigrated ${ok}, failed ${failed}`);
  for (const [code, shops] of Object.entries(failures)) {
    console.log(`  ${code}: ${shops.length}`);
  }
  if (ok) console.log(`Backup: ${BACKUP_FILE} — delete after verifying.`);
}

main()
  .catch((e) => {
    console.error(e.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
