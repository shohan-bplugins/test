import prisma from "../../db.server";
import { parseLayers, parseRenderConfig, defaultConfig } from "./config";
import {
  CONFIGURATOR_NAMESPACE,
  DRAFT_KEY,
  PRICING_KEY,
  RENDER_KEY,
} from "./constants";
import { configuratorModules } from "./modules.server";
import {
  buildPricingPayload,
  pricingPayloadSize,
  PRICING_PAYLOAD_LIMIT,
} from "./pricing";
import type { ConfigLayer, OptionRules, ProductRenderConfig } from "./types";

type Admin = {
  graphql: (query: string, options?: any) => Promise<Response>;
};

export type ProductConfigData = {
  productId: string;
  enabled: boolean;
  modelFileId: string | null;
  config: ProductRenderConfig;
  optionRules: OptionRules;
  variantConfigs: Record<string, ConfigLayer>;
  customizer: "inherit" | "on" | "off";
  publishedAt: Date | null;
  /** Unpublished changes were saved after the last publish. */
  draftAt: Date | null;
};

const CUSTOMIZER = ["inherit", "on", "off"] as const;

/** Numeric id from a gid or a plain id; null for anything else. */
export function numericProductId(id: string): string | null {
  const m = String(id).match(/(\d+)$/);
  return m ? m[1] : null;
}

export async function getProductConfig(
  shop: string,
  productId: string,
): Promise<ProductConfigData | null> {
  const row = await prisma.productConfig.findUnique({
    where: { shop_productId: { shop, productId } },
  });
  if (!row) return null;
  return {
    productId: row.productId,
    enabled: row.enabled,
    modelFileId: row.modelFileId,
    config: parseRenderConfig(row.config),
    optionRules: parseLayers(row.optionRules),
    variantConfigs: parseLayers(row.variantConfigs),
    customizer: (CUSTOMIZER as readonly string[]).includes(row.customizer)
      ? (row.customizer as ProductConfigData["customizer"])
      : "inherit",
    publishedAt: row.publishedAt,
    draftAt: row.draftAt,
  };
}

export function blankProductConfig(productId: string): ProductConfigData {
  return {
    productId,
    enabled: true,
    modelFileId: null,
    config: defaultConfig(),
    optionRules: {},
    variantConfigs: {},
    customizer: "inherit",
    publishedAt: null,
    draftAt: null,
  };
}

/** Every model gid the config references — product, rules and variant layers. */
function modelIds(data: ProductConfigData): string[] {
  const ids = new Set<string>();
  if (data.modelFileId) ids.add(data.modelFileId);
  for (const l of Object.values(data.optionRules)) {
    if (l.modelFileId) ids.add(l.modelFileId);
  }
  for (const l of Object.values(data.variantConfigs)) {
    if (l.modelFileId) ids.add(l.modelFileId);
  }
  return [...ids];
}

/**
 * gid -> { glb, usdz } for Shopify Files models. A Model3d's `sources` carry
 * the GLB and, when Shopify generated one, the USDZ used for iOS Quick Look.
 */
export async function resolveModelUrls(
  admin: Admin,
  ids: string[],
): Promise<Record<string, { glb: string; usdz?: string }>> {
  if (!ids.length) return {};
  const res = await admin.graphql(
    `#graphql
      query ConfiguratorModels($ids: [ID!]!) {
        nodes(ids: $ids) {
          id
          ... on Model3d { sources { url format } }
          ... on GenericFile { url }
        }
      }`,
    { variables: { ids } },
  );
  const json: any = await res.json();
  const out: Record<string, { glb: string; usdz?: string }> = {};
  for (const node of json?.data?.nodes ?? []) {
    if (!node?.id) continue;
    if (node.sources) {
      const glb = node.sources.find((s: any) => s.format === "glb")?.url;
      const usdz = node.sources.find((s: any) => s.format === "usdz")?.url;
      if (glb) out[node.id] = { glb, usdz };
    } else if (node.url) {
      out[node.id] = { glb: node.url };
    }
  }
  return out;
}

export type SaveResult =
  | { ok: true; pricingBytes: number; mode: "draft" | "publish" }
  | { ok: false; error: string };

/** Where a save goes: "draft" stores it for preview; "publish" makes it live. */
export type SaveMode = "draft" | "publish";

/**
 * Save the config. The DB row is written first so a failed publish never loses
 * the merchant's work.
 *
 * "draft" stores the config and writes only the `render_draft` metafield, which
 * the storefront reads in preview mode — the live `render` and `pricing`
 * metafields (what shoppers and the Cart Transform use) stay as published.
 * "publish" writes all three and moves `publishedAt`.
 */
export async function saveProductConfig(
  admin: Admin,
  shop: string,
  data: ProductConfigData,
  mode: SaveMode = "publish",
): Promise<SaveResult> {
  const pricing = buildPricingPayload(
    data.config,
    data.optionRules,
    data.variantConfigs,
  );
  const pricingBytes = pricingPayloadSize(pricing);
  if (pricingBytes > PRICING_PAYLOAD_LIMIT) {
    return {
      ok: false,
      error: `Option prices take ${pricingBytes} bytes; the limit is ${PRICING_PAYLOAD_LIMIT}. Remove some priced choices or variant exceptions.`,
    };
  }

  const fields = {
    enabled: data.enabled,
    modelFileId: data.modelFileId,
    config: JSON.stringify(data.config),
    optionRules: JSON.stringify(data.optionRules),
    variantConfigs: JSON.stringify(data.variantConfigs),
    customizer: data.customizer,
  };
  await prisma.productConfig.upsert({
    where: { shop_productId: { shop, productId: data.productId } },
    create: {
      shop,
      productId: data.productId,
      ...fields,
      ...(mode === "draft" ? { draftAt: new Date() } : {}),
    },
    update: { ...fields, ...(mode === "draft" ? { draftAt: new Date() } : {}) },
  });

  const models = await resolveModelUrls(admin, modelIds(data));
  const render = {
    v: 1,
    // Lets the storefront tell a draft from what is live without comparing
    // two large payloads.
    rev: Date.now(),
    enabled: data.enabled,
    // Plan-gated modules, resolved here so the storefront can't be talked into
    // option pricing or conditions the merchant's plan doesn't include.
    modules: await configuratorModules(admin, shop),
    customizer: data.customizer,
    model: data.modelFileId,
    models,
    config: data.config,
    rules: data.optionRules,
    variants: data.variantConfigs,
  };

  const ownerId = `gid://shopify/Product/${data.productId}`;
  const metafield = (key: string, value: unknown) => ({
    ownerId,
    namespace: CONFIGURATOR_NAMESPACE,
    key,
    type: "json",
    value: JSON.stringify(value),
  });
  const metafields =
    mode === "draft"
      ? [metafield(DRAFT_KEY, render)]
      : [
          metafield(RENDER_KEY, render),
          // Same payload, so a published product has no draft difference.
          metafield(DRAFT_KEY, render),
          metafield(PRICING_KEY, pricing),
        ];
  const res = await admin.graphql(
    `#graphql
      mutation PublishConfigurator($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
    { variables: { metafields } },
  );
  const json: any = await res.json();
  const errors = json?.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    return {
      ok: false,
      error: errors.map((e: any) => e.message).join("; "),
    };
  }

  if (mode === "publish") {
    await prisma.productConfig.update({
      where: { shop_productId: { shop, productId: data.productId } },
      data: { publishedAt: new Date(), draftAt: null },
    });
  }
  return { ok: true, pricingBytes, mode };
}

/** Publish what is already saved (a draft), without re-posting the config. */
export async function publishStoredConfig(
  admin: Admin,
  shop: string,
  productId: string,
): Promise<SaveResult> {
  const data = await getProductConfig(shop, productId);
  if (!data) return { ok: false, error: "Nothing saved to publish." };
  return saveProductConfig(admin, shop, data, "publish");
}
