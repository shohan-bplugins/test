import type {
  ConfigLayer,
  MaterialConfig,
  OptionRules,
  ProductRenderConfig,
  ProductShape,
  ShopperChoices,
  VariantOptions,
} from "./types";

/*
 * Layer resolution: product default <- option-value rules <- variant exception
 * <- shopper choices. Ported from the prototype's
 * js/shared/effective-config.js and shopify/core/commerce.js (which were in
 * turn a port of the WooCommerce plugin's EffectiveConfig.php) — keep the
 * inheritance rules identical, or a config built in one surface renders
 * differently in another.
 *
 * Pure and client-safe: the admin editor, the storefront bundle and the Cart
 * Transform Function all resolve with this one module.
 */

export function defaultConfig(): ProductRenderConfig {
  return {
    schema_version: 1,
    meshes: {},
    materials: {},
    camera: null,
    environment: null,
    animations: null,
    hotspots: [],
    optimization: null,
  };
}

/** WordPress sanitize_key(): ASCII lowercase, strip outside [a-z0-9_-]. */
export function legacyMaterialKey(meshName: string): string {
  return String(meshName)
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[^a-z0-9_-]/g, "");
}

/** Legacy lowercased entry with the exact-name entry layered on top. */
export function getMaterialConfig(
  materials: Record<string, MaterialConfig> | undefined,
  meshName: string,
  meshNames: string[] = [],
): MaterialConfig | undefined {
  if (!materials) return undefined;
  const exact = materials[meshName];
  const legacy = legacyMaterialKey(meshName);
  const old =
    legacy !== meshName && !meshNames.includes(legacy)
      ? materials[legacy]
      : undefined;
  if (!old) return exact;
  return { ...old, ...(exact ?? {}) };
}

/** Patch one mesh's material entry, folding a legacy key into the exact name. */
export function patchMaterialConfig(
  materials: Record<string, MaterialConfig> | undefined,
  meshName: string,
  patch: MaterialConfig,
  meshNames: string[] = [],
): Record<string, MaterialConfig> {
  const next = { ...(materials ?? {}) };
  const legacy = legacyMaterialKey(meshName);
  next[meshName] = {
    ...(getMaterialConfig(materials, meshName, meshNames) ?? {}),
    ...patch,
  };
  if (legacy !== meshName && legacy in next && !meshNames.includes(legacy)) {
    delete next[legacy];
  }
  return next;
}

/** {...base, ...override} for materials; an override also replaces its legacy alias. */
export function mergeMaterialLayers(
  base: Record<string, MaterialConfig> | undefined,
  override: Record<string, MaterialConfig> | undefined,
): Record<string, MaterialConfig> {
  const out = { ...(base ?? {}) };
  for (const [key, cfg] of Object.entries(override ?? {})) {
    for (const baseKey of Object.keys(out)) {
      if (
        baseKey !== key &&
        (legacyMaterialKey(key) === baseKey ||
          legacyMaterialKey(baseKey) === key)
      ) {
        delete out[baseKey];
      }
    }
    out[key] = cfg;
  }
  return out;
}

function mergeFields<T extends Record<string, unknown>>(
  base: T | null | undefined,
  over: T | null | undefined,
): T | null | undefined {
  if (!over) return base;
  if (!base) return over;
  return { ...base, ...over };
}

/**
 * One layer over another. meshes/materials merge per entry (replaced outright
 * when the layer brings its own model, since mesh names no longer match);
 * environment/optimization/ar merge per field; everything else is replaced
 * as a whole value. null/undefined = inherit.
 */
export function resolveEffectiveConfig(
  base: ProductRenderConfig,
  layer: Partial<ProductRenderConfig> | null | undefined,
  hasOwnModel: boolean,
): ProductRenderConfig {
  if (!layer) return base;
  return {
    ...base,
    meshes: hasOwnModel
      ? { ...(layer.meshes ?? {}) }
      : { ...(base.meshes ?? {}), ...(layer.meshes ?? {}) },
    materials: hasOwnModel
      ? { ...(layer.materials ?? {}) }
      : mergeMaterialLayers(base.materials, layer.materials),
    camera: layer.camera ?? base.camera,
    animations: layer.animations ?? base.animations,
    gallery_presets: layer.gallery_presets ?? base.gallery_presets,
    hotspots: layer.hotspots ?? base.hotspots,
    environment: mergeFields(base.environment, layer.environment),
    optimization: mergeFields(base.optimization, layer.optimization),
    ar: mergeFields(base.ar, layer.ar),
    pricing: layer.pricing ?? base.pricing,
    options: layer.options ?? base.options,
    material_variant: layer.material_variant ?? base.material_variant,
    decals: layer.decals ?? base.decals,
  };
}

export const ruleKey = (name: string, value: string) => `${name}=${value}`;

export type RuleLayer = {
  key: string;
  name: string;
  value: string;
  layer: ConfigLayer;
};

/** Rule layers that apply to a variant, in the product's option order. */
export function rulesFor(
  product: ProductShape | null | undefined,
  variantOptions: VariantOptions | null | undefined,
  rules: OptionRules | null | undefined,
): RuleLayer[] {
  if (!product || !variantOptions || !rules) return [];
  const out: RuleLayer[] = [];
  for (const o of product.options ?? []) {
    const value = variantOptions[o.name];
    if (value == null) continue;
    const key = ruleKey(o.name, value);
    if (rules[key]) out.push({ key, name: o.name, value, layer: rules[key] });
  }
  return out;
}

/** Product default <- option-value rules <- variant exception. */
export function resolveLayers(
  base: ProductRenderConfig,
  ruleLayers: RuleLayer[],
  variantLayer: ConfigLayer | null | undefined,
): ProductRenderConfig {
  let out = base;
  // Rules keep the product's mesh names, so they always inherit.
  for (const r of ruleLayers) {
    out = resolveEffectiveConfig(out, r.layer?.config ?? null, false);
  }
  return variantLayer
    ? resolveEffectiveConfig(
        out,
        variantLayer.config ?? null,
        !!variantLayer.modelFileId,
      )
    : out;
}

/** The variant's own GLB, else the last option rule with one, else the product's. */
export function layerModelId(
  productModelId: string | null | undefined,
  ruleLayers: RuleLayer[],
  variantLayer: ConfigLayer | null | undefined,
): string | null {
  if (variantLayer?.modelFileId) return variantLayer.modelFileId;
  for (let i = ruleLayers.length - 1; i >= 0; i--) {
    const id = ruleLayers[i].layer?.modelFileId;
    if (id) return id;
  }
  return productModelId ?? null;
}

/**
 * Shopper layer ({materials, meshes, material_variant, decals}) baked into a
 * resolved config. Field-level patches on the resolved entries.
 */
export type ShopperLayer = {
  meshes?: Record<string, { visible?: boolean }>;
  materials?: Record<string, MaterialConfig>;
  material_variant?: string;
  decals?: ShopperChoices["decals"];
};

export function applyShopperLayer(
  config: ProductRenderConfig,
  layer: ShopperLayer | null | undefined,
): ProductRenderConfig {
  if (
    !layer ||
    (!layer.meshes &&
      !layer.materials &&
      typeof layer.material_variant !== "string" &&
      !layer.decals)
  ) {
    return config;
  }
  const meshes = { ...(config.meshes ?? {}) };
  const materials = { ...(config.materials ?? {}) };
  for (const [name, opts] of Object.entries(layer.meshes ?? {})) {
    meshes[name] = { ...(meshes[name] ?? {}), ...(opts ?? {}) };
  }
  const meshNames = Object.keys(meshes);
  for (const [name, opts] of Object.entries(layer.materials ?? {})) {
    materials[name] = {
      ...(getMaterialConfig(materials, name, meshNames) ?? {}),
      ...(opts ?? {}),
    };
  }
  const out: ProductRenderConfig = { ...config, meshes, materials };
  if (typeof layer.material_variant === "string") {
    out.material_variant = layer.material_variant;
  }
  const decals = layer.decals;
  if (decals && Array.isArray(config.decals)) {
    out.decals = config.decals.map((a) =>
      a && decals[a.id] ? { ...a, content: decals[a.id] } : a,
    );
  }
  return out;
}

/**
 * Parse a stored config JSON string. Anything unparsable or without
 * `schema_version: 1` falls back to a blank default rather than reaching the
 * renderer.
 */
export function parseRenderConfig(
  raw: string | null | undefined,
): ProductRenderConfig {
  if (!raw) return defaultConfig();
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && value.schema_version === 1) {
      return { ...defaultConfig(), ...value };
    }
  } catch {
    // fall through
  }
  return defaultConfig();
}

export function parseLayers(
  raw: string | null | undefined,
): Record<string, ConfigLayer> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}
