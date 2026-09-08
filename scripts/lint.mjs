#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const en = JSON.parse(readFileSync(join(root, "web/src/locales/en.json"), "utf8"));
const es = JSON.parse(readFileSync(join(root, "web/src/locales/es.json"), "utf8"));
const enKeys = Object.keys(en).sort();
const esKeys = Object.keys(es).sort();
const missingEs = enKeys.filter((k) => !esKeys.includes(k));
const missingEn = esKeys.filter((k) => !enKeys.includes(k));
if (missingEs.length || missingEn.length) {
  console.error("i18n key mismatch");
  if (missingEs.length) console.error("missing in es:", missingEs.join(", "));
  if (missingEn.length) console.error("missing in en:", missingEn.join(", "));
  process.exit(1);
}
console.log(`lint ok (${enKeys.length} i18n keys)`);
