/*
 * Hotspots: numbered points pinned to a 3D model, each opening a small card
 * (title, description, optional link) and turning the camera to face it.
 *
 * Stored inside the model's viewer config (see viewer-config.ts), so every
 * place a config already reaches — the product block, the page block via the
 * library, the /viewer/:id embed — gets them without a sync of its own.
 *
 * Rendered with view3d's own annotations (FaceAnnotation / PointAnnotation),
 * which the admin bundle and the storefront's view3d.pkgd.min.js (both 2.10.1)
 * already contain: positioned every frame, pinned to a mesh face so they move
 * with animation, and with a built-in camera "focus" on open. The element
 * inside each one is built here with textContent — view3d's own default
 * element sets its label with innerHTML, which would run markup a merchant
 * typed on their storefront.
 *
 * The storefront widget (extensions/viewer-3d/assets/viewer-3d.js) cannot
 * import this file and mirrors sanitizeHotspots and the element markup by hand.
 */

export const MAX_HOTSPOTS = 20;
export const MAX_TITLE = 60;
export const MAX_DESCRIPTION = 280;
export const MAX_LINK_LABEL = 40;
export const MAX_URL = 500;

export type HotspotImage = { url: string; alt: string };

/** YouTube / Vimeo by id; a video file (Shopify Files, or any https mp4/webm) by URL. */
export type HotspotVideo =
  | { kind: "youtube" | "vimeo"; id: string; url: "" }
  | {
      kind: "file";
      id: "";
      url: string;
      /**
       * A still from the video, shown on the card before play: Shopify's own
       * preview frame for a file from Shopify Files. Without one, the card
       * shows the video's first frame instead (primeHotspotVideoFrames).
       */
      poster?: string;
    };

/**
 * A product to sell from the hotspot. A snapshot for display in the admin and
 * as a fallback; the storefront refreshes price and stock live from
 * /products/<handle>.js when the card opens, so a changed price is never
 * shown stale to a shopper.
 */
export type HotspotProduct = {
  /** Numeric ids, not gids: they go straight into cart URLs. */
  id: string;
  variantId: string;
  handle: string;
  title: string;
  imageUrl: string;
  /** Display snapshot, e.g. "29.99". */
  price: string;
  addToCart: boolean;
  buyNow: boolean;
};

export type Hotspot = {
  /** Stable, for editing and for analytics. */
  id: string;
  title: string;
  description: string;
  linkLabel: string;
  linkUrl: string;
  /**
   * Where it sits. A mesh face (meshIndex/faceIndex/weights — moves with
   * animation) when the click landed on the model; otherwise a fixed point.
   */
  meshIndex: number;
  faceIndex: number;
  weights: [number, number, number];
  position: [number, number, number] | null;
  /** Camera pose when opened: [yaw, pitch, zoom], captured at placement. */
  focus: [number, number, number];
  image: HotspotImage | null;
  video: HotspotVideo | null;
  product: HotspotProduct | null;
};

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const num = (v: unknown, fallback = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const triple = (
  v: unknown,
  fallback: [number, number, number],
): [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n))
    ? [v[0], v[1], v[2]]
    : fallback;

/**
 * A link a shopper may follow: https, or a path on the store itself. Anything
 * else (javascript:, data:, http:) is dropped rather than rendered.
 */
export function safeHotspotUrl(raw: unknown): string {
  const url = str(raw, MAX_URL);
  if (!url) return "";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    return new URL(url).protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}

/** An https image URL, or nothing. */
export function safeImageUrl(raw: unknown): string {
  const url = str(raw, MAX_URL);
  try {
    return url && new URL(url).protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}

/**
 * Reads a pasted video link into something embeddable: a YouTube or Vimeo id,
 * or an https video file. Anything else is not a video this can play.
 */
export function parseVideoUrl(raw: unknown): HotspotVideo | null {
  const url = str(raw, MAX_URL);
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return /^[\w-]{11}$/.test(id) ? { kind: "youtube", id, url: "" } : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const id =
      u.searchParams.get("v") ??
      u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1] ??
      "";
    return /^[\w-]{11}$/.test(id) ? { kind: "youtube", id, url: "" } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = u.pathname.match(/(\d{6,12})/)?.[1] ?? "";
    return id ? { kind: "vimeo", id, url: "" } : null;
  }
  if (/\.(mp4|webm|mov|m4v)$/i.test(u.pathname) || host === "cdn.shopify.com") {
    return { kind: "file", id: "", url };
  }
  return null;
}

/** The link a merchant would recognise, for showing a stored video back. */
export function videoDisplayUrl(v: HotspotVideo | null): string {
  if (!v) return "";
  if (v.kind === "youtube") return `https://www.youtube.com/watch?v=${v.id}`;
  if (v.kind === "vimeo") return `https://vimeo.com/${v.id}`;
  return v.url;
}

function sanitizeVideo(raw: unknown): HotspotVideo | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (v.kind === "youtube" && /^[\w-]{11}$/.test(String(v.id))) {
    return { kind: "youtube", id: String(v.id), url: "" };
  }
  if (v.kind === "vimeo" && /^\d{6,12}$/.test(String(v.id))) {
    return { kind: "vimeo", id: String(v.id), url: "" };
  }
  if (v.kind === "file") {
    const parsed = parseVideoUrl(v.url);
    if (parsed?.kind !== "file") return null;
    const poster = safeImageUrl(v.poster);
    return poster ? { ...parsed, poster } : parsed;
  }
  return null;
}

function sanitizeProduct(raw: unknown): HotspotProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const numeric = (v: unknown) => {
    const m = String(v ?? "").match(/(\d{1,20})$/);
    return m ? m[1] : "";
  };
  const id = numeric(p.id);
  const variantId = numeric(p.variantId);
  const handle = str(p.handle, 255);
  if (!id || !variantId || !/^[a-z0-9][a-z0-9-]*$/i.test(handle)) return null;
  return {
    id,
    variantId,
    handle,
    title: str(p.title, 120) || handle,
    imageUrl: safeImageUrl(p.imageUrl),
    price: str(p.price, 20).replace(/[^\d.,]/g, ""),
    addToCart: p.addToCart !== false,
    buyNow: p.buyNow === true,
  };
}

let counter = 0;
export function newHotspotId(): string {
  counter += 1;
  return `h${Date.now().toString(36)}${counter.toString(36)}`;
}

/** Validates and clamps stored hotspots; anything malformed is dropped. */
export function sanitizeHotspots(raw: unknown): Hotspot[] {
  if (!Array.isArray(raw)) return [];
  const out: Hotspot[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_HOTSPOTS) break;
    if (!item || typeof item !== "object") continue;
    const h = item as Record<string, unknown>;
    const title = str(h.title, MAX_TITLE);
    const meshIndex = Math.floor(num(h.meshIndex, -1));
    const faceIndex = Math.floor(num(h.faceIndex, -1));
    const position =
      Array.isArray(h.position) &&
      h.position.length === 3 &&
      h.position.every((n) => Number.isFinite(n))
        ? ([h.position[0], h.position[1], h.position[2]] as [
            number,
            number,
            number,
          ])
        : null;
    const onFace = meshIndex >= 0 && faceIndex >= 0;
    // A hotspot that is nowhere is not a hotspot.
    if (!onFace && !position) continue;
    let id = str(h.id, 40).replace(/[^\w-]/g, "") || newHotspotId();
    if (seen.has(id)) id = newHotspotId();
    seen.add(id);
    const linkUrl = safeHotspotUrl(h.linkUrl);
    out.push({
      id,
      title: title || `Hotspot ${out.length + 1}`,
      description: str(h.description, MAX_DESCRIPTION),
      linkLabel: linkUrl ? str(h.linkLabel, MAX_LINK_LABEL) : "",
      linkUrl,
      meshIndex: onFace ? meshIndex : -1,
      faceIndex: onFace ? faceIndex : -1,
      weights: triple(h.weights, [1 / 3, 1 / 3, 1 / 3]),
      position,
      focus: triple(h.focus, [0, 0, 0]),
      image: (() => {
        const img = h.image as Record<string, unknown> | null | undefined;
        const url = safeImageUrl(img?.url);
        return url ? { url, alt: str(img?.alt, 200) } : null;
      })(),
      video: sanitizeVideo(h.video),
      product: sanitizeProduct(h.product),
    });
  }
  return out;
}

/** A hex colour for the markers, or the default. */
export function sanitizeHotspotColor(raw: unknown): string {
  return typeof raw === "string" && /^#[0-9a-f]{6}$/i.test(raw)
    ? raw
    : DEFAULT_HOTSPOT_COLOR;
}

export const DEFAULT_HOTSPOT_COLOR = "#2a78d6";

/** What the pin shows: its number, or the hotspot's title as a pill. */
export const HOTSPOT_LABELS = ["number", "title"] as const;
export type HotspotLabel = (typeof HOTSPOT_LABELS)[number];

/** What opens the card: a click/tap, or (with a mouse) hovering the pin. */
export const HOTSPOT_TRIGGERS = ["click", "hover"] as const;
export type HotspotTrigger = (typeof HOTSPOT_TRIGGERS)[number];

/** Where the card is rendered: decides whether the shop buttons can work. */
export type HotspotCommerce =
  /** The storefront itself: same origin as the cart. */
  | "live"
  /** Admin preview or the /viewer/:id embed: no cart on this origin. */
  | "preview";

/**
 * The marker and card for one hotspot, as DOM. Shared shape with the
 * storefront's buildHotspotEl in viewer-3d.js — same classes, same CSS.
 * Text only via textContent; URLs only after the safe* checks above.
 *
 * Heavy media is deferred: the image is lazy, and a video is a thumbnail with
 * a play button until pressed (see activateHotspotVideo) — a page with twenty
 * hotspots must not open twenty players.
 */
export function buildHotspotElement(
  h: Hotspot,
  index: number,
  color: string,
  onPreviewCommerce?: () => void,
  label: HotspotLabel = "number",
): HTMLElement {
  const el = document.createElement("div");
  // view3d's classes, for its flip-x / flip-y / selected / hidden toggles;
  // not its "default" class, whose stock styling this replaces.
  el.className = "view3d-annotation e3d-hotspot";
  if (label === "title") el.classList.add("e3d-hotspot--title");
  el.style.setProperty("--e3d-hotspot", color);
  el.dataset.hotspotId = h.id;

  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = "e3d-hotspot-pin";
  pin.textContent = label === "title" ? h.title : String(index + 1);
  pin.setAttribute("aria-label", `Hotspot ${index + 1}: ${h.title}`);
  el.appendChild(pin);

  const card = document.createElement("div");
  card.className = "view3d-annotation-tooltip e3d-hotspot-card";
  if (h.image || h.video || h.product)
    card.classList.add("e3d-hotspot-card--rich");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", h.title);

  if (h.video) card.appendChild(buildVideo(h.video));
  else if (h.image) card.appendChild(buildImage(h.image));

  const title = document.createElement("div");
  title.className = "e3d-hotspot-title";
  title.textContent = h.title;
  card.appendChild(title);

  if (h.description) {
    const body = document.createElement("div");
    body.className = "e3d-hotspot-text";
    body.textContent = h.description;
    card.appendChild(body);
  }

  // An image alongside a video goes under the text rather than competing
  // with the player for the top of the card.
  if (h.video && h.image) card.appendChild(buildImage(h.image));

  const url = safeHotspotUrl(h.linkUrl);
  if (url) {
    const a = document.createElement("a");
    a.className = "e3d-hotspot-link";
    a.href = url;
    a.textContent = h.linkLabel || "Learn more";
    if (!url.startsWith("/")) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    card.appendChild(a);
  }

  if (h.product) card.appendChild(buildProduct(h.product, onPreviewCommerce));
  // view3d cancels wheel events on the whole annotation (so scrolling over a
  // pin never zooms the model) — which also stops a tall card scrolling.
  // Scrolled by hand instead.
  card.addEventListener(
    "wheel",
    (e) => {
      card.scrollTop += e.deltaY;
    },
    { passive: true },
  );
  el.appendChild(card);
  return el;
}

/**
 * Hover to open: a mouse resting on the pin opens the card, and leaving the
 * pin and card closes it after a short grace period (long enough to cross the
 * gap between them). Opens without the camera turn — the camera moving would
 * drag the pin out from under the pointer — by calling view3d's own
 * _onFocus, which marks it selected and fires annotationFocus like a click.
 * Touch has no hover, so a tap still opens it the usual way; `canHover` lets
 * the storefront fall back to click when it would show the card as a sheet.
 * Mirrored by wireHsHover in viewer-3d.js.
 */
export function wireHotspotHover(
  el: HTMLElement,
  get: () => any,
  canHover: () => boolean = () => true,
) {
  let timer: number | undefined;
  el.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "mouse" || !canHover()) return;
    window.clearTimeout(timer);
    const annotation = get();
    if (annotation && !annotation.focusing) {
      // No camera turn to undo when it closes; see resetViewOnHotspotClose.
      annotation[HOVER_OPENED] = true;
      annotation._onFocus?.();
    }
  });
  el.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse") return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const annotation = get();
      if (annotation?.focusing) annotation.unfocus();
    }, 250);
  });
}

/** Set on an annotation opened by hover, which never turned the camera. */
const HOVER_OPENED = "__e3dHoverOpened";

/**
 * Closing a hotspot's card glides the camera back to the starting view — the
 * same reset as the toolbar's Reset view — undoing the turn that opening it
 * made. Not when:
 * - another hotspot opened in the same click (view3d closes the old one, then
 *   opens the new one; resetting would swing away from the new one),
 * - the shopper dragged the model (view3d closes the card as soon as the model
 *   is grabbed; resetting would undo the angle they just turned to). A press
 *   that turns out to be a click, with no camera movement, still resets,
 * - the card was opened by hover, which never moved the camera.
 * Returns a cleanup. Mirrored by resetViewOnHsClose in viewer-3d.js.
 */
export function resetViewOnHotspotClose(view3d: any): () => void {
  let holding = false;
  let pending = false;
  let holdPose: number[] | null = null;
  const pose = () => {
    const p = view3d.camera?.currentPose;
    return p ? [p.yaw, p.pitch, p.zoom] : null;
  };
  const reset = () => {
    const list: any[] = view3d.annotation?.list ?? [];
    if (list.some((a) => a.focusing)) return;
    view3d.camera?.reset?.(500);
  };
  const onHold = () => {
    holding = true;
    holdPose = pose();
  };
  const onRelease = () => {
    holding = false;
    if (!pending) return;
    pending = false;
    const now = pose();
    const moved =
      !holdPose || !now || now.some((v, i) => Math.abs(v - holdPose![i]) > 0.5);
    if (!moved) reset();
  };
  const controls: any[] = view3d.control?.controls ?? [];
  controls.forEach((c) => {
    c.on?.("hold", onHold);
    c.on?.("release", onRelease);
  });
  const onUnfocus = (evt: any) => {
    const annotation = evt?.annotation;
    const hovered = !!annotation?.[HOVER_OPENED];
    if (annotation) annotation[HOVER_OPENED] = false;
    if (hovered) return;
    // After the event that closed it has finished: by then a pin pressed in
    // the same click has opened, and a press on the model has reported its
    // hold — whose release then decides between a click and a drag.
    window.setTimeout(() => {
      if (holding) pending = true;
      else reset();
    }, 0);
  };
  view3d.on?.("annotationUnfocus", onUnfocus);
  return () => {
    view3d.off?.("annotationUnfocus", onUnfocus);
    controls.forEach((c) => {
      c.off?.("hold", onHold);
      c.off?.("release", onRelease);
    });
  };
}

function buildImage(image: HotspotImage): HTMLElement {
  const img = document.createElement("img");
  img.className = "e3d-hotspot-media";
  img.src = image.url;
  img.alt = image.alt;
  img.loading = "lazy";
  img.decoding = "async";
  return img;
}

function buildVideo(video: HotspotVideo): HTMLElement {
  const box = document.createElement("div");
  box.className = "e3d-hotspot-video";
  box.dataset.kind = video.kind;
  box.dataset.src = video.kind === "file" ? video.url : video.id;
  const poster =
    video.kind === "youtube"
      ? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`
      : video.kind === "file"
        ? safeImageUrl(video.poster)
        : "";
  if (poster) {
    box.dataset.poster = poster;
    box.style.backgroundImage = `url("${poster}")`;
  }
  const play = document.createElement("button");
  play.type = "button";
  play.className = "e3d-hotspot-play";
  play.setAttribute("aria-label", "Play video");
  play.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
  play.addEventListener("click", (e) => {
    e.stopPropagation();
    activateHotspotVideo(box);
  });
  box.appendChild(play);
  return box;
}

/** Swaps a video's thumbnail for the real player, on demand. */
export function activateHotspotVideo(box: HTMLElement) {
  const kind = box.dataset.kind;
  const src = box.dataset.src ?? "";
  box.textContent = "";
  box.style.backgroundImage = "";
  if (kind === "file") {
    const video = document.createElement("video");
    if (box.dataset.poster) video.poster = box.dataset.poster;
    video.src = src;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    box.appendChild(video);
    return;
  }
  const iframe = document.createElement("iframe");
  iframe.src =
    kind === "youtube"
      ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(src)}?autoplay=1&rel=0&playsinline=1`
      : `https://player.vimeo.com/video/${encodeURIComponent(src)}?autoplay=1`;
  iframe.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
  // YouTube refuses to play without a Referer ("Error 153: video player
  // configuration error"), and the page's own policy may withhold it: hosting
  // panels commonly add `Referrer-Policy: same-origin` (see DEPLOY-VPS.md),
  // which sends none cross-origin. The browser default, set on the frame, wins
  // over the page's. Same as the dashboard's tutorial embed.
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.allowFullscreen = true;
  iframe.title = "Video";
  box.appendChild(iframe);
}

/**
 * A file video with no poster shows its own first frame instead of a blank
 * box: a muted, metadata-only <video> behind the play button. Called when a
 * card opens, not when it is built, so a page with many hotspots does not
 * fetch from every video at load. `#t=0.1` makes iOS Safari paint a frame.
 */
export function primeHotspotVideoFrames(root: HTMLElement) {
  root
    .querySelectorAll<HTMLElement>(
      '.e3d-hotspot-video[data-kind="file"]:not([data-poster])',
    )
    .forEach((box) => {
      if (box.querySelector("video, iframe")) return;
      const frame = document.createElement("video");
      frame.className = "e3d-hotspot-frame";
      frame.muted = true;
      frame.playsInline = true;
      frame.preload = "metadata";
      frame.setAttribute("aria-hidden", "true");
      frame.src = `${(box.dataset.src ?? "").split("#")[0]}#t=0.1`;
      box.insertBefore(frame, box.firstChild);
    });
}

/** Stops any playing video in a card by putting the thumbnail back. */
export function resetHotspotVideos(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".e3d-hotspot-video").forEach((box) => {
    if (!box.querySelector("iframe, video:not(.e3d-hotspot-frame)")) return;
    const fresh = buildVideo(
      box.dataset.kind === "file"
        ? {
            kind: "file",
            id: "",
            url: box.dataset.src ?? "",
            poster: box.dataset.poster ?? "",
          }
        : {
            kind: box.dataset.kind as "youtube" | "vimeo",
            id: box.dataset.src ?? "",
            url: "",
          },
    );
    box.replaceWith(fresh);
  });
}

function buildProduct(
  product: HotspotProduct,
  onPreviewCommerce?: () => void,
): HTMLElement {
  const box = document.createElement("div");
  box.className = "e3d-hotspot-product";
  box.dataset.handle = product.handle;
  box.dataset.variantId = product.variantId;

  const row = document.createElement("div");
  row.className = "e3d-hotspot-product-row";
  if (product.imageUrl) {
    const img = document.createElement("img");
    img.src = product.imageUrl;
    img.alt = "";
    img.loading = "lazy";
    row.appendChild(img);
  }
  const info = document.createElement("div");
  const name = document.createElement("div");
  name.className = "e3d-hotspot-product-title";
  name.textContent = product.title;
  const price = document.createElement("div");
  price.className = "e3d-hotspot-product-price";
  price.textContent = product.price;
  info.append(name, price);
  row.appendChild(info);
  box.appendChild(row);

  if (product.addToCart || product.buyNow) {
    const actions = document.createElement("div");
    actions.className = "e3d-hotspot-actions";
    const add = (label: string, cls: string, action: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `e3d-hotspot-btn ${cls}`;
      b.dataset.action = action;
      b.textContent = label;
      // Outside the storefront there is no cart to add to; say so instead.
      if (onPreviewCommerce) {
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          onPreviewCommerce();
        });
      }
      actions.appendChild(b);
    };
    if (product.addToCart)
      add("Add to cart", "e3d-hotspot-btn--primary", "add");
    if (product.buyNow) add("Buy now", "e3d-hotspot-btn--secondary", "buy");
    box.appendChild(actions);
  }
  // Mirrors the storefront's link to the full product page. Outside the
  // storefront there is no product page on this origin, so it explains.
  const view = document.createElement("a");
  view.className = "e3d-hotspot-product-link";
  view.href = `/products/${encodeURIComponent(product.handle)}?variant=${encodeURIComponent(product.variantId)}`;
  view.textContent = "View product →";
  if (onPreviewCommerce) {
    view.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onPreviewCommerce();
    });
  }
  box.appendChild(view);
  return box;
}

/**
 * Fits an opening card inside the viewer.
 *
 * view3d decides whether a card opens upward (flip-y) or leftward (flip-x)
 * from a size it measured once, when the annotation was created — before the
 * element was on the page, so it measured 0 and a tall card (image, product)
 * ran off the bottom of the viewer. So, when a card opens: cap its height to
 * the larger of the space above or below its pin, then have view3d measure it
 * again so its flip check sees the real size. Re-measured once more after any
 * image inside it loads.
 */
export function fitHotspotCard(annotation: any, root: HTMLElement) {
  const el: HTMLElement | undefined = annotation?.element;
  const card = el?.querySelector<HTMLElement>(".e3d-hotspot-card");
  if (!el || !card) return;
  const box = root.getBoundingClientRect();
  const pin = el.getBoundingClientRect();
  const above = pin.top - box.top - 12;
  const below = box.bottom - pin.bottom - 12;
  card.style.maxHeight = `${Math.max(120, Math.max(above, below))}px`;
  annotation.resize?.();
  card.querySelectorAll("img").forEach((img) => {
    if (!img.complete) {
      img.addEventListener("load", () => annotation.resize?.(), { once: true });
    }
  });
}
