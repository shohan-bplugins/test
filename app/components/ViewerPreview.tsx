import {
  buildHotspotElement,
  fitHotspotCard,
  primeHotspotVideoFrames,
  resetHotspotVideos,
  resetViewOnHotspotClose,
  wireHotspotHover,
  type Hotspot,
  type HotspotLabel,
  type HotspotTrigger,
} from "~/lib/hotspots";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  Box,
  Camera,
  ChevronDown,
  ChevronUp,
  FileWarning,
  Loader2,
  Maximize,
  Minimize,
  RotateCcw,
  UploadCloud,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import view3dStylesUrl from "@egjs/view3d/css/view3d-bundle.min.css?url";
import appStylesUrl from "~/app.css?url";
import { isPreviewableModelUrl } from "~/lib/files";
import { qrSvgPath } from "~/lib/qr";
import {
  CONTROL_SLOTS,
  fullscreenCloseSlot,
  resolveDefaultClipIndex,
  type ControlItemId,
  type ControlsLayout,
  type ControlSlot,
} from "~/lib/viewer-config";
import { cn } from "~/lib/utils";
import type { FEATURES } from "~/lib/viewer-stats";
import { ControlLayoutEditor } from "~/components/ControlLayoutEditor";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";

const TONE_MAPPINGS: Record<string, number> = {
  None: 0,
  Linear: 1,
  Reinhard: 2,
  Cineon: 3,
  ACESFilmic: 4,
};

export type ViewerConfig = {
  height: number;
  background: string;
  exposure: number;
  toneMapping: string;
  useDefaultEnv: boolean;
  skyboxBlur: boolean;
  skybox: string;
  envmap: string;
  fovMode: "auto" | "custom";
  fov: number;
  yaw: number;
  pitch: number;
  initialZoom: number;
  rotate: boolean;
  translate: boolean;
  zoom: boolean;
  autoRotate: boolean;
  scrollable: boolean;
  wheelScrollable: boolean;
  useGrabCursor: boolean;
  showAnimationSelector: boolean;
  showAxes: boolean;
  showFullscreenButton: boolean;
  showScreenshotButton: boolean;
  showCameraResetButton: boolean;
  showZoomButtons: boolean;
  defaultAnimationIndex: number;
  animationRepeatMode: string;
  webAR: boolean;
  sceneViewer: boolean;
  quickLook: boolean;
  /** Where AR puts the model: on the floor, or hung on a wall. */
  arPlacement: "floor" | "wall";
  /** Which controls sit in each spot, in order — see CONTROL_SLOTS. */
  controlsLayout: ControlsLayout;
  iosSrc: string;
  variant: string;
  fixSkinnedBbox: boolean;
  shadow: boolean;
  maintainSize: boolean;
  /** Numbered points on the model with a card each — see lib/hotspots.ts. */
  hotspots: Hotspot[];
  showHotspots: boolean;
  hotspotColor: string;
  /** Pin shows its number or the hotspot's title. */
  hotspotLabel: HotspotLabel;
  /** Card opens on click, or on mouse hover (touch still taps). */
  hotspotTrigger: HotspotTrigger;
};

function buildOptions(modelUrl: string, cfg: ViewerConfig) {
  const opts: Record<string, unknown> = {
    src: modelUrl,
    autoInit: true,
    exposure: cfg.exposure,
    useDefaultEnv: cfg.useDefaultEnv,
    skyboxBlur: cfg.skyboxBlur,
    yaw: cfg.yaw,
    pitch: cfg.pitch,
    initialZoom: cfg.initialZoom,
    rotate: cfg.rotate,
    translate: cfg.translate,
    zoom: cfg.zoom,
    scrollable: cfg.scrollable,
    wheelScrollable: cfg.wheelScrollable,
    useGrabCursor: cfg.useGrabCursor,
    // view3d's option is the 0-based clip index; ours is 1-based with 0 for
    // "none" (resolveDefaultClipIndex). The clip count isn't known yet here, so
    // this is the plain shift — the ready handler below re-resolves it against
    // the clips the model actually turned out to have. A -1 (our "none") is
    // deliberate rather than clamped away: ModelAnimator.play(-1) finds no
    // action and returns, so nothing autoplays and there is no frame of unwanted
    // animation to stop afterwards.
    defaultAnimationIndex: cfg.defaultAnimationIndex - 1,
    animationRepeatMode: cfg.animationRepeatMode,
    webAR: arSessionOption(cfg.webAR, cfg.arPlacement),
    sceneViewer: arSessionOption(cfg.sceneViewer, cfg.arPlacement),
    quickLook: cfg.quickLook,
    fixSkinnedBbox: cfg.fixSkinnedBbox,
    shadow: cfg.shadow,
    maintainSize: cfg.maintainSize,
    autoplay: cfg.autoRotate ? { delay: 0, speed: 0.5 } : false,
  };

  if (TONE_MAPPINGS[cfg.toneMapping] != null) {
    opts.toneMapping = TONE_MAPPINGS[cfg.toneMapping];
  }
  if (cfg.skybox) opts.skybox = cfg.skybox;
  if (cfg.envmap) opts.envmap = cfg.envmap;
  if (cfg.background && cfg.background.includes("://"))
    opts.background = cfg.background;
  if (cfg.fovMode === "auto") opts.fov = "auto";
  else opts.fov = cfg.fov;
  if (cfg.iosSrc) opts.iosSrc = cfg.iosSrc;
  if (cfg.variant) opts.variant = cfg.variant;

  return opts;
}

/**
 * view3d's value for one AR session type. `true` turns the session on with its
 * defaults; an object turns it on with options, and `vertical` is the one both
 * Android paths (WebXR and Scene Viewer) read to place on walls. Quick Look has
 * no equivalent — iOS anchors the model as its .usdz says.
 *
 * MUST match arSessionOption in extensions/viewer-3d/assets/viewer-3d.js.
 */
function arSessionOption(
  enabled: boolean,
  placement: ViewerConfig["arPlacement"],
): boolean | { vertical: true } {
  if (!enabled) return false;
  return placement === "wall" ? { vertical: true } : true;
}

type Props = {
  modelUrl: string | null;
  config: ViewerConfig;
  className?: string;
  // Fill the parent instead of using config.height — for the standalone
  // /viewer/:id page, where the iframe (or window) dictates the size.
  fill?: boolean;
  // Overrides the wording shown when fullscreen is refused. The default names
  // the Shopify admin, which is right for the settings preview but wrong on the
  // public viewer page, where a refusal instead means the *embedding* page
  // didn't pass allow="fullscreen".
  fullscreenUnavailableMessage?: string;
  // The page a desktop visitor's phone should open to use AR, shown as a QR
  // code. Left out, it is this page — unless this page is framed (the admin),
  // where the address is one a phone can't open, so there is no QR at all.
  // null turns it off.
  arShareUrl?: string | null;
  // Given, the preview offers "Move controls": drag each control to a new
  // spot, or in and out of the hidden tray. Every change arrives here as a
  // config patch (the layout, plus the show/hide settings a tray drag flips)
  // to be saved with the other settings.
  onLayoutChange?: (patch: Partial<ViewerConfig>) => void;
  /**
   * Called when the visitor uses AR or a control — the same events the
   * storefront widget counts for Analytics. Only the public /viewer/:id embed
   * passes it; the admin's previews are not visitors.
   */
  onTrack?: (event: ViewerTrackEvent) => void;
  /**
   * Hotspot placement mode: the next click on the model (a click, not a drag)
   * reports where it landed — mesh face, barycentric weights and the camera
   * pose to use as the hotspot's focus — instead of doing anything else.
   */
  placingHotspot?: boolean;
  onPlaceHotspot?: (anchor: HotspotAnchor) => void;
  /** Opens this hotspot (camera turn and card) whenever `focusNonce` changes. */
  focusHotspotId?: string | null;
  focusNonce?: number;
};

export type ViewerTrackEvent = "ar" | (typeof FEATURES)[number];

export type HotspotAnchor = Pick<
  Hotspot,
  "meshIndex" | "faceIndex" | "weights" | "position" | "focus"
>;

// The page as the phone should open it: only `variant` survives from the query
// string, since everything else there is tracking that would make the code
// denser, and the hash goes too. Same rule as arHandOffUrl in viewer-3d.js.
function currentPageShareUrl(): string | null {
  try {
    if (window.self !== window.top) return null;
    const url = new URL(window.location.href);
    const variant = url.searchParams.get("variant");
    url.search = variant ? `?variant=${encodeURIComponent(variant)}` : "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

// A device with a mouse. A phone or tablet that can't enter AR is already the
// device a QR code would send the visitor to.
function isDesktopPointer(): boolean {
  try {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch {
    return false;
  }
}

// three.js's renderer.dispose() frees its own JS-side caches but never
// releases the actual WebGL context, so we force it explicitly. Combined
// with keying the <canvas> by initKey (which hands the next instance a
// brand new canvas anyway), this guarantees the old GPU context is torn
// down rather than left dangling.
function destroyView3D(instance: any) {
  if (!instance) return;
  try {
    instance.renderer?.threeRenderer?.forceContextLoss?.();
  } catch {}
  try {
    instance.destroy?.();
  } catch {}
}

function disconnectResizeObserver(ref: { current: ResizeObserver | null }) {
  ref.current?.disconnect();
  ref.current = null;
}

// Steps the camera's zoom by `delta` using view3d's own animated-reset
// mechanism (the same one it uses internally for double-tap-to-zoom), so a
// button click gets a smooth transition instead of an instant jump. Clamped
// so zoom can't push the effective FOV to zero/negative (which would
// otherwise be reachable since reset() doesn't apply the same min/max
// clamping the scroll/pinch zoom control does).
function stepZoom(instance: any, delta: number) {
  try {
    const camera = instance?.camera;
    if (!camera) return;
    const pose = camera.currentPose.clone();
    const maxZoom = camera.baseFov - 5;
    pose.zoom = Math.min(maxZoom, Math.max(-100, pose.zoom + delta));
    camera.reset(300, undefined, pose);
  } catch {}
}

/*
 * Enforces the rotate / translate / zoom permissions.
 *
 * Passing `rotate: false`, `translate: false` or `zoom: false` to View3D looks
 * like it should work and does nothing. Its OrbitControl builds each sub-control
 * with `bc(option)`, and bc is `e => typeof e === "object" ? e : {}` — so a
 * boolean is discarded and the control gets default options. enable() then turns
 * all three on regardless. All three settings were inert.
 *
 * Mirrors applyControlPermissions in
 * extensions/viewer-3d/assets/viewer-3d.js — keep the two in step.
 */
function applyControlPermissions(instance: any, cfg: ViewerConfig) {
  const control = instance?.control;
  if (!control) return;
  const permissions: [string, boolean][] = [
    ["rotate", cfg.rotate],
    ["translate", cfg.translate],
    ["zoom", cfg.zoom],
  ];
  for (const [name, allowed] of permissions) {
    const sub = control[name];
    if (!sub) continue;
    try {
      if (allowed) sub.enable?.();
      else sub.disable?.();
    } catch {}
  }
}

/*
 * Takes the axis gizmo's six hit targets out of the document.
 *
 * This is what keeps the Shopify admin usable while the gizmo is on, and it is
 * not about this app's own rendering at all. App Bridge installs a document-wide
 * MutationObserver with no attribute filter:
 *
 *   observe(document, {subtree: true, childList: true, characterData: true,
 *                      attributes: true})
 *
 * and re-projects the page's action buttons — Preview, Reset settings, Delete,
 * Support — whenever it fires. Meanwhile NavigationGizmo._onRender, registered on
 * view3d's RENDER event, ends with:
 *
 *   axisEl.style.left = `${screenPos.x}px`;
 *   axisEl.style.top = `${screenPos.y}px`;
 *   axisEl.style.zIndex = renderIdx.toString();
 *
 * autoRotate is on by default, so view3d renders continuously: eighteen
 * attribute mutations per frame, better than a thousand a second, every one of
 * them inside `document`. The admin's header buttons are then rebuilt faster
 * than a click can complete, which is why enabling one checkbox made four
 * unrelated buttons dead.
 *
 * Detaching is the fix rather than `display: none` or `contain`, both of which
 * were tried: those stop the *layout*, but the writes still happen and it is the
 * mutation records, not the layout, that App Bridge is reacting to. A write to a
 * node outside the observed tree produces no record at all — and view3d keeps
 * its own references in `_axisEls`, so it goes on writing to them harmlessly.
 *
 * Nothing visible is lost. The gizmo everyone sees — three coloured axes and
 * their labels — is painted by that same function onto the gizmo's own 2D
 * canvas, and canvas drawing is not DOM mutation. These six divs carry no paint
 * (the vendor rule gives them 20x20, pointer-events and a cursor); they exist
 * only to snap the camera to an axis on click. That gesture is the one casualty,
 * which the setting's own description accepts — "Orientation indicator shown in
 * the corner of the viewer" — and the toolbar's Reset view already covers.
 *
 * They stay detached: ControlBar._updateModelParams re-runs disable()/enable()
 * on every MODEL_CHANGE, but enable() only re-appends the gizmo's root. The axis
 * elements were appended once, in _createElement.
 *
 * Mirrored by detachGizmoHitTargets in extensions/viewer-3d/assets/viewer-3d.js.
 */
function detachGizmoHitTargets(root: HTMLElement | null) {
  if (!root) return;
  root
    .querySelectorAll(".view3d-gizmo .view3d-gizmo-axis")
    .forEach((node) => node.remove());
}

/*
 * A home for view3d's hotspot elements that App Bridge cannot see.
 *
 * The same App Bridge observer as above (detachGizmoHitTargets) re-sends the
 * page's header buttons on any mutation inside <s-page>. view3d writes every
 * annotation's `style` and `class` on every rendered frame, so with hotspots on
 * a model and autoRotate on, that was ~700 mutation records a second: Preview,
 * Reset settings, Delete and Support rebuilt faster than a click could land.
 *
 * Unlike the gizmo's hit targets, the pins have to stay on screen, so they
 * cannot be detached. A shadow root is the other kind of place a write makes no
 * record: an observer on `document` with `subtree: true` does not reach into
 * shadow trees. The pins keep their exact position — the host sits where view3d
 * would have appended its own wrapper, inside the viewer root, so fullscreen
 * still includes them.
 *
 * Shadow trees don't inherit the page's stylesheets, so the same two the route
 * loads are linked inside it. They are cached by then, and the hotspot rules in
 * app.css use only the pins' own classes, so they match unchanged in here.
 */
function createAnnotationLayer(root: HTMLElement) {
  const host = document.createElement("div");
  host.className = "view3d-annotation-host";
  host.style.cssText = "position:absolute;inset:0;pointer-events:none;";
  const shadow = host.attachShadow({ mode: "open" });
  for (const href of [view3dStylesUrl, appStylesUrl]) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    shadow.appendChild(link);
  }
  const wrapper = document.createElement("div");
  wrapper.className = "view3d-annotation-wrapper";
  shadow.appendChild(wrapper);
  root.appendChild(host);
  return { host, wrapper };
}

// Duration of the clip crossfade / fade-out, in ms. Mirrors FADE_MS in
// extensions/viewer-3d/assets/viewer-3d.js.
const FADE_MS = 320;

// Fullscreen API, with the WebKit-prefixed spellings Safari still needs.
// document.fullscreenElement is the source of truth for whether we're
// fullscreen — a local boolean goes stale the moment the user leaves via Escape,
// F11 or the browser's own control, none of which run our code. Mirrors the
// helpers in extensions/viewer-3d/assets/viewer-3d.js.
const FS_CHANGE_EVENTS = ["fullscreenchange", "webkitfullscreenchange"];

function nativeFullscreenElement(): Element | null {
  const doc = document as any;
  return doc.fullscreenElement || doc.webkitFullscreenElement || null;
}

// Returns a promise when the request was made, or null when it couldn't be — no
// API at all, or a synchronous throw (which is how some engines refuse it). A
// null return and a rejected promise mean the same thing to the caller.
function requestNativeFullscreen(el: HTMLElement): Promise<void> | null {
  const anyEl = el as any;
  const request = anyEl.requestFullscreen || anyEl.webkitRequestFullscreen;
  if (!request) return null;
  try {
    const result = request.call(el);
    return result && typeof result.then === "function"
      ? result
      : Promise.resolve();
  } catch {
    return null;
  }
}

function exitNativeFullscreen() {
  const doc = document as any;
  const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
  if (!exit) return;
  try {
    const result = exit.call(document);
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch {}
}

// Whether this document is *permitted* to go fullscreen at all.
// `document.fullscreenEnabled` is false inside an iframe that wasn't given
// `allow="fullscreen"` — which is exactly how Shopify embeds this app — so it
// tells us up front that the button can't work here, without having to fire a
// request and watch it fail. On a storefront page it's true.
function nativeFullscreenAllowed(el: HTMLElement | null): boolean {
  if (!el) return false;
  const doc = document as any;
  const enabled = doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled;
  if (enabled === false) return false;
  const anyEl = el as any;
  return !!(anyEl.requestFullscreen || anyEl.webkitRequestFullscreen);
}

const FULLSCREEN_UNAVAILABLE_MESSAGE =
  "Fullscreen only works on your storefront. Shopify's admin blocks it inside this preview.";

// view3d's crossFade() blends via three's crossFadeTo with the `warp` flag on,
// which morphs the two clips' playback speeds toward each other for the length
// of the blend — and leaves the *outgoing* action's timeScale sitting at
// outgoingDuration / incomingDuration forever. view3d restores only the incoming
// action, so every switch between clips of different lengths strands a wrong
// speed on the clip you just left: select it again and it plays at that speed (a
// 2.5s clip left after a 0.4s one comes back 6.25x too fast). Normalizing every
// action once the blend has finished is what keeps clip speeds correct across
// repeated switching. setEffectiveTimeScale() also calls stopWarping()
// internally, so this clears both past residue and any warp still in flight.
function normalizeTimeScales(animator: any) {
  const actions = animator?.actions ?? [];
  for (const action of actions) {
    try {
      action?.setEffectiveTimeScale(1);
    } catch {}
  }
}

const CORNER_POSITION_CLASSES: Record<string, string> = {
  "bottom-left": "bottom-2 left-2",
  "bottom-center": "bottom-2 left-1/2 -translate-x-1/2",
  "bottom-right": "bottom-2 right-2",
  "top-left": "top-2 left-2",
  "top-center": "top-2 left-1/2 -translate-x-1/2",
  "top-right": "top-2 right-2",
};

// The animation popup is nested *inside* the mini toolbar div (which is
// itself `position: absolute`, so it already forms the containing block
// for these classes) rather than positioned independently — that's what
// keeps it anchored right next to the button that opens it instead of
// popping up somewhere unrelated on the card. Opens upward off a
// bottom-anchored toolbar, downward off a top-anchored one, and mirrors
// the toolbar's own left/center/right alignment.
const ANIMATION_POPUP_ANCHOR_CLASSES: Record<string, string> = {
  "bottom-left": "bottom-full mb-2 left-0",
  "bottom-center": "bottom-full mb-2 left-1/2 -translate-x-1/2",
  "bottom-right": "bottom-full mb-2 right-0",
  "top-left": "top-full mt-2 left-0",
  "top-center": "top-full mt-2 left-1/2 -translate-x-1/2",
  "top-right": "top-full mt-2 right-0",
};

/*
 * Which side a bar's tooltips open on. A bar can sit at the top of the viewer
 * as well as the bottom, and a tooltip above a top bar would be cut off by the
 * viewer's edge — so the buttons in each bar are told which side to use.
 */
const sideFor = (slot: ControlSlot): "top" | "bottom" =>
  slot.startsWith("top") ? "bottom" : "top";

/** A bar's position, and its direction: a row in the middle spots, a column in the corners. */
function barClasses(slot: ControlSlot) {
  return cn(
    CORNER_POSITION_CLASSES[slot],
    slot.endsWith("center") ? "flex-row" : "flex-col",
  );
}

function MiniToolbarButton({
  label,
  onClick,
  children,
  // "bottom" for a button against the top edge — above it there's no room.
  tooltipSide = "top",
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  tooltipSide?: "top" | "bottom";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="preview-toolbar-btn flex size-9 items-center justify-center border border-black/10 bg-white text-black/80 shadow-md outline-none transition-all duration-150 hover:bg-primary hover:text-white active:scale-90 active:bg-primary/90 focus-visible:bg-primary focus-visible:text-white focus-visible:ring-2 focus-visible:ring-black/30 focus-visible:ring-offset-1 focus-visible:ring-offset-white [&_svg]:size-5"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * A second click on an open hotspot closes it. view3d's own click handler only
 * ever opens, so this runs first (it is attached before view3d's) and stops
 * view3d's from reopening what it just closed.
 */
function wireHotspotToggle(el: HTMLElement, get: () => any) {
  el.addEventListener("click", (e) => {
    const annotation = get();
    // Only the pin toggles; presses inside the open card (shop buttons, play,
    // links) leave it open. view3d's own handler, which runs next, only
    // re-focuses a hotspot that is already open.
    if (!(e.target as Element | null)?.closest?.(".e3d-hotspot-pin")) return;
    if (annotation?.focusing) {
      e.stopImmediatePropagation();
      annotation.unfocus();
    }
  });
}

/**
 * The nearest triangle under a ray, tested against the model as it is drawn.
 *
 * three's own Raycaster is not used: for a skinned mesh (any rigged
 * character) it culls against a bounding sphere of the unposed bind pose,
 * which on real models misses everything the merchant can see — every click
 * on a posed character reported "nothing here". This transforms each vertex
 * the way the renderer does (boneTransform for skinned meshes, then the
 * mesh's world matrix) and tests every triangle, so what is clicked is what
 * is on screen. It is also the same posed triangle view3d's FaceAnnotation
 * later reads (getAnimatedFace), so the pin lands exactly on the click —
 * measured to the pixel on a 12-mesh skinned model, ~25ms per click.
 *
 * Vertices are transformed lazily and once each per click.
 */
function intersectPosed(
  THREE: any,
  ray: any,
  meshes: any[],
): {
  distance: number;
  meshIndex: number;
  faceIndex: number;
  weights: [number, number, number];
  point: any;
  indexed: boolean;
} | null {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const p = new THREE.Vector3();
  const v = new THREE.Vector3();
  let best: ReturnType<typeof intersectPosed> = null;
  meshes.forEach((mesh, meshIndex) => {
    const geometry = mesh.geometry;
    const pos = geometry?.attributes?.position;
    if (!pos || mesh.visible === false) return;
    const index = geometry.index;
    const faces = Math.floor((index ? index.count : pos.count) / 3);
    const world = new Float32Array(pos.count * 3);
    const done = new Uint8Array(pos.count);
    const vertex = (i: number, out: any) => {
      if (!done[i]) {
        v.fromBufferAttribute(pos, i);
        if (mesh.isSkinnedMesh && mesh.boneTransform) mesh.boneTransform(i, v);
        v.applyMatrix4(mesh.matrixWorld);
        world[i * 3] = v.x;
        world[i * 3 + 1] = v.y;
        world[i * 3 + 2] = v.z;
        done[i] = 1;
      }
      return out.fromArray(world, i * 3);
    };
    for (let f = 0; f < faces; f++) {
      const i0 = index ? index.getX(f * 3) : f * 3;
      const i1 = index ? index.getX(f * 3 + 1) : f * 3 + 1;
      const i2 = index ? index.getX(f * 3 + 2) : f * 3 + 2;
      if (
        !ray.intersectTriangle(
          vertex(i0, a),
          vertex(i1, b),
          vertex(i2, c),
          false,
          p,
        )
      ) {
        continue;
      }
      const distance = p.distanceTo(ray.origin);
      if (best && distance >= best.distance) continue;
      const w = new THREE.Vector3();
      THREE.Triangle.getBarycoord(p, a, b, c, w);
      best = {
        distance,
        meshIndex,
        faceIndex: f,
        weights: [w.x, w.y, w.z],
        point: p.clone(),
        indexed: !!index,
      };
    }
  });
  return best;
}

/**
 * Where a click landed on the model, as a hotspot anchor: the mesh and face
 * hit, the point's barycentric weights inside that triangle (what view3d's
 * FaceAnnotation needs to follow the face as it animates), and the current
 * camera pose to use as the hotspot's focus — the merchant is looking at the
 * spot from the angle they want it shown from. A click on empty space places
 * nothing.
 */
async function pickHotspotAnchor(
  view3d: any,
  e: PointerEvent,
  THREE: any,
): Promise<HotspotAnchor | null> {
  const model = view3d.model;
  const camera = view3d.camera?.threeCamera;
  const canvas: HTMLCanvasElement | undefined = view3d.renderer?.canvas;
  if (!model || !camera || !canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const hit = intersectPosed(THREE, raycaster.ray, model.meshes ?? []);
  if (!hit) return null;

  const pose = view3d.camera.currentPose;
  const focus: [number, number, number] = [
    Number(pose?.yaw) || 0,
    Number(pose?.pitch) || 0,
    Number(pose?.zoom) || 0,
  ];
  // view3d's FaceAnnotation reads faces through the geometry's index buffer
  // (getAnimatedFace), so a face anchor on non-indexed geometry would throw
  // on the storefront. Those get a fixed point instead.
  if (!hit.indexed || !hit.weights.every(Number.isFinite)) {
    return {
      meshIndex: -1,
      faceIndex: -1,
      weights: [1 / 3, 1 / 3, 1 / 3],
      position: [hit.point.x, hit.point.y, hit.point.z],
      focus,
    };
  }
  return {
    meshIndex: hit.meshIndex,
    faceIndex: hit.faceIndex,
    weights: hit.weights,
    position: null,
    focus,
  };
}

export function ViewerPreview({
  modelUrl,
  config,
  className,
  fill = false,
  fullscreenUnavailableMessage = FULLSCREEN_UNAVAILABLE_MESSAGE,
  arShareUrl,
  onLayoutChange,
  onTrack,
  placingHotspot = false,
  onPlaceHotspot,
  focusHotspotId = null,
  focusNonce = 0,
}: Props) {
  // "Move controls" mode — see ControlLayoutEditor. Only offered where the
  // page can save the result (onLayoutChange), i.e. the admin's settings pages.
  const [arranging, setArranging] = useState(false);
  const closeSlot = fullscreenCloseSlot(config.controlsLayout);
  const elRef = useRef<HTMLDivElement>(null);
  const view3dRef = useRef<any>(null);
  // Latest onTrack, readable from view3d's event handlers without re-binding.
  const onTrackRef = useRef(onTrack);
  onTrackRef.current = onTrack;
  const track = (event: ViewerTrackEvent) => {
    try {
      onTrackRef.current?.(event);
    } catch {
      // Analytics must never break the viewer.
    }
  };
  // The view3d module, for its FaceAnnotation / PointAnnotation classes.
  const view3dModRef = useRef<any>(null);
  // Bumped on every 'ready', so hotspots are (re)attached to each new instance.
  const [readyCount, setReadyCount] = useState(0);
  const controlBarRef = useRef<any>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  // Shadow-root host for hotspot elements; see createAnnotationLayer.
  const annotationHostRef = useRef<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Starts true (instead of flipping true only once the mount effect runs)
  // so the spinner is visible from the very first paint after a page
  // reload, rather than a brief blank canvas before "Loading model…" appears.
  const [loading, setLoading] = useState(
    () => !!modelUrl && isPreviewableModelUrl(modelUrl),
  );
  // Real Fullscreen API only. There used to be a CSS-maximize fallback here for
  // when the request is refused, but "fills the admin iframe" isn't fullscreen —
  // it just looked like the feature half-working. Shopify embeds this app in an
  // iframe without `allow="fullscreen"`, so the honest behaviour in that case is
  // to say so (see warnFullscreenUnavailable) rather than substitute something
  // else. The storefront widget keeps its own fallback: the theme editor preview
  // is also a restricted iframe, but there a bigger preview is still worth having.
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  // Assumed available until proven otherwise, so the button doesn't flicker into
  // a warning label on first paint; the effect below corrects it once mounted.
  const [fullscreenAvailable, setFullscreenAvailable] = useState(true);
  // In-viewer message used where App Bridge's toast isn't available.
  const [notice, setNotice] = useState<string | null>(null);
  // view3d's own AnimationSelector is a click-to-open dropdown behind a
  // single "current clip name" button — this reimplements that same
  // interaction (name button lives in the mini toolbar, list opens on
  // click) since the vendor plugin can't be split across our own toolbar
  // and a custom list. clipNames/activeClipIndex are plain React state (not
  // read from the ref on every render) because the animator only knows the
  // clips once the model has actually loaded. activeClipIndex of -1 means
  // "None" (animation stopped).
  const [clipNames, setClipNames] = useState<string[]>([]);
  // Whether this device can actually enter AR. Resolved asynchronously
  // (WebXR's check returns a promise), and false on every desktop, which gets
  // the QR hand-off below instead.
  const [arAvailable, setArAvailable] = useState(false);
  // Whether that check has answered — the QR fallback waits for it, so a phone
  // that *can* enter AR never flashes the QR button first.
  const [arChecked, setArChecked] = useState(false);
  // Resolved after mount: both read `window`, which the server doesn't have.
  const [arQrTarget, setArQrTarget] = useState<string | null>(null);
  const [arQrOpen, setArQrOpen] = useState(false);
  // Whatever had focus when the QR opened (its button), to hand focus back to.
  const arQrReturnFocusRef = useRef<HTMLElement | null>(null);
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const animationListRef = useRef<HTMLDivElement>(null);

  // The QR fallback for a desktop: only when some phone could use AR (Quick
  // Look alone needs a .usdz) and there's a page a phone can open.
  const phoneCanUseAr =
    config.webAR || config.sceneViewer || (config.quickLook && !!config.iosSrc);
  useEffect(() => {
    if (!phoneCanUseAr || !isDesktopPointer()) {
      setArQrTarget(null);
      return;
    }
    setArQrTarget(
      arShareUrl === undefined ? currentPageShareUrl() : arShareUrl,
    );
  }, [phoneCanUseAr, arShareUrl]);
  const showArQr = arChecked && !arAvailable && !!arQrTarget;
  // Redrawn whenever the target changes; a URL too long for any QR version
  // gets no button rather than one that opens nothing.
  const arQr = useMemo(
    () => (showArQr && arQrTarget ? qrSvgPath(arQrTarget) : null),
    [showArQr, arQrTarget],
  );

  function closeArQr() {
    setArQrOpen(false);
    arQrReturnFocusRef.current?.focus();
  }

  useEffect(() => {
    if (!arQrOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeArQr();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [arQrOpen]);

  // Switching clips used to be a hard cut — animator.play() stops the outgoing
  // clip on the same frame the incoming one starts, so the model visibly snaps
  // between poses. crossFade/fadeOut blend the two instead. Kept in one function
  // (idx -1 meaning "None") so both call sites get identical behaviour, and
  // mirroring selectClip() in extensions/viewer-3d/assets/viewer-3d.js.
  //
  // The fades are driven by the mixer's clock, and the mixer's clock is exactly
  // what pause() freezes (it sets timeScale to 0) — so a fade started while
  // paused would hang forever with two clips half-blended on screen. Paused
  // viewers therefore keep the old instant switch.
  const selectionSeq = useRef(0);

  function selectClip(idx: number) {
    const animator = view3dRef.current?.animator;
    if (!animator) return;
    if (idx !== -1 && !(idx >= 0 && idx < clipNames.length)) return;

    // Re-picking the clip that's already playing would otherwise restart it from
    // frame 0 and crossfade it against itself — three's crossFadeTo schedules a
    // fade-out and a fade-in on the same action, the second overwriting the
    // first, so the model drops to its bind pose and fades back in. Nothing to do
    // instead. A clip that has *finished* (repeat mode "none") isn't animating,
    // so it still restarts.
    if (
      idx !== -1 &&
      idx === animator.activeAnimationIndex &&
      !!animator.animating
    ) {
      setListOpen(false);
      return;
    }

    const seq = ++selectionSeq.current;
    // UI first: the toolbar responds on the click, not when the blend ends.
    setActiveClipIndex(idx);
    setListOpen(false);

    try {
      if (animator.paused) {
        if (idx === -1) {
          animator.stop();
        } else {
          animator.play(idx);
          animator.pause();
        }
        normalizeTimeScales(animator);
        return;
      }

      // Re-picking the clip that is already selected but has finished — repeat
      // mode "none" leaves it clamped and paused on its last frame — is a
      // restart, not a blend, and crossFade cannot do it: it rewinds the action
      // without clearing three's `paused` flag, and with start and end being the
      // same action it would fade the clip against itself. play() stops every
      // action first, and stop() resets them, which is what unpauses.
      if (idx !== -1 && idx === animator.activeAnimationIndex) {
        animator.play(idx);
        normalizeTimeScales(animator);
        view3dRef.current?.renderer?.renderSingleFrame?.(true);
        return;
      }

      if (idx === -1) {
        animator.fadeOut(FADE_MS)?.catch?.(() => {});
      } else {
        animator.crossFade(idx, FADE_MS)?.catch?.(() => {});
      }

      // Runs once the blend has finished, and only for the most recent selection
      // — a stale timer from a superseded transition must not touch the new one,
      // hence the seq check.
      //
      // Two jobs. First, strip the warp residue crossFade leaves on the outgoing
      // action (see normalizeTimeScales) — safe here because by now that action
      // is at weight 0, so changing its speed is invisible. Second, for None,
      // actually halt the actions: fadeOut only lowers their weight to zero and
      // leaves them running. A timer rather than fadeOut's promise because that
      // promise resolves from a BEFORE_RENDER callback, so an idle render loop
      // leaves it pending forever and None never stops.
      window.setTimeout(() => {
        if (seq !== selectionSeq.current) return;
        try {
          if (idx === -1) animator.stop();
          normalizeTimeScales(animator);
        } catch {}
      }, FADE_MS + 80);
    } catch {}
  }

  useEffect(() => {
    if (!listOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!animationListRef.current?.contains(e.target as Node)) {
        setListOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setListOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [listOpen]);

  // The browser is the source of truth for native fullscreen, and it can be left
  // by means this component never sees — Escape, F11, the browser's own exit
  // control. Mirroring the state off the event is the only way the button and the
  // canvas size stay right in all of those cases.
  useEffect(() => {
    const onFsChange = () => {
      const active = nativeFullscreenElement() === elRef.current;
      setIsNativeFullscreen(active);
      try {
        view3dRef.current?.resize?.();
      } catch {}
    };
    for (const evt of FS_CHANGE_EVENTS) {
      document.addEventListener(evt, onFsChange);
    }
    return () => {
      for (const evt of FS_CHANGE_EVENTS) {
        document.removeEventListener(evt, onFsChange);
      }
    };
  }, []);

  // Checked after mount rather than during render: it needs the element, and
  // `document.fullscreenEnabled` is a browser-only API.
  useEffect(() => {
    setFullscreenAvailable(nativeFullscreenAllowed(elRef.current));
  }, []);

  function warnFullscreenUnavailable() {
    // Latch it, so from now on the button's tooltip says so before being clicked.
    setFullscreenAvailable(false);
    // App Bridge's toast, the same channel the rest of the admin uses. Guarded
    // because the global only exists inside the embedded admin.
    if (typeof shopify !== "undefined") {
      shopify.toast.show(fullscreenUnavailableMessage, { duration: 5000 });
    } else {
      setNotice(fullscreenUnavailableMessage);
      window.setTimeout(() => setNotice(null), 5000);
    }
  }

  function toggleFullscreen() {
    if (nativeFullscreenElement()) {
      exitNativeFullscreen();
      return;
    }
    track("f_fullscreen");
    const el = elRef.current;
    // A null return (no API, or a synchronous throw) and a rejected promise both
    // mean the request was refused, so the warning covers either.
    const request = el ? requestNativeFullscreen(el) : null;
    if (!request) {
      warnFullscreenUnavailable();
      return;
    }
    request.catch(() => warnFullscreenUnavailable());
  }

  // The WebGL canvas itself is transparent wherever the model doesn't cover
  // it — the visible background color/gradient behind it is just the
  // wrapper <div>'s own CSS background painted underneath. Capturing
  // canvas.toDataURL() alone would therefore export a see-through PNG, so
  // the current background color is painted onto an offscreen canvas first
  // and the WebGL frame is drawn on top of that before exporting.
  function captureSnapshot() {
    track("f_screenshot");
    const v3d = view3dRef.current;
    const canvas = elRef.current?.querySelector("canvas");
    if (!v3d || !canvas) return;
    try {
      v3d.renderer?.renderSingleFrame?.(true);
      const composite = document.createElement("canvas");
      composite.width = canvas.width;
      composite.height = canvas.height;
      const ctx = composite.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = config.background.startsWith("#")
        ? config.background
        : "#ffffff";
      ctx.fillRect(0, 0, composite.width, composite.height);
      ctx.drawImage(canvas, 0, 0);
      const link = document.createElement("a");
      link.href = composite.toDataURL("image/png");
      link.download = `model-view-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {}
  }

  // Anything the view3d instance exposes a live setter for (camera pose,
  // animation clip/repeat mode, material variant, skybox/envmap URLs, tone
  // mapping, skybox blur, maintain-size, iOS AR source) is applied via that
  // setter in the effects below instead of listed here — including it here
  // would force a full destroy/recreate (re-fetching the model) on every
  // slider drag tick or keystroke, which flashes the canvas black/white and
  // can leave it stuck blank if a reinit is interrupted mid-flight by the
  // next one. Only options with no live setter (they only take effect at
  // construction time) remain in this key.
  const initKey = useMemo(
    () =>
      JSON.stringify({
        modelUrl,
        useDefaultEnv: config.useDefaultEnv,
        fovMode: config.fovMode,
        shadow: config.shadow,
        fixSkinnedBbox: config.fixSkinnedBbox,
        webAR: config.webAR,
        sceneViewer: config.sceneViewer,
        quickLook: config.quickLook,
        // A session option, fixed at construction like the three above.
        arPlacement: config.arPlacement,
        showAxes: config.showAxes,
        // Not a constructor option, but it decides whether the 'ready' handler
        // starts a clip or stops the animator — so toggling it in the admin has
        // to rebuild, or the preview would keep animating after the switcher was
        // hidden.
        showAnimationSelector: config.showAnimationSelector,
      }),
    [modelUrl, config],
  );

  useEffect(() => {
    let cancelled = false;
    if (!modelUrl || !isPreviewableModelUrl(modelUrl)) {
      disconnectResizeObserver(resizeObserverRef);
      destroyView3D(view3dRef.current);
      view3dRef.current = null;
      setLoading(false);
      return;
    }

    const el = elRef.current;
    if (!el) return;

    setError(null);
    setLoading(true);

    (async () => {
      try {
        const mod = await import("@egjs/view3d");
        if (cancelled) return;
        const View3D = (mod as any).default || mod;
        view3dModRef.current = mod;
        const ControlBar = (mod as any).ControlBar;

        disconnectResizeObserver(resizeObserverRef);
        destroyView3D(view3dRef.current);
        controlBarRef.current = null;

        annotationHostRef.current?.remove();
        const layer = createAnnotationLayer(el);
        annotationHostRef.current = layer.host;
        const opts = { ...buildOptions(modelUrl, config), annotationWrapper: layer.wrapper };
        const instance = new View3D(el, opts);
        view3dRef.current = instance;

        // Fullscreen/camera-reset/zoom/animation-selector are all handled by
        // our own compact overlays below instead of the vendor's ControlBar
        // (a fixed full-width bottom strip with a click-to-open dropdown for
        // clips) — that's what makes them independently positionable, adds
        // zoom in/out, and turns the clip picker into an always-visible list
        // instead of a dropdown. Only play button/progress bar stay on the
        // vendor bar, since a scrubbable timeline is a lot to reimplement.
        // Only the axis gizmo is left of view3d's own ControlBar: the play
        // button and progress bar were removed, and everything else in our
        // toolbar is hand-built. So the plugin is loaded solely for the gizmo.
        //
        // Two things about that bargain have to be neutralised, because the bar
        // itself is unwanted here and does not know it:
        //
        // `autoHide: false` — autoHide is on by default and registers
        // pointerenter/pointerleave handlers on `view3D.rootEl`, which is the
        // very div React owns, plus a timer that toggles a class to run an
        // opacity transition. All of it drives a bar that holds nothing in this
        // configuration. Worse, "show on hover" meant hovering the viewer faded
        // in an empty 48px strip of `--view3d-cb-bg` (rgba(0,0,0,.3)) across the
        // bottom of the model.
        //
        // A settled loadPlugins, guarded on `cancelled` — it is async and was
        // fired and forgotten. The plugin is pushed onto view3d's `_plugins`
        // only *after* its init resolves, and destroy() tears down `_plugins`.
        // So a teardown landing in that window (any initKey change — and
        // showAxes is itself part of initKey, so toggling this very switch is
        // the fast path) left a plugin that attached its DOM and listeners to
        // the wrapper after its instance was already dead, registered nowhere,
        // torn down never. Every toggle stranded another one inside the div
        // React manages.
        //
        // Handled with .then() rather than awaited here: everything below —
        // the resize observer, and the 'ready' handler that clears the loading
        // spinner — has to be wired up without waiting on a plugin. An await at
        // this line would let a fast-loading model fire 'ready' before anything
        // was listening for it, and the spinner would never clear.
        if (config.showAxes && ControlBar) {
          try {
            const cb = new ControlBar({
              autoHide: false,
              playButton: false,
              progressBar: false,
              animationSelector: false,
              fullscreenButton: false,
              cameraResetButton: false,
              navigationGizmo: config.showAxes,
            });
            instance
              .loadPlugins(cb)
              .then(() => {
                if (cancelled) {
                  // Undo it ourselves: this instance is on its way out and its
                  // destroy() has already run past the plugin list.
                  try {
                    cb.teardown(instance);
                  } catch {}
                  return;
                }
                controlBarRef.current = cb;
                // Only reachable once the plugin's init has resolved, which is
                // when the gizmo has appended them.
                detachGizmoHitTargets(el);
              })
              .catch((e: unknown) => {
                console.warn("[preview] ControlBar plugin failed", e);
              });
          } catch (e) {
            console.warn("[preview] ControlBar plugin failed", e);
          }
        }

        // view3d's own auto-resizer only reliably re-fits the camera when the
        // container's size at construction time was exactly 0x0. In a
        // flex/split-pane layout the container often has *some* non-zero but
        // still-transitional size at that moment (mid CSS transition, sibling
        // cards not yet laid out, embedded-admin iframe still settling) — in
        // that case view3d's resizer discards the one notification that would
        // have corrected the fit, permanently leaving the model too big or
        // too small. Running our own resize on every real layout change,
        // for the life of the instance, guarantees it self-corrects no
        // matter when the container actually settles.
        //
        // Guarded on the size actually changing, which is what "real layout
        // change" above has to mean in practice. `instance.resize()` writes the
        // canvas's own width and height, and the observer sees that write as
        // another notification — so resizing on every notification is a
        // feedback loop: resize, layout, notify, resize. The rAF throttle caps
        // it at one pass per frame but never ends it, so the page stays in
        // permanent layout churn. Anything whose position depends on that
        // layout is then being rebuilt continuously, and a click cannot land on
        // an element that is replaced between pointerdown and pointerup — which
        // is how every button in this page's header ended up unusable while the
        // page itself looked perfectly normal.
        //
        // Rounded to whole pixels: a container sized in percentages or with a
        // scrollbar appearing and disappearing oscillates by a fraction of a
        // pixel forever, and sub-pixel noise is the usual thing keeping one of
        // these loops alive.
        let resizeRaf = 0;
        let lastWidth = -1;
        let lastHeight = -1;
        const resizeObserver = new ResizeObserver((entries) => {
          const rect = entries[entries.length - 1]?.contentRect;
          const width = Math.round(rect?.width ?? el.clientWidth);
          const height = Math.round(rect?.height ?? el.clientHeight);
          if (width === lastWidth && height === lastHeight) return;
          lastWidth = width;
          lastHeight = height;
          cancelAnimationFrame(resizeRaf);
          resizeRaf = requestAnimationFrame(() => {
            if (!cancelled) instance.resize?.();
          });
        });
        resizeObserver.observe(el);
        resizeObserverRef.current = resizeObserver;

        instance.once?.("ready", () => {
          if (cancelled) return;
          setLoading(false);
          setReadyCount((n) => n + 1);
          applyControlPermissions(instance, config);

          // The webAR/sceneViewer/quickLook settings only tell view3d which
          // session types it may use; entering AR needs an explicit
          // ar.enter(). Ask the device whether any of them can run, and let
          // the answer decide whether the button exists at all.
          if (config.webAR || config.sceneViewer || config.quickLook) {
            // A rejection means "no" too: in an iframe without
            // allow="xr-spatial-tracking" WebXR throws instead of answering.
            Promise.resolve(instance.ar?.isAvailable?.())
              .catch(() => false)
              .then((ok: boolean) => {
                if (cancelled) return;
                setArAvailable(!!ok);
                setArChecked(true);
              });
          } else {
            setArAvailable(false);
            setArChecked(true);
          }

          try {
            const clips = instance.animator?.clips ?? [];
            setClipNames(clips.map((c: any) => c.name));

            // Hiding the clip switcher means "no animation", not "an animation
            // you can't control". view3d autoplays defaultAnimationIndex on
            // load, so without stopping it here a model would animate forever
            // with no visible way to pause or change it — and since the switcher
            // is now hidden by default, that would be most models.
            if (!config.showAnimationSelector) {
              instance.animator?.stop?.();
              setActiveClipIndex(-1);
              return;
            }

            // Resolved against the clips this model actually has: the setting is
            // only validated against 0..99 when saved (the clip count isn't
            // knowable then), so a position the model doesn't have would
            // otherwise leave the toolbar showing an empty name for a clip that
            // isn't playing.
            const idx = resolveDefaultClipIndex(
              config.defaultAnimationIndex,
              clips.length,
            );
            setActiveClipIndex(idx);
            // view3d plays defaultAnimationIndex itself on load, but its
            // ModelAnimator.play() silently returns when the index has no
            // action — so an out-of-range saved index left nothing playing
            // while the toolbar showed a clip name and a pulsing "playing"
            // dot. Re-issue for the resolved index so the two agree.
            if (idx === -1) {
              instance.animator?.stop?.();
            } else if (instance.animator?.activeAnimationIndex !== idx) {
              instance.animator?.play(idx);
            }
          } catch {
            setClipNames([]);
          }
        });
        // In repeat mode "all" the animator advances to the next clip by itself
        // whenever one loops (ModelAnimator._onAnimationLoop calls
        // play(nextIndex)), so the toolbar has to follow the animator rather than
        // only our own clicks — otherwise it sits there showing whatever was last
        // picked while a completely different clip plays.
        instance.on?.("animationStart", (evt: any) => {
          if (cancelled) return;
          const idx = evt?.index;
          if (typeof idx === "number" && idx >= 0) {
            setActiveClipIndex((prev) => (prev === idx ? prev : idx));
          }
        });
        instance.once?.("loadError", () => {
          if (!cancelled) {
            setError("Failed to load model");
            setLoading(false);
          }
        });
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      // The instance is also torn down at the top of the next run, which covers
      // re-initialising. This covers the other exit: unmounting. Without it,
      // every SPA navigation away from a viewer left an instance behind that
      // still held a WebGL context and — because autoRotate keeps view3d
      // rendering every frame rather than on demand — still ran a full
      // requestAnimationFrame draw loop forever. A few navigations was all it
      // took to saturate the main thread and hit "Page Unresponsive".
      disconnectResizeObserver(resizeObserverRef);
      destroyView3D(view3dRef.current);
      view3dRef.current = null;
      controlBarRef.current = null;
      annotationHostRef.current?.remove();
      annotationHostRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initKey]);

  useEffect(() => {
    const v3d = view3dRef.current;
    if (!v3d) return;
    try {
      if (typeof config.exposure === "number") v3d.exposure = config.exposure;
    } catch {}
    try {
      const auto = v3d.autoPlayer;
      if (auto) {
        if (config.autoRotate) auto.enable?.();
        else auto.disable?.();
      }
    } catch {}
    try {
      if (v3d.control) {
        if (v3d.control.rotate) v3d.control.rotate.enabled = config.rotate;
        if (v3d.control.translate)
          v3d.control.translate.enabled = config.translate;
        if (v3d.control.zoom) v3d.control.zoom.enabled = config.zoom;
      }
    } catch {}
    try {
      v3d.scrollable = config.scrollable;
      v3d.wheelScrollable = config.wheelScrollable;
      v3d.useGrabCursor = config.useGrabCursor;
    } catch {}
    try {
      if (v3d.camera) {
        if (typeof config.yaw === "number") v3d.camera.yaw = config.yaw;
        if (typeof config.pitch === "number") v3d.camera.pitch = config.pitch;
        if (typeof config.initialZoom === "number")
          v3d.camera.zoom = config.initialZoom;
        if (config.fovMode === "custom" && typeof config.fov === "number") {
          v3d.camera.baseFov = config.fov;
        }
        // The default render loop only renders while something is actively
        // animating (drag, autoplay, etc). Programmatic pose changes need an
        // explicit frame or they'd never reach the screen.
        v3d.renderer?.renderSingleFrame?.(true);
      }
    } catch {}
  }, [
    config.exposure,
    config.autoRotate,
    config.rotate,
    config.translate,
    config.zoom,
    config.scrollable,
    config.wheelScrollable,
    config.useGrabCursor,
    config.yaw,
    config.pitch,
    config.initialZoom,
    config.fovMode,
    config.fov,
  ]);

  // Kept separate from the effect above: switching clips restarts from frame 0,
  // so it must only run when the index actually changes, not whenever an
  // unrelated setting (e.g. exposure) triggers a re-render. Routed through
  // selectClip so changing this setting crossfades and stays range-checked,
  // exactly like picking a clip from the toolbar does — it used to call
  // animator.play() directly, which hard-cut and could set the toolbar to an
  // index the model doesn't have.
  useEffect(() => {
    if (typeof config.defaultAnimationIndex !== "number") return;
    // With the switcher hidden there is no animation to change, and calling
    // selectClip here would start one the visitor has no way to stop.
    if (!config.showAnimationSelector) return;
    selectClip(
      resolveDefaultClipIndex(config.defaultAnimationIndex, clipNames.length),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.defaultAnimationIndex, config.showAnimationSelector]);

  useEffect(() => {
    applyControlPermissions(view3dRef.current, config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.rotate, config.translate, config.zoom]);

  /*
   * Repeat mode.
   *
   * Setting it is live: view3d's setter calls ModelAnimator.updateRepeatMode(),
   * which re-flags every action's `loop` and `clampWhenFinished`. A clip that is
   * still running therefore picks the new mode up at the end of its current
   * cycle with nothing else to do.
   *
   * A clip that has already *finished* does not, which is the case that looked
   * broken. Repeat mode "none" ends the clip on three's LoopOnce +
   * clampWhenFinished, and finishing that way sets the action's `paused` flag —
   * which the loop flags above never clear, and which pins the action's
   * effective time scale at 0. Switching back to "one" or "all" re-flagged an
   * action that could no longer advance, so the model stayed frozen on its last
   * frame and the preview showed no sign the setting had changed. It has to be
   * restarted.
   *
   * animator.play() rather than selectClip(): play() stops every action first,
   * and three's stop() resets them, which is what clears `paused`. selectClip
   * would take the crossFade path, and crossFade rewinds the action without
   * unpausing it — and with the same clip on both sides of the blend it would be
   * fading the action against itself.
   */
  useEffect(() => {
    const v3d = view3dRef.current;
    if (!v3d) return;
    try {
      if (typeof config.animationRepeatMode !== "string") return;
      v3d.animationRepeatMode = config.animationRepeatMode;

      const animator = v3d.animator;
      if (!animator) return;
      // With the switcher hidden the ready handler deliberately leaves the
      // animator stopped, so starting a clip here would hand the visitor an
      // animation with no way to stop it — the same reason the
      // defaultAnimationIndex effect above guards on this.
      if (!config.showAnimationSelector) return;
      // Nothing selected, or it is already running and will honour the new mode
      // by itself.
      if (activeClipIndex < 0 || animator.animating) return;

      // play() restores the mixer's time scale, so a viewer that was paused has
      // to be put back — mirroring the paused branch of selectClip().
      const wasPaused = animator.paused;
      animator.play(activeClipIndex);
      if (wasPaused) animator.pause();
      // The draw loop only runs while something animates; a restart that lands
      // paused would otherwise never reach the screen.
      v3d.renderer?.renderSingleFrame?.(true);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.animationRepeatMode]);

  useEffect(() => {
    const v3d = view3dRef.current;
    if (!v3d) return;
    try {
      v3d.variant = config.variant || null;
    } catch {}
  }, [config.variant]);

  // Skybox/envmap load their HDR texture asynchronously and the setters
  // trigger their own render once loaded, so no manual render call is needed.
  useEffect(() => {
    const v3d = view3dRef.current;
    if (!v3d) return;
    try {
      v3d.skybox = config.skybox || null;
    } catch {}
  }, [config.skybox]);

  useEffect(() => {
    const v3d = view3dRef.current;
    if (!v3d) return;
    try {
      v3d.envmap = config.envmap || null;
    } catch {}
  }, [config.envmap]);

  useEffect(() => {
    const v3d = view3dRef.current;
    if (!v3d) return;
    try {
      v3d.toneMapping =
        TONE_MAPPINGS[config.toneMapping] ?? TONE_MAPPINGS.Linear;
    } catch {}
  }, [config.toneMapping]);

  useEffect(() => {
    const v3d = view3dRef.current;
    if (!v3d) return;
    try {
      v3d.skyboxBlur = config.skyboxBlur;
      v3d.renderer?.renderSingleFrame?.(true);
    } catch {}
  }, [config.skyboxBlur]);

  useEffect(() => {
    const v3d = view3dRef.current;
    if (!v3d) return;
    try {
      v3d.maintainSize = config.maintainSize;
    } catch {}
  }, [config.maintainSize]);

  useEffect(() => {
    const v3d = view3dRef.current;
    if (!v3d) return;
    try {
      v3d.iosSrc = config.iosSrc || undefined;
    } catch {}
  }, [config.iosSrc]);

  useEffect(() => {
    return () => {
      disconnectResizeObserver(resizeObserverRef);
      destroyView3D(view3dRef.current);
      view3dRef.current = null;
    };
  }, []);

  const bgIsColor = config.background.startsWith("#");

  /*
   * Hotspots. Rebuilt whenever they or their style change — cheap, and never
   * part of initKey, so editing a title does not reload the model.
   */
  const hotspotsKey = JSON.stringify([
    config.showHotspots,
    config.hotspotColor,
    config.hotspotLabel,
    config.hotspotTrigger,
    config.hotspots,
  ]);
  useEffect(() => {
    const view3d = view3dRef.current;
    const mod = view3dModRef.current;
    const manager = view3d?.annotation;
    if (!view3d || !mod || !manager || !readyCount) return;
    manager.reset();
    if (!config.showHotspots) return;
    const FaceAnnotation = mod.FaceAnnotation ?? mod.default?.FaceAnnotation;
    const PointAnnotation = mod.PointAnnotation ?? mod.default?.PointAnnotation;
    if (!FaceAnnotation || !PointAnnotation) return;
    const annotations = config.hotspots.map((h, i) => {
      // No cart on this origin (admin, or the /viewer/:id embed): the shop
      // buttons explain that instead of failing.
      const element = buildHotspotElement(h, i, config.hotspotColor, () => {
        const message =
          "Add to cart, Buy now and the product link work on your storefront.";
        if (typeof shopify !== "undefined") {
          shopify.toast.show(message, { duration: 4000 });
        } else {
          setNotice(message);
          window.setTimeout(() => setNotice(null), 4000);
        }
      }, config.hotspotLabel);
      if (config.hotspotTrigger === "hover") {
        wireHotspotHover(element, () => annotations[i]);
      }
      wireHotspotToggle(element, () => annotations[i]);
      const common = { element, focus: h.focus, focusDuration: 700 };
      return h.meshIndex >= 0 && h.faceIndex >= 0
        ? new FaceAnnotation(view3d, {
            ...common,
            meshIndex: h.meshIndex,
            faceIndex: h.faceIndex,
            weights: h.weights,
          })
        : new PointAnnotation(view3d, {
            ...common,
            position: h.position ?? [0, 0, 0],
          });
    });
    manager.add(...annotations);
    view3d.renderer?.renderSingleFrame?.();
    // Closing a card stops its video: the player is swapped back for its
    // thumbnail, so nothing keeps playing behind a closed hotspot.
    const onUnfocus = (evt: any) => {
      const el = evt?.annotation?.element;
      if (el) resetHotspotVideos(el);
    };
    view3d.on?.("annotationUnfocus", onUnfocus);
    const onFocus = (evt: any) => {
      track("f_hotspot");
      const el = evt?.annotation?.element;
      if (el) primeHotspotVideoFrames(el);
      if (elRef.current) fitHotspotCard(evt?.annotation, elRef.current);
    };
    view3d.on?.("annotationFocus", onFocus);
    const stopResetView = resetViewOnHotspotClose(view3d);
    return () => {
      view3d.off?.("annotationUnfocus", onUnfocus);
      view3d.off?.("annotationFocus", onFocus);
      stopResetView();
      // The instance may already be gone (a reinit); only reset a live one.
      if (view3dRef.current === view3d) view3d.annotation?.reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyCount, hotspotsKey]);

  // "Preview" from the hotspot list: open that hotspot as a shopper would.
  useEffect(() => {
    if (!focusNonce || !focusHotspotId) return;
    const view3d = view3dRef.current;
    const list: any[] = view3d?.annotation?.list ?? [];
    const target = list.find(
      (a) => a.element?.dataset?.hotspotId === focusHotspotId,
    );
    void target?.focus?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  /*
   * Placement. A click — press and release within a few pixels and half a
   * second — places; anything longer is the merchant turning the model, which
   * keeps working while placing so they can reach the side they want.
   */
  const placeRef = useRef(onPlaceHotspot);
  placeRef.current = onPlaceHotspot;
  useEffect(() => {
    const el = elRef.current;
    if (!placingHotspot || !el) return;

    // Said out loud rather than failing silently: a click that places nothing
    // otherwise looks exactly like a broken button.
    const say = (message: string) => {
      if (typeof shopify !== "undefined") {
        shopify.toast.show(message, { duration: 4000 });
      } else {
        setNotice(message);
        window.setTimeout(() => setNotice(null), 4000);
      }
    };

    // Fetched the moment placement starts, not on the click, so the click
    // never waits on a network request (or on a dev server optimising it).
    const threeP = import("three");
    threeP.catch(() => {});

    let down: { x: number; y: number; t: number } | null = null;
    // Clicks on our own overlays — toolbar buttons, existing hotspots — are
    // not clicks on the model.
    const onOverlay = (e: Event) =>
      !!(e.target as Element | null)?.closest?.(
        "button, a, .e3d-hotspot, .preview-toolbar, .preview-animation-popup",
      );
    const onDown = (e: PointerEvent) => {
      down = onOverlay(e)
        ? null
        : { x: e.clientX, y: e.clientY, t: Date.now() };
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = Date.now() - down.t < 800;
      down = null;
      // A drag is the merchant turning the model to the side they want.
      if (moved > 8 || !quick) return;
      const view3d = view3dRef.current;
      if (!view3d?.model) {
        say("The model is still loading — try again in a moment.");
        return;
      }
      threeP
        .then((THREE) => pickHotspotAnchor(view3d, e, THREE))
        .then((anchor) => {
          if (anchor) placeRef.current?.(anchor);
          else say("Click directly on the model to place the hotspot.");
        })
        .catch((error) => {
          console.error("[hotspots] placement failed", error);
          say("Couldn’t place the hotspot. Reload the page and try again.");
        });
    };
    // On the wrapper, in the capture phase: the canvas is not the only thing
    // a click can land on (the annotation layer sits over it), and capture
    // sees the event before anything inside can stop it.
    el.addEventListener("pointerdown", onDown, true);
    el.addEventListener("pointerup", onUp, true);
    return () => {
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("pointerup", onUp, true);
    };
  }, [placingHotspot, readyCount]);

  if (!modelUrl) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 border border-dashed bg-muted/30 text-muted-foreground",
          className,
        )}
        style={{ height: fill ? "100%" : config.height }}
      >
        <UploadCloud className="size-6 opacity-50" />
        <p className="text-sm">Upload a model to see the preview</p>
      </div>
    );
  }

  if (!isPreviewableModelUrl(modelUrl)) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 border border-dashed bg-muted/30 text-center text-muted-foreground px-6",
          className,
        )}
        style={{ height: fill ? "100%" : config.height }}
      >
        <FileWarning className="size-6 opacity-50" />
        <p className="text-sm max-w-xs">
          Live preview isn&apos;t available for this file type yet. Only .glb
          and .gltf models can be shown here — the file is still stored and
          linked normally.
        </p>
      </div>
    );
  }

  /*
   * One control as it renders in `slot`, or null when it is switched off or
   * can't work here. Where each one goes is config.controlsLayout's business —
   * see the bars below.
   */
  function renderControl(id: ControlItemId, slot: ControlSlot): ReactNode {
    const side = sideFor(slot);
    switch (id) {
      // config.zoom as well: stepZoom drives camera.reset() directly, bypassing
      // view3d's zoom control, so these buttons kept zooming after "Allow
      // zoom" was switched off.
      case "zoomIn":
        return config.showZoomButtons && config.zoom ? (
          <MiniToolbarButton
            tooltipSide={side}
            label="Zoom in"
            onClick={() => {
              track("f_zoom");
              stepZoom(view3dRef.current, 15);
            }}
          >
            <ZoomIn />
          </MiniToolbarButton>
        ) : null;
      case "zoomOut":
        return config.showZoomButtons && config.zoom ? (
          <MiniToolbarButton
            tooltipSide={side}
            label="Zoom out"
            onClick={() => {
              track("f_zoom");
              stepZoom(view3dRef.current, -15);
            }}
          >
            <ZoomOut />
          </MiniToolbarButton>
        ) : null;
      case "reset":
        return config.showCameraResetButton ? (
          <MiniToolbarButton
            tooltipSide={side}
            label="Resets view"
            onClick={() => view3dRef.current?.camera?.reset(500)}
          >
            <RotateCcw />
          </MiniToolbarButton>
        ) : null;
      case "fullscreen":
        return config.showFullscreenButton ? (
          <MiniToolbarButton
            tooltipSide={side}
            label={
              isNativeFullscreen
                ? "Exit fullscreen"
                : fullscreenAvailable
                  ? "Fullscreen"
                  : "Fullscreen — storefront only"
            }
            onClick={toggleFullscreen}
          >
            {isNativeFullscreen ? <Minimize /> : <Maximize />}
          </MiniToolbarButton>
        ) : null;
      case "screenshot":
        return config.showScreenshotButton ? (
          <MiniToolbarButton
            tooltipSide={side}
            label="Capture and download image"
            onClick={captureSnapshot}
          >
            <Camera />
          </MiniToolbarButton>
        ) : null;
      case "ar":
        // Gated on the device being able to enter AR rather than on a setting
        // of its own — see the matching note in viewer-3d.js. Never visible in
        // the Shopify admin: that preview is a cross-origin iframe without
        // allow="xr-spatial-tracking". Where the device can't enter AR but is
        // a desktop, the same control opens a QR code of the page instead
        // (arShareUrl), since the admin's own address is no use on a phone.
        if (arAvailable) {
          return (
            <MiniToolbarButton
              tooltipSide={side}
              label="View in your room"
              onClick={() => {
                track("ar");
                view3dRef.current?.ar
                  ?.enter?.()
                  .catch((err: unknown) =>
                    console.warn("[preview] could not enter AR:", err),
                  );
              }}
            >
              <Box />
            </MiniToolbarButton>
          );
        }
        if (arQr) {
          return (
            <MiniToolbarButton
              tooltipSide={side}
              label="View in your room on your phone"
              onClick={() => {
                if (arQrOpen) {
                  closeArQr();
                  return;
                }
                arQrReturnFocusRef.current =
                  document.activeElement as HTMLElement | null;
                track("ar");
                setArQrOpen(true);
              }}
            >
              <Box />
            </MiniToolbarButton>
          );
        }
        return null;
      case "animation":
        if (!config.showAnimationSelector || clipNames.length === 0)
          return null;
        return (
          <Tooltip>
            <div className="relative">
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setListOpen((v) => !v)}
                  aria-label="Choose animation"
                  aria-haspopup="listbox"
                  aria-expanded={listOpen}
                  className={cn(
                    "preview-toolbar-btn flex h-9 max-w-32 items-center gap-1.5 border border-black/10 bg-white px-3 text-xs text-black/80 shadow-md outline-none transition-colors hover:bg-primary hover:text-white focus-visible:bg-primary focus-visible:text-white focus-visible:ring-2 focus-visible:ring-black/30 focus-visible:ring-offset-1 focus-visible:ring-offset-white",
                    listOpen && "bg-black/5 text-black",
                  )}
                >
                  {activeClipIndex !== -1 && (
                    <span className="relative flex size-1.5 shrink-0">
                      <span className="absolute inline-flex size-full animate-ping bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex size-1.5 bg-emerald-500" />
                    </span>
                  )}
                  {/*
                          Keyed on the active index so React remounts it when the
                          selection changes, which restarts the wipe-in animation
                          app.css puts on .preview-animation-label.
                        */}
                  <span
                    key={activeClipIndex}
                    className="preview-animation-label truncate"
                  >
                    {activeClipIndex === -1
                      ? "None"
                      : clipNames[activeClipIndex]}
                  </span>
                  {listOpen ? (
                    <ChevronUp className="size-3.5 shrink-0 opacity-70" />
                  ) : (
                    <ChevronDown className="size-3.5 shrink-0 opacity-70" />
                  )}
                </button>
              </TooltipTrigger>
              {!listOpen && (
                <TooltipContent side={sideFor(slot)} sideOffset={8}>
                  Choose animation
                </TooltipContent>
              )}
              {/*
                      Always mounted, shown by the `is-open` class — see app.css.
                      Conditionally rendering it meant it could only animate open,
                      never closed.
                    */}
              <div
                ref={animationListRef}
                role="listbox"
                className={cn(
                  "preview-animation-popup absolute z-10 w-44 max-w-[70vw] overflow-hidden bg-white text-sm shadow-lg ring-1 ring-black/10",
                  listOpen && "is-open",
                  ANIMATION_POPUP_ANCHOR_CLASSES[slot],
                )}
              >
                <div className="preview-animation-popup-items overflow-y-auto p-1.5">
                  <button
                    type="button"
                    role="option"
                    aria-selected={activeClipIndex === -1}
                    onClick={() => selectClip(-1)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors duration-150 hover:bg-primary hover:text-white",
                      activeClipIndex === -1
                        ? "text-emerald-600 font-medium"
                        : "text-black/80",
                    )}
                  >
                    None
                  </button>
                  {clipNames.map((name, idx) => (
                    <button
                      key={idx}
                      type="button"
                      role="option"
                      aria-selected={idx === activeClipIndex}
                      onClick={() => {
                        // Picking a clip, as the storefront counts it.
                        track("f_animation");
                        selectClip(idx);
                      }}
                      className={cn(
                        "group flex w-full items-center gap-2 truncate rounded px-2 py-1.5 text-left transition-colors duration-150 hover:bg-primary hover:text-white",
                        idx === activeClipIndex
                          ? "text-emerald-600 font-medium"
                          : "text-black/80",
                      )}
                    >
                      {/* Dimmed normally, full strength on the brand fill —
                                70% white on primary is muddy. Mirrors the
                                storefront rule for .viewer-3d-animation-list-index. */}
                      <span className="tabular-nums text-xs opacity-70 shrink-0 group-hover:opacity-100">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span className="truncate">{name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Tooltip>
        );
    }
  }

  const viewer = (
    <div
      ref={elRef}
      data-placing={placingHotspot ? "" : undefined}
      className={cn(
        // `rounded-lg` is inert — the app-wide border-radius reset in app.css
        // wins from inside a cascade layer (see the note there). The viewer is
        // square-cornered, and the storefront widget matches it.
        "relative overflow-hidden rounded-lg border shadow-sm view3d-wrapper",
        isNativeFullscreen && "border-0 shadow-none",
        className,
      )}
      style={
        {
          height: isNativeFullscreen
            ? undefined
            : fill
              ? "100%"
              : config.height,
          background: bgIsColor ? config.background : "#ffffff",
          // Read by app.css to cap the animation list's height to the room left
          // inside the viewer, the same way the storefront widget does — the
          // wrapper clips its overflow, so on a short viewer an unconstrained
          // list would be cut off at the edge.
          "--viewer-height": fill ? "100vh" : `${config.height}px`,
        } as React.CSSProperties
      }
    >
      {/*
        Keyed by initKey so React mounts a brand new <canvas> DOM node for
        every reinit. three.js's renderer.dispose() never actually calls
        WEBGL_lose_context, so reusing the same canvas element across
        `new View3D(...)` calls makes the browser hand back the same
        (now-inconsistent) WebGL context instead of a fresh one — that stale
        context is what causes the canvas to render solid white/black and
        never recover until a full page reload replaces the canvas element.
      */}
      <canvas key={initKey} className="view3d-canvas" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 border bg-background/95 px-3.5 py-2 shadow-sm">
            <Loader2 className="size-4 animate-spin text-primary" />
            <span className="text-xs font-medium text-muted-foreground">
              Loading model…
            </span>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-destructive/5 p-4 text-center">
          <AlertTriangle className="size-5 text-destructive" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}
      {/*
        Same role as the App Bridge toast, for contexts that have no App Bridge
        (the public /viewer/:id page). Non-interactive and self-clearing, so it
        can't get in the way of the model.
      */}
      {notice && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center p-3">
          <p className="max-w-md border bg-background/95 px-3.5 py-2 text-center text-xs font-medium text-foreground shadow-md">
            {notice}
          </p>
        </div>
      )}
      {arranging && onLayoutChange && (
        <ControlLayoutEditor
          config={config}
          onChange={onLayoutChange}
          onDone={() => setArranging(false)}
        />
      )}
      {!loading && !error && !arranging && (
        <TooltipProvider delayDuration={200}>
          {/*
              One bar per spot that has something to show, holding its controls
              in the order the merchant arranged them (config.controlsLayout,
              set by dragging in ControlLayoutEditor). A spot whose controls are
              all switched off renders nothing at all.
            */}
          {CONTROL_SLOTS.map((slot) => {
            const nodes = config.controlsLayout[slot].flatMap((id) => {
              const node = renderControl(id, slot);
              return node ? [<Fragment key={id}>{node}</Fragment>] : [];
            });
            if (nodes.length === 0) return null;
            return (
              <div
                key={slot}
                className={cn(
                  "preview-toolbar absolute z-10 flex items-center gap-2",
                  "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 duration-200",
                  barClasses(slot),
                )}
              >
                {nodes}
              </div>
            );
          })}
          {arQrOpen && arQr && (
            <div
              role="dialog"
              aria-label="View in your room on your phone"
              className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 p-2 animate-in fade-in-0 duration-150"
              onClick={(e) => {
                if (e.target === e.currentTarget) closeArQr();
              }}
              // Keep presses on the overlay from reaching view3d's controls.
              onPointerDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              <div className="flex max-h-full max-w-full flex-col items-center overflow-auto border border-black/10 bg-white px-5 py-4 text-center shadow-lg">
                <svg
                  viewBox={`0 0 ${arQr.size} ${arQr.size}`}
                  shapeRendering="crispEdges"
                  role="img"
                  aria-label="QR code"
                  className="size-40 shrink-0"
                >
                  <rect width={arQr.size} height={arQr.size} fill="#ffffff" />
                  <path d={arQr.d} fill="#000000" />
                </svg>
                <p className="mt-2.5 max-w-[200px] text-sm font-semibold text-black/80">
                  View in your room
                </p>
                <p className="mt-0.5 max-w-[200px] text-xs text-black/60">
                  Scan with your phone&rsquo;s camera to see this in AR.
                </p>
              </div>
              <div className="absolute right-2 top-2">
                <MiniToolbarButton
                  label="Close"
                  tooltipSide="bottom"
                  onClick={closeArQr}
                >
                  <X />
                </MiniToolbarButton>
              </div>
            </div>
          )}
          {/*
              Dedicated close button in the top-right corner, shown only while
              fullscreen is active. Mirrors the storefront widget's, which is
              driven by CSS off :fullscreen — here the render is already
              conditional, so a class isn't needed.
            */}
          {isNativeFullscreen && config.showFullscreenButton && (
            <div
              className={cn(
                "preview-toolbar absolute z-10 flex items-center gap-2",
                "animate-in fade-in-0 zoom-in-95 duration-200",
                barClasses(closeSlot),
              )}
            >
              <MiniToolbarButton
                label="Exit fullscreen"
                onClick={toggleFullscreen}
                tooltipSide={sideFor(closeSlot)}
              >
                <X />
              </MiniToolbarButton>
            </div>
          )}
        </TooltipProvider>
      )}
    </div>
  );

  if (!onLayoutChange) return viewer;
  return (
    <div className="flex flex-col gap-2">
      {viewer}
      <div className="flex justify-end">
        <s-button
          variant={arranging ? "primary" : "secondary"}
          icon="drag-handle"
          disabled={isNativeFullscreen ? true : undefined}
          onClick={() => setArranging((v) => !v)}
        >
          {arranging ? "Done moving controls" : "Move controls"}
        </s-button>
      </div>
    </div>
  );
}
