/**
 * Message lookup and formatting, shared by the React hook (index.tsx) and the
 * server helper (i18n.server.ts). Client-safe.
 *
 * Messages are flat JSON per namespace: { "key": "Text with {name}" }.
 *  - {name} placeholders are filled from `vars`.
 *  - Plurals: with a numeric `vars.count`, `key_one` / `key_few` / … (the
 *    locale's Intl.PluralRules category) is used when present, else
 *    `key_other`, else `key`.
 *  - Rich text: <tag>chunk</tag> pairs, rendered by the caller (see t.rich in
 *    index.tsx). Not nested.
 */

export type Messages = Record<string, string>;
/** namespace -> messages */
export type Catalog = Record<string, Messages>;
export type Vars = Record<string, string | number>;

/** Builds a namespace -> messages map from an import.meta.glob result. */
export function catalogFromGlob(
  files: Record<string, Messages>,
  locale: string,
): Catalog {
  const out: Catalog = {};
  const prefix = `/locales/${locale}/`;
  for (const [path, messages] of Object.entries(files)) {
    const at = path.indexOf(prefix);
    if (at === -1) continue;
    const ns = path.slice(at + prefix.length).replace(/\.json$/, "");
    out[ns] = messages;
  }
  return out;
}

const pluralRulesCache = new Map<string, Intl.PluralRules>();
function pluralCategory(locale: string, count: number): string {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(locale);
    } catch {
      rules = new Intl.PluralRules("en");
    }
    pluralRulesCache.set(locale, rules);
  }
  return rules.select(count);
}

function lookup(messages: Messages | undefined, key: string, locale: string, vars?: Vars) {
  if (!messages) return undefined;
  if (vars && typeof vars.count === "number") {
    const plural =
      messages[`${key}_${pluralCategory(locale, vars.count)}`] ??
      messages[`${key}_other`];
    if (plural !== undefined) return plural;
  }
  return messages[key];
}

/** The raw message: the locale's, else English, else the key itself. */
export function resolveMessage(
  catalog: Catalog,
  fallback: Catalog,
  locale: string,
  ns: string,
  key: string,
  vars?: Vars,
): string {
  const found =
    lookup(catalog[ns], key, locale, vars) ?? lookup(fallback[ns], key, "en", vars);
  if (found === undefined) {
    if (import.meta.env?.DEV) console.warn(`[i18n] missing ${ns}:${key}`);
    return key;
  }
  return found;
}

/** Fills {name} placeholders. Numbers are formatted for the locale. */
export function interpolate(message: string, locale: string, vars?: Vars): string {
  if (!vars) return message;
  return message.replace(/\{(\w+)\}/g, (m, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return m;
    const v = vars[name];
    if (typeof v === "number") {
      try {
        return new Intl.NumberFormat(locale).format(v);
      } catch {
        return String(v);
      }
    }
    return v;
  });
}

/** Splits "a <b>bold</b> c" into ["a ", { tag: "b", text: "bold" }, " c"]. */
export function splitRich(message: string): (string | { tag: string; text: string })[] {
  const parts: (string | { tag: string; text: string })[] = [];
  const re = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message))) {
    if (m.index > last) parts.push(message.slice(last, m.index));
    parts.push({ tag: m[1], text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < message.length) parts.push(message.slice(last));
  return parts;
}
