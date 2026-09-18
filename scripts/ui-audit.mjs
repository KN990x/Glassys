#!/usr/bin/env node
/**
 * Static audit of the PWA design system.
 *
 * It exists because a hardcoded `font-size: 16px` on the model picker shipped:
 * it made the model name the largest text in the composer and no amount of
 * reading the file or looking at screenshots caught it. A machine catches it.
 *
 * Three rules:
 *   1. No length literal in a component rule. Sizes come from the token scale.
 *   2. Every ink token clears WCAG AA on the surfaces it is used on.
 *   3. No class declared in CSS that no component renders.
 *
 * Genuine one-offs live in ALLOWED below, each with the reason, so stepping
 * outside the scale is a written decision instead of a slip.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cssPath = join(root, "web/src/styles.css");
const css = readFileSync(cssPath, "utf8");

/** Properties that must always resolve through a token. */
const SCALED = new Set([
  "font-size", "gap", "row-gap", "column-gap",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "border-radius", "background-size",
]);

/**
 * One-offs that are deliberately not on the scale. Each is a fixed dimension of
 * a single element, not a rhythm value, so a token would only add indirection.
 */
const ALLOWED = new Map([
  ["--", "token definitions are the scale itself"],
  [".composer-box textarea", "optical centring against the send button, derived from its em box"],
  [".visually-hidden", "the standard clip pattern"],
  [".md :not(pre) > code", "inline code tracks its paragraph, so em not px"],
  ['input:not([type="checkbox"]):not([type="radio"]), textarea', "16px is the iOS focus-zoom floor, not a type step"],
]);

const failures = [];

// ---------------------------------------------------------------- rule 1
{
  // Everything after the token blocks is component CSS.
  const start = css.indexOf("/* ---");
  const body = css.slice(css.indexOf("Base", start));
  let selector = "";
  for (const line of body.split("\n")) {
    // Indentation is not significant: a rule nested in a media query counts.
    const sel = line.match(/^\s*([^\s{][^{]*)\{\s*$/);
    if (sel && !sel[1].trim().startsWith("@")) selector = sel[1].trim();
    const inline = line.match(/^\s*([^\s{][^{]*)\{(.*)\}\s*$/);
    const decls = inline ? inline[2] : line;
    if (inline) selector = inline[1].trim();
    for (const d of decls.split(";")) {
      const m = d.match(/^\s*([a-z-]+)\s*:\s*(.+)$/);
      if (!m) continue;
      const [, prop, rawValue] = m;
      if (!SCALED.has(prop)) continue;
      // A 1px or 2px hairline inside a border/outline shorthand is not a size.
      const value = rawValue.replace(/var\([^)]*\)/g, "").replace(/env\([^)]*\)/g, "");
      const lengths = [...value.matchAll(/(?<![\w-])(\d*\.?\d+)(px|rem|em)/g)];
      if (!lengths.length) continue;
      if (lengths.every((l) => l[2] === "px" && Number(l[1]) <= 2)) continue;
      if ([...ALLOWED.keys()].some((k) => selector.includes(k))) continue;
      failures.push(
        `off-scale ${prop}: ${rawValue.trim()}  in  ${selector}\n` +
          `      use a token, or add the selector to ALLOWED in scripts/ui-audit.mjs with a reason`,
      );
    }
  }
}

// ---------------------------------------------------------------- rule 2
function channel(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) out[m[1]] = m[2];
  return out;
}
const darkBlock = css.slice(css.indexOf(":root {"), css.indexOf('html[data-theme="light"]'));
const lightBlock = css.slice(css.indexOf('html[data-theme="light"]'), css.indexOf("/* ---", css.indexOf('html[data-theme="light"]')));
const dark = tokens(darkBlock);
const light = { ...dark, ...tokens(lightBlock) };

/** Ink token -> the surfaces it actually sits on, and the AA bar for its use. */
const INK = [
  ["--text", ["--bg", "--surface-1", "--surface-2"], 4.5],
  ["--muted", ["--bg", "--surface-1", "--surface-2"], 4.5],
  ["--faint", ["--bg", "--surface-1"], 4.5],
  ["--accent", ["--bg", "--surface-1"], 4.5],
  ["--danger", ["--bg", "--surface-1"], 4.5],
  ["--ok", ["--bg", "--surface-1"], 4.5],
  ["--warn", ["--bg", "--surface-1"], 4.5],
];
for (const [name, palette] of [["dark", dark], ["light", light]]) {
  for (const [ink, surfaces, min] of INK) {
    if (!palette[ink]) continue;
    for (const surface of surfaces) {
      const r = contrast(palette[ink], palette[surface]);
      if (r < min) {
        failures.push(`contrast ${name}: ${ink} on ${surface} is ${r.toFixed(2)}:1, needs ${min}:1`);
      }
    }
  }
}

// ---------------------------------------------------------------- rule 3
function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (entry.endsWith(".tsx") && !entry.includes(".test.")) acc.push(full);
  }
  return acc;
}
const markup = walk(join(root, "web/src")).map((f) => readFileSync(f, "utf8")).join("\n");
/* A file extension inside url() or format() is not a class name. */
const selectable = css.replace(/url\([^)]*\)/g, "").replace(/format\([^)]*\)/g, "");
const declared = new Set([...selectable.matchAll(/\.([a-z][a-z0-9-]{2,})/g)].map((m) => m[1]));
/** Rendered by a library or by markdown, not by our own JSX. */
const EXTERNAL = new Set(["org"]);
/**
 * A component that renders `pop-${side}` or `tone-${tone}` does render the
 * variants, so the prefix counts as rendering every class that starts with it.
 */
const composed = [...markup.matchAll(/([a-z][a-z0-9-]*-)\$\{/g)].map((m) => m[1]);
for (const cls of [...declared].sort()) {
  if (EXTERNAL.has(cls)) continue;
  if (markup.includes(cls)) continue;
  if (composed.some((prefix) => cls.startsWith(prefix))) continue;
  failures.push(`dead selector: .${cls} is declared in styles.css but nothing renders it`);
}

// ----------------------------------------------------------------- report
if (failures.length) {
  console.error(`ui-audit found ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("ui-audit ok (scale, contrast, dead selectors)");
