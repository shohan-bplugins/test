/*
 * The configurator's config format — the prototype's `schema_version: 1`
 * (3D Configurator for Shopify/js/shared/effective-config.js), typed. Kept
 * structurally identical so prototype JSON imports and exports unchanged.
 *
 * Client-safe: no server imports. The storefront bundle and the Cart Transform
 * Function build from this folder too.
 */

export type MeshConfig = {
  /** Shopper-facing name for the part. */
  label?: string;
  visible?: boolean;
  /** Customer can recolor this part in the plain (no option groups) customizer. */
  customizable?: boolean;
  /** Customer can hide this part in the plain customizer. */
  optional?: boolean;
};

export type MaterialConfig = {
  baseColor?: string;
  color?: string;
  metalness?: number;
  roughness?: number;
  clearcoat?: number;
  texture?: { url: string };
};

export type PriceRule = {
  type: "none" | "fixed" | "percent";
  /** Currency amount (fixed) or percent of the variant price. May be negative. */
  amount?: number;
  /** Sale amount; replaces `amount` when set. */
  sale?: number;
};

export type ConditionRule =
  | { source: "option"; name: string; op: "is" | "is_not"; value: string }
  | {
      source: "group";
      groupId: string;
      op: "is" | "is_not" | "has_choice" | "no_choice";
      choiceId?: string;
    };

export type Conditions = { match: "all" | "any"; rules: ConditionRule[] };

export type OptionChoice = {
  id: string;
  label: string;
  color?: string;
  material?: MaterialConfig;
  /** Meshes shown by a `parts` choice; the group's other targets are hidden. */
  show?: string[];
  /** `material-variant` choice: the KHR_materials_variants name. */
  variant?: string;
  thumbnail?: string;
  price?: PriceRule;
  conditions?: Conditions;
};

export type OptionGroup = {
  id: string;
  label: string;
  type: "color" | "material" | "parts" | "material-variant";
  display: "swatch" | "thumbnail" | "button" | "dropdown";
  targets?: string[];
  default?: string;
  required?: boolean;
  description?: string;
  choices: OptionChoice[];
  conditions?: Conditions;
};

export type DecalArea = {
  id: string;
  label: string;
  mesh: string;
  side: "front" | "back" | "left" | "right" | "top" | "bottom";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  kinds: ("text" | "image")[];
  fonts?: string[];
  colors?: string[];
  maxChars?: number;
  required?: boolean;
  price?: PriceRule;
  /** Shopper content, set only on a configured (choices-applied) config. */
  content?: DecalContent;
};

export type DecalContent = {
  text?: string;
  font?: string;
  color?: string;
  /** Uploaded image URL — never a data URL (see CONFIGURATOR-PLAN.md #8). */
  image?: string;
};

export type Hotspot = {
  id: string;
  label: string;
  description?: string;
  type?: "info" | "link" | "product";
  mesh?: string;
  offset?: [number, number, number];
  url?: string;
  productId?: string;
  camera?: CameraView;
};

export type CameraView = {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
};

export type ProductRenderConfig = {
  schema_version: 1;
  meshes?: Record<string, MeshConfig>;
  materials?: Record<string, MaterialConfig>;
  camera?: (CameraView & { lock?: Record<string, unknown> }) | null;
  environment?: Record<string, unknown> | null;
  animations?: Record<string, unknown> | null;
  optimization?: Record<string, unknown> | null;
  ar?: Record<string, unknown> | null;
  hotspots?: Hotspot[];
  gallery_presets?: Record<string, CameraView> | null;
  pricing?: unknown;
  options?: OptionGroup[];
  /** '' = the GLB's own materials. */
  material_variant?: string;
  decals?: DecalArea[];
};

/** One override layer: an option-value rule or a variant exception. */
export type ConfigLayer = {
  config?: Partial<ProductRenderConfig> | null;
  /** Its own GLB (Shopify Files gid). Replaces meshes/materials entirely. */
  modelFileId?: string | null;
};

/** "Color=Teal" -> layer. */
export type OptionRules = Record<string, ConfigLayer>;

/** What the shopper picked. */
export type ShopperChoices = {
  /** groupId -> choiceId */
  options?: Record<string, string>;
  /** areaId -> content */
  decals?: Record<string, DecalContent>;
  /** Plain customizer: mesh -> hex. */
  colors?: Record<string, string>;
  /** Plain customizer: mesh -> visible. */
  parts?: Record<string, boolean>;
};

/** Shopify's view of a product, just enough to resolve layers. */
export type ProductShape = { options: { name: string }[] };
/** Variant's selected options: { Color: "Teal", Size: "Wide" }. */
export type VariantOptions = Record<string, string>;
