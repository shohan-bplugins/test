import { resolveLayers, rulesFor } from "./config";
import { resolvedPicks, visibleGroups, type ModuleFlags } from "./options";
import type {
  ConfigLayer,
  OptionRules,
  PriceRule,
  ProductRenderConfig,
  ProductShape,
  ShopperChoices,
  VariantOptions,
} from "./types";

/*
 * Option pricing — a port of the prototype's ruleAmount/priceLines/
 * priceSummary. Runs in the browser (live price), on the server (design
 * records) and, through the compact payload below, in the Cart Transform
 * Function, which is the one that actually charges.
 *
 * Amounts are in the shop's currency. Rounded to cents at each step, as the
 * Function must, so the three surfaces agree to the cent.
 */

const cents = (n: number) => Math.round(n * 100) / 100;

export function ruleAmount(
  rule: PriceRule | null | undefined,
  base: number,
  modules: ModuleFlags,
): number {
  if (!rule || rule.type === "none" || !modules["option-pricing"]) return 0;
  const amount = rule.sale ?? rule.amount ?? 0;
  return rule.type === "percent"
    ? Math.round(base * amount) / 100
    : cents(Number(amount));
}

export type PriceLine = { label: string; amount: number; regular?: number };

/** Priced add-on lines for option picks and decal areas. */
export function priceLines(
  config: ProductRenderConfig,
  base: number,
  choices: ShopperChoices | null | undefined,
  variantOptions: VariantOptions | null | undefined,
  modules: ModuleFlags,
): PriceLine[] {
  const out: PriceLine[] = [];
  const picks = resolvedPicks(config, choices, variantOptions, modules);
  for (const g of visibleGroups(config, choices, variantOptions, modules)) {
    const c = picks[g.id];
    if (!c?.price) continue;
    const amount = ruleAmount(c.price, base, modules);
    if (!amount) continue;
    out.push({
      label: `${g.label}: ${c.label}`,
      amount,
      regular:
        c.price.sale != null
          ? ruleAmount({ ...c.price, sale: undefined }, base, modules)
          : undefined,
    });
  }
  if (modules.personalization) {
    for (const area of config.decals ?? []) {
      const d = choices?.decals?.[area.id];
      if (!d || !(d.text || d.image) || !area.price) continue;
      const amount = ruleAmount(area.price, base, modules);
      if (amount) {
        out.push({
          label: `${area.label}: ${d.text ? `"${d.text}"` : "Image"}`,
          amount,
        });
      }
    }
  }
  return out;
}

export type PriceSummary = {
  base: number;
  lines: PriceLine[];
  addons: number;
  total: number;
};

export function priceSummary(
  config: ProductRenderConfig,
  base: number,
  choices: ShopperChoices | null | undefined,
  variantOptions: VariantOptions | null | undefined,
  modules: ModuleFlags,
): PriceSummary {
  const lines = priceLines(config, base, choices, variantOptions, modules);
  const addons = cents(lines.reduce((t, l) => t + l.amount, 0));
  return { base, lines, addons, total: cents(base + addons) };
}

/* ---------- compact payload for the Cart Transform Function ---------- */

/*
 * The Function can't reach the app database, so everything it needs to price
 * a line is published in the product's `$app:configurator.pricing` metafield.
 * Shopify caps what a Function reads, so the payload keeps only price rules,
 * keyed by group/choice/area ids:
 *
 *   { v: 1,
 *     d: PriceTable,                       product default
 *     r: { "Color=Teal": PriceTable },     option rules that replace options/decals
 *     x: { "<variant id>": PriceTable } }  variant exceptions that do
 *
 * `options` and `decals` are separate whole-value layers (config.ts): a layer
 * that overrides one replaces that half of the table (`o` or `a`) and
 * inherits the other — the Function resolves the same way as resolveLayers.
 * So a layer's table carries `o`/`a` exactly when its config sets
 * options/decals, even if nothing in it is priced.
 *
 * Conditions are deliberately not in the payload: the client drops hidden
 * picks before adding to cart (cleanChoices), and the Function only ever adds
 * charges for ids the shopper sent, so a forged hidden pick can only cost the
 * shopper more.
 */

/** [type, amount] — type 1 = fixed, 2 = percent. Sale is folded into amount. */
type CompactRule = [1 | 2, number];
export type PriceTable = {
  /** groupId -> choiceId -> rule */
  o?: Record<string, Record<string, CompactRule>>;
  /** areaId -> rule */
  a?: Record<string, CompactRule>;
};
export type PricingPayload = {
  v: 1;
  d: PriceTable;
  r?: Record<string, PriceTable>;
  x?: Record<string, PriceTable>;
};

/** Function input budget we hold ourselves to (bytes of JSON). */
export const PRICING_PAYLOAD_LIMIT = 10_000;

function compactRule(rule: PriceRule | undefined): CompactRule | null {
  if (!rule || rule.type === "none") return null;
  const amount = Number(rule.sale ?? rule.amount ?? 0);
  if (!amount) return null;
  return [rule.type === "percent" ? 2 : 1, amount];
}

function priceTable(
  config: Partial<ProductRenderConfig> | null | undefined,
): PriceTable | null {
  if (!config || (!config.options && !config.decals)) return null;
  const table: PriceTable = {};
  if (config.options) {
    const o: NonNullable<PriceTable["o"]> = {};
    for (const g of config.options) {
      for (const c of g.choices ?? []) {
        const r = compactRule(c.price);
        if (r) (o[g.id] ??= {})[c.id] = r;
      }
    }
    table.o = o;
  }
  if (config.decals) {
    const a: NonNullable<PriceTable["a"]> = {};
    for (const area of config.decals) {
      const r = compactRule(area.price);
      if (r) a[area.id] = r;
    }
    table.a = a;
  }
  return table;
}

export function buildPricingPayload(
  base: ProductRenderConfig,
  optionRules: OptionRules,
  variantConfigs: Record<string, ConfigLayer>,
): PricingPayload {
  const payload: PricingPayload = { v: 1, d: priceTable(base) ?? {} };
  for (const [key, layer] of Object.entries(optionRules)) {
    const t = priceTable(layer.config);
    if (t) (payload.r ??= {})[key] = t;
  }
  for (const [vid, layer] of Object.entries(variantConfigs)) {
    const t = priceTable(layer.config);
    if (t) (payload.x ??= {})[vid] = t;
  }
  return payload;
}

export function pricingPayloadSize(payload: PricingPayload): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

/**
 * The table that applies to a variant — for options and decals separately,
 * the last layer that sets them wins, as in resolveLayers. `ruleKeys` are the
 * variant's "Name=Value" keys in the product's option order.
 */
export function tableFor(
  payload: PricingPayload,
  ruleKeys: string[],
  variantId: string,
): PriceTable {
  let { o, a } = payload.d;
  const layers = [
    ...ruleKeys.map((key) => payload.r?.[key]),
    payload.x?.[variantId],
  ];
  for (const t of layers) {
    if (t?.o) o = t.o;
    if (t?.a) a = t.a;
  }
  return { o, a };
}

/** Add-on total for a line, from the payload alone (what the Function charges). */
export function payloadAddons(
  table: PriceTable,
  base: number,
  picks: EncodedPicks,
): number {
  let total = 0;
  for (const [gid, cid] of Object.entries(picks.o)) {
    const r = table.o?.[gid]?.[cid];
    if (r) total += r[0] === 2 ? Math.round(base * r[1]) / 100 : r[1];
  }
  for (const aid of picks.a) {
    const r = table.a?.[aid];
    if (r) total += r[0] === 2 ? Math.round(base * r[1]) / 100 : r[1];
  }
  return cents(total);
}

/* ---------- picks on the cart line ---------- */

/*
 * What the shopper picked, in the hidden `_3d_picks` line property — ids only,
 * never prices, so editing the cart can't change what is charged:
 *
 *   "g1:c2,g2:c1|a1,a2"   option picks | decal areas with content
 */
export type EncodedPicks = { o: Record<string, string>; a: string[] };

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function encodePicks(choices: ShopperChoices): string {
  const o = Object.entries(choices.options ?? {})
    .filter(([g, c]) => SAFE_ID.test(g) && SAFE_ID.test(c))
    .map(([g, c]) => `${g}:${c}`)
    .join(",");
  const a = Object.entries(choices.decals ?? {})
    .filter(([id, d]) => SAFE_ID.test(id) && d && (d.text || d.image))
    .map(([id]) => id)
    .join(",");
  return `${o}|${a}`;
}

export function decodePicks(raw: string | null | undefined): EncodedPicks {
  const out: EncodedPicks = { o: {}, a: [] };
  if (!raw) return out;
  const [o = "", a = ""] = raw.split("|");
  for (const pair of o.split(",")) {
    const [g, c] = pair.split(":");
    if (g && c && SAFE_ID.test(g) && SAFE_ID.test(c)) out.o[g] = c;
  }
  for (const id of a.split(",")) if (SAFE_ID.test(id)) out.a.push(id);
  return out;
}

/** Convenience for admin/server: resolve the variant's config, then price it. */
export function priceForVariant(
  product: ProductShape,
  base: ProductRenderConfig,
  optionRules: OptionRules,
  variantConfigs: Record<string, ConfigLayer>,
  variantId: string,
  variantOptions: VariantOptions,
  variantPrice: number,
  choices: ShopperChoices,
  modules: ModuleFlags,
): PriceSummary {
  const cfg = resolveLayers(
    base,
    rulesFor(product, variantOptions, optionRules),
    variantConfigs[variantId],
  );
  return priceSummary(cfg, variantPrice, choices, variantOptions, modules);
}
