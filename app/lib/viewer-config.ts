import type { ViewerConfig } from "~/components/ViewerPreview";
import {
  DEFAULT_HOTSPOT_COLOR,
  HOTSPOT_LABELS,
  HOTSPOT_TRIGGERS,
  sanitizeHotspotColor,
  sanitizeHotspots,
} from "~/lib/hotspots";

/*
 * Single source of truth for the viewer's defaults and for validating a stored
 * config. Previously app.products.$id.tsx and app.models.$id.tsx each carried
 * their own copy of this ~40-key object, and the storefront widget a third
 * (extensions/viewer-3d/assets/viewer-3d.js, which can't import from here, so its
 * DEFAULTS block still has to be kept in step by hand). Copies of this had
 * already drifted apart once; adding a fourth for the public /viewer/:id route
 * would have made that worse, hence this module.
 *
 * parseConfig is the strict version that used to live in app.products.$id.tsx:
 * it validates and clamps every field rather than spreading unknown JSON over the
 * defaults, so a hand-edited or out-of-range metafield can't reach the renderer.
 */

export const TONE_MAPPINGS = [
  "None",
  "Linear",
  "Reinhard",
  "Cineon",
  "ACESFilmic",
] as const;
export const REPEAT_MODES = ["one", "all", "none"] as const;
export const AR_PLACEMENTS = ["floor", "wall"] as const;

/*
 * Where each of the viewer's controls sits. Six spots; any number of controls
 * can share one, and they line up in the order given. Every control is in
 * exactly one spot, shown or not — turning a button off hides it but keeps its
 * place for when it comes back.
 *
 * The storefront widget repeats these rules (CONTROL_SLOTS, CONTROL_ITEMS,
 * normalizeControlsLayout, fullscreenCloseSlot in viewer-3d.js) and has to be
 * kept in step by hand.
 */
export const CONTROL_SLOTS = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;
export type ControlSlot = (typeof CONTROL_SLOTS)[number];

export const CONTROL_ITEMS = [
  { id: "zoomIn", label: "Zoom in" },
  { id: "zoomOut", label: "Zoom out" },
  { id: "reset", label: "Reset view" },
  { id: "fullscreen", label: "Fullscreen" },
  { id: "screenshot", label: "Screenshot" },
  { id: "ar", label: "View in your room" },
  { id: "animation", label: "Animation" },
] as const;
export type ControlItemId = (typeof CONTROL_ITEMS)[number]["id"];

export type ControlsLayout = Record<ControlSlot, ControlItemId[]>;

export const DEFAULT_CONTROLS_LAYOUT: ControlsLayout = {
  "top-left": ["animation"],
  "top-center": [],
  "top-right": [],
  "bottom-left": ["screenshot", "ar"],
  "bottom-center": [],
  "bottom-right": ["zoomIn", "zoomOut", "reset", "fullscreen"],
};

export function isControlSlot(value: unknown): value is ControlSlot {
  return (CONTROL_SLOTS as readonly unknown[]).includes(value);
}

function isControlItem(value: unknown): value is ControlItemId {
  return CONTROL_ITEMS.some((i) => i.id === value);
}

function cloneLayout(layout: ControlsLayout): ControlsLayout {
  const out = {} as ControlsLayout;
  for (const slot of CONTROL_SLOTS) out[slot] = [...layout[slot]];
  return out;
}

/**
 * A stored layout made safe to render: unknown spots and controls dropped, a
 * control listed twice kept only the first time, and any control missing from
 * it put back in its default spot — so a control added in a later release
 * still shows up on models saved before it existed.
 */
export function normalizeControlsLayout(raw: unknown): ControlsLayout {
  const out = {} as ControlsLayout;
  for (const slot of CONTROL_SLOTS) out[slot] = [];
  const seen = new Set<ControlItemId>();
  if (raw && typeof raw === "object") {
    for (const slot of CONTROL_SLOTS) {
      const list = (raw as Record<string, unknown>)[slot];
      if (!Array.isArray(list)) continue;
      for (const id of list) {
        if (isControlItem(id) && !seen.has(id)) {
          seen.add(id);
          out[slot].push(id);
        }
      }
    }
  }
  for (const slot of CONTROL_SLOTS) {
    for (const id of DEFAULT_CONTROLS_LAYOUT[slot]) {
      if (!seen.has(id)) out[slot].push(id);
    }
  }
  return out;
}

export function slotOfControl(
  layout: ControlsLayout,
  id: ControlItemId,
): ControlSlot {
  return CONTROL_SLOTS.find((s) => layout[s].includes(id)) ?? "bottom-right";
}

/**
 * Move one control into `slot` at position `index` (the end when left out).
 * Within its own spot this is a reorder.
 */
export function moveControl(
  layout: ControlsLayout,
  id: ControlItemId,
  slot: ControlSlot,
  index?: number,
): ControlsLayout {
  const next = cloneLayout(layout);
  const from = slotOfControl(next, id);
  const fromIndex = next[from].indexOf(id);
  next[from].splice(fromIndex, 1);
  let at = index ?? next[slot].length;
  // Removing it first shifts everything after it down one in its own spot.
  if (from === slot && index !== undefined && index > fromIndex) at -= 1;
  next[slot].splice(Math.max(0, Math.min(at, next[slot].length)), 0, id);
  return next;
}

/**
 * Whether a control is switched on in the settings. Device support aside (AR
 * needs a phone or the QR hand-off; the animation switcher needs clips), this
 * is what decides if it renders.
 */
export function isControlEnabled(
  config: ViewerConfig,
  id: ControlItemId,
): boolean {
  switch (id) {
    case "zoomIn":
    case "zoomOut":
      return config.showZoomButtons && config.zoom;
    case "reset":
      return config.showCameraResetButton;
    case "fullscreen":
      return config.showFullscreenButton;
    case "screenshot":
      return config.showScreenshotButton;
    case "ar":
      return config.webAR || config.sceneViewer || config.quickLook;
    case "animation":
      return config.showAnimationSelector;
  }
}

/**
 * The settings that switch a control on or off, as a patch — what dragging a
 * control out of, or into, the layout editor's tray does.
 *
 * Some controls hang off settings that do more than show a button:
 *   - Zoom in and Zoom out share one switch, so they come and go together;
 *     turning them on also allows zooming, without which they stay hidden.
 *   - "View in your room" is the three AR session types together.
 *   - The animation switcher's setting also decides whether the model
 *     animates at all.
 */
export function controlVisibilityPatch(
  id: ControlItemId,
  on: boolean,
): Partial<ViewerConfig> {
  switch (id) {
    case "zoomIn":
    case "zoomOut":
      return on
        ? { showZoomButtons: true, zoom: true }
        : { showZoomButtons: false };
    case "reset":
      return { showCameraResetButton: on };
    case "fullscreen":
      return { showFullscreenButton: on };
    case "screenshot":
      return { showScreenshotButton: on };
    case "ar":
      return { webAR: on, sceneViewer: on, quickLook: on };
    case "animation":
      return { showAnimationSelector: on };
  }
}

/**
 * Where the fullscreen close button goes: its usual top-right unless a control
 * was moved there, then the first spot no control is using.
 */
export function fullscreenCloseSlot(layout: ControlsLayout): ControlSlot {
  const order: ControlSlot[] = [
    "top-right",
    "top-left",
    "top-center",
    "bottom-right",
    "bottom-left",
    "bottom-center",
  ];
  return order.find((s) => layout[s].length === 0) ?? "top-right";
}

export const DEFAULT_CONFIG: ViewerConfig = {
  height: 500,
  background: "#ffffff",
  exposure: 1,
  toneMapping: "Linear",
  useDefaultEnv: true,
  skyboxBlur: false,
  skybox: "",
  envmap: "",
  fovMode: "auto",
  fov: 45,
  yaw: 0,
  pitch: 0,
  initialZoom: 0,
  rotate: true,
  translate: true,
  zoom: true,
  autoRotate: true,
  scrollable: true,
  wheelScrollable: false,
  useGrabCursor: true,
  // Out of the box the control bar carries only fullscreen and zoom in/out.
  // Everything else is opt-in: a viewer embedded in a product page is a product
  // photo that happens to turn, and a row of six controls over it reads as an
  // application. Merchants who want the rest can switch them on per model.
  //
  // Note the knock-on: with the clip switcher hidden by default, a model's
  // animation does not play by default either — see the animation handling in
  // ViewerPreview.tsx and viewer-3d.js, where hiding the switcher means "no
  // animation" rather than "animation you can't control".
  showAnimationSelector: false,
  showAxes: false,
  showFullscreenButton: true,
  // Downloads a PNG of the current view. Was hardcoded always-on with no way to
  // hide it, which made it the one control a merchant couldn't remove from a
  // storefront viewer.
  showScreenshotButton: false,
  showCameraResetButton: false,
  showZoomButtons: true,
  // 1-based, 0 meaning "no animation" — see resolveDefaultClipIndex. 1 rather
  // than 0 keeps the rule the switcher's own help text states: turning the clip
  // switcher on is what makes a model animate, so the first clip is what it
  // starts with unless the merchant picks another position (or 0 for none).
  defaultAnimationIndex: 1,
  animationRepeatMode: "one",
  webAR: true,
  sceneViewer: true,
  quickLook: true,
  arPlacement: "floor",
  controlsLayout: DEFAULT_CONTROLS_LAYOUT,
  iosSrc: "",
  variant: "",
  // Only affects meshes that actually have a skeleton (no-op otherwise), and
  // without it view3d fits the camera to the unposed bind-pose bbox, which
  // for rigged/character-style models is often wildly wrong — rendering the
  // model as a tiny speck. Safe to default on.
  fixSkinnedBbox: true,
  shadow: true,
  maintainSize: false,
  hotspots: [],
  showHotspots: true,
  hotspotColor: DEFAULT_HOTSPOT_COLOR,
  hotspotLabel: "number",
  hotspotTrigger: "click",
};

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/*
 * Turns the merchant-facing "Default animation index" into the clip index both
 * viewers use internally.
 *
 * The setting counts the way the clip switcher lists clips — 1, 2, 3… — with 0
 * for "none", because it is typed in by hand next to that list; an array's 0 for
 * "the first one" only makes sense to people who write the array. Internally the
 * index is view3d's 0-based one, with -1 for "None" (see selectClip in
 * ViewerPreview.tsx and in extensions/viewer-3d/assets/viewer-3d.js).
 *
 * A position the model doesn't have resolves to "None" rather than to the first
 * clip: the clip count isn't knowable when the setting is saved (it's validated
 * against 0..99 and nothing more), and playing some *other* clip than the one
 * asked for is what makes the setting look broken. "None" is a state both
 * toolbars already render, so nothing is left showing a clip that isn't running.
 *
 * Mirrored by resolveDefaultClipIndex in viewer-3d.js, which can't import it.
 */
export function resolveDefaultClipIndex(
  setting: number,
  clipCount: number,
): number {
  if (!Number.isFinite(setting) || setting < 1) return -1;
  const idx = Math.floor(setting) - 1;
  return idx < clipCount ? idx : -1;
}

export function parseConfig(raw: string | undefined | null): ViewerConfig {
  if (!raw) return { ...DEFAULT_CONFIG };
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  if (!parsed || typeof parsed !== "object") return { ...DEFAULT_CONFIG };

  const out: ViewerConfig = { ...DEFAULT_CONFIG };
  if (typeof parsed.height === "number")
    out.height = clamp(parsed.height, 200, 1200);
  if (typeof parsed.background === "string") out.background = parsed.background;
  if (typeof parsed.exposure === "number")
    out.exposure = clamp(parsed.exposure, 0, 5);
  if ((TONE_MAPPINGS as readonly string[]).includes(parsed.toneMapping))
    out.toneMapping = parsed.toneMapping;
  if (typeof parsed.useDefaultEnv === "boolean")
    out.useDefaultEnv = parsed.useDefaultEnv;
  if (typeof parsed.skyboxBlur === "boolean")
    out.skyboxBlur = parsed.skyboxBlur;
  if (typeof parsed.skybox === "string") out.skybox = parsed.skybox;
  if (typeof parsed.envmap === "string") out.envmap = parsed.envmap;
  if (parsed.fovMode === "auto" || parsed.fovMode === "custom")
    out.fovMode = parsed.fovMode;
  if (typeof parsed.fov === "number") out.fov = clamp(parsed.fov, 1, 179);
  if (typeof parsed.yaw === "number") out.yaw = clamp(parsed.yaw, -360, 360);
  if (typeof parsed.pitch === "number")
    out.pitch = clamp(parsed.pitch, -90, 90);
  if (typeof parsed.initialZoom === "number")
    out.initialZoom = clamp(parsed.initialZoom, -100, 100);
  if (typeof parsed.rotate === "boolean") out.rotate = parsed.rotate;
  if (typeof parsed.translate === "boolean") out.translate = parsed.translate;
  if (typeof parsed.zoom === "boolean") out.zoom = parsed.zoom;
  if (typeof parsed.autoRotate === "boolean")
    out.autoRotate = parsed.autoRotate;
  if (typeof parsed.scrollable === "boolean")
    out.scrollable = parsed.scrollable;
  if (typeof parsed.wheelScrollable === "boolean")
    out.wheelScrollable = parsed.wheelScrollable;
  if (typeof parsed.useGrabCursor === "boolean")
    out.useGrabCursor = parsed.useGrabCursor;
  if (typeof parsed.showAnimationSelector === "boolean")
    out.showAnimationSelector = parsed.showAnimationSelector;
  if (typeof parsed.showAxes === "boolean") out.showAxes = parsed.showAxes;
  if (typeof parsed.showFullscreenButton === "boolean")
    out.showFullscreenButton = parsed.showFullscreenButton;
  if (typeof parsed.showScreenshotButton === "boolean")
    out.showScreenshotButton = parsed.showScreenshotButton;
  if (typeof parsed.showCameraResetButton === "boolean")
    out.showCameraResetButton = parsed.showCameraResetButton;
  if (typeof parsed.showZoomButtons === "boolean")
    out.showZoomButtons = parsed.showZoomButtons;
  if (typeof parsed.defaultAnimationIndex === "number")
    out.defaultAnimationIndex = clamp(parsed.defaultAnimationIndex, 0, 99);
  if ((REPEAT_MODES as readonly string[]).includes(parsed.animationRepeatMode))
    out.animationRepeatMode = parsed.animationRepeatMode;
  if (typeof parsed.webAR === "boolean") out.webAR = parsed.webAR;
  if (typeof parsed.sceneViewer === "boolean")
    out.sceneViewer = parsed.sceneViewer;
  if (typeof parsed.quickLook === "boolean") out.quickLook = parsed.quickLook;
  if ((AR_PLACEMENTS as readonly string[]).includes(parsed.arPlacement))
    out.arPlacement = parsed.arPlacement;
  if (typeof parsed.iosSrc === "string") out.iosSrc = parsed.iosSrc;
  if (typeof parsed.variant === "string") out.variant = parsed.variant;
  if (typeof parsed.fixSkinnedBbox === "boolean")
    out.fixSkinnedBbox = parsed.fixSkinnedBbox;
  if (typeof parsed.shadow === "boolean") out.shadow = parsed.shadow;
  if (typeof parsed.maintainSize === "boolean")
    out.maintainSize = parsed.maintainSize;
  out.controlsLayout = normalizeControlsLayout(parsed.controlsLayout);
  out.hotspots = sanitizeHotspots(parsed.hotspots);
  if (typeof parsed.showHotspots === "boolean")
    out.showHotspots = parsed.showHotspots;
  out.hotspotColor = sanitizeHotspotColor(parsed.hotspotColor);
  if ((HOTSPOT_LABELS as readonly string[]).includes(parsed.hotspotLabel))
    out.hotspotLabel = parsed.hotspotLabel;
  if ((HOTSPOT_TRIGGERS as readonly string[]).includes(parsed.hotspotTrigger))
    out.hotspotTrigger = parsed.hotspotTrigger;
  return out;
}
