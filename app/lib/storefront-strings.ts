/**
 * Shopper-facing viewer strings that the browser bundle can use: the English
 * defaults, the helpers, and the list of bundled languages.
 *
 * The English is a copy of extensions/viewer-3d/locales/en.default.json, which
 * stays the source of truth; npm run check-locales fails if the two drift. It
 * is copied, not imported, because client code cannot load anything from
 * extensions/: in `shopify app dev` the CLI's proxy claims every
 * /extensions/* URL for its own extension previews, so the browser gets a 404
 * and the page importing it fails to load. Other languages are only needed on
 * the server (storefront-i18n.server.ts), which reads the locale files
 * directly.
 */

export const DEFAULT_STOREFRONT_STRINGS = {
  zoom_in: "Zoom in",
  zoom_out: "Zoom out",
  reset: "Resets view",
  fullscreen: "Fullscreen",
  exit_fullscreen: "Exit fullscreen",
  capture: "Capture and download image",
  choose_animation: "Choose animation",
  animation_none: "None",
  loading: "Loading model…",
  load_failed: "Failed to load model",
  ar_view_in_room: "View in your room",
  ar_view_on_phone: "View in your room on your phone",
  ar_scan_qr: "Scan with your phone’s camera to see this in AR.",
  qr_code: "QR code",
  close: "Close",
  hotspot: "Hotspot",
  hotspot_n: "Hotspot {n}",
  hotspot_pin: "Hotspot {n}: {title}",
  learn_more: "Learn more",
  play_video: "Play video",
  video: "Video",
  add_to_cart: "Add to cart",
  buy_now: "Buy now",
  view_product: "View product →",
  option_n: "Option {n}",
  sold_out: "Sold out",
  unavailable: "Unavailable",
  adding: "Adding…",
  added: "Added ✓",
  added_to_cart: "Added to your cart",
  view_cart: "View cart",
  add_failed: "Could not add to cart",
};

export type StorefrontStrings = typeof DEFAULT_STOREFRONT_STRINGS;
export type StorefrontStringKey = keyof StorefrontStrings;

/** The languages with bundled translations, for pickers. */
export const STOREFRONT_LOCALES = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
  { code: "pt-BR", name: "Portuguese (Brazil)", flag: "🇧🇷" },
  { code: "nl", name: "Dutch", flag: "🇳🇱" },
  { code: "ja", name: "Japanese", flag: "🇯🇵" },
  { code: "zh-CN", name: "Chinese (Simplified)", flag: "🇨🇳" },
  { code: "ko", name: "Korean", flag: "🇰🇷" },
  { code: "bn", name: "Bengali (Bangla)", flag: "🇧🇩" },
  { code: "ar", name: "Arabic", flag: "🇸🇦" },
] as const;

/** A locale code as Shopify writes it: "fr", "pt-BR", "zh-CN". */
export const LOCALE_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/i;

/** Fills {name} placeholders: fmt(s.hotspot_n, { n: 2 }) -> "Hotspot 2". */
export function fmt(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m,
  );
}
