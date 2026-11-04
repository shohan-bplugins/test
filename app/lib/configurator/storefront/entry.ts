import {
  applyShopperLayer,
  defaultConfig,
  layerModelId,
  resolveLayers,
  rulesFor,
} from "../config";
import {
  MODULE_IDS,
  cleanChoices,
  missingRequired,
  resolvedPicks,
  shopperLayer,
  visibleGroups,
  type ModuleFlags,
} from "../options";
import { encodePicks, priceSummary } from "../pricing";
import { LINE_PROP_PICKS } from "../constants";
import type {
  ConfigLayer,
  MaterialConfig,
  OptionGroup,
  OptionRules,
  ProductRenderConfig,
  ShopperChoices,
  VariantOptions,
} from "../types";

/*
 * Storefront half of the product configurator. Built by
 * scripts/build-storefront.mjs into extensions/viewer-3d/assets/configurator.js
 * and loaded by blocks/product_configurator.liquid.
 *
 * It does no rendering of its own: viewer-3d.js owns the egjs-view3d instance
 * and announces it with `viewer3d:ready`. This file resolves the layers
 * (config.ts — the same module the admin editor and the Cart Transform
 * Function use), restyles that instance's meshes, draws the option panel and
 * price box, and writes the picks onto the cart line.
 *
 * No three.js import: the viewer's copy is the only one on the page, and every
 * call below is a method of a material that already exists. That copy is the
 * same era as the editor's (three 0.134: no colour management), so the colour
 * maths matches the admin preview.
 */

type RenderPayload = {
  v: 1;
  enabled: boolean;
  customizer: "inherit" | "on" | "off";
  modules?: ModuleFlags;
  model: string | null;
  models: Record<string, { glb: string; usdz?: string }>;
  config: ProductRenderConfig;
  rules: OptionRules;
  variants: Record<string, ConfigLayer>;
};

type ProductJson = {
  options: string[];
  variants: {
    id: number;
    title: string;
    options: string[];
    price: number;
    compare_at_price?: number | null;
    sku?: string;
    available: boolean;
    featured_image?: { id: number } | null;
  }[];
};

type Strings = Record<string, string>;

const DEFAULTS: Strings = {
  heading: "Customize",
  required: "Required",
  choose: "Choose…",
  base_price: "Price",
  addons: "Add-ons",
  total: "Total",
  reset: "Reset choices",
  missing: "Please choose: {names}",
  add_to_cart: "Add to cart",
  adding: "Adding…",
  added: "Added to cart",
  add_failed: "Could not add to cart",
  sold_out: "Sold out",
  unavailable: "Unavailable",
  preview_badge: "Draft preview — not live yet",
};

/* ---------- applying a config to the viewer's meshes ---------- */

type Mat = {
  color?: { set(v: string): { convertSRGBToLinear(): void } };
  map?: unknown;
  metalness?: number;
  roughness?: number;
  clearcoat?: number;
  envMapIntensity?: number;
  needsUpdate?: boolean;
  clone(): Mat;
  copy(o: Mat): Mat;
  dispose(): void;
};
type Mesh = { name: string; visible: boolean; material: Mat | Mat[]; isMesh?: boolean };
type Obj = { traverse(fn: (o: Obj & Partial<Mesh>) => void): void };

/** Same naming rule as the editor's meshKeys, or config entries stop matching. */
function meshMap(root: Obj): Map<string, Mesh> {
  const map = new Map<string, Mesh>();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const base = (o.name || "").trim() || "Mesh";
    let name = base;
    for (let n = 2; map.has(name); n++) name = `${base}_${n}`;
    o.name = name;
    map.set(name, o as Mesh);
  });
  return map;
}

class Styler {
  private meshes: Map<string, Mesh>;
  private originals = new Map<string, { material: Mesh["material"]; visible: boolean }>();
  private clones = new Map<string, Mat>();

  constructor(root: Obj) {
    this.meshes = meshMap(root);
    for (const [name, m] of this.meshes) {
      this.originals.set(name, { material: m.material, visible: m.visible });
    }
  }

  apply(cfg: ProductRenderConfig) {
    for (const [name, mesh] of this.meshes) {
      const o = this.originals.get(name)!;
      mesh.visible = o.visible;
      mesh.material = o.material;
    }
    for (const [name, mc] of Object.entries(cfg.meshes ?? {})) {
      const mesh = this.meshes.get(name);
      if (mesh && mc?.visible !== undefined) mesh.visible = !!mc.visible;
    }
    const used = new Set<string>();
    for (const [name, mc] of Object.entries(cfg.materials ?? {}) as [string, MaterialConfig][]) {
      const mesh = this.meshes.get(name);
      const orig = this.originals.get(name)?.material;
      if (!mesh || !orig || Array.isArray(orig) || !mc) continue;
      if (
        !mc.baseColor &&
        mc.metalness === undefined &&
        mc.roughness === undefined &&
        mc.clearcoat === undefined
      ) {
        continue;
      }
      let m = this.clones.get(name);
      if (!m) {
        m = orig.clone();
        this.clones.set(name, m);
      } else {
        m.copy(orig);
      }
      used.add(name);
      mesh.material = m;
      if (mc.baseColor && m.color) {
        m.color.set(mc.baseColor).convertSRGBToLinear();
        m.map = null;
      }
      if (mc.metalness !== undefined) m.metalness = Number(mc.metalness);
      if (mc.roughness !== undefined) m.roughness = Number(mc.roughness);
      if (mc.clearcoat !== undefined && "clearcoat" in m) m.clearcoat = Number(mc.clearcoat);
      m.needsUpdate = true;
    }
    for (const [name, m] of this.clones) {
      if (!used.has(name)) {
        m.dispose();
        this.clones.delete(name);
      }
    }
  }
}

/* ---------- helpers ---------- */

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function parse<T>(raw: string | undefined, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function variantFromPage(root: HTMLElement): number | null {
  const url = new URL(location.href).searchParams.get("variant");
  if (url) return Number(url);
  const input =
    root.querySelector<HTMLInputElement>("form[data-e3d-form] [name=id]") ??
    document.querySelector<HTMLInputElement>('form[action*="/cart/add"] [name="id"]');
  if (input?.value) return Number(input.value);
  return Number(root.dataset.variantId) || null;
}

/* ---------- one configurator ---------- */

class Configurator {
  private render: RenderPayload;
  private product: ProductJson;
  private strings: Strings;
  private modules: ModuleFlags;
  private styler: Styler | null = null;
  private view3d: any = null;
  private loadedModel: string | null;
  private variantId: number | null;
  private choices: ShopperChoices = { options: {} };
  private fmt: Intl.NumberFormat;
  private panel: HTMLElement;
  private viewer: HTMLElement;
  /** The block's own product form; absent when only the options are embedded. */
  private form: HTMLFormElement | null;
  private previewBadge: HTMLElement | null = null;

  constructor(private root: HTMLElement) {
    const blank = {
      v: 1,
      enabled: true,
      customizer: "off",
      model: null,
      models: {},
      config: defaultConfig(),
      rules: {},
      variants: {},
    } as RenderPayload;
    // The editor's Preview opens the page with ?e3d_preview=1: show the saved
    // draft instead of what is live. Shoppers never have the flag.
    const previewing =
      !!root.dataset.renderDraft && new URLSearchParams(location.search).has("e3d_preview");
    if (previewing) {
      const draft = parse<RenderPayload | null>(root.dataset.renderDraft, null);
      this.render = draft && draft.customizer !== "off" ? draft : blank;
      for (const hidden of root.querySelectorAll<HTMLElement>("[data-draft-hidden]")) {
        hidden.hidden = false;
      }
      const badge = document.createElement("div");
      badge.className = "e3d-preview-badge";
      badge.setAttribute("role", "status");
      root.prepend(badge);
      this.previewBadge = badge;
    } else {
      this.render = parse<RenderPayload | null>(root.dataset.render, null) ?? blank;
    }
    this.form = root.querySelector<HTMLFormElement>("form[data-e3d-form]");
    this.product = parse(root.dataset.product, { options: [], variants: [] });
    this.strings = { ...DEFAULTS, ...parse<Strings>(root.dataset.i18n, {}) };
    if (this.previewBadge) this.previewBadge.textContent = this.t("preview_badge");
    // Products published before `modules` existed carry no flags. The editor's
    // save already stripped whatever the plan didn't allow (options, prices,
    // conditions), so what is stored is safe to show; treating "missing" as
    // "none" would hide every option until the merchant re-saved.
    this.modules =
      this.render.modules ??
      (Object.fromEntries(MODULE_IDS.map((id) => [id, true])) as ModuleFlags);
    this.viewer = root.querySelector<HTMLElement>("[data-view3d]")!;
    this.panel = root.querySelector<HTMLElement>("[data-e3d-panel]")!;
    this.variantId = variantFromPage(root);
    this.loadedModel = this.viewer.dataset.modelUrl ?? null;
    try {
      this.fmt = new Intl.NumberFormat(root.dataset.locale || undefined, {
        style: "currency",
        currency: root.dataset.currency || "USD",
      });
    } catch {
      this.fmt = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
    }

    this.viewer.addEventListener("viewer3d:ready", (e) => {
      this.view3d = (e as CustomEvent).detail.view3d;
      const scene = this.view3d?.model?.scene ?? this.view3d?.scene?.root;
      if (scene) this.styler = new Styler(scene);
      this.update(false);
    });
    this.watchVariant();
    this.bindProductUi();
    this.update(true);
  }

  /* ---------- the product section around the viewer ---------- */

  private $<T extends HTMLElement>(sel: string) {
    return this.root.querySelector<T>(sel);
  }

  private bindProductUi() {
    for (const group of this.root.querySelectorAll<HTMLElement>("[data-option-index]")) {
      group.addEventListener("change", () => this.pickFromControls());
    }
    for (const thumb of this.root.querySelectorAll<HTMLElement>("[data-e3d-thumb]")) {
      thumb.addEventListener("click", () =>
        this.showMedia(thumb.dataset.e3dThumb === "3d" ? null : thumb.dataset.e3dThumb!),
      );
    }
    this.form?.querySelector<HTMLButtonElement>("[data-e3d-buy]")?.addEventListener("click", (e) => {
      void this.addToCart(e.currentTarget as HTMLButtonElement, true);
    });
    this.form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const btn = this.form!.querySelector<HTMLButtonElement>("[data-e3d-submit]");
      if (btn) void this.addToCart(btn);
    });
  }

  /** Show the 3D viewer (null) or one product image in the stage. */
  private showMedia(imageId: string | null) {
    for (const img of this.root.querySelectorAll<HTMLElement>("[data-e3d-image]")) {
      img.classList.toggle("is-active", img.dataset.e3dImage === imageId);
    }
    for (const t of this.root.querySelectorAll<HTMLElement>("[data-e3d-thumb]")) {
      const on = (t.dataset.e3dThumb === "3d" ? null : t.dataset.e3dThumb) === imageId;
      t.classList.toggle("is-on", on);
      t.setAttribute("aria-pressed", String(on));
    }
  }

  /** The variant the picker's current values name; the nearest one if that combination doesn't exist. */
  private pickFromControls() {
    const chosen = this.product.options.map((_, i) => {
      const g = this.$(`[data-option-index="${i}"]`);
      return (
        g?.querySelector<HTMLInputElement>("input:checked")?.value ??
        g?.querySelector<HTMLSelectElement>("select")?.value ??
        ""
      );
    });
    const score = (v: ProductJson["variants"][number]) =>
      v.options.reduce((n, o, i) => n + (o === chosen[i] ? 1 : 0), 0);
    const best = [...this.product.variants]
      .sort((a, b) => score(b) - score(a) || Number(b.available) - Number(a.available))[0];
    if (best) {
      this.variantId = best.id;
      this.update(true);
    }
  }

  /** Everything on the page that follows the selected variant and the live total. */
  private syncProductUi(total: number | null, addons: number) {
    const v = this.variant;
    if (!v) return;

    const idInput = this.form?.querySelector<HTMLInputElement>("[name=id]");
    if (idInput) idInput.value = String(v.id);
    // Also when the block has its own variant picker but no form (the modal
    // block): otherwise watchVariant re-reads the page's old variant after every
    // change event and snaps the pick back.
    if (this.form || this.root.querySelector("[data-option-index]")) {
      const url = new URL(location.href);
      if (url.searchParams.get("variant") !== String(v.id)) {
        url.searchParams.set("variant", String(v.id));
        history.replaceState(history.state, "", url);
      }
    }

    // Reflect a variant chosen elsewhere (URL, theme) back onto the controls, and
    // grey out values that can't be bought with the other current picks.
    this.product.options.forEach((_, i) => {
      const group = this.$(`[data-option-index="${i}"]`);
      if (!group) return;
      for (const input of group.querySelectorAll<HTMLInputElement>("input")) {
        input.checked = input.value === v.options[i];
        const stillAvailable = this.product.variants.some(
          (x) =>
            x.available &&
            x.options[i] === input.value &&
            x.options.every((o, j) => j === i || o === v.options[j]),
        );
        input.closest("label")?.classList.toggle("is-unavailable", !stillAvailable);
      }
      const select = group.querySelector<HTMLSelectElement>("select");
      if (select) select.value = v.options[i];
    });

    const price = this.$("[data-e3d-price-main]");
    if (price) price.textContent = this.money(total ?? v.price / 100);
    const compare = this.$("[data-e3d-price-compare]");
    if (compare) {
      const on = !!v.compare_at_price && v.compare_at_price > v.price && !addons;
      compare.hidden = !on;
      compare.textContent = on ? this.money(v.compare_at_price! / 100) : "";
    }
    const sku = this.$("[data-e3d-sku]");
    if (sku) sku.textContent = v.sku ?? "";

    const btn = this.form?.querySelector<HTMLButtonElement>("[data-e3d-submit]");
    if (btn) {
      btn.disabled = !v.available;
      btn.textContent = v.available ? this.t("add_to_cart") : this.t("sold_out");
    }
    const buy = this.form?.querySelector<HTMLButtonElement>("[data-e3d-buy]");
    if (buy) buy.disabled = !v.available;

    if (v.featured_image?.id) {
      const has = this.$(`[data-e3d-image="${v.featured_image.id}"]`);
      if (has) this.showMedia(String(v.featured_image.id));
    }
  }

  private t(key: string, vars?: Record<string, string>) {
    return (this.strings[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? "");
  }

  private money(n: number) {
    return this.fmt.format(n);
  }

  private get variant() {
    const vs = this.product.variants;
    return vs.find((v) => v.id === this.variantId) ?? vs.find((v) => v.available) ?? vs[0];
  }

  private variantOptions(): VariantOptions {
    const v = this.variant;
    const out: VariantOptions = {};
    this.product.options.forEach((name, i) => {
      if (v?.options[i] != null) out[name] = v.options[i];
    });
    return out;
  }

  /** Product default <- option rules <- variant exception. */
  private layers() {
    const vo = this.variantOptions();
    const shape = { options: this.product.options.map((name) => ({ name })) };
    const ruleLayers = rulesFor(shape, vo, this.render.rules);
    const variantLayer = this.variant ? this.render.variants?.[String(this.variant.id)] : null;
    return {
      vo,
      cfg: resolveLayers(this.render.config, ruleLayers, variantLayer),
      modelId: layerModelId(this.render.model, ruleLayers, variantLayer),
    };
  }

  private watchVariant() {
    const check = () => {
      const id = variantFromPage(this.root);
      if (id && id !== this.variantId) {
        this.variantId = id;
        this.update(true);
      }
    };
    // Themes announce a variant change in different ways; the URL's ?variant=
    // and the product form's hidden id are the two every theme keeps in step.
    for (const m of ["pushState", "replaceState"] as const) {
      const orig = history[m];
      history[m] = function (this: History, ...a: Parameters<History["pushState"]>) {
        const r = orig.apply(this, a);
        setTimeout(check);
        return r;
      };
    }
    window.addEventListener("popstate", check);
    document.addEventListener("change", () => setTimeout(check));
    document.addEventListener("variant:change", check);
    document.addEventListener("variantChange", check);
    const input = document.querySelector('form[action*="/cart/add"] [name="id"]');
    if (input) {
      new MutationObserver(check).observe(input, { attributes: true, attributeFilter: ["value"] });
    }
  }

  /** Re-resolve everything. `panel` redraws the controls; styling always reapplies. */
  private update(panel: boolean) {
    const { cfg, vo, modelId } = this.layers();

    // Drop picks a condition has hidden, and seed defaults for visible groups.
    const kept = cleanChoices(cfg, this.choices, vo, this.modules);
    const picks = resolvedPicks(cfg, kept, vo, this.modules);
    for (const [gid, c] of Object.entries(picks)) {
      if (!kept.options![gid]) kept.options![gid] = c.id;
    }
    this.choices = kept;

    const wanted = modelId ? this.render.models?.[modelId]?.glb : null;
    if (wanted && this.view3d && wanted !== this.loadedModel) {
      this.loadedModel = wanted;
      this.styler = null;
      Promise.resolve(this.view3d.load(wanted)).then(() => {
        const scene = this.view3d?.model?.scene ?? this.view3d?.scene?.root;
        if (scene) this.styler = new Styler(scene);
        this.restyle();
      });
    } else {
      this.restyle();
    }

    if (panel || this.panel.childElementCount === 0) this.draw();
    else this.drawPrice();
    const summary = priceSummary(cfg, (this.variant?.price ?? 0) / 100, this.choices, vo, this.modules);
    this.syncProductUi(summary.total, summary.addons);
    this.syncForms();
  }

  private restyle() {
    if (!this.styler) return;
    const { cfg, vo } = this.layers();
    const layer = shopperLayer(cfg, this.choices, vo, this.modules);
    this.styler.apply(applyShopperLayer(cfg, layer));
    this.view3d?.renderer?.renderSingleFrame?.(true);
  }

  private pick(group: OptionGroup, choiceId: string) {
    this.choices = {
      ...this.choices,
      options: { ...this.choices.options, [group.id]: choiceId },
    };
    this.update(true);
  }

  private reset() {
    this.choices = { options: {} };
    this.update(true);
  }

  /* ---------- panel ---------- */

  private draw() {
    const { cfg, vo } = this.layers();
    const groups = visibleGroups(cfg, this.choices, vo, this.modules);
    this.panel.replaceChildren();
    this.panel.hidden = groups.length === 0;
    if (groups.length === 0) return;

    this.panel.append(el("h3", "e3d-heading", this.t("heading")));
    for (const g of groups) this.panel.append(this.group(g));

    const price = el("div", "e3d-price");
    price.dataset.e3dPrice = "";
    this.panel.append(price);

    const foot = el("div", "e3d-foot");
    const reset = el("button", "e3d-link", this.t("reset"));
    reset.type = "button";
    reset.onclick = () => this.reset();
    foot.append(reset);
    // Embedded without the product form, the panel carries its own button.
    if (!this.form) {
      const add = el("button", "e3d-add", this.t("add_to_cart"));
      add.type = "button";
      add.dataset.e3dAdd = "";
      add.onclick = () => void this.addToCart(add);
      foot.append(add);
    }
    this.panel.append(foot);

    const msg = el("p", "e3d-msg");
    msg.setAttribute("role", "status");
    msg.dataset.e3dMsg = "";
    this.panel.append(msg);
    this.drawPrice();
  }

  private group(g: OptionGroup) {
    const wrap = el("div", "e3d-group");
    const label = el("div", "e3d-label", g.label);
    if (g.required) label.append(el("span", "e3d-req", ` · ${this.t("required")}`));
    wrap.append(label);
    if (g.description) wrap.append(el("p", "e3d-desc", g.description));

    const current = this.choices.options?.[g.id];
    if (g.display === "dropdown") {
      const sel = el("select", "e3d-select");
      sel.setAttribute("aria-label", g.label);
      if (!current) {
        const o = el("option", undefined, this.t("choose"));
        o.value = "";
        sel.append(o);
      }
      for (const c of g.choices) {
        const o = el("option", undefined, this.choiceLabel(c.label, g, c.id));
        o.value = c.id;
        o.selected = c.id === current;
        sel.append(o);
      }
      sel.onchange = () => sel.value && this.pick(g, sel.value);
      wrap.append(sel);
      return wrap;
    }

    const row = el("div", "e3d-choices");
    row.setAttribute("role", "radiogroup");
    row.setAttribute("aria-label", g.label);
    for (const c of g.choices) {
      const b = el("button", `e3d-choice e3d-${g.display}`);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(c.id === current));
      b.title = c.label;
      if (c.id === current) b.classList.add("is-on");
      if (g.display === "swatch") {
        const sw = el("span", "e3d-swatch");
        const bg = c.color ?? c.material?.baseColor ?? c.material?.color;
        if (bg) sw.style.background = bg;
        b.append(sw);
        b.setAttribute("aria-label", c.label);
      } else if (g.display === "thumbnail" && c.thumbnail) {
        const img = el("img", "e3d-thumb");
        img.src = c.thumbnail;
        img.alt = c.label;
        b.append(img);
      } else {
        b.textContent = this.choiceLabel(c.label, g, c.id);
      }
      b.onclick = () => this.pick(g, c.id);
      row.append(b);
    }
    wrap.append(row);
    return wrap;
  }

  /** Dropdown / button labels carry the price delta, e.g. "Walnut (+$20.00)". */
  private choiceLabel(label: string, g: OptionGroup, id: string) {
    const c = g.choices.find((x) => x.id === id);
    const base = (this.variant?.price ?? 0) / 100;
    if (!c?.price || c.price.type === "none" || !this.modules["option-pricing"]) return label;
    const amt = c.price.sale ?? c.price.amount ?? 0;
    const delta = c.price.type === "percent" ? Math.round(base * amt) / 100 : amt;
    if (!delta) return label;
    return `${label} (${delta > 0 ? "+" : "−"}${this.money(Math.abs(delta))})`;
  }

  private drawPrice() {
    const box = this.panel.querySelector<HTMLElement>("[data-e3d-price]");
    if (!box) return;
    const { cfg, vo } = this.layers();
    const v = this.variant;
    const s = priceSummary(cfg, (v?.price ?? 0) / 100, this.choices, vo, this.modules);
    box.replaceChildren();
    if (!s.lines.length) return;
    const line = (label: string, amount: string, cls = "") => {
      const r = el("div", `e3d-row ${cls}`.trim());
      r.append(el("span", undefined, label), el("span", undefined, amount));
      box.append(r);
    };
    line(this.t("base_price"), this.money(s.base));
    for (const l of s.lines) line(l.label, `${l.amount < 0 ? "−" : "+"}${this.money(Math.abs(l.amount))}`);
    line(this.t("total"), this.money(s.total), "e3d-total");
  }

  /* ---------- cart ---------- */

  /** Readable rows for the cart/order, plus the hidden ids the Function prices from. */
  private properties(): Record<string, string> {
    const { cfg, vo } = this.layers();
    const picks = resolvedPicks(cfg, this.choices, vo, this.modules);
    const props: Record<string, string> = {};
    for (const g of visibleGroups(cfg, this.choices, vo, this.modules)) {
      if (picks[g.id]) props[g.label] = picks[g.id].label;
    }
    props[LINE_PROP_PICKS] = encodePicks(this.choices);
    return props;
  }

  private missing() {
    const { cfg, vo } = this.layers();
    return missingRequired(cfg, this.choices, vo, this.modules);
  }

  /** Keep the theme's own product form carrying the picks, so its button works too. */
  private syncForms() {
    const props = this.properties();
    const forms = this.form
      ? [this.form]
      : document.querySelectorAll<HTMLFormElement>('form[action*="/cart/add"]');
    for (const form of forms) {
      for (const input of form.querySelectorAll<HTMLInputElement>("input[data-e3d]")) input.remove();
      for (const [k, v] of Object.entries(props)) {
        const i = document.createElement("input");
        i.type = "hidden";
        i.name = `properties[${k}]`;
        i.value = v;
        i.dataset.e3d = "";
        form.append(i);
      }
    }
  }

  private say(text: string, bad = false) {
    const m = this.panel.querySelector<HTMLElement>("[data-e3d-msg]");
    if (!m) return;
    m.textContent = text;
    m.classList.toggle("is-bad", bad);
  }

  private async addToCart(btn: HTMLButtonElement, checkout = false) {
    const label = btn.textContent;
    const missing = this.missing();
    if (missing.length) {
      this.say(this.t("missing", { names: missing.join(", ") }), true);
      return;
    }
    const v = this.variant;
    if (!v || !v.available) {
      this.say(this.t("sold_out"), true);
      return;
    }
    const qty = Math.max(1, Number(this.form?.querySelector<HTMLInputElement>("[name=quantity]")?.value) || 1);
    btn.disabled = true;
    if (!checkout) btn.textContent = this.t("adding");
    try {
      const res = await fetch(`${window.Shopify?.routes?.root ?? "/"}cart/add.js`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ items: [{ id: v.id, quantity: qty, properties: this.properties() }] }),
      });
      if (!res.ok) throw new Error(String(res.status));
      if (checkout) {
        location.href = `${window.Shopify?.routes?.root ?? "/"}checkout`;
        return;
      }
      this.say(this.t("added"));
      document.dispatchEvent(new CustomEvent("cart:refresh", { bubbles: true }));
    } catch {
      this.say(this.t("add_failed"), true);
    } finally {
      btn.disabled = !this.variant?.available;
      btn.textContent = label;
    }
  }
}

declare global {
  interface Window {
    Shopify?: { routes?: { root?: string } };
    __e3dConfigurator?: boolean;
  }
}

function init() {
  for (const root of document.querySelectorAll<HTMLElement>("[data-e3d-configurator]")) {
    if (root.dataset.e3dReady) continue;
    root.dataset.e3dReady = "1";
    try {
      new Configurator(root);
    } catch (err) {
      console.warn("[3d-configurator] could not start", err);
    }
  }
}

if (!window.__e3dConfigurator) {
  window.__e3dConfigurator = true;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  document.addEventListener("shopify:section:load", init);
}
