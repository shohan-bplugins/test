import { API_VERSION } from "../shopify.server";

// Whether a shop's published theme accepts app blocks, remembered per server
// process so the Dashboard can render the right layout on its first paint
// instead of waiting for the theme check. Refreshed by every theme check, so a
// theme change is picked up on the next Dashboard visit.
const supportByShop = new Map();

export const getCachedAppBlockSupport = (shop) =>
  supportByShop.has(shop) ? supportByShop.get(shop) : null;

export const setCachedAppBlockSupport = (shop, value) => {
  if (typeof value === "boolean") supportByShop.set(shop, value);
};

const restHeaders = (session) => ({
  "X-Shopify-Access-Token": session.accessToken,
  "Content-Type": "application/json",
});

// The asset key is passed with a literal slash (NOT URL-encoded) — Shopify's
// assets endpoint rejects an encoded "%2F" and returns nothing.
const assetUrl = (session, themeId, key) =>
  `https://${session.shop}/admin/api/${API_VERSION}/themes/${themeId}/assets.json?asset[key]=${key}`;

export async function getMainThemeId(session) {
  const res = await fetch(
    `https://${session.shop}/admin/api/${API_VERSION}/themes.json`,
    { headers: restHeaders(session) },
  );
  if (!res.ok) throw new Error(`themes.json ${res.status}`);
  const data = await res.json();
  return data?.themes?.find((theme) => theme.role === "main")?.id ?? null;
}

// Asset value, "" when the asset doesn't exist. Throws on other failures
// (rate limit, network) so an unknown answer isn't mistaken for "no support".
async function readAsset(session, themeId, key) {
  const res = await fetch(assetUrl(session, themeId, key), {
    headers: restHeaders(session),
  });
  if (res.status === 404) return "";
  if (!res.ok) throw new Error(`asset ${key} ${res.status}`);
  return (await res.json())?.asset?.value || "";
}

// Real app-block support: does the PRODUCT template have a section that
// accepts @app blocks? OS 2.0 alone isn't enough — themes like Prestige are
// 2.0 but don't expose @app in their product sections.
// `getAssetKeys` is only called when templates/product.json doesn't exist.
export async function detectAppBlockSupport(session, themeId, getAssetKeys) {
  let template = await readAsset(session, themeId, "templates/product.json");
  if (!template) {
    const keys = await getAssetKeys();
    const altKey = keys.find((k) => /^templates\/product\..+\.json$/.test(k));
    if (!altKey) return false; // vintage theme (product.liquid)
    template = await readAsset(session, themeId, altKey);
  }

  let sectionTypes = [];
  try {
    sectionTypes = Array.from(
      new Set(
        Object.values(JSON.parse(template).sections || {})
          .map((s) => s && s.type)
          .filter(Boolean),
      ),
    );
  } catch {
    return false;
  }

  // A section that supports app blocks declares {"type":"@app"}.
  const BATCH = 8;
  for (let i = 0; i < sectionTypes.length; i += BATCH) {
    const contents = await Promise.all(
      sectionTypes
        .slice(i, i + BATCH)
        .map((t) => readAsset(session, themeId, `sections/${t}.liquid`)),
    );
    if (contents.some((c) => c.includes("@app"))) return true;
  }
  return false;
}
