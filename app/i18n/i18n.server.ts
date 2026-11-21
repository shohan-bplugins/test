/**
 * Dashboard translations on the server: picking the merchant's language, and
 * translating messages an action returns (toasts, errors).
 *
 *   const t = getServerT(request, "models");
 *   return { ok: true, message: t("saved") };
 */
import { DEFAULT_LOCALE, parseAcceptLanguage, pickLocale } from "./config";
import {
  catalogFromGlob,
  interpolate,
  resolveMessage,
  type Catalog,
  type Messages,
  type Vars,
} from "./format";

const FILES = import.meta.glob<Messages>("./locales/*/*.json", {
  eager: true,
  import: "default",
});

const catalogs = new Map<string, Catalog>();
export function catalogFor(locale: string): Catalog {
  let catalog = catalogs.get(locale);
  if (!catalog) {
    catalog = catalogFromGlob(FILES, locale);
    catalogs.set(locale, catalog);
  }
  return catalog;
}

export const LOCALE_COOKIE = "e3d_admin_locale";

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * A language the merchant chose (the dashboard's language picker, or ?lang=),
 * kept until they choose "auto" again.
 */
export const OVERRIDE_COOKIE = "e3d_admin_lang";

/**
 * The merchant's admin language, most specific first:
 *
 *  1. An explicit choice: the language picker's `lang` (passed in), or
 *     ?lang= in the URL. Shopify never sets either. "auto" clears it.
 *  2. The remembered choice (cookie).
 *  3. ?locale= — Shopify adds this on every load in the admin, from the
 *     admin user's language setting. Adding ?locale= to the admin URL by hand
 *     does not work: Shopify's own value is used instead.
 *  4. The remembered ?locale= (cookie): client navigations and actions
 *     don't carry the query string.
 *  5. The browser's Accept-Language, then English.
 */
export function resolveAdminLocale(
  request: Request,
  lang: string | null = new URL(request.url).searchParams.get("lang"),
): string {
  const url = new URL(request.url);
  const override = lang === "auto" ? null : lang || cookieValue(request, OVERRIDE_COOKIE);
  return pickLocale([
    override,
    // The last ?locale=, should there be more than one: Shopify appends its
    // own after any query the admin URL carried.
    url.searchParams.getAll("locale").at(-1),
    cookieValue(request, LOCALE_COOKIE),
    ...parseAcceptLanguage(request.headers.get("Accept-Language")),
  ]);
}

/*
 * Partitioned and SameSite=None because the app runs in the admin's
 * cross-site iframe; where a browser refuses the cookie anyway, the fallbacks
 * above still apply.
 */
const COOKIE_ATTRS = "Path=/; Max-Age=31536000; SameSite=None; Secure; Partitioned";

/** The picker's current value: the chosen locale, or "auto". */
export function languageChoice(request: Request): string {
  const lang = new URL(request.url).searchParams.get("lang");
  if (lang === "auto") return "auto";
  const chosen = lang || cookieValue(request, OVERRIDE_COOKIE);
  return chosen ? pickLocale([chosen]) : "auto";
}

/**
 * Set-Cookie values remembering an explicit choice (`lang`, defaulting to
 * ?lang=) and Shopify's ?locale=, when there are any.
 */
export function localeCookieHeaders(
  request: Request,
  lang: string | null = new URL(request.url).searchParams.get("lang"),
): string[] {
  const url = new URL(request.url);
  const out: string[] = [];
  if (lang === "auto") {
    out.push(`${OVERRIDE_COOKIE}=; Path=/; Max-Age=0; SameSite=None; Secure; Partitioned`);
  } else if (lang) {
    out.push(`${OVERRIDE_COOKIE}=${encodeURIComponent(pickLocale([lang]))}; ${COOKIE_ATTRS}`);
  }
  const fromShopify = url.searchParams.getAll("locale").at(-1);
  if (fromShopify) {
    out.push(`${LOCALE_COOKIE}=${encodeURIComponent(pickLocale([fromShopify]))}; ${COOKIE_ATTRS}`);
  }
  return out;
}

const EN = (): Catalog => catalogFor(DEFAULT_LOCALE);

/** A translator for one namespace, for loaders and actions. */
export function getServerT(request: Request, ns: string) {
  const locale = resolveAdminLocale(request);
  const catalog = catalogFor(locale);
  return (key: string, vars?: Vars) =>
    interpolate(resolveMessage(catalog, EN(), locale, ns, key, vars), locale, vars);
}
