#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const en = JSON.parse(readFileSync(join(root, "web/src/locales/en.json"), "utf8"));
const es = JSON.parse(readFileSync(join(root, "web/src/locales/es.json"), "utf8"));
const enKeys = Object.keys(en).sort();
const esKeys = Object.keys(es).sort();
const problems = [];

const missingEs = enKeys.filter((k) => !esKeys.includes(k));
const missingEn = esKeys.filter((k) => !enKeys.includes(k));
if (missingEs.length) problems.push(`missing in es: ${missingEs.join(", ")}`);
if (missingEn.length) problems.push(`missing in en: ${missingEn.join(", ")}`);
const empty = enKeys.filter((k) => !String(en[k]).trim() || !String(es[k] ?? "x").trim());
if (empty.length) problems.push(`empty values: ${empty.join(", ")}`);

/* Every key the source names, as a plain literal ("chat.copy") or as the fixed head of a
   template (`nav.${view}` keeps every nav.* key). Tests and the component gallery do not count. */
function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name) || name === "gallery.tsx") return [];
    return [readFileSync(full, "utf8")];
  });
}
const code = sources(join(root, "web/src")).join("\n");
const literals = new Set([...code.matchAll(/["'`]([a-z][A-Za-z]*(?:\.[A-Za-z0-9_-]+)+)["'`]/g)].map((m) => m[1]));
const prefixes = [...code.matchAll(/`([a-z][A-Za-z]*(?:\.[A-Za-z0-9_-]+)*\.)\$\{/g)].map((m) => m[1]);
const used = (key) => literals.has(key) || prefixes.some((p) => key.startsWith(p));
const unused = enKeys.filter((k) => !used(k));
if (unused.length) problems.push(`keys no source uses: ${unused.join(", ")}`);

/* t("x") with a literal that is not in the catalog renders the bare key. */
const called = [...code.matchAll(/\bt\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
const unknown = [...new Set(called.filter((k) => !(k in en)))];
if (unknown.length) problems.push(`t() keys missing from en.json: ${unknown.join(", ")}`);

if (problems.length) {
  console.error("i18n lint failed");
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
console.log(`lint ok (${enKeys.length} i18n keys)`);
