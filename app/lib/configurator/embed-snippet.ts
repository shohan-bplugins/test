/*
 * The iframe embed code for the Product configurator, for themes that can't
 * take app blocks. Client-safe: the product page renders it for copying.
 *
 * The iframe shows the app proxy page (routes/proxy.configurator.$handle.tsx)
 * from the shop's own domain. The script beside it:
 *  - fetches that page — with the page's language and ?variant= so the
 *    configurator opens on what the shopper was looking at — and loads it as the
 *    iframe's srcdoc. Not as its src: Shopify sends `frame-ancestors 'none'` /
 *    `X-Frame-Options: DENY` on password-protected storefronts (every
 *    development store), which refuses a framed src even on the same domain. A
 *    srcdoc document carries no response headers, keeps the shop's origin (so
 *    /cart/add.js still uses the shopper's cart) and resolves relative URLs
 *    against the page around it;
 *  - grows the iframe to its content's height (the page posts it);
 *  - after "Add to cart", refreshes the theme's cart count, or opens the cart
 *    page when data-after-add="cart".
 * Safe to paste more than once on a page: the script boots once and handles
 * every embed.
 */

export const EMBED_PATH = "/apps/viewer-3d/configurator/";

// ES5 on purpose: it runs inside whatever theme it is pasted into.
const SCRIPT = `<script>
(function () {
  function root() { return (window.Shopify && Shopify.routes && Shopify.routes.root) || "/"; }
  function boot() {
    var frames = document.querySelectorAll("iframe[data-e3d-embed]:not([data-e3d-loading])");
    for (var i = 0; i < frames.length; i++) load(frames[i]);
  }
  function load(f) {
    f.setAttribute("data-e3d-loading", "");
    var u = new URL(f.getAttribute("data-src"), location.href);
    var lang = document.documentElement.lang;
    var variant = new URLSearchParams(location.search).get("variant");
    if (lang && !u.searchParams.has("lang")) u.searchParams.set("lang", lang);
    if (variant && !u.searchParams.has("variant")) u.searchParams.set("variant", variant);
    fetch(u.toString(), { credentials: "same-origin", headers: { Accept: "text/html" } })
      .then(function (r) { return r.text(); })
      .then(function (html) { f.srcdoc = html; })
      .catch(function () {
        f.srcdoc = '<p style="font-family:system-ui,sans-serif;color:#666;padding:16px">Could not load the product configurator.</p>';
      });
  }
  if (window.__e3dEmbed) return window.__e3dEmbed();
  window.__e3dEmbed = boot;
  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin || !e.data || typeof e.data.type !== "string") return;
    var frames = document.querySelectorAll("iframe[data-e3d-embed]"), frame = null;
    for (var i = 0; i < frames.length; i++) if (frames[i].contentWindow === e.source) frame = frames[i];
    if (!frame) return;
    if (e.data.type === "e3d:height" && e.data.height > 0) frame.style.height = e.data.height + "px";
    if (e.data.type !== "e3d:cart-added") return;
    if (frame.getAttribute("data-after-add") === "cart") { location.href = root() + "cart"; return; }
    document.dispatchEvent(new CustomEvent("cart:refresh", { bubbles: true }));
    fetch(root() + "cart.js").then(function (r) { return r.json(); }).then(function (cart) {
      var els = document.querySelectorAll("[data-cart-count], .cart-count, #CartCount, .cart-count-bubble span[aria-hidden], .cart-link__bubble-num");
      for (var i = 0; i < els.length; i++) els[i].textContent = cart.item_count;
      document.dispatchEvent(new CustomEvent("cart:updated", { bubbles: true, detail: { cart: cart } }));
    }).catch(function () {});
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
</script>`;

/** Every Product configurator setting the embed takes, plus its width. */
export type EmbedOptions = {
  /** Gallery opens on the 3D model or the variant image. */
  media: "3d" | "image";
  /** Gallery height, px (300–800). */
  height: number;
  /** 3D background colour, #rrggbb. */
  bg: string;
  position: "left" | "right";
  variantStyle: "pills" | "dropdown";
  vendor: boolean;
  sku: boolean;
  quantity: boolean;
  buyNow: boolean;
  description: boolean;
  /** After "Add to cart": update the page's cart count, or open the cart page. */
  afterAdd: "update" | "cart";
  /** Fill the container, or a custom maximum width (centred). */
  width: "full" | "custom";
  /** Maximum width when `width` is "custom". */
  maxWidth: number;
  maxWidthUnit: "px" | "%";
};

/** The block's own defaults; a setting left at its default stays out of the URL. */
export const DEFAULT_EMBED_OPTIONS: EmbedOptions = {
  media: "3d",
  height: 550,
  bg: "#ffffff",
  position: "left",
  variantStyle: "pills",
  vendor: false,
  sku: false,
  quantity: true,
  buyNow: true,
  description: true,
  afterAdd: "update",
  width: "full",
  maxWidth: 1200,
  maxWidthUnit: "px",
};

const clamp = (n: number, lo: number, hi: number, fallback: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;

/** The page's query string (read by proxy.configurator.$handle.tsx). */
function embedQuery(o: EmbedOptions): string {
  const d = DEFAULT_EMBED_OPTIONS;
  const q = new URLSearchParams();
  const bool = (key: string, v: boolean, def: boolean) => {
    if (v !== def) q.set(key, v ? "1" : "0");
  };
  if (o.media !== d.media) q.set("media", o.media);
  const height = clamp(o.height, 300, 800, d.height);
  if (height !== d.height) q.set("height", String(height));
  const bg = /^#[0-9a-f]{6}$/i.test(o.bg) ? o.bg.toLowerCase() : d.bg;
  if (bg !== d.bg) q.set("bg", bg.slice(1));
  if (o.position !== d.position) q.set("position", o.position);
  if (o.variantStyle !== d.variantStyle) q.set("variant_style", o.variantStyle);
  bool("vendor", o.vendor, d.vendor);
  bool("sku", o.sku, d.sku);
  bool("quantity", o.quantity, d.quantity);
  bool("buy_now", o.buyNow, d.buyNow);
  bool("description", o.description, d.description);
  return q.toString();
}

/**
 * The code to paste. `handle` is a product handle, or `{{ product.handle }}` for
 * a theme's product template (one paste covers every product).
 */
export function buildConfiguratorEmbed(
  handle: string,
  options: Partial<EmbedOptions> = {},
): string {
  const o = { ...DEFAULT_EMBED_OPTIONS, ...options };
  const query = embedQuery(o);
  // Liquid stays readable; a literal handle is URL-encoded.
  const path = handle.includes("{{") ? handle : encodeURIComponent(handle);
  const maxWidth =
    o.maxWidthUnit === "%" ? clamp(o.maxWidth, 10, 100, 100) : clamp(o.maxWidth, 320, 4000, 1200);
  const width =
    o.width === "custom" ? `width:100%;max-width:${maxWidth}${o.maxWidthUnit};margin:0 auto;` : "width:100%;";
  return (
    `<iframe data-e3d-embed data-src="${EMBED_PATH}${path}${query ? `?${query}` : ""}"` +
    (o.afterAdd === "cart" ? ` data-after-add="cart"` : "") +
    ` title="Product configurator" loading="lazy"` +
    ` allow="fullscreen; xr-spatial-tracking; clipboard-write" allowfullscreen` +
    ` style="display:block;${width}height:900px;border:0"></iframe>\n` +
    SCRIPT
  );
}

/** Metafield key (namespace $app:configurator) holding a product's saved embed options. */
export const EMBED_KEY = "embed";

/**
 * Saved options -> EmbedOptions: unknown or invalid fields fall back to the
 * defaults, so an old or hand-edited value can never break the page.
 */
export function parseEmbedOptions(raw: unknown): EmbedOptions {
  let v: any = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      v = null;
    }
  }
  const d = DEFAULT_EMBED_OPTIONS;
  if (!v || typeof v !== "object") return { ...d };
  const pick = <T extends string>(val: unknown, allowed: readonly T[], def: T): T =>
    allowed.includes(val as T) ? (val as T) : def;
  const bool = (val: unknown, def: boolean) => (typeof val === "boolean" ? val : def);
  const num = (val: unknown, def: number) =>
    typeof val === "number" && Number.isFinite(val) ? val : def;
  return {
    media: pick(v.media, ["3d", "image"], d.media),
    height: num(v.height, d.height),
    bg: typeof v.bg === "string" && /^#[0-9a-f]{6}$/i.test(v.bg) ? v.bg : d.bg,
    position: pick(v.position, ["left", "right"], d.position),
    variantStyle: pick(v.variantStyle, ["pills", "dropdown"], d.variantStyle),
    vendor: bool(v.vendor, d.vendor),
    sku: bool(v.sku, d.sku),
    quantity: bool(v.quantity, d.quantity),
    buyNow: bool(v.buyNow, d.buyNow),
    description: bool(v.description, d.description),
    afterAdd: pick(v.afterAdd, ["update", "cart"], d.afterAdd),
    width: pick(v.width, ["full", "custom"], d.width),
    maxWidth: num(v.maxWidth, d.maxWidth),
    maxWidthUnit: pick(v.maxWidthUnit, ["px", "%"], d.maxWidthUnit),
  };
}
