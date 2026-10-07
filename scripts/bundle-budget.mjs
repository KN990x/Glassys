#!/usr/bin/env node
/**
 * The PWA's size budget, checked after `pnpm build`. The first load went to 556 KB before
 * anyone noticed; a budget makes the next jump a failed check instead of a slow phone.
 *
 * Raw (uncompressed) bytes of the built chunks. Raise a limit on purpose, with the reason in
 * the commit, never to make a red check green.
 */
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const assets = join(dirname(fileURLToPath(import.meta.url)), "../web/dist/assets");
const BUDGET = [
  { name: "first load (index)", pattern: /^index-[\w-]+\.js$/, maxBytes: 360 * 1024 },
  { name: "chat", pattern: /^Chat-[\w-]+\.js$/, maxBytes: 280 * 1024 },
  { name: "any other chunk", pattern: /^(?!index-|Chat-)[\w-]+\.js$/, maxBytes: 64 * 1024 },
  { name: "styles", pattern: /^index-[\w-]+\.css$/, maxBytes: 110 * 1024 },
];

let files;
try {
  files = readdirSync(assets);
} catch {
  console.error("bundle-budget: web/dist/assets is missing; run pnpm build first");
  process.exit(1);
}
const over = [];
for (const rule of BUDGET) {
  const matched = files.filter((f) => rule.pattern.test(f));
  if (!matched.length && rule.name !== "any other chunk") over.push(`${rule.name}: no chunk matched ${rule.pattern}`);
  for (const f of matched) {
    const size = statSync(join(assets, f)).size;
    if (size > rule.maxBytes) over.push(`${rule.name}: ${f} is ${(size / 1024).toFixed(0)} KB, budget ${rule.maxBytes / 1024} KB`);
  }
}
if (over.length) {
  console.error("bundle-budget failed");
  for (const line of over) console.error(`- ${line}`);
  process.exit(1);
}
console.log("bundle-budget ok");
