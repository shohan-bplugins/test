#!/usr/bin/env node
/*
 * Checks the dashboard's translations (app/i18n/locales):
 *
 *  - every locale has every namespace and key that English has, and nothing
 *    English lacks, with the same {placeholders} and <tags>;
 *  - every t("key") / t.rich("key") in app/ exists in the namespace that `t`
 *    was created for (`const t = useT("ns")` or `getServerT(request, "ns")`).
 *    A plural key passes when key_other exists.
 *
 *   node scripts/check-admin-i18n.mjs            # everything
 *   node scripts/check-admin-i18n.mjs --en-only  # skip other locales
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const LOCALES = join(ROOT, "app/i18n/locales");
const enOnly = process.argv.includes("--en-only");
const problems = [];

const readNs = (locale) => {
  const dir = join(LOCALES, locale);
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      out[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch (e) {
      problems.push(`${locale}/${f}: invalid JSON (${e.message})`);
    }
  }
  return out;
};

const en = readNs("en");
const tokens = (s) =>
  [...String(s).matchAll(/\{(\w+)\}|<\/?(\w+)>/g)].map((m) => m[0]).sort().join(" ");

for (const [ns, messages] of Object.entries(en)) {
  for (const [key, value] of Object.entries(messages)) {
    if (typeof value !== "string") problems.push(`en/${ns}.json: ${key} is not a string`);
  }
}

if (!enOnly) {
  const locales = readdirSync(LOCALES).filter(
    (d) => d !== "en" && statSync(join(LOCALES, d)).isDirectory(),
  );
  for (const locale of locales) {
    const other = readNs(locale);
    for (const [ns, messages] of Object.entries(en)) {
      if (!other[ns]) {
        problems.push(`${locale}/${ns}.json: missing`);
        continue;
      }
      for (const [key, value] of Object.entries(messages)) {
        if (!(key in other[ns])) problems.push(`${locale}/${ns}.json: missing ${key}`);
        else if (tokens(value) !== tokens(other[ns][key])) {
          problems.push(`${locale}/${ns}.json: ${key} has [${tokens(other[ns][key])}], English has [${tokens(value)}]`);
        }
      }
      for (const key of Object.keys(other[ns])) {
        // Languages with more plural forms than English (Arabic: zero, two,
        // few, many) may add key_<category> wherever English has key_other.
        const plural = key.match(/^(.*)_(zero|one|two|few|many)$/);
        if (plural && `${plural[1]}_other` in messages) continue;
        if (!(key in messages)) problems.push(`${locale}/${ns}.json: ${key} is not in English`);
      }
    }
    for (const ns of Object.keys(other)) {
      if (!en[ns]) problems.push(`${locale}/${ns}.json: no English namespace`);
    }
  }
}

// Keys used in code.
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(f)) out.push(p);
  }
  return out;
}
const has = (ns, key) =>
  en[ns] && (key in en[ns] || `${key}_other` in en[ns]);

// app/i18n itself only has usage examples in comments.
for (const file of walk(join(ROOT, "app")).filter((f) => !f.includes("/app/i18n/"))) {
  const src = readFileSync(file, "utf8");
  const bindings = new Map();
  for (const m of src.matchAll(/\b(\w+)\s*=\s*(?:useT\(\s*|getServerT\(\s*\w+\s*,\s*)["'](\w[\w-]*)["']/g)) {
    bindings.set(m[1], m[2]);
  }
  for (const [ident, ns] of bindings) {
    if (!en[ns]) {
      problems.push(`${relative(ROOT, file)}: namespace "${ns}" has no app/i18n/locales/en/${ns}.json`);
      continue;
    }
    const re = new RegExp(`\\b${ident}(?:\\.rich)?\\(\\s*["'\`]([^"'\`$]+)["'\`]`, "g");
    for (const m of src.matchAll(re)) {
      if (!has(ns, m[1])) problems.push(`${relative(ROOT, file)}: ${ident}("${m[1]}") is not in en/${ns}.json`);
    }
  }
}

if (problems.length) {
  console.error(`check-admin-i18n: ${problems.length} problem(s)\n  ` + problems.join("\n  "));
  process.exit(1);
}
const keyCount = Object.values(en).reduce((n, m) => n + Object.keys(m).length, 0);
console.log(`check-admin-i18n: ${Object.keys(en).length} namespaces, ${keyCount} English keys, all in step`);
