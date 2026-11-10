import { applyShopperLayer, type ShopperLayer } from "./config";
import type {
  ConditionRule,
  Conditions,
  OptionChoice,
  OptionGroup,
  ProductRenderConfig,
  ShopperChoices,
  VariantOptions,
} from "./types";

/*
 * Customer options and conditional logic — ported from the prototype's
 * shopify/core/commerce.js. The prototype read module switches from a global
 * store; here the caller passes them, so the same code runs in the admin, the
 * storefront and the Cart Transform Function.
 */

export type ModuleFlags = Partial<Record<ModuleId, boolean>>;

export const MODULE_IDS = [
  "option-groups",
  "conditional-logic",
  "saved-designs",
  "order-snapshot",
  "customizer-modal",
  "undo-redo",
  "material-variants",
  "option-pricing",
  "personalization",
  "external-url",
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

function ruleMatches(
  rule: ConditionRule,
  choices: ShopperChoices | null | undefined,
  variantOptions: VariantOptions | null | undefined,
): boolean {
  if (rule.source === "option") {
    const v = variantOptions?.[rule.name];
    return rule.op === "is_not" ? v !== rule.value : v === rule.value;
  }
  const picked = choices?.options?.[rule.groupId];
  if (rule.op === "has_choice") return !!picked;
  if (rule.op === "no_choice") return !picked;
  return rule.op === "is_not"
    ? picked !== rule.choiceId
    : picked === rule.choiceId;
}

export function conditionsPass(
  cond: Conditions | null | undefined,
  choices: ShopperChoices | null | undefined,
  variantOptions: VariantOptions | null | undefined,
  modules: ModuleFlags,
): boolean {
  if (!cond || !cond.rules?.length || !modules["conditional-logic"]) {
    return true;
  }
  const res = cond.rules.map((r) => ruleMatches(r, choices, variantOptions));
  return cond.match === "any" ? res.some(Boolean) : res.every(Boolean);
}

/** Groups (with only their visible choices) the shopper can see right now. */
export function visibleGroups(
  config: ProductRenderConfig,
  choices: ShopperChoices | null | undefined,
  variantOptions: VariantOptions | null | undefined,
  modules: ModuleFlags,
): OptionGroup[] {
  if (!modules["option-groups"]) return [];
  return (config.options ?? [])
    .filter((g) => conditionsPass(g.conditions, choices, variantOptions, modules))
    .map((g) => ({
      ...g,
      choices: (g.choices ?? []).filter((c) =>
        conditionsPass(c.conditions, choices, variantOptions, modules),
      ),
    }))
    .filter((g) => g.choices.length > 0);
}

/** Picked choice per visible group: shopper pick, else the group default. */
export function resolvedPicks(
  config: ProductRenderConfig,
  choices: ShopperChoices | null | undefined,
  variantOptions: VariantOptions | null | undefined,
  modules: ModuleFlags,
): Record<string, OptionChoice> {
  const out: Record<string, OptionChoice> = {};
  for (const g of visibleGroups(config, choices, variantOptions, modules)) {
    const id = choices?.options?.[g.id] ?? g.default;
    const c = g.choices.find((x) => x.id === id);
    if (c) out[g.id] = c;
  }
  return out;
}

/** Engine layer from option picks, plain-customizer colors/parts and decals. */
export function shopperLayer(
  config: ProductRenderConfig,
  choices: ShopperChoices | null | undefined,
  variantOptions: VariantOptions | null | undefined,
  modules: ModuleFlags,
): ShopperLayer {
  const materials: NonNullable<ShopperLayer["materials"]> = {};
  const meshes: NonNullable<ShopperLayer["meshes"]> = {};
  const out: ShopperLayer = { materials, meshes };
  const picks = resolvedPicks(config, choices, variantOptions, modules);
  for (const g of visibleGroups(config, choices, variantOptions, modules)) {
    const c = picks[g.id];
    if (!c) continue;
    if (g.type === "material-variant") {
      if (modules["material-variants"]) out.material_variant = c.variant ?? "";
      continue;
    }
    for (const mesh of g.targets ?? []) {
      if (g.type === "color" && c.color) {
        materials[mesh] = { ...(materials[mesh] ?? {}), baseColor: c.color };
      }
      if (g.type === "material" && c.material) {
        materials[mesh] = { ...(materials[mesh] ?? {}), ...c.material };
      }
      if (g.type === "parts") {
        meshes[mesh] = { visible: (c.show ?? []).includes(mesh) };
      }
    }
  }
  for (const [mesh, hex] of Object.entries(choices?.colors ?? {})) {
    materials[mesh] = { ...(materials[mesh] ?? {}), baseColor: hex };
  }
  for (const [mesh, vis] of Object.entries(choices?.parts ?? {})) {
    meshes[mesh] = { visible: !!vis };
  }
  if (modules.personalization) {
    const decals: NonNullable<ShopperLayer["decals"]> = {};
    for (const [id, d] of Object.entries(choices?.decals ?? {})) {
      if (d && (d.text || d.image)) decals[id] = d;
    }
    out.decals = decals;
  }
  return out;
}

/** Resolved config with the shopper's choices baked in (snapshots, order previews). */
export function configuredConfig(
  config: ProductRenderConfig,
  choices: ShopperChoices | null | undefined,
  variantOptions: VariantOptions | null | undefined,
  modules: ModuleFlags,
): ProductRenderConfig {
  return applyShopperLayer(
    config,
    shopperLayer(config, choices, variantOptions, modules),
  );
}

/** Labels of required groups/areas still missing. */
export function missingRequired(
  config: ProductRenderConfig,
  choices: ShopperChoices | null | undefined,
  variantOptions: VariantOptions | null | undefined,
  modules: ModuleFlags,
): string[] {
  const missing: string[] = [];
  for (const g of visibleGroups(config, choices, variantOptions, modules)) {
    if (g.required && !choices?.options?.[g.id]) missing.push(g.label);
  }
  if (modules.personalization) {
    for (const a of config.decals ?? []) {
      const d = choices?.decals?.[a.id];
      if (a.required && !(d?.text || d?.image)) missing.push(a.label);
    }
  }
  return missing;
}

/**
 * Drop picks the shopper can't see any more (a condition hid the group or the
 * choice). Run before writing line properties so a hidden pick is never
 * charged or shown on the order.
 */
export function cleanChoices(
  config: ProductRenderConfig,
  choices: ShopperChoices | null | undefined,
  variantOptions: VariantOptions | null | undefined,
  modules: ModuleFlags,
): ShopperChoices {
  const options: Record<string, string> = {};
  for (const g of visibleGroups(config, choices, variantOptions, modules)) {
    const id = choices?.options?.[g.id];
    if (id && g.choices.some((c) => c.id === id)) options[g.id] = id;
  }
  const out: ShopperChoices = { options };
  if (modules.personalization && choices?.decals) {
    const areas = new Set((config.decals ?? []).map((a) => a.id));
    out.decals = Object.fromEntries(
      Object.entries(choices.decals).filter(
        ([id, d]) => areas.has(id) && d && (d.text || d.image),
      ),
    );
  }
  if (choices?.colors) out.colors = { ...choices.colors };
  if (choices?.parts) out.parts = { ...choices.parts };
  return out;
}

/* ---------- authoring: limits and sanitising ---------- */

export const OPTION_TYPES = ["color", "material", "parts", "material-variant"] as const;
export const OPTION_DISPLAYS = ["swatch", "button", "dropdown"] as const;
export const MAX_OPTION_GROUPS = 8;
export const MAX_OPTION_CHOICES = 24;

const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[\w-]{1,40}$/;
const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const unit = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined;
const money = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(-1e6, Math.min(1e6, v)) : undefined;
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const meshList = (v: unknown) =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 120)))].slice(0, 200)
    : [];

function cleanMaterial(raw: unknown): OptionChoice["material"] {
  if (!isObj(raw)) return undefined;
  const out: NonNullable<OptionChoice["material"]> = {};
  for (const k of ["baseColor", "color"] as const) {
    if (typeof raw[k] === "string" && HEX.test(raw[k] as string)) out[k] = raw[k] as string;
  }
  for (const k of ["metalness", "roughness", "clearcoat"] as const) {
    const n = unit(raw[k]);
    if (n !== undefined) out[k] = n;
  }
  const url = isObj(raw.texture) ? text(raw.texture.url, 500) : "";
  if (url.startsWith("https://")) out.texture = { url };
  return out;
}

function cleanPrice(raw: unknown) {
  if (!isObj(raw) || !["none", "fixed", "percent"].includes(raw.type as string)) return undefined;
  const out: NonNullable<OptionChoice["price"]> = { type: raw.type as "none" | "fixed" | "percent" };
  const amount = money(raw.amount);
  const sale = money(raw.sale);
  if (amount !== undefined) out.amount = amount;
  if (sale !== undefined) out.sale = sale;
  return out;
}

function cleanConditions(raw: unknown): Conditions | undefined {
  if (!isObj(raw) || !Array.isArray(raw.rules)) return undefined;
  const rules: ConditionRule[] = [];
  for (const r of raw.rules.slice(0, 10)) {
    if (!isObj(r)) continue;
    if (r.source === "option" && (r.op === "is" || r.op === "is_not")) {
      const name = text(r.name, 80);
      if (name) rules.push({ source: "option", name, op: r.op, value: text(r.value, 120) });
    } else if (
      r.source === "group" &&
      ["is", "is_not", "has_choice", "no_choice"].includes(r.op as string)
    ) {
      const groupId = text(r.groupId, 40);
      if (!ID.test(groupId)) continue;
      const rule: ConditionRule = {
        source: "group",
        groupId,
        op: r.op as "is" | "is_not" | "has_choice" | "no_choice",
      };
      if (typeof r.choiceId === "string" && ID.test(r.choiceId)) rule.choiceId = r.choiceId;
      rules.push(rule);
    }
  }
  return rules.length ? { match: raw.match === "any" ? "any" : "all", rules } : undefined;
}

type SanitizeFlags = { materialVariants?: boolean; pricing?: boolean; conditions?: boolean };

function cleanChoice(raw: unknown, seen: Set<string>, f: SanitizeFlags): OptionChoice | null {
  if (!isObj(raw)) return null;
  const id = text(raw.id, 40);
  if (!ID.test(id) || seen.has(id)) return null;
  seen.add(id);
  const out: OptionChoice = { id, label: text(raw.label, 60) || id };
  if (typeof raw.color === "string" && HEX.test(raw.color)) out.color = raw.color;
  const material = cleanMaterial(raw.material);
  if (material) out.material = material;
  if (Array.isArray(raw.show)) out.show = meshList(raw.show);
  if (typeof raw.variant === "string") out.variant = text(raw.variant, 120);
  const thumb = text(raw.thumbnail, 500);
  if (thumb.startsWith("https://")) out.thumbnail = thumb;
  const price = f.pricing === false ? undefined : cleanPrice(raw.price);
  if (price) out.price = price;
  const conditions = f.conditions === false ? undefined : cleanConditions(raw.conditions);
  if (conditions) out.conditions = conditions;
  return out;
}

/**
 * What the server accepts for `config.options`: known fields only, bounded
 * counts and lengths. The flags say which modules the plan includes: without
 * `materialVariants` groups of that type are dropped, without `pricing` price
 * rules are dropped, and without `conditions` conditions are dropped.
 */
export function sanitizeOptionGroups(
  raw: unknown,
  flags: SanitizeFlags = {},
): OptionGroup[] {
  const materialVariants = flags.materialVariants !== false;
  if (!Array.isArray(raw)) return [];
  const groupIds = new Set<string>();
  const out: OptionGroup[] = [];
  for (const g of raw) {
    if (out.length >= MAX_OPTION_GROUPS) break;
    if (!isObj(g)) continue;
    const id = text(g.id, 40);
    if (!ID.test(id) || groupIds.has(id)) continue;
    const type = g.type as OptionGroup["type"];
    if (!OPTION_TYPES.includes(type)) continue;
    if (type === "material-variant" && !materialVariants) continue;
    groupIds.add(id);
    const seen = new Set<string>();
    const choices = (Array.isArray(g.choices) ? g.choices : [])
      .slice(0, MAX_OPTION_CHOICES)
      .map((c) => cleanChoice(c, seen, flags))
      .filter((c): c is OptionChoice => !!c);
    const group: OptionGroup = {
      id,
      label: text(g.label, 60) || id,
      type,
      display: OPTION_DISPLAYS.includes(g.display as (typeof OPTION_DISPLAYS)[number])
        ? (g.display as OptionGroup["display"])
        : g.display === "thumbnail"
          ? "thumbnail"
          : "button",
      choices,
    };
    if (type !== "material-variant") group.targets = meshList(g.targets);
    if (typeof g.default === "string" && choices.some((c) => c.id === g.default)) {
      group.default = g.default;
    }
    if (g.required === true) group.required = true;
    const description = text(g.description, 200);
    if (description) group.description = description;
    const conditions = flags.conditions === false ? undefined : cleanConditions(g.conditions);
    if (conditions) group.conditions = conditions;
    out.push(group);
  }
  return out;
}
