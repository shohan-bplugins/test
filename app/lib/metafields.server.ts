/*
 * Readiness check for the two product metafield definitions the viewer needs.
 *
 * Lived as byte-identical copies in app._index.tsx and app.products._index.tsx;
 * the onboarding wizard needed a third, which is one copy too many for a query
 * that decides whether the storefront can read a model at all.
 */

function storefrontOk(node: any): boolean {
  if (!node) return false;
  const access = node?.access?.storefront;
  return access === "PUBLIC_READ" || access === "PUBLIC_READ_WRITE";
}

/**
 * True only when both definitions exist *and* are storefront-readable — a
 * definition without storefront access renders nothing on the theme, so a
 * plain existence check would report a broken store as ready.
 */
import {
  createShopCache,
  SHOP_CACHE_TTL_MS,
} from "~/lib/shop-cache.server";

const defsReadyCache = createShopCache<boolean>(SHOP_CACHE_TTL_MS);

/**
 * `checkDefsReady` through a per-shop cache — the dashboard, the product list
 * and the onboarding checklist all ask this on every load purely to render a
 * tick. Setup's action drops the entry the moment it creates the definitions,
 * so a merchant who has just fixed them never sees a stale cross.
 */
export async function checkDefsReadyCached(
  admin: any,
  shop: string,
): Promise<boolean> {
  return defsReadyCache.read(shop, () => checkDefsReady(admin));
}

/** Called by every action that creates or alters the metafield definitions. */
export function invalidateDefsReady(shop: string): void {
  defsReadyCache.invalidate(shop);
}

export async function checkDefsReady(admin: any): Promise<boolean> {
  try {
    const res = await admin.graphql(
      `#graphql
        query Defs {
          modelDef: metafieldDefinitions(
            first: 1
            namespace: "custom"
            key: "model_3d"
            ownerType: PRODUCT
          ) {
            edges { node { id access { storefront } } }
          }
          configDef: metafieldDefinitions(
            first: 1
            namespace: "custom"
            key: "viewer_3d_config"
            ownerType: PRODUCT
          ) {
            edges { node { id access { storefront } } }
          }
        }`,
    );
    const json = await res.json();
    return (
      storefrontOk(json?.data?.modelDef?.edges?.[0]?.node) &&
      storefrontOk(json?.data?.configDef?.edges?.[0]?.node)
    );
  } catch {
    return false;
  }
}
