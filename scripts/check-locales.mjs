#!/usr/bin/env node
/*
 * Keeps the viewer's shopper-facing strings in step everywhere they live:
 *
 *  - every extensions/viewer-3d/locales/*.json has exactly the keys of
 *    en.default.json (and the same for *.schema.json against
 *    en.default.schema.json), with the same {placeholders};
 *  - snippets/viewer_i18n.liquid sends every viewer_3d.ui key to the script;
 *  - DEFAULT_STRINGS in assets/viewer-3d.js matches en.default.json, word for
 *    word, so a block cached from before a change still reads the same;
 *  - every t('key') in viewer-3d.js exists in the catalog.
 *
 * Run with `npm run check-locales`. Exits non-zero with a list of problems.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const EXT = new URL("../extensions/viewer-3d/", import.meta.url).pathname;
const LOCALES = join(EXT, "locales");
const problems = [];

const readJson = (file) => JSON.parse(readFileSync(join(LOCALES, file), "utf8"));

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

function compareFamily(defaultFile, suffix) {
  const base = flatten(readJson(defaultFile));
  const files = readdirSync(LOCALES).filter(
    (f) => f !== defaultFile && f.endsWith(suffix) &&
      (suffix === ".schema.json" || !f.endsWith(".schema.json")),
  );
  for (const file of files) {
    const other = flatten(readJson(file));
    for (const key of Object.keys(base)) {
      if (!(key in other)) problems.push(`${file}: missing ${key}`);
      else if (placeholders(base[key]) !== placeholders(other[key])) {
        problems.push(`${file}: ${key} has placeholders {${placeholders(other[key])}}, expected {${placeholders(base[key])}}`);
      }
    }
    for (const key of Object.keys(other)) {
      if (!(key in base)) problems.push(`${file}: ${key} is not in ${defaultFile}`);
    }
  }
  return base;
}

const en = compareFamily("en.default.json", ".json");
compareFamily("en.default.schema.json", ".schema.json");

const uiKeys = Object.keys(en)
  .filter((k) => k.startsWith("viewer_3d.ui."))
  .map((k) => k.slice("viewer_3d.ui.".length));

// The snippet that hands the strings to the script.
const snippet = readFileSync(join(EXT, "snippets/viewer_i18n.liquid"), "utf8");
for (const key of uiKeys) {
  if (!snippet.includes(`'viewer_3d.ui.${key}' | t`)) {
    problems.push(`snippets/viewer_i18n.liquid: does not send ${key}`);
  }
}

// The script's own English fallback, and the keys it asks for.
const js = readFileSync(join(EXT, "assets/viewer-3d.js"), "utf8");
const block = js.match(/var DEFAULT_STRINGS = \{([\s\S]*?)\n {2}\};/);
if (!block) {
  problems.push("assets/viewer-3d.js: DEFAULT_STRINGS not found");
} else {
  const defaults = {};
  for (const m of block[1].matchAll(/^\s*(\w+): '((?:[^'\\]|\\.)*)'/gm)) {
    defaults[m[1]] = m[2].replace(/\\'/g, "'");
  }
  for (const key of uiKeys) {
    const want = en[`viewer_3d.ui.${key}`];
    if (!(key in defaults)) problems.push(`viewer-3d.js DEFAULT_STRINGS: missing ${key}`);
    else if (defaults[key] !== want) {
      problems.push(`viewer-3d.js DEFAULT_STRINGS.${key} is "${defaults[key]}", en.default.json has "${want}"`);
    }
  }
  for (const key of Object.keys(defaults)) {
    if (!uiKeys.includes(key)) problems.push(`viewer-3d.js DEFAULT_STRINGS.${key} is not in en.default.json`);
  }
}
for (const m of js.matchAll(/\bt\('(\w+)'/g)) {
  if (!uiKeys.includes(m[1])) problems.push(`viewer-3d.js: t('${m[1]}') is not in en.default.json`);
}

// The admin's copy of the English (it cannot import from extensions/).
const appStrings = readFileSync(new URL("../app/lib/storefront-strings.ts", import.meta.url), "utf8");
const appBlock = appStrings.match(/DEFAULT_STOREFRONT_STRINGS = \{([\s\S]*?)\n\};/);
if (!appBlock) {
  problems.push("app/lib/storefront-strings.ts: DEFAULT_STOREFRONT_STRINGS not found");
} else {
  const appDefaults = {};
  for (const m of appBlock[1].matchAll(/^\s*(\w+): ("(?:[^"\\]|\\.)*"),/gm)) {
    appDefaults[m[1]] = JSON.parse(m[2]);
  }
  for (const key of uiKeys) {
    const want = en[`viewer_3d.ui.${key}`];
    if (appDefaults[key] !== want) {
      problems.push(`storefront-strings.ts DEFAULT_STOREFRONT_STRINGS.${key} is ${JSON.stringify(appDefaults[key])}, en.default.json has "${want}"`);
    }
  }
  for (const key of Object.keys(appDefaults)) {
    if (!uiKeys.includes(key)) problems.push(`storefront-strings.ts DEFAULT_STOREFRONT_STRINGS.${key} is not in en.default.json`);
  }
}

if (problems.length) {
  console.error(`check-locales: ${problems.length} problem(s)\n  ` + problems.join("\n  "));
  process.exit(1);
}
console.log(`check-locales: ${uiKeys.length} viewer strings in step across all locales`);
