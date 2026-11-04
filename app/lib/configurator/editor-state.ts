import { useSyncExternalStore } from "react";

import {
  getMaterialConfig,
  layerModelId,
  resolveEffectiveConfig,
  resolveLayers,
  ruleKey,
  rulesFor,
} from "./config";
import {
  configuredConfig,
  MAX_OPTION_CHOICES,
  MAX_OPTION_GROUPS,
  type ModuleFlags,
} from "./options";
import type {
  CameraView,
  ConfigLayer,
  OptionChoice,
  OptionGroup,
  ProductRenderConfig,
} from "./types";

/*
 * The 3D editor's session — a port of the prototype's
 * shopify/admin/editor/state.js. One draft holds the product default, one
 * layer per option value ("Size=Wide") and per-variant exceptions; each target
 * has its own undo history (50 steps, edits within 800 ms merge).
 *
 * Edits follow resolveEffectiveConfig: meshes/materials per entry,
 * environment/optimization/ar per field, everything else as a whole value.
 *
 * Module-level like the prototype: the editor is the only thing in its
 * s-app-window, so there is exactly one session per page.
 */

export type EditorProduct = {
  id: string;
  title: string;
  handle: string;
  options: { name: string; values: string[] }[];
  variants: {
    id: string;
    title: string;
    options: Record<string, string>;
    price?: string;
    compareAtPrice?: string | null;
    sku?: string;
    /** false = unlimited quantity (Shopify's "don't track quantity"). */
    tracked?: boolean;
    quantity?: number | null;
    /** The variant's own image (thumbnail size), when it has one. */
    image?: string | null;
  }[];
};

export type Draft = {
  modelFileId: string | null;
  base: ProductRenderConfig;
  rules: Record<string, ConfigLayer>;
  variants: Record<string, ConfigLayer>;
};

export type SceneNode = { name: string; mesh?: string; children?: SceneNode[] };

type History = { past: Snap[]; future: Snap[] };
type Snap = { modelFileId: string | null; config: Partial<ProductRenderConfig> | null | undefined };

export type EditorState = {
  product: EditorProduct;
  /** "default" | "rule:Color=Teal" | "<variant id>" */
  target: string;
  draft: Draft;
  saved: string;
  history: Record<string, History>;
  lastKey: string | null;
  lastAt: number;
  selection: string | null;
  meshNames: string[];
  hierarchy: SceneNode[];
  saving: boolean;
  /** Option previews: groupId -> choiceId. Session only, never saved. */
  preview: Record<string, string>;
  /** Model file gid -> GLB url, for the product's and every layer's model. */
  modelUrls: Record<string, string>;
  /** Display names for models picked this session. */
  modelNames: Record<string, string>;
};

const HISTORY_CAP = 50;
const COALESCE_MS = 800;
const RULE = "rule:";
const EMPTY = (): Partial<ProductRenderConfig> => ({ schema_version: 1 });
const clone = <T,>(x: T): T => (x == null ? x : JSON.parse(JSON.stringify(x)));

let st: EditorState | null = null;
const subs = new Set<() => void>();

function set(patch: Partial<EditorState>) {
  st = { ...(st as EditorState), ...patch };
  subs.forEach((f) => f());
}

function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o ?? {})) if (v !== undefined) out[k] = v;
  return out as T;
}

export function initEditor(
  product: EditorProduct,
  saved: {
    modelFileId: string | null;
    config: ProductRenderConfig;
    optionRules: Record<string, ConfigLayer>;
    variantConfigs: Record<string, ConfigLayer>;
  },
  modelUrls: Record<string, string> = {},
) {
  const rules: Record<string, ConfigLayer> = {};
  for (const o of product.options) {
    for (const v of o.values) {
      const key = ruleKey(o.name, v);
      const r = saved.optionRules[key];
      rules[key] = {
        modelFileId: r?.modelFileId ?? null,
        config: clone(r?.config) ?? EMPTY(),
      };
    }
  }
  const variants: Record<string, ConfigLayer> = {};
  for (const v of product.variants) {
    const vc = saved.variantConfigs[v.id];
    variants[v.id] = {
      modelFileId: vc?.modelFileId ?? null,
      config: clone(vc?.config) ?? EMPTY(),
    };
  }
  const draft: Draft = {
    modelFileId: saved.modelFileId,
    base: clone(saved.config),
    rules,
    variants,
  };
  st = {
    product,
    target: "default",
    draft,
    saved: JSON.stringify(draft),
    history: {},
    lastKey: null,
    lastAt: 0,
    selection: null,
    meshNames: st?.product.id === product.id ? st.meshNames : [],
    hierarchy: st?.product.id === product.id ? st.hierarchy : [],
    saving: false,
    preview: {},
    modelUrls,
    modelNames: {},
  };
  subs.forEach((f) => f());
}

export function getEd(): EditorState {
  return st as EditorState;
}

export function useEd(): EditorState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => st as EditorState,
    () => st as EditorState,
  );
}

export const isDirty = (s = st) => !!s && JSON.stringify(s.draft) !== s.saved;
export const onVariant = (s = st) => !!s && s.target !== "default";
export const isRule = (t: string) => t.startsWith(RULE);
export const ruleTarget = (key: string) => RULE + key;

/** The variants the current target covers: one variant, or every variant with an option value. */
export function targetVariantIds(s = getEd()): string[] {
  if (!onVariant(s)) return [];
  if (!isRule(s.target)) return [s.target];
  const key = s.target.slice(RULE.length);
  const at = key.indexOf("=");
  const [name, value] = [key.slice(0, at), key.slice(at + 1)];
  return s.product.variants.filter((v) => v.options[name] === value).map((v) => v.id);
}

function layerAt(t: string, d: Draft): ConfigLayer | undefined {
  if (t === "default") return undefined;
  return isRule(t) ? d.rules[t.slice(RULE.length)] : d.variants[t];
}

function withLayer(d: Draft, t: string, layer: ConfigLayer): Draft {
  return isRule(t)
    ? { ...d, rules: { ...d.rules, [t.slice(RULE.length)]: layer } }
    : { ...d, variants: { ...d.variants, [t]: layer } };
}

export const currentLayer = (s = getEd()) => layerAt(s.target, s.draft);

export function rawConfig(s = getEd()): Partial<ProductRenderConfig> {
  return onVariant(s) ? (currentLayer(s)?.config ?? EMPTY()) : s.draft.base;
}

export function hasOverride(l: ConfigLayer | undefined): boolean {
  return (
    !!l &&
    (!!l.modelFileId ||
      Object.keys(l.config ?? {}).some((k) => k !== "schema_version"))
  );
}

/** "Size: Wide" / "Teal / Wide" / "" for the default. */
export function targetLabel(s = getEd()): string {
  if (!onVariant(s)) return "";
  if (isRule(s.target)) return s.target.slice(RULE.length).replace("=", ": ");
  return s.product.variants.find((v) => v.id === s.target)?.title ?? "";
}

let memo: { d: Draft; t: string; out: ProductRenderConfig } | null = null;

/** What the viewer and the storefront show for the active target. */
export function effective(s = getEd()): ProductRenderConfig {
  if (!onVariant(s)) return s.draft.base;
  if (memo && memo.d === s.draft && memo.t === s.target) return memo.out;
  let out: ProductRenderConfig;
  if (isRule(s.target)) {
    out = resolveEffectiveConfig(
      s.draft.base,
      currentLayer(s)?.config ?? null,
      false,
    );
  } else {
    const v = s.product.variants.find((x) => x.id === s.target);
    out = resolveLayers(
      s.draft.base,
      rulesFor(s.product, v?.options, s.draft.rules),
      currentLayer(s),
    );
  }
  memo = { d: s.draft, t: s.target, out };
  return out;
}

/* ---------- history ---------- */

function snapshot(t: string): Snap {
  const d = getEd().draft;
  if (t === "default") return { modelFileId: d.modelFileId, config: d.base };
  const l = layerAt(t, d);
  return { modelFileId: l?.modelFileId ?? null, config: l?.config };
}

function restore(t: string, snap: Snap): Draft {
  const d = getEd().draft;
  return t === "default"
    ? {
        ...d,
        modelFileId: snap.modelFileId,
        base: snap.config as ProductRenderConfig,
      }
    : withLayer(d, t, { modelFileId: snap.modelFileId, config: snap.config });
}

function commit(draft: Draft, key: string | null) {
  const s = getEd();
  const t = s.target;
  const now = performance.now();
  const h = s.history[t] ?? { past: [], future: [] };
  const coalesce = !!key && key === s.lastKey && now - s.lastAt < COALESCE_MS;
  const past = coalesce ? h.past : [...h.past, snapshot(t)].slice(-HISTORY_CAP);
  set({
    draft,
    history: { ...s.history, [t]: { past, future: [] } },
    lastKey: key,
    lastAt: now,
  });
}

function edit(
  key: string | null,
  produce: (
    cur: Partial<ProductRenderConfig>,
    onVar: boolean,
  ) => Partial<ProductRenderConfig> | null,
) {
  const s = getEd();
  const t = s.target;
  const cur = rawConfig(s);
  const next = produce(cur, t !== "default");
  if (!next || next === cur) return;
  commit(
    t === "default"
      ? { ...s.draft, base: next as ProductRenderConfig }
      : withLayer(s.draft, t, { ...layerAt(t, s.draft), config: next }),
    key,
  );
}

export const canUndo = (s = getEd()) => !!s.history[s.target]?.past.length;
export const canRedo = (s = getEd()) => !!s.history[s.target]?.future.length;

export function undo() {
  const s = getEd();
  const h = s.history[s.target];
  if (!h?.past.length) return;
  const prev = h.past[h.past.length - 1];
  const cur = snapshot(s.target);
  set({
    draft: restore(s.target, prev),
    history: {
      ...s.history,
      [s.target]: { past: h.past.slice(0, -1), future: [cur, ...h.future] },
    },
    lastKey: null,
  });
}

export function redo() {
  const s = getEd();
  const h = s.history[s.target];
  if (!h?.future.length) return;
  const [next, ...rest] = h.future;
  const cur = snapshot(s.target);
  set({
    draft: restore(s.target, next),
    history: {
      ...s.history,
      [s.target]: { past: [...h.past, cur], future: rest },
    },
    lastKey: null,
  });
}

/* ---------- edits ---------- */

type FieldSection = "environment" | "optimization" | "ar";
type WholeSection = "camera" | "hotspots" | "animations" | "gallery_presets";

/** Field-level sections: a layer stores only the fields it changes. */
export function patchSection(
  section: FieldSection,
  patch: Record<string, unknown>,
  key: string = section,
) {
  edit(key, (cfg) => ({
    ...cfg,
    [section]: stripUndefined({ ...(cfg[section] ?? {}), ...patch }),
  }));
}

/** Whole-value sections. */
export function setWhole<K extends WholeSection>(
  section: K,
  value:
    | ProductRenderConfig[K]
    | ((cur: ProductRenderConfig[K]) => ProductRenderConfig[K]),
  key: string | null = null,
) {
  edit(key, (cfg, onVar) => {
    const cur = (cfg[section] ??
      (onVar ? effective()[section] : undefined)) as ProductRenderConfig[K];
    const next =
      typeof value === "function"
        ? (value as (c: ProductRenderConfig[K]) => ProductRenderConfig[K])(
            clone(cur),
          )
        : value;
    return { ...cfg, [section]: next };
  });
}

/** Entry-level meshes/materials: a layer's entry carries the full merged entry. */
export function patchEntry(
  section: "meshes" | "materials",
  name: string,
  patch: Record<string, unknown>,
  key = `${section}.${name}`,
) {
  edit(key, (cfg, onVar) => {
    const known = getEd().meshNames;
    const fromEff = onVar
      ? section === "materials"
        ? getMaterialConfig(effective().materials, name, known)
        : effective().meshes?.[name]
      : undefined;
    const map = (cfg[section] ?? {}) as Record<string, Record<string, unknown>>;
    const cur = map[name] ?? fromEff ?? {};
    return {
      ...cfg,
      [section]: { ...map, [name]: stripUndefined({ ...cur, ...patch }) },
    };
  });
}

/**
 * Show or hide several parts at once (a parent node in the Parts tree). One
 * edit, so a single undo restores the whole group. Like patchEntry, a layer's
 * entry starts from what it inherits.
 */
export function setMeshesVisible(names: string[], visible: boolean) {
  if (!names.length) return;
  edit(null, (cfg, onVar) => {
    const inherited = onVar ? effective().meshes : undefined;
    const map = { ...(cfg.meshes ?? {}) } as Record<string, Record<string, unknown>>;
    for (const name of names) {
      const cur = map[name] ?? inherited?.[name] ?? {};
      map[name] = stripUndefined({ ...cur, visible: visible ? undefined : false });
    }
    return { ...cfg, meshes: map };
  });
}

/** Remove a mesh's material entry (the model's own material shows again). */
export function resetMaterial(name: string) {
  if (onVariant()) {
    clearOverride(["materials"], name);
    return;
  }
  edit(null, (cfg) => {
    const next = { ...(cfg.materials ?? {}) };
    delete next[name];
    return { ...cfg, materials: next };
  });
}

/** On a layer: drop overridden keys so they inherit again. */
export function clearOverride(
  keys: ("meshes" | "materials" | FieldSection | WholeSection)[],
  entry?: string,
) {
  if (!onVariant()) return;
  edit(null, (cfg) => {
    const next: Record<string, unknown> = { ...cfg };
    for (const k of keys) {
      if (entry && next[k]) {
        const m = { ...(next[k] as Record<string, unknown>) };
        delete m[entry];
        next[k] = m;
        if (!Object.keys(m).length) delete next[k];
      } else delete next[k];
    }
    return next as Partial<ProductRenderConfig>;
  });
}

export function resetTarget() {
  const s = getEd();
  if (s.target === "default" || !hasOverride(layerAt(s.target, s.draft))) return;
  commit(withLayer(s.draft, s.target, { modelFileId: null, config: EMPTY() }), null);
}

export function importConfig(cfg: Partial<ProductRenderConfig>) {
  edit(null, () => clone(cfg));
}

export function captureCamera(view: CameraView) {
  setWhole("camera", (cur) => ({ ...(cur ?? {}), ...view }), null);
}

/* ---------- view state ---------- */

export function setTarget(t: string) {
  const s = getEd();
  if (t !== "default" && !layerAt(t, s.draft)) return;
  set({ target: t, lastKey: null });
}

export const select = (name: string | null) => set({ selection: name });

export function setScene(meshNames: string[], hierarchy: SceneNode[]) {
  set({ meshNames, hierarchy });
}

/* ---------- save / discard ---------- */

/** What gets posted: layers without overrides are dropped. */
export function savePayload(s = getEd(), mode: "draft" | "publish" = "publish") {
  const keep = (m: Record<string, ConfigLayer>) =>
    Object.fromEntries(Object.entries(m).filter(([, l]) => hasOverride(l)));
  return {
    mode,
    modelFileId: s.draft.modelFileId,
    config: s.draft.base,
    optionRules: keep(s.draft.rules),
    variantConfigs: keep(s.draft.variants),
  };
}

export const setSaving = (saving: boolean) => set({ saving });

export function markSaved() {
  const s = getEd();
  set({ saved: JSON.stringify(s.draft), saving: false });
}

export function discard() {
  const s = getEd();
  set({ draft: JSON.parse(s.saved), history: {}, lastKey: null });
}

/* ---------- custom options (shopper-facing variants) ---------- */

/*
 * Option groups live on the product default (`config.options`). Each group
 * changes colors, materials, visible parts or a glTF material variant, and each
 * choice is one custom variant the shopper can pick. Edits go through the same
 * history as everything else.
 */

type GroupType = OptionGroup["type"];

const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

/*
 * Option groups follow the selected target. Default owns them; a variant or an
 * option value inherits Default's until it takes its own copy (`options` on its
 * layer, which replaces the whole list — config.ts resolveEffectiveConfig).
 * Copies keep the group and choice ids, so a choice means the same thing
 * wherever it is edited.
 */
export const optionGroups = (s = getEd()): OptionGroup[] => effective(s).options ?? [];

/** True when the selected variant / option value has its own groups. */
export const ownsOptions = (s = getEd()): boolean =>
  onVariant(s) && !!rawConfig(s).options;

function setGroups(
  produce: (groups: OptionGroup[]) => OptionGroup[] | null,
  key: string | null,
) {
  const inherited = clone(effective().options ?? []);
  edit(key, (cfg, onVar) => {
    // Editing on a variant starts from what it shows now and makes it its own.
    const next = produce(onVar ? inherited : clone(cfg.options ?? []));
    return next ? { ...cfg, options: next } : null;
  });
}

/** Give the selected variant its own copy of the groups it currently shows. */
export function customizeOptions() {
  if (!onVariant() || ownsOptions()) return;
  setGroups((groups) => groups, null);
}

/** Drop the selected variant's own groups and inherit Default's again. */
export function inheritOptions() {
  if (!ownsOptions()) return;
  edit(null, (cfg) => {
    const { options: _drop, ...rest } = cfg;
    return rest;
  });
  set({ preview: {} });
}

function blankChoice(type: GroupType, label: string): OptionChoice {
  const id = newId("ch");
  switch (type) {
    case "color":
      return { id, label, color: "#3b82f6" };
    case "material":
      return {
        id,
        label,
        material: { baseColor: "#3b82f6", metalness: 0, roughness: 0.5 },
      };
    case "parts":
      return { id, label, show: [] };
    default:
      return { id, label, variant: "" };
  }
}

/** Creates a group with one starter choice. Returns its id, or null at the limit. */
export function addOptionGroup(
  type: GroupType,
  label: string,
  choiceLabel: string,
): string | null {
  if (optionGroups().length >= MAX_OPTION_GROUPS) return null;
  const id = newId("grp");
  const choice = blankChoice(type, choiceLabel);
  const sel = getEd().selection;
  setGroups((groups) => {
    const group: OptionGroup = {
      id,
      label,
      type,
      display: type === "color" ? "swatch" : "button",
      choices: [choice],
      default: choice.id,
    };
    if (type !== "material-variant") group.targets = sel ? [sel] : [];
    if (type === "parts") choice.show = [...(group.targets ?? [])];
    return [...groups, group];
  }, null);
  return id;
}

export function updateOptionGroup(
  id: string,
  patch: Partial<OptionGroup>,
  key: string | null = `opt.${id}`,
) {
  setGroups(
    (groups) => groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    key,
  );
}

export function removeOptionGroup(id: string) {
  setGroups((groups) => groups.filter((g) => g.id !== id), null);
  const { [id]: _drop, ...rest } = getEd().preview;
  set({ preview: rest });
}

export function addChoice(groupId: string, label: string): string | null {
  const group = optionGroups().find((g) => g.id === groupId);
  if (!group || group.choices.length >= MAX_OPTION_CHOICES) return null;
  const choice = blankChoice(group.type, label);
  if (group.type === "parts") choice.show = [...(group.targets ?? [])];
  setGroups(
    (groups) =>
      groups.map((g) =>
        g.id === groupId ? { ...g, choices: [...g.choices, choice] } : g,
      ),
    null,
  );
  return choice.id;
}

export function updateChoice(
  groupId: string,
  choiceId: string,
  patch: Partial<OptionChoice>,
  key: string | null = `opt.${groupId}.${choiceId}`,
) {
  setGroups(
    (groups) =>
      groups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              choices: g.choices.map((c) =>
                c.id === choiceId ? { ...c, ...patch } : c,
              ),
            }
          : g,
      ),
    key,
  );
}

export function removeChoice(groupId: string, choiceId: string) {
  setGroups(
    (groups) =>
      groups.map((g) => {
        if (g.id !== groupId || g.choices.length <= 1) return g;
        const choices = g.choices.filter((c) => c.id !== choiceId);
        return {
          ...g,
          choices,
          default: g.default === choiceId ? choices[0].id : g.default,
        };
      }),
    null,
  );
  const s = getEd();
  if (s.preview[groupId] === choiceId) {
    const { [groupId]: _drop, ...rest } = s.preview;
    set({ preview: rest });
  }
}

/** Show one choice on the model without saving it; null clears the group. */
export function setPreview(groupId: string, choiceId: string | null) {
  const { [groupId]: _drop, ...rest } = getEd().preview;
  set({ preview: choiceId ? { ...rest, [groupId]: choiceId } : rest });
}

const PREVIEW_MODULES: ModuleFlags = {
  "option-groups": true,
  "material-variants": true,
};
let previewMemo: {
  base: ProductRenderConfig;
  picks: Record<string, string>;
  out: ProductRenderConfig;
} | null = null;

/** The viewer's config: the active target plus any option choices being previewed. */
export function previewConfig(s = getEd()): ProductRenderConfig {
  const base = effective(s);
  if (!Object.keys(s.preview).length || !base.options?.length) return base;
  if (previewMemo && previewMemo.base === base && previewMemo.picks === s.preview) {
    return previewMemo.out;
  }
  const out = configuredConfig(base, { options: s.preview }, null, PREVIEW_MODULES);
  previewMemo = { base, picks: s.preview, out };
  return out;
}

/* ---------- product variants and per-layer models ---------- */

/**
 * Brings the session in line with the product after a variant or option was
 * created, changed or deleted in Shopify. New variants and option values get an
 * empty layer, deleted ones lose theirs; the draft and the saved snapshot move
 * together so the editor doesn't turn "unsaved".
 */
export function syncProduct(product: EditorProduct) {
  const s = getEd();
  if (JSON.stringify(s.product) === JSON.stringify(product)) return;
  const blank = (): ConfigLayer => ({ modelFileId: null, config: EMPTY() });
  const fit = (d: Draft): Draft => {
    const variants: Record<string, ConfigLayer> = {};
    for (const v of product.variants) variants[v.id] = d.variants[v.id] ?? blank();
    const rules: Record<string, ConfigLayer> = {};
    for (const o of product.options) {
      for (const val of o.values) {
        const key = ruleKey(o.name, val);
        rules[key] = d.rules[key] ?? blank();
      }
    }
    return { ...d, variants, rules };
  };
  const draft = fit(s.draft);
  const stillThere =
    s.target === "default" ||
    (isRule(s.target)
      ? s.target.slice(RULE.length) in draft.rules
      : s.target in draft.variants);
  set({
    product,
    draft,
    saved: JSON.stringify(fit(JSON.parse(s.saved))),
    target: stillThere ? s.target : "default",
  });
}

/**
 * Gives the active variant or option value its own model (or, with null, goes
 * back to the product's). Its parts and materials then stand alone — see
 * resolveLayers.
 */
export function setLayerModel(gid: string | null, url?: string, name?: string) {
  const s = getEd();
  if (s.target === "default") return;
  const layer = layerAt(s.target, s.draft) ?? { modelFileId: null, config: EMPTY() };
  if (gid && url) {
    set({
      modelUrls: { ...s.modelUrls, [gid]: url },
      modelNames: name ? { ...s.modelNames, [gid]: name } : s.modelNames,
    });
  }
  commit(withLayer(getEd().draft, s.target, { ...layer, modelFileId: gid }), null);
}

/** Model gid shown for the active target, following layerModelId. */
export function activeModelId(s = getEd()): string | null {
  const own = s.draft.modelFileId;
  if (!onVariant(s)) return own;
  if (isRule(s.target)) {
    const key = s.target.slice(RULE.length);
    return layerModelId(own, [{ key, name: "", value: "", layer: s.draft.rules[key] }], null);
  }
  const v = s.product.variants.find((x) => x.id === s.target);
  return layerModelId(
    own,
    rulesFor(s.product, v?.options, s.draft.rules),
    s.draft.variants[s.target],
  );
}

/** GLB url the viewport should load for the active target, if known. */
export function activeModelUrl(s = getEd()): string | null {
  const id = activeModelId(s);
  return (id && s.modelUrls[id]) || null;
}
