import {
  ADVANCE_PLAN_NAME,
  FREE_PLAN_NAME,
  GROWTH_PLAN_NAME,
  STARTER_PLAN_NAME,
} from "~/lib/billing-constants";
import type { ModuleId } from "./options";

/*
 * Client-safe constants for the configurator — separate from the `.server`
 * modules for the same reason as model-library-constants.ts: routes render
 * these, and a route can't reference server code outside loader/action.
 */

/*
 * Product metafields the configurator publishes on save. `$app:` keeps them
 * app-owned: no definition or extra scope is needed, the theme app extension
 * reads them as product.metafields["$app:configurator"].render.value, and the
 * Cart Transform Function's input query reads them by the same namespace.
 */
export const CONFIGURATOR_NAMESPACE = "$app:configurator";
/** Everything the storefront needs: base config, option rules, variant layers, model URLs. */
export const RENDER_KEY = "render";
/** The saved-but-unpublished config, read by the storefront only in preview mode. */
export const DRAFT_KEY = "render_draft";
/** Compact price rules for the Cart Transform Function (pricing.ts). */
export const PRICING_KEY = "pricing";

/** Hidden cart line properties. A leading underscore hides them in most themes. */
export const LINE_PROP_DESIGN = "_3d_design";
export const LINE_PROP_PICKS = "_3d_picks";
export const LINE_PROP_HASH = "_3d_hash";
export const LINE_PROP_SNAPSHOT = "_3d_snapshot";

/** Plans in ascending order. A module is on for its plan and every plan above. */
export const PLAN_ORDER = [
  FREE_PLAN_NAME,
  STARTER_PLAN_NAME,
  GROWTH_PLAN_NAME,
  ADVANCE_PLAN_NAME,
] as const;

/*
 * Lowest plan that includes each module. The prototype had three tiers
 * (free/growth/business); its "growth" maps to Growth and "business" to
 * Advance. Adjust here — nothing else hard-codes a plan.
 */
export const MODULE_MIN_PLAN: Record<ModuleId, (typeof PLAN_ORDER)[number]> = {
  "option-groups": GROWTH_PLAN_NAME,
  "conditional-logic": GROWTH_PLAN_NAME,
  "saved-designs": GROWTH_PLAN_NAME,
  "order-snapshot": GROWTH_PLAN_NAME,
  "customizer-modal": GROWTH_PLAN_NAME,
  "undo-redo": GROWTH_PLAN_NAME,
  "material-variants": GROWTH_PLAN_NAME,
  "option-pricing": ADVANCE_PLAN_NAME,
  personalization: ADVANCE_PLAN_NAME,
  "external-url": ADVANCE_PLAN_NAME,
};

export function planIncludes(planName: string, module: ModuleId): boolean {
  const have = PLAN_ORDER.indexOf(planName as (typeof PLAN_ORDER)[number]);
  return have >= PLAN_ORDER.indexOf(MODULE_MIN_PLAN[module]);
}

/** Share-link lifetimes offered in Settings, in days (0 = never expires). */
export const SHARE_LINK_LIFETIMES = [30, 90, 180, 365, 0] as const;

/*
 * "Needs attention" size threshold on the 3D products page — models above it
 * load slowly on phones. The prototype's default; becomes a setting with the
 * Settings page (Phase 9).
 */
export const COVERAGE_MAX_MODEL_MB = 10;

/** Environment presets, in the order the editor lists them (files in public/hdri). */
export const ENV_PRESET_IDS = [
  "studio",
  "apartment",
  "city",
  "dawn",
  "forest",
  "lobby",
  "night",
  "park",
  "sunset",
  "warehouse",
] as const;
