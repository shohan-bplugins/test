import { useEffect, useRef, useState, type ReactNode } from "react";

import { fieldChecked, fieldValue, flag } from "~/components/polaris/helpers";
import { useT } from "~/i18n";
import { getMaterialConfig, ruleKey } from "~/lib/configurator/config";
import {
  addChoice,
  addOptionGroup,
  customizeOptions,
  inheritOptions,
  ownsOptions,
  captureCamera,
  clearOverride,
  currentLayer,
  effective,
  hasOverride,
  importConfig,
  onVariant,
  optionGroups,
  patchEntry,
  patchSection,
  rawConfig,
  removeChoice,
  removeOptionGroup,
  resetMaterial,
  resetTarget,
  ruleTarget,
  select,
  setMeshesVisible,
  setPreview,
  setTarget,
  setWhole,
  targetLabel,
  updateChoice,
  updateOptionGroup,
  useEd,
  type SceneNode,
} from "~/lib/configurator/editor-state";
import { ENV_PRESET_IDS } from "~/lib/configurator/constants";
import { MAX_OPTION_CHOICES, MAX_OPTION_GROUPS } from "~/lib/configurator/options";
import { priceSummary } from "~/lib/configurator/pricing";
import type {
  CameraView,
  OptionChoice,
  OptionGroup,
  ProductRenderConfig,
} from "~/lib/configurator/types";
import { LayerModelControl } from "./LayerModelControl";
import { ConditionsEditor, PriceEditor } from "./OptionRules";
import { CubeLoader } from "~/components/CubeLoader";
import {
  HotspotsPanel,
  ViewerStylePanel,
  type ShopperViewerState,
} from "./ShopperViewerPanel";
import type { ViewportApi } from "./EditorViewport";

/*
 * The editor's left sidebar (what you edit + parts) and right inspector —
 * ports of the prototype's shopify/admin/editor/sidebar.js and
 * panels-basic.js. Customer options, pricing, personalization and hotspots
 * (panels-options.js, panels-more.js) arrive with Phases 3 and 6.
 */

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/* ---------- small fields ---------- */

const OPEN_OPTIONS = "ed:open-options";

const SECTION_MS = 200;

/**
 * Opens or closes one inspector section with its body sliding, rather than
 * the jump a bare <details> makes. Closing has to animate before `open` is
 * cleared, since a closed <details> hides its body at once.
 */
function slideSection(d: HTMLDetailsElement, open: boolean) {
  const body = d.querySelector<HTMLElement>(":scope > .ed-sec__body");
  const still =
    !body ||
    typeof body.animate !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (open) d.open = true;
  if (still) {
    d.open = open;
    return;
  }
  body.getAnimations().forEach((a) => a.cancel());
  const full = {
    height: `${body.scrollHeight}px`,
    paddingBottom: getComputedStyle(body).paddingBottom,
    opacity: 1,
  };
  const none = { height: "0px", paddingBottom: "0px", opacity: 0 };
  body.style.overflow = "hidden";
  const anim = body.animate(open ? [none, full] : [full, none], {
    duration: SECTION_MS,
    easing: "cubic-bezier(0.2, 0, 0, 1)",
  });
  anim.onfinish = () => {
    body.style.overflow = "";
    if (!open) d.open = false;
  };
}

/**
 * Opens one section and closes the others beside it, so the inspector shows
 * one group of settings at a time.
 */
function openOnly(d: HTMLDetailsElement) {
  d.parentElement
    ?.querySelectorAll<HTMLDetailsElement>(":scope > details.ed-sec[open]")
    .forEach((other) => {
      if (other !== d) slideSection(other, false);
    });
  if (!d.open) slideSection(d, true);
}

function Section({
  title,
  meta,
  open = true,
  opensOn,
  forceOpen = false,
  hidden = false,
  children,
}: {
  title: string;
  meta?: ReactNode;
  open?: boolean;
  /** Keep the section open while a settings search is active. */
  forceOpen?: boolean;
  /** Hidden by the settings search; stays mounted. */
  hidden?: boolean;
  /** Window event that expands and scrolls to this section. */
  opensOn?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!opensOn) return;
    const show = () => {
      if (ref.current) openOnly(ref.current);
      ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    window.addEventListener(opensOn, show);
    return () => window.removeEventListener(opensOn, show);
  }, [opensOn]);
  return (
    <details className="ed-sec" open={open || forceOpen} ref={ref} hidden={hidden}>
      <summary
        onClick={(e) => {
          // A settings search keeps every match open, so leave it to the
          // browser then; otherwise one section at a time, animated.
          const d = ref.current;
          if (!d || forceOpen) return;
          e.preventDefault();
          if (d.open) slideSection(d, false);
          else openOnly(d);
        }}
      >
        <span>{title}</span>
        {meta ? <span className="ed-sec__meta">{meta}</span> : null}
        {/* Turned by CSS: down when closed, up when open. */}
        <span className="ed-sec__chev" aria-hidden="true">
          <s-icon type="chevron-down" size="small" />
        </span>
      </summary>
      <div className="ed-sec__body">{children}</div>
    </details>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="ed-slider">
      <span className="ed-slider__top">
        <span>{label}</span>
        <span className="ed-slider__val">{round(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    </label>
  );
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="ed-color">
      <span>{label}</span>
      <span className="ed-color__row">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"}
          onChange={(e) => onChange(e.currentTarget.value)}
          aria-label={label}
        />
        <code>{value}</code>
      </span>
    </label>
  );
}

function OverrideNote({ show, onReset }: { show: boolean; onReset: () => void }) {
  const t = useT("editor");
  if (!onVariant()) return null;
  return show ? (
    <s-stack direction="inline" gap="small" alignItems="center">
      <s-badge tone="warning">{t("overridden", { target: targetLabel() })}</s-badge>
      <s-button variant="tertiary" onClick={onReset}>
        {t("useDefault")}
      </s-button>
    </s-stack>
  ) : (
    <s-text color="subdued">{t("inheritsDefault")}</s-text>
  );
}

/* ---------- sidebar ---------- */

function TargetRow({
  target,
  label,
  dot,
}: {
  target: string;
  label: string;
  dot?: boolean;
}) {
  const t = useT("editor");
  const ed = useEd();
  const on = ed.target === target;
  // Select this row, give a variant / option value its own groups to add to
  // (Default already owns them), and bring the Options section into view.
  const addOptions = () => {
    setTarget(target);
    customizeOptions();
    window.dispatchEvent(new Event(OPEN_OPTIONS));
  };
  return (
    <li className="ed-rowwrap">
      <button
        type="button"
        className={`ed-row${on ? " is-on" : ""}`}
        aria-pressed={on}
        onClick={() => setTarget(target)}
      >
        <span className="ed-row__label">{label}</span>
        {dot ? <span className="ed-dot" aria-hidden="true" /> : null}
      </button>
      <s-button
        variant="tertiary"
        icon="plus"
        accessibilityLabel={t("addOptionsFor", { name: label })}
        onClick={addOptions}
      />
    </li>
  );
}

function TargetSwitcher({ locked }: { locked: boolean }) {
  const t = useT("editor");
  const ed = useEd();
  const [q, setQ] = useState("");
  const { product } = ed;
  const single =
    product.variants.length <= 1 &&
    (product.variants[0]?.title ?? "Default Title") === "Default Title";
  const cur = currentLayer(ed);
  const exceptions = Object.values(ed.draft.variants).filter(hasOverride).length;
  const shown = q
    ? product.variants.filter((v) =>
        v.title.toLowerCase().includes(q.toLowerCase()),
      )
    : product.variants;

  return (
    <div className="ed-panel">
      {locked ? null : (
        <>
          <h2 className="ed-h">{t("setUpByOption")}</h2>
          <ul className="ed-list">
            <TargetRow target="default" label={t("defaultAll")} />
          </ul>
          {single ? (
            <p className="ed-help">{t("noVariants")}</p>
          ) : (
            <>
              {product.options.map((o) => (
                <div key={o.name}>
                  <p className="ed-sub">{o.name}</p>
                  <ul className="ed-list">
                    {o.values.map((v) => (
                      <TargetRow
                        key={v}
                        target={ruleTarget(ruleKey(o.name, v))}
                        label={v}
                        dot={hasOverride(ed.draft.rules[ruleKey(o.name, v)])}
                      />
                    ))}
                  </ul>
                </div>
              ))}
              <p className="ed-help">{t("optionHelp")}</p>

              <h2 className="ed-h">
                {t("variantExceptions")}{" "}
                <span className="ed-meta">
                  {t("countOf", { count: exceptions, total: product.variants.length })}
                </span>
              </h2>
              {product.variants.length > 8 ? (
                <s-search-field
                  label={t("findVariant")}
                  labelAccessibilityVisibility="exclusive"
                  placeholder={t("findVariant")}
                  value={q}
                  onInput={(e) => setQ(fieldValue(e))}
                />
              ) : null}
              <ul className="ed-list">
                {shown.map((v) => (
                  <TargetRow
                    key={v.id}
                    target={v.id}
                    label={v.title}
                    dot={hasOverride(ed.draft.variants[v.id])}
                  />
                ))}
              </ul>
              <p className="ed-help">{t("exceptionHelp")}</p>
            </>
          )}
        </>
      )}
      {cur ? (
        <div className="ed-editing">
          {/*
            Opened on one variant (from the product page), the lists above are
            hidden — so the variant itself is a dropdown, to move to another
            without closing the window. The draft holds every variant, so
            unsaved edits to the one left behind are kept.
          */}
          {locked && !single && product.variants.some((v) => v.id === ed.target) ? (
            <s-select
              label={t("switchVariant")}
              value={ed.target}
              onChange={(e) => setTarget(fieldValue(e))}
            >
              {product.variants.map((v) => (
                <s-option key={v.id} value={v.id}>
                  {hasOverride(ed.draft.variants[v.id])
                    ? t("variantWithOwnSetup", { name: v.title })
                    : v.title}
                </s-option>
              ))}
            </s-select>
          ) : (
            <s-text>
              {t("editingTarget", { target: targetLabel(ed) })}
            </s-text>
          )}
          {hasOverride(cur) ? (
            <s-badge tone="warning">{t("overridesDefault")}</s-badge>
          ) : (
            <s-badge>{t("sameAsDefault")}</s-badge>
          )}
          <s-button
            variant="tertiary"
            icon="reset"
            disabled={flag(!hasOverride(cur))}
            onClick={resetTarget}
          >
            {t("resetToDefault")}
          </s-button>
        </div>
      ) : null}
      <LayerModelControl />
    </div>
  );
}

function meshLabel(cfg: ProductRenderConfig, name: string) {
  return cfg.meshes?.[name]?.label || name.replace(/_/g, " ");
}

function MeshRow({ name, depth }: { name: string; depth: number }) {
  const t = useT("editor");
  const ed = useEd();
  const cfg = effective(ed);
  const mc = cfg.meshes?.[name] ?? {};
  const own = onVariant(ed) && !!rawConfig(ed).meshes?.[name];
  const on = ed.selection === name;
  const hidden = mc.visible === false;
  return (
    <li>
      <div className={`ed-mesh${on ? " is-on" : ""}${hidden ? " is-hidden" : ""}`} style={{ paddingInlineStart: 6 + depth * 12 }}>
        <button
          type="button"
          className="ed-mesh__name"
          aria-pressed={on}
          onClick={() => select(on ? null : name)}
        >
          {meshLabel(cfg, name)}
          {own ? <span className="ed-dot" aria-hidden="true" /> : null}
        </button>
        <s-button
          variant="tertiary"
          icon={hidden ? "hide" : "view"}
          accessibilityLabel={hidden ? t("showPart", { name }) : t("hidePart", { name })}
          onClick={() =>
            patchEntry("meshes", name, { visible: hidden ? undefined : false })
          }
        />
      </div>
      {on ? (
        <div className="ed-mesh__edit">
          <s-text-field
            label={t("shopperLabel")}
            value={mc.label ?? ""}
            placeholder={name.replace(/_/g, " ")}
            onInput={(e) =>
              patchEntry("meshes", name, { label: fieldValue(e) || undefined }, `label.${name}`)
            }
          />
          <s-checkbox
            label={t("visible")}
            checked={flag(!hidden)}
            onInput={(e) =>
              patchEntry("meshes", name, { visible: fieldChecked(e) ? undefined : false })
            }
          />
          <s-checkbox
            label={t("canRecolor")}
            details={t("canRecolorHelp")}
            checked={flag(!!mc.customizable)}
            onInput={(e) =>
              patchEntry("meshes", name, { customizable: fieldChecked(e) || undefined })
            }
          />
          <s-checkbox
            label={t("canHide")}
            details={t("canHideHelp")}
            checked={flag(!!mc.optional)}
            onInput={(e) =>
              patchEntry("meshes", name, { optional: fieldChecked(e) || undefined })
            }
          />
          {own ? (
            <s-button variant="tertiary" onClick={() => clearOverride(["meshes", "materials"], name)}>
              {t("useDefaultPart")}
            </s-button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Every part at or under a node. */
function meshesUnder(node: SceneNode): string[] {
  const out: string[] = node.mesh ? [node.mesh] : [];
  node.children?.forEach((c) => out.push(...meshesUnder(c)));
  return out;
}

/**
 * A parent node: collapses its children and shows or hides all of them with
 * one eye. If any child is visible the eye hides them all; once every child is
 * hidden it shows them all again.
 */
function GroupRow({ node, depth }: { node: SceneNode; depth: number }) {
  const t = useT("editor");
  const ed = useEd();
  const [open, setOpen] = useState(true);
  const names = meshesUnder(node);
  const meshes = effective(ed).meshes ?? {};
  const hiddenCount = names.filter((n) => meshes[n]?.visible === false).length;
  const allHidden = names.length > 0 && hiddenCount === names.length;
  const mixed = hiddenCount > 0 && !allHidden;
  const selectedInside = !!ed.selection && names.includes(ed.selection);

  // Picking a part on the model opens the group it lives in.
  useEffect(() => {
    if (selectedInside) setOpen(true);
  }, [selectedInside, ed.selection]);

  return (
    <>
      <li
        className={`ed-tgroup${allHidden ? " is-hidden" : ""}${mixed ? " is-mixed" : ""}`}
        style={{ paddingInlineStart: 2 + depth * 12 }}
      >
        <button
          type="button"
          className={`ed-tgroup__toggle${open ? "" : " is-collapsed"}`}
          aria-expanded={open}
          aria-label={open ? t("collapseGroup", { name: node.name }) : t("expandGroup", { name: node.name })}
          onClick={() => setOpen((o) => !o)}
        >
          <s-icon type="chevron-down" size="small" />
        </button>
        <span className="ed-tgroup__name">{node.name}</span>
        {names.length ? (
          <s-button
            variant="tertiary"
            icon={allHidden ? "hide" : "view"}
            accessibilityLabel={
              allHidden ? t("showPart", { name: node.name }) : t("hidePart", { name: node.name })
            }
            onClick={() => setMeshesVisible(names, allHidden)}
          />
        ) : null}
      </li>
      {open
        ? node.children?.map((c, i) => (
            <TreeNode key={`${c.name}-${i}`} node={c} depth={depth + 1} />
          ))
        : null}
    </>
  );
}

function TreeNode({ node, depth }: { node: SceneNode; depth: number }) {
  if (node.mesh && !node.children) return <MeshRow name={node.mesh} depth={depth} />;
  if (node.mesh) {
    // A part that also has children: its own row, then the children.
    return (
      <>
        <MeshRow name={node.mesh} depth={depth} />
        {node.children?.map((c, i) => (
          <TreeNode key={`${c.name}-${i}`} node={c} depth={depth + 1} />
        ))}
      </>
    );
  }
  return <GroupRow node={node} depth={depth} />;
}

export function Sidebar({ hasModel, locked = false }: { hasModel: boolean; locked?: boolean }) {
  const t = useT("editor");
  const ed = useEd();
  const nodes = ed.hierarchy.length
    ? ed.hierarchy
    : ed.meshNames.map((n) => ({ name: n, mesh: n }));
  return (
    <>
      <TargetSwitcher locked={locked} />
      <div className="ed-panel">
        <h2 className="ed-h">
          {t("parts")}{" "}
          <span className="ed-meta">{t("meshCount", { count: ed.meshNames.length })}</span>
        </h2>
        {nodes.length ? (
          <ul className="ed-list">
            {nodes.map((n, i) => (
              <TreeNode key={`${n.name}-${i}`} node={n} depth={0} />
            ))}
          </ul>
        ) : hasModel ? (
          <s-stack direction="inline" gap="small" alignItems="center">
            <CubeLoader size="small" label={t("loadingModel")} />
            <s-text color="subdued">{t("loadingModel")}</s-text>
          </s-stack>
        ) : (
          <p className="ed-help">{t("noModel")}</p>
        )}
        <p className="ed-help">{t("partsHelp")}</p>
      </div>
    </>
  );
}

/* ---------- inspector ---------- */

function ModelPanel({
  info,
}: {
  info: { fileName: string; size: string | null; format: string; hasUsdz: boolean } | null;
}) {
  const t = useT("editor");
  const ed = useEd();
  if (!info) return <p className="ed-help">{t("noModel")}</p>;
  return (
    <s-stack direction="block" gap="small">
      <dl className="ed-dl">
        <dt>{t("file")}</dt>
        <dd><code>{info.fileName}</code></dd>
        {info.size ? (
          <>
            <dt>{t("size")}</dt>
            <dd>{info.size}</dd>
          </>
        ) : null}
        <dt>{t("format")}</dt>
        <dd>{info.format}</dd>
        <dt>{t("meshes")}</dt>
        <dd>{ed.meshNames.length}</dd>
        <dt>{t("arFile")}</dt>
        <dd>
          {info.hasUsdz ? (
            <s-badge tone="success">{t("arReady")}</s-badge>
          ) : (
            <s-badge tone="warning">{t("arMissing")}</s-badge>
          )}
        </dd>
      </dl>
      <p className="ed-help">{t("replaceHelp")}</p>
    </s-stack>
  );
}

function MaterialPanel({ liveColor }: { liveColor: (name: string) => string | null }) {
  const t = useT("editor");
  const ed = useEd();
  const sel = ed.selection;
  if (!sel) return <p className="ed-help">{t("selectPart")}</p>;
  const eff = effective(ed);
  const mat = getMaterialConfig(eff.materials, sel, ed.meshNames) ?? {};
  const own = onVariant(ed) && !!rawConfig(ed).materials?.[sel];
  const color = mat.baseColor ?? liveColor(sel) ?? "#ffffff";
  return (
    <s-stack direction="block" gap="base">
      <s-text type="strong">{meshLabel(eff, sel)}</s-text>
      <ColorInput
        label={t("color")}
        value={color}
        onChange={(v) => patchEntry("materials", sel, { baseColor: v }, `color.${sel}`)}
      />
      <Slider
        label={t("metalness")}
        value={mat.metalness ?? 0}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => patchEntry("materials", sel, { metalness: v }, `metal.${sel}`)}
      />
      <Slider
        label={t("roughness")}
        value={mat.roughness ?? 0.5}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => patchEntry("materials", sel, { roughness: v }, `rough.${sel}`)}
      />
      <Slider
        label={t("clearcoat")}
        value={mat.clearcoat ?? 0}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) =>
          patchEntry("materials", sel, { clearcoat: v || undefined }, `coat.${sel}`)
        }
      />
      <s-button icon="reset" onClick={() => resetMaterial(sel)}>
        {t("resetMaterial")}
      </s-button>
      <OverrideNote show={own} onReset={() => clearOverride(["materials"], sel)} />
    </s-stack>
  );
}

type Env = {
  preset?: string;
  intensity?: number;
  backgroundType?: string;
  backgroundColor?: string;
  shadowsEnabled?: boolean;
  shadowIntensity?: number;
};

function ScenePanel() {
  const t = useT("editor");
  const ed = useEd();
  const env = (effective(ed).environment ?? {}) as Env;
  const own = onVariant(ed) && rawConfig(ed).environment !== undefined;
  return (
    <s-stack direction="block" gap="base">
      <s-select
        label={t("environment")}
        value={env.preset ?? "studio"}
        onInput={(e) => patchSection("environment", { preset: fieldValue(e) })}
      >
        {ENV_PRESET_IDS.map((p) => (
          <s-option key={p} value={p}>
            {t(`env_${p}`)}
          </s-option>
        ))}
      </s-select>
      <Slider
        label={t("lightIntensity")}
        value={env.intensity ?? 1}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => patchSection("environment", { intensity: v }, "env.intensity")}
      />
      <s-select
        label={t("background")}
        value={env.backgroundType ?? "transparent"}
        onInput={(e) => patchSection("environment", { backgroundType: fieldValue(e) })}
      >
        <s-option value="transparent">{t("bgTransparent")}</s-option>
        <s-option value="color">{t("bgColor")}</s-option>
        <s-option value="preset">{t("bgEnvironment")}</s-option>
      </s-select>
      {env.backgroundType === "color" ? (
        <ColorInput
          label={t("backgroundColor")}
          value={env.backgroundColor ?? "#ffffff"}
          onChange={(v) => patchSection("environment", { backgroundColor: v }, "env.bg")}
        />
      ) : null}
      <s-checkbox
        label={t("shadows")}
        checked={flag(env.shadowsEnabled !== false)}
        onInput={(e) => patchSection("environment", { shadowsEnabled: fieldChecked(e) })}
      />
      {env.shadowsEnabled !== false ? (
        <Slider
          label={t("shadowStrength")}
          value={env.shadowIntensity ?? 0.5}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => patchSection("environment", { shadowIntensity: v }, "env.shadow")}
        />
      ) : null}
      <OverrideNote show={own} onReset={() => clearOverride(["environment"])} />
    </s-stack>
  );
}

const GALLERY_VIEWS = ["perspective", "front", "side", "back"] as const;

function CameraPanel({ viewport }: { viewport: () => ViewportApi | null }) {
  const t = useT("editor");
  const ed = useEd();
  const cam = effective(ed).camera ?? null;
  const lock = ((cam as { lock?: Record<string, unknown> } | null)?.lock ?? {}) as Record<
    string,
    number | boolean | undefined
  >;
  const gallery = (effective(ed).gallery_presets ?? {}) as Record<string, CameraView>;
  const own = onVariant(ed) && rawConfig(ed).camera !== undefined;
  const hasView = Array.isArray(cam?.position);

  const setLock = (patch: Record<string, unknown>) =>
    setWhole(
      "camera",
      (cur) => {
        const c = (cur ?? {}) as NonNullable<ProductRenderConfig["camera"]>;
        return { ...c, lock: { ...(c.lock ?? {}), ...patch } } as ProductRenderConfig["camera"];
      },
      null,
    );

  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="inline" gap="small">
        <s-button
          onClick={() => {
            const v = viewport()?.capture();
            if (v) captureCamera(v);
          }}
        >
          {t("useCurrentView")}
        </s-button>
        <s-button
          variant="tertiary"
          disabled={flag(!hasView)}
          onClick={() =>
            setWhole("camera", (cur) => {
              if (!cur) return cur;
              const { lock: l } = cur as { lock?: Record<string, unknown> };
              return (l ? { lock: l } : null) as ProductRenderConfig["camera"];
            })
          }
        >
          {t("automaticView")}
        </s-button>
      </s-stack>
      <p className="ed-help">{hasView ? t("startViewSaved") : t("startViewAuto")}</p>

      <s-checkbox
        label={t("allowRotate")}
        checked={flag(lock.rotate !== false)}
        onInput={(e) => setLock({ rotate: fieldChecked(e) ? undefined : false })}
      />
      <s-checkbox
        label={t("allowZoom")}
        checked={flag(lock.zoom !== false)}
        onInput={(e) => setLock({ zoom: fieldChecked(e) ? undefined : false })}
      />
      <s-checkbox
        label={t("allowPan")}
        checked={flag(lock.pan !== false)}
        onInput={(e) => setLock({ pan: fieldChecked(e) ? undefined : false })}
      />
      <s-grid gridTemplateColumns="1fr 1fr" gap="small">
        <s-number-field
          label={t("minPolar")}
          suffix="°"
          min={0}
          max={180}
          value={lock.minPolarAngle != null ? String(lock.minPolarAngle) : ""}
          onInput={(e) => setLock({ minPolarAngle: num(fieldValue(e)) })}
        />
        <s-number-field
          label={t("maxPolar")}
          suffix="°"
          min={0}
          max={180}
          value={lock.maxPolarAngle != null ? String(lock.maxPolarAngle) : ""}
          onInput={(e) => setLock({ maxPolarAngle: num(fieldValue(e)) })}
        />
      </s-grid>

      <s-text type="strong">{t("galleryViews")}</s-text>
      <p className="ed-help">{t("galleryHelp")}</p>
      {GALLERY_VIEWS.map((id) => (
        <s-stack key={id} direction="inline" gap="small" alignItems="center">
          <span className="ed-gallery__name">{t(`view_${id}`)}</span>
          <s-button
            onClick={() => {
              const v = viewport()?.capture();
              if (v) setWhole("gallery_presets", (cur) => ({ ...(cur ?? {}), [id]: v }));
            }}
          >
            {t("capture")}
          </s-button>
          <s-button
            variant="tertiary"
            disabled={flag(!gallery[id])}
            onClick={() => viewport()?.goTo(gallery[id])}
          >
            {t("flyTo")}
          </s-button>
        </s-stack>
      ))}
      <OverrideNote show={own} onReset={() => clearOverride(["camera"])} />
    </s-stack>
  );
}

function ArPanel() {
  const t = useT("editor");
  const ed = useEd();
  const ar = (effective(ed).ar ?? {}) as { enabled?: boolean; scale?: string };
  return (
    <s-stack direction="block" gap="base">
      <s-checkbox
        label={t("arEnabled")}
        checked={flag(ar.enabled !== false)}
        onInput={(e) => patchSection("ar", { enabled: fieldChecked(e) })}
      />
      <s-select
        label={t("arScale")}
        value={ar.scale ?? "fixed"}
        onInput={(e) => patchSection("ar", { scale: fieldValue(e) })}
      >
        <s-option value="fixed">{t("arScaleFixed")}</s-option>
        <s-option value="auto">{t("arScaleAuto")}</s-option>
      </s-select>
      <p className="ed-help">{t("arHelp")}</p>
    </s-stack>
  );
}

function PerformancePanel() {
  const t = useT("editor");
  const ed = useEd();
  const opt = (effective(ed).optimization ?? {}) as {
    pixelRatioLimit?: number;
    gpuPerformanceMode?: string;
  };
  return (
    <s-stack direction="block" gap="base">
      <s-select
        label={t("pixelRatio")}
        value={String(opt.pixelRatioLimit ?? 2)}
        onInput={(e) =>
          patchSection("optimization", { pixelRatioLimit: Number(fieldValue(e)) })
        }
      >
        <s-option value="1">1×</s-option>
        <s-option value="1.5">1.5×</s-option>
        <s-option value="2">2×</s-option>
      </s-select>
      <s-checkbox
        label={t("lowPower")}
        details={t("lowPowerHelp")}
        checked={flag(opt.gpuPerformanceMode === "low-power")}
        onInput={(e) =>
          patchSection("optimization", {
            gpuPerformanceMode: fieldChecked(e) ? "low-power" : undefined,
          })
        }
      />
    </s-stack>
  );
}

function ImportExportPanel({ onError }: { onError: (m: string) => void }) {
  const t = useT("editor");
  const ed = useEd();
  const [text, setText] = useState("");
  const json = JSON.stringify(rawConfig(ed), null, 2);
  return (
    <s-stack direction="block" gap="small">
      <p className="ed-help">{t("importHelp")}</p>
      <s-text-area
        label={t("configJson")}
        rows={8}
        value={text || json}
        onInput={(e) => setText(fieldValue(e))}
      />
      <s-stack direction="inline" gap="small">
        <s-button
          disabled={flag(!text || text === json)}
          onClick={() => {
            try {
              const value = JSON.parse(text);
              if (!value || value.schema_version !== 1) throw new Error();
              importConfig(value);
              setText("");
            } catch {
              onError(t("importInvalid"));
            }
          }}
        >
          {t("apply")}
        </s-button>
        <s-button
          variant="tertiary"
          onClick={() => navigator.clipboard?.writeText(json).catch(() => {})}
        >
          {t("copyJson")}
        </s-button>
      </s-stack>
    </s-stack>
  );
}

/* ---------- custom options (shopper-facing variants) ---------- */

function MeshChecks({
  label,
  meshes,
  value,
  onChange,
}: {
  label: string;
  meshes: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="ed-checks">
      <legend>{label}</legend>
      {meshes.map((m) => (
        <s-checkbox
          key={m}
          label={m}
          checked={flag(value.includes(m))}
          onInput={(e) =>
            onChange(fieldChecked(e) ? [...value, m] : value.filter((x) => x !== m))
          }
        />
      ))}
    </fieldset>
  );
}

function ChoiceEditor({
  group,
  choice,
  previewing,
  pricingAllowed,
  conditionsAllowed,
}: {
  group: OptionGroup;
  choice: OptionChoice;
  previewing: boolean;
  pricingAllowed: boolean;
  conditionsAllowed: boolean;
}) {
  const t = useT("editor");
  const ed = useEd();
  const key = (f: string) => `opt.${group.id}.${choice.id}.${f}`;
  const patch = (p: Partial<OptionChoice>, f: string) =>
    updateChoice(group.id, choice.id, p, key(f));
  const material = choice.material ?? {};
  return (
    <div className={`ed-choice${previewing ? " is-previewing" : ""}`}>
      <s-text-field
        label={t("choiceName")}
        value={choice.label}
        onInput={(e) => patch({ label: fieldValue(e) }, "label")}
      />
      {group.type === "color" ? (
        <ColorInput
          label={t("color")}
          value={choice.color ?? "#ffffff"}
          onChange={(v) => patch({ color: v }, "color")}
        />
      ) : null}
      {group.type === "material" ? (
        <>
          <ColorInput
            label={t("color")}
            value={material.baseColor ?? "#ffffff"}
            onChange={(v) => patch({ material: { ...material, baseColor: v } }, "color")}
          />
          <Slider
            label={t("metalness")}
            value={material.metalness ?? 0}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => patch({ material: { ...material, metalness: v } }, "metal")}
          />
          <Slider
            label={t("roughness")}
            value={material.roughness ?? 0.5}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => patch({ material: { ...material, roughness: v } }, "rough")}
          />
        </>
      ) : null}
      {group.type === "parts" ? (
        <MeshChecks
          label={t("choiceShows")}
          meshes={group.targets ?? []}
          value={choice.show ?? []}
          onChange={(show) => patch({ show }, "show")}
        />
      ) : null}
      {group.type === "material-variant" ? (
        <s-text-field
          label={t("choiceVariant")}
          details={t("choiceVariantHelp")}
          value={choice.variant ?? ""}
          onInput={(e) => patch({ variant: fieldValue(e) }, "variant")}
        />
      ) : null}
      {pricingAllowed ? (
        <PriceEditor price={choice.price} onChange={(price) => patch({ price }, "price")} />
      ) : null}
      {conditionsAllowed ? (
        <ConditionsEditor
          value={choice.conditions}
          onChange={(conditions) => patch({ conditions }, "cond")}
          groups={optionGroups(ed)}
          selfGroupId={group.id}
          productOptions={ed.product.options}
        />
      ) : null}
      <s-stack direction="inline" gap="small">
        <s-button
          variant={previewing ? "primary" : "secondary"}
          icon="view"
          onClick={() => setPreview(group.id, previewing ? null : choice.id)}
        >
          {previewing ? t("previewing") : t("previewChoice")}
        </s-button>
        <s-button
          variant="tertiary"
          tone="critical"
          icon="delete"
          accessibilityLabel={t("removeChoice")}
          disabled={flag(group.choices.length <= 1)}
          onClick={() => removeChoice(group.id, choice.id)}
        />
      </s-stack>
    </div>
  );
}

function OptionGroupEditor({
  group,
  pricingAllowed,
  conditionsAllowed,
}: {
  group: OptionGroup;
  pricingAllowed: boolean;
  conditionsAllowed: boolean;
}) {
  const t = useT("editor");
  const ed = useEd();
  const typeLabel = {
    color: t("optTypeColor"),
    material: t("optTypeMaterial"),
    parts: t("optTypeParts"),
    "material-variant": t("optTypeVariant"),
  }[group.type];
  const displays: [OptionGroup["display"], string][] = [
    ["swatch", t("optDisplaySwatch")],
    ["button", t("optDisplayButton")],
    ["dropdown", t("optDisplayDropdown")],
  ];
  const patch = (p: Partial<OptionGroup>, f?: string) =>
    updateOptionGroup(group.id, p, f ? `opt.${group.id}.${f}` : null);
  const usesTargets = group.type !== "material-variant";
  return (
    <details className="ed-optgroup" open>
      <summary>
        <span>{group.label}</span>
        <span className="ed-meta">
          {typeLabel} · {t("choiceCount", { count: group.choices.length })}
        </span>
      </summary>
      <div className="ed-optgroup__body">
        <s-text-field
          label={t("optName")}
          value={group.label}
          onInput={(e) => patch({ label: fieldValue(e) }, "label")}
        />
        <s-select
          label={t("optDisplay")}
          value={group.display}
          onInput={(e) => patch({ display: fieldValue(e) as OptionGroup["display"] })}
        >
          {displays.map(([v, label]) => (
            <s-option key={v} value={v}>
              {label}
            </s-option>
          ))}
        </s-select>
        {usesTargets ? (
          <MeshChecks
            label={t("optTargets")}
            meshes={ed.meshNames}
            value={group.targets ?? []}
            onChange={(targets) => patch({ targets })}
          />
        ) : null}
        <s-select
          label={t("optDefault")}
          value={group.default ?? group.choices[0]?.id ?? ""}
          onInput={(e) => patch({ default: fieldValue(e) })}
        >
          {group.choices.map((c) => (
            <s-option key={c.id} value={c.id}>
              {c.label}
            </s-option>
          ))}
        </s-select>
        <s-checkbox
          label={t("optRequired")}
          checked={flag(!!group.required)}
          onInput={(e) => patch({ required: fieldChecked(e) || undefined })}
        />
        {conditionsAllowed ? (
          <ConditionsEditor
            value={group.conditions}
            onChange={(conditions) => patch({ conditions }, "cond")}
            groups={optionGroups(ed)}
            selfGroupId={group.id}
            productOptions={ed.product.options}
          />
        ) : null}
        {!pricingAllowed ? <p className="ed-help">{t("pricingPlan")}</p> : null}
        {group.choices.map((c) => (
          <ChoiceEditor
            key={c.id}
            group={group}
            choice={c}
            previewing={ed.preview[group.id] === c.id}
            pricingAllowed={pricingAllowed}
            conditionsAllowed={conditionsAllowed}
          />
        ))}
        <s-stack direction="inline" gap="small">
          <s-button
            icon="plus"
            disabled={flag(group.choices.length >= MAX_OPTION_CHOICES)}
            onClick={() =>
              addChoice(group.id, t("newChoice", { n: group.choices.length + 1 }))
            }
          >
            {t("addChoice")}
          </s-button>
          <s-button
            variant="tertiary"
            tone="critical"
            icon="delete"
            onClick={() => removeOptionGroup(group.id)}
          >
            {t("removeOption")}
          </s-button>
        </s-stack>
      </div>
    </details>
  );
}

function OptionsPanel({
  allowed,
  variantsAllowed,
  pricingAllowed,
  conditionsAllowed,
}: {
  allowed: boolean;
  variantsAllowed: boolean;
  pricingAllowed: boolean;
  conditionsAllowed: boolean;
}) {
  const t = useT("editor");
  const ed = useEd();
  const groups = optionGroups(ed);
  if (!allowed) return <p className="ed-help">{t("optionsPlan")}</p>;
  // Default owns the groups; a variant or option value inherits them until it
  // takes its own copy.
  const variantTarget = onVariant(ed);
  const own = ownsOptions(ed);
  if (variantTarget && !own) {
    return (
      <s-stack direction="block" gap="small">
        <p className="ed-help">{t("optionsInherited", { count: groups.length })}</p>
        <s-button onClick={customizeOptions}>{t("customizeOptions")}</s-button>
        <s-button variant="tertiary" onClick={() => setTarget("default")}>
          {t("editDefault")}
        </s-button>
      </s-stack>
    );
  }
  const types: [OptionGroup["type"], string][] = [
    ["color", t("optTypeColor")],
    ["material", t("optTypeMaterial")],
    ["parts", t("optTypeParts")],
  ];
  if (variantsAllowed) types.push(["material-variant", t("optTypeVariant")]);
  return (
    <s-stack direction="block" gap="base">
      <p className="ed-help">{t("optionsHelp")}</p>
      {variantTarget ? (
        <s-stack direction="block" gap="small">
          <p className="ed-help">{t("optionsOwn")}</p>
          <s-button variant="tertiary" onClick={inheritOptions}>
            {t("useDefaultOptions")}
          </s-button>
        </s-stack>
      ) : null}
      {groups.length === 0 ? <p className="ed-help">{t("noGroups")}</p> : null}
      {groups.map((g) => (
        <OptionGroupEditor
          key={g.id}
          group={g}
          pricingAllowed={pricingAllowed}
          conditionsAllowed={conditionsAllowed}
        />
      ))}
      {groups.length < MAX_OPTION_GROUPS ? (
        <>
          <p className="ed-sub">{t("addOption")}</p>
          <s-stack direction="inline" gap="small">
            {types.map(([type, label]) => (
              <s-button
                key={type}
                icon="plus"
                onClick={() =>
                  addOptionGroup(
                    type,
                    t("newOption", { n: groups.length + 1 }),
                    t("newChoice", { n: 1 }),
                  )
                }
              >
                {label}
              </s-button>
            ))}
          </s-stack>
        </>
      ) : (
        <p className="ed-help">{t("optionsLimit", { count: MAX_OPTION_GROUPS })}</p>
      )}
    </s-stack>
  );
}

function PricingPanel({ allowed }: { allowed: boolean }) {
  const t = useT("editor");
  const ed = useEd();
  const [picks, setPicks] = useState<Record<string, string>>({});
  if (!allowed) return <p className="ed-help">{t("pricingPlan")}</p>;
  const groups = optionGroups(ed);
  const base = parseFloat(ed.product.variants[0]?.price ?? "0") || 0;
  const summary = priceSummary(
    effective(ed),
    base,
    { options: picks, decals: {}, colors: {}, parts: {} },
    null,
    { "option-pricing": true, "conditional-logic": false },
  );
  const money = (n: number) => n.toFixed(2);
  return (
    <s-stack direction="block" gap="small">
      <p className="ed-help">{t("pricingHelp")}</p>
      <p className="ed-sub">{t("pricingPreview")}</p>
      {groups.length === 0 ? (
        <p className="ed-help">{t("pricingNoOptions")}</p>
      ) : (
        groups.map((g) => (
          <s-select
            key={`${g.id}:${g.choices.map((c) => c.id).join(",")}`}
            label={g.label}
            value={picks[g.id] ?? g.default ?? g.choices[0]?.id ?? ""}
            onInput={(e) =>
              setPicks((p) => ({ ...p, [g.id]: fieldValue(e) }))
            }
          >
            {g.choices.map((c) => (
              <s-option key={c.id} value={c.id}>
                {c.label}
              </s-option>
            ))}
          </s-select>
        ))
      )}
      <div className="ed-price">
        <div className="ed-price__row">
          <span>{t("pricingBase")}</span>
          <span>{money(summary.base)}</span>
        </div>
        {summary.lines.map((l) => (
          <div className="ed-price__row" key={l.label}>
            <span>{l.label}</span>
            <span>
              {l.amount < 0 ? "−" : "+"}
              {money(Math.abs(l.amount))}
            </span>
          </div>
        ))}
        <div className="ed-price__row ed-price__row--total">
          <span>{t("pricingTotal")}</span>
          <span>{money(summary.total)}</span>
        </div>
      </div>
      <p className="ed-help">{t("pricingNote")}</p>
    </s-stack>
  );
}

export function Inspector({
  modelInfo,
  viewport,
  liveColor,
  onError,
  optionsAllowed,
  variantsAllowed,
  pricingAllowed,
  conditionsAllowed,
  viewer,
  hasModel,
}: {
  viewer: ShopperViewerState;
  hasModel: boolean;
  modelInfo: Parameters<typeof ModelPanel>[0]["info"];
  viewport: () => ViewportApi | null;
  liveColor: (name: string) => string | null;
  onError: (m: string) => void;
  optionsAllowed: boolean;
  variantsAllowed: boolean;
  pricingAllowed: boolean;
  conditionsAllowed: boolean;
}) {
  const t = useT("editor");
  const ed = useEd();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  // A section shows when its title matches the search (or there is none).
  const show = (title: string) => !q || title.toLowerCase().includes(q);
  const titles = {
    model: t("secModel"),
    material: t("secMaterial"),
    scene: t("secScene"),
    options: t("secOptions"),
    pricing: t("secPricing"),
    camera: t("secCamera"),
    ar: t("secAr"),
    performance: t("secPerformance"),
    importExport: t("secImport"),
    viewer: t("secViewer"),
    hotspots: t("secHotspots"),
  };
  const any = Object.values(titles).some(show);
  const group = (label: string, keys: (keyof typeof titles)[]) => (
    <p className="ed-group" hidden={!keys.some((k) => show(titles[k]))}>
      {label}
    </p>
  );
  return (
    <>
      <div className="ed-search">
        <s-search-field
          label={t("searchSettings")}
          labelAccessibilityVisibility="exclusive"
          placeholder={t("searchSettings")}
          value={query}
          onInput={(e) => setQuery(fieldValue(e))}
        />
      </div>
      <p className="ed-help" style={{ padding: 12 }} hidden={any}>
        {t("noSettingsMatch", { query })}
      </p>

      {(
        <Section hidden={!show(titles.model)} title={titles.model} open={false} forceOpen={!!q}>
          <ModelPanel info={modelInfo} />
        </Section>
      )}

      {group(t("groupAppearance"), ["material", "scene"])}
      {(
        <Section
          hidden={!show(titles.material)}
          title={titles.material}
          meta={ed.selection ?? undefined}
          forceOpen={!!q}
        >
          <MaterialPanel liveColor={liveColor} />
        </Section>
      )}
      {(
        <Section hidden={!show(titles.scene)} title={titles.scene} open={false} forceOpen={!!q}>
          <ScenePanel />
        </Section>
      )}

      {group(t("groupShopper"), ["options", "pricing", "camera", "ar", "viewer", "hotspots"])}
      {(
        <Section
          hidden={!show(titles.options)}
          title={titles.options}
          meta={optionGroups(ed).length || undefined}
          open={false}
          opensOn={OPEN_OPTIONS}
          forceOpen={!!q}
        >
          <OptionsPanel
            allowed={optionsAllowed}
            variantsAllowed={variantsAllowed}
            pricingAllowed={pricingAllowed}
            conditionsAllowed={conditionsAllowed}
          />
        </Section>
      )}
      {(
        <Section hidden={!show(titles.pricing)} title={titles.pricing} open={false} forceOpen={!!q}>
          <PricingPanel allowed={pricingAllowed} />
        </Section>
      )}
      {(
        <Section hidden={!show(titles.camera)} title={titles.camera} open={false} forceOpen={!!q}>
          <CameraPanel viewport={viewport} />
        </Section>
      )}
      {(
        <Section hidden={!show(titles.ar)} title={titles.ar} open={false} forceOpen={!!q}>
          <ArPanel />
        </Section>
      )}
      <Section
        hidden={!show(titles.viewer)}
        title={titles.viewer}
        open={false}
        forceOpen={!!q}
      >
        <ViewerStylePanel v={viewer} hasModel={hasModel} />
      </Section>
      <Section
        hidden={!show(titles.hotspots)}
        title={titles.hotspots}
        meta={viewer.config.hotspots.length || undefined}
        open={false}
        forceOpen={!!q}
      >
        <HotspotsPanel v={viewer} />
      </Section>

      {group(t("groupAdvanced"), ["performance", "importExport"])}
      {(
        <Section hidden={!show(titles.performance)} title={titles.performance} open={false} forceOpen={!!q}>
          <PerformancePanel />
        </Section>
      )}
      {(
        <Section hidden={!show(titles.importExport)} title={titles.importExport} open={false} forceOpen={!!q}>
          <ImportExportPanel onError={onError} />
        </Section>
      )}

    </>
  );
}
