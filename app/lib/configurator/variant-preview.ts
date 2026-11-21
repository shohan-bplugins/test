import { applyShopperLayer, layerModelId, resolveLayers, rulesFor } from "./config";
import { cleanChoices, resolvedPicks, shopperLayer, type ModuleFlags } from "./options";
import type {
  ConfigLayer,
  OptionRules,
  ProductRenderConfig,
  ShopperChoices,
  VariantOptions,
} from "./types";

/** The saved configurator setup a preview resolves from. */
export type PreviewSource = {
  /** The product's own model (custom.model_3d). */
  modelFileId: string | null;
  config: ProductRenderConfig;
  optionRules: OptionRules;
  variantConfigs: Record<string, ConfigLayer>;
  modules: ModuleFlags;
};

/**
 * What the storefront shows for a variant before the shopper picks anything:
 * product default <- option rules <- the variant's own layer, with each
 * customer option on its default choice — the same steps as
 * storefront/entry.ts (layers() + update()), so the admin preview matches.
 *
 * `variant` null is the product default (no variant layer, no option rules).
 * `modelId` is the GLB to show: the variant's, an option rule's, or the
 * product's.
 */
export function previewForVariant(
  src: PreviewSource,
  optionNames: string[],
  variant: { id: string; options: VariantOptions } | null,
): { config: ProductRenderConfig; modelId: string | null } {
  const vo: VariantOptions = variant?.options ?? {};
  const ruleLayers = variant
    ? rulesFor({ options: optionNames.map((name) => ({ name })) }, vo, src.optionRules)
    : [];
  const variantLayer = variant ? (src.variantConfigs[variant.id] ?? null) : null;
  const cfg = resolveLayers(src.config, ruleLayers, variantLayer);

  const kept: ShopperChoices = cleanChoices(cfg, { options: {} }, vo, src.modules);
  const picks = resolvedPicks(cfg, kept, vo, src.modules);
  for (const [gid, c] of Object.entries(picks)) {
    if (!kept.options![gid]) kept.options![gid] = c.id;
  }
  return {
    config: applyShopperLayer(cfg, shopperLayer(cfg, kept, vo, src.modules)),
    modelId: layerModelId(src.modelFileId, ruleLayers, variantLayer),
  };
}
