import prisma from "../db.server";
import { parseConfig } from "./viewer-config";
import {
  APP_LIBRARY_KEY,
  APP_LIBRARY_NAMESPACE,
  APP_URL_KEY,
  LIBRARY_KEY,
  LIBRARY_NAMESPACE,
} from "./model-library-constants";

/*
 * Mirrors this shop's model library into a shop-level metafield so the theme app
 * extension can resolve a Model ID entirely in Liquid.
 *
 * Why a metafield at all: a theme block renders on Shopify's servers and has no
 * way to reach this app's database. The alternative — having viewer-3d.js fetch
 * the model from an app endpoint at page-view time — would make every storefront
 * page depend on this app being reachable and add a round-trip before the model
 * appears. Mirroring instead means the storefront keeps working even if the app
 * is down, and the block resolves the id with zero extra requests.
 *
 * Shape (keyed by Model3D.id, which is what the merchant pastes into the block):
 *
 *   { "<uuid>": { "url": "https://cdn…/model.glb", "config": { … } } }
 *
 * `config` is the model's own saved viewer settings, which is the real advantage
 * of referencing by id over pasting a URL: the block picks those up too.
 */

/*
 * Two namespaces, and the app-reserved one is the one that matters.
 *
 * The library used to live only in the merchant-owned `custom` namespace. That
 * namespace is documented as writable by "all apps with appropriate scopes" —
 * and this app's scopes (write_products, write_files, write_themes) include
 * nothing that grants write access to *shop*-owned metafields. So the write was
 * being rejected, the metafield stayed empty, and every Model ID pasted into the
 * page block resolved to "not found". The block was never the problem.
 *
 * See ~/lib/model-library-constants for the names themselves; they live outside
 * this module because the Setup page displays them.
 */
export {
  APP_LIBRARY_NAMESPACE,
  APP_LIBRARY_KEY,
  LIBRARY_NAMESPACE,
  LIBRARY_KEY,
} from "./model-library-constants";

// Shopify rejects a metafield value over 5MB. Each entry is roughly 1.5KB (a CDN
// URL plus the ~40-key config), so this cap is far below the limit while still
// covering any realistic library; going over it drops the oldest entries rather
// than failing the whole write, and logs what was left out.
const MAX_ENTRIES = 500;

type LibraryEntry = { url: string; config: unknown };

async function getShopGid(admin: any): Promise<string | null> {
  try {
    const res = await admin.graphql(`#graphql
      query ShopId { shop { id } }
    `);
    const json = await res.json();
    return json?.data?.shop?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Rebuilds the metafield from the Model3D table. Called after any change to the
 * library. Never throws: a failed mirror must not fail the user's actual action
 * (saving or deleting a model) — the next change re-syncs the whole map anyway,
 * since this always writes the full library rather than patching it.
 *
 * Returns null on success, or a human-readable reason on failure. The
 * model-editing callers ignore it (they must not fail on a mirror problem), but
 * Setup surfaces it: a silent console.warn meant the Setup page could report
 * "ready" while the storefront had no library at all, which is the one place a
 * merchant goes to find out why the page block can't resolve a Model ID.
 */
/*
 * A model's config as the library carries it: everything but the hotspot
 * text. The library is one shop metafield that every page-block render reads
 * in full, for up to MAX_ENTRIES models; twenty hotspots of copy each would
 * multiply its size for viewers that mostly have none. Models that do have
 * hotspots are flagged instead, and viewer-3d.js fetches that one model's
 * hotspots through the app proxy when it mounts.
 */
function libraryConfig(raw: string | null) {
  const config = parseConfig(raw);
  if (config.hotspots.length === 0) return config;
  return { ...config, hotspots: [], hotspotsRemote: true };
}

export async function syncModelLibrary(
  admin: any,
  shop: string,
): Promise<string | null> {
  try {
    if (!shop) return "No shop in session; skipped library sync.";

    // Independent reads, issued together rather than one after another.
    const [models, total, ownerId] = await Promise.all([
      prisma.model3D.findMany({
        where: { shop },
        select: { id: true, fileUrl: true, config: true },
        orderBy: { createdAt: "desc" },
        take: MAX_ENTRIES,
      }),
      prisma.model3D.count({ where: { shop } }),
      getShopGid(admin),
    ]);
    if (total > MAX_ENTRIES) {
      console.warn(
        `[model-library] ${shop} has ${total} models; only the newest ${MAX_ENTRIES} are exposed to the theme block.`,
      );
    }

    const library: Record<string, LibraryEntry> = {};
    for (const model of models) {
      // A row with no resolved file URL can't be rendered, so leaving it out
      // keeps the block's "did this id resolve?" check meaningful.
      if (!model.fileUrl) continue;
      library[model.id] = {
        url: model.fileUrl,
        // Normalised through the same parser the admin uses, so the block never
        // receives a partial or out-of-range config.
        config: libraryConfig(model.config),
      };
    }

    if (!ownerId) {
      console.warn("[model-library] could not resolve shop id; skipped sync");
      return "Could not resolve the shop id from the Admin API.";
    }

    const value = JSON.stringify(library);

    // Separate calls rather than one two-element array, so an error can be
    // attributed to the namespace that produced it — metafieldsSet reports
    // userErrors for the batch, and the legacy write failing must not be
    // mistaken for the app-owned one failing.
    async function write(
      namespace: string,
      key: string,
      type = "json",
      body = value,
    ): Promise<string | null> {
      const res = await admin.graphql(
        `#graphql
          mutation SetLibrary($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              userErrors { field message }
            }
          }`,
        {
          variables: {
            metafields: [{ ownerId, namespace, key, type, value: body }],
          },
        },
      );
      const json = await res.json();
      const errors = json?.data?.metafieldsSet?.userErrors ?? [];
      if (errors.length) return errors.map((e: any) => e.message).join("; ");
      return null;
    }

    const appUrl = process.env.SHOPIFY_APP_URL?.trim().replace(/\/+$/, "");
    const toMessage = (err: unknown) =>
      err instanceof Error ? err.message : String(err);

    // The three writes are independent, so they go out together — this sync
    // also runs inside save actions, where the merchant waits on it.
    const [appErr, urlErr, legacyErr] = await Promise.all([
      write(APP_LIBRARY_NAMESPACE, APP_LIBRARY_KEY),
      // Republished on every sync so it tracks a moving app URL — a dev tunnel
      // changes on each `shopify app dev`, and the block would otherwise be
      // pointing at a host that stopped existing. Failure is not reported: the
      // block has a hardcoded fallback, so a stale or missing value degrades to
      // exactly the behaviour that existed before this key.
      appUrl
        ? write(
            APP_LIBRARY_NAMESPACE,
            APP_URL_KEY,
            "single_line_text_field",
            appUrl,
          ).catch(toMessage)
        : Promise.resolve(null),
      // Best-effort and deliberately unreported: this is the namespace the
      // app has no scope for, so a failure here is the expected outcome.
      write(LIBRARY_NAMESPACE, LIBRARY_KEY).catch(toMessage),
    ]);
    if (urlErr) console.info("[model-library] app_url write failed:", urlErr);
    if (legacyErr) {
      console.info("[model-library] legacy custom.* write skipped:", legacyErr);
    }

    if (appErr) {
      console.warn("[model-library] app-owned write failed:", appErr);
      return appErr;
    }

    return null;
  } catch (err) {
    console.warn("[model-library] sync failed:", err);
    return err instanceof Error ? err.message : String(err);
  }
}
