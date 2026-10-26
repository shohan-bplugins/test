/**
 * The languages the app is translated into: the dashboard (app/i18n/locales)
 * and the storefront viewer (extensions/viewer-3d/locales) share this list.
 * Client-safe.
 */
export const SUPPORTED_LOCALES = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "fr", name: "Français", flag: "🇫🇷" },
  { code: "de", name: "Deutsch", flag: "🇩🇪" },
  { code: "es", name: "Español", flag: "🇪🇸" },
  { code: "it", name: "Italiano", flag: "🇮🇹" },
  { code: "pt-BR", name: "Português (Brasil)", flag: "🇧🇷" },
  { code: "nl", name: "Nederlands", flag: "🇳🇱" },
  { code: "ja", name: "日本語", flag: "🇯🇵" },
  { code: "zh-CN", name: "简体中文", flag: "🇨🇳" },
  { code: "ko", name: "한국어", flag: "🇰🇷" },
  { code: "ar", name: "العربية", flag: "🇸🇦" },
] as const;

/** Languages written right to left: the page's `dir` follows. */
const RTL = new Set(["ar", "he", "fa", "ur"]);
export function localeDir(locale: string): "rtl" | "ltr" {
  return RTL.has(locale.split("-")[0].toLowerCase()) ? "rtl" : "ltr";
}

/** "🇯🇵 日本語": a language as the picker shows it, in its own script. */
export function localeLabel(code: string): string {
  const l = SUPPORTED_LOCALES.find((x) => x.code === code);
  return l ? `${l.flag} ${l.name}` : code;
}

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]["code"];
export const DEFAULT_LOCALE: SupportedLocale = "en";

const CODES: readonly string[] = SUPPORTED_LOCALES.map((l) => l.code);

/** A locale code as Shopify and browsers write it: "fr", "pt-BR", "zh-CN". */
const LOCALE_SHAPE = /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/i;

/**
 * The supported locale for one tag: exact (pt-BR), else its language
 * (fr-CA -> fr), else a regional one for a bare language (pt -> pt-BR,
 * zh-TW -> zh-CN). Null when nothing fits.
 */
export function matchLocale(tag: string | null | undefined): SupportedLocale | null {
  if (!tag || !LOCALE_SHAPE.test(tag.trim())) return null;
  const lower = tag.trim().toLowerCase();
  const exact = CODES.find((c) => c.toLowerCase() === lower);
  if (exact) return exact as SupportedLocale;
  const lang = lower.split("-")[0];
  const byLang =
    CODES.find((c) => c.toLowerCase() === lang) ??
    CODES.find((c) => c.toLowerCase().split("-")[0] === lang);
  return (byLang as SupportedLocale | undefined) ?? null;
}

/** The first supported locale among `tags`, in order; English if none. */
export function pickLocale(tags: (string | null | undefined)[]): SupportedLocale {
  for (const tag of tags) {
    const hit = matchLocale(tag);
    if (hit) return hit;
  }
  return DEFAULT_LOCALE;
}

/** "fr-CA,fr;q=0.9,en;q=0.8" -> ["fr-CA", "fr", "en"], in the browser's order. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => part.split(";")[0].trim())
    .filter((tag) => tag && tag !== "*");
}
