/**
 * Shopper-facing viewer strings in every bundled language, for the public
 * /viewer/:id page's loader.
 *
 * One source of truth: these are the theme app extension's own locale files,
 * the same ones the storefront blocks render through `| t`. Server-only on
 * purpose — the browser cannot load files from extensions/ in `shopify app
 * dev` (see storefront-strings.ts), so the loader picks the language and hands
 * the strings to the page as data.
 */
import ar from "../../extensions/viewer-3d/locales/ar.json";
import bn from "../../extensions/viewer-3d/locales/bn.json";
import de from "../../extensions/viewer-3d/locales/de.json";
import en from "../../extensions/viewer-3d/locales/en.default.json";
import es from "../../extensions/viewer-3d/locales/es.json";
import fr from "../../extensions/viewer-3d/locales/fr.json";
import it from "../../extensions/viewer-3d/locales/it.json";
import ja from "../../extensions/viewer-3d/locales/ja.json";
import ko from "../../extensions/viewer-3d/locales/ko.json";
import nl from "../../extensions/viewer-3d/locales/nl.json";
import ptBR from "../../extensions/viewer-3d/locales/pt-BR.json";
import zhCN from "../../extensions/viewer-3d/locales/zh-CN.json";
import {
  DEFAULT_STOREFRONT_STRINGS,
  LOCALE_PATTERN,
  type StorefrontStrings,
} from "~/lib/storefront-strings";

const CATALOG: Record<string, Partial<StorefrontStrings>> = {
  en: en.viewer_3d.ui,
  bn: bn.viewer_3d.ui,
  ar: ar.viewer_3d.ui,
  de: de.viewer_3d.ui,
  es: es.viewer_3d.ui,
  fr: fr.viewer_3d.ui,
  it: it.viewer_3d.ui,
  ja: ja.viewer_3d.ui,
  ko: ko.viewer_3d.ui,
  nl: nl.viewer_3d.ui,
  "pt-br": ptBR.viewer_3d.ui,
  "zh-cn": zhCN.viewer_3d.ui,
};

/**
 * The catalog entry for a locale: the exact one (pt-BR), else its language
 * (fr-CA -> fr), else a regional one for a bare language (pt -> pt-BR).
 */
function catalogKey(locale: string): string | null {
  const lower = locale.toLowerCase();
  if (CATALOG[lower]) return lower;
  const lang = lower.split("-")[0];
  if (CATALOG[lang]) return lang;
  const regional = Object.keys(CATALOG).find((k) => k.split("-")[0] === lang);
  return regional ?? null;
}

/** Every string in `locale`, English filling anything not translated. */
export function getStorefrontStrings(
  locale: string | null | undefined,
): StorefrontStrings {
  const key = locale && LOCALE_PATTERN.test(locale) ? catalogKey(locale) : null;
  return key
    ? { ...DEFAULT_STOREFRONT_STRINGS, ...CATALOG[key] }
    : DEFAULT_STOREFRONT_STRINGS;
}

/**
 * The locale for a public page: an explicit ?lang= wins, then the browser's
 * Accept-Language (first bundled match, in the browser's order), then English.
 * Returned as the catalog's canonical code ("pt-BR"), safe for <html lang>.
 */
export function resolveStorefrontLocale(
  langParam: string | null | undefined,
  acceptLanguage: string | null | undefined,
): string {
  const candidates: string[] = [];
  if (langParam) candidates.push(langParam.trim());
  if (acceptLanguage) {
    for (const part of acceptLanguage.split(",")) {
      const tag = part.split(";")[0].trim();
      if (tag && tag !== "*") candidates.push(tag);
    }
  }
  for (const c of candidates) {
    if (!LOCALE_PATTERN.test(c)) continue;
    const key = catalogKey(c);
    if (key) return canonical(key);
  }
  return "en";
}

function canonical(key: string): string {
  const [lang, region] = key.split("-");
  return region ? `${lang}-${region.toUpperCase()}` : lang;
}

const CONFIGURATOR_CATALOG: Record<string, Record<string, string>> = {
  en: en.viewer_3d.configurator,
  bn: bn.viewer_3d.configurator,
  ar: ar.viewer_3d.configurator,
  de: de.viewer_3d.configurator,
  es: es.viewer_3d.configurator,
  fr: fr.viewer_3d.configurator,
  it: it.viewer_3d.configurator,
  ja: ja.viewer_3d.configurator,
  ko: ko.viewer_3d.configurator,
  nl: nl.viewer_3d.configurator,
  "pt-br": ptBR.viewer_3d.configurator,
  "zh-cn": zhCN.viewer_3d.configurator,
};

/**
 * The Product configurator's strings (viewer_3d.configurator.*) in `locale`,
 * English filling gaps — what the block renders through configurator_i18n,
 * for pages served outside the theme (the iframe embed).
 */
export function getConfiguratorStrings(
  locale: string | null | undefined,
): Record<string, string> {
  const key = locale && LOCALE_PATTERN.test(locale) ? catalogKey(locale) : null;
  return { ...CONFIGURATOR_CATALOG.en, ...(key ? CONFIGURATOR_CATALOG[key] : {}) };
}
