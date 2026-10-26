#!/usr/bin/env node
/**
 * Static audit of the PWA design system.
 *
 * It exists because a hardcoded `font-size: 16px` on the model picker shipped:
 * it made the model name the largest text in the composer and no amount of
 * reading the file or looking at screenshots caught it. A machine catches it.
 *
 * Four rules:
 *   1. No length literal in a component rule. Sizes come from the token scale.
 *   2. Every ink token clears WCAG AA on the surfaces it is used on.
 *   3. No class declared in CSS that no component renders.
 *   4. No inline <svg> outside Icon.tsx and QrCode.tsx, and no pixel sizes in a style prop:
 *      icons come from Icon.tsx and sizes from the stylesheet.
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
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "top", "right", "bottom", "left", "inset",
  "transform", "translate", "box-shadow", "outline-offset",
]);

/**
 * One-offs that are deliberately not on the scale. Each is a fixed dimension of
 * a single element, not a rhythm value, so a token would only add indirection.
 */
const ALLOWED = new Map([
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
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Every custom property with its raw value, so a token that is not a plain colour is seen too. */
function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}
/** Hex colours only: anything else (rgb(), oklch(), a var(), 8-digit alpha) cannot be judged here. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/* A block boundary that moved used to slice the wrong text and check nothing; it fails instead. */
function block(startMarker, endMarker, from = 0) {
  const start = css.indexOf(startMarker, from);
  const end = start < 0 ? -1 : css.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    failures.push(`ui-audit: cannot find the block between "${startMarker}" and "${endMarker}" in styles.css`);
    return "";
  }
  return css.slice(start, end);
}
const darkBlock = block(":root {", 'html[data-theme="light"]');
const lightBlock = block('html[data-theme="light"]', "/* ---");
const dark = tokens(darkBlock);
const light = { ...dark, ...tokens(lightBlock) };

/** Ink token -> the surfaces it actually sits on, and the AA bar for its use. */
const INK = [
  ["--text", ["--bg", "--surface-1", "--surface-2"], 4.5],
  ["--muted", ["--bg", "--surface-1", "--surface-2"], 4.5],
  ["--faint", ["--bg", "--surface-1", "--surface-2"], 4.5],
  ["--accent", ["--bg", "--surface-1"], 4.5],
  ["--danger", ["--bg", "--surface-1"], 4.5],
  ["--ok", ["--bg", "--surface-1"], 4.5],
  ["--warn", ["--bg", "--surface-1"], 4.5],
  /* Text on a filled control: the fill is the surface. */
  ["--on-solid", ["--danger-fill"], 4.5],
  ["--btn-fg", ["--btn"], 4.5],
];
for (const [name, palette] of [["dark", dark], ["light", light]]) {
  for (const [ink, surfaces, min] of INK) {
    for (const surface of [ink, ...surfaces]) {
      if (!HEX.test(palette[surface] ?? "")) {
        failures.push(`contrast ${name}: ${surface} is ${palette[surface] ? `"${palette[surface]}", not a hex colour` : "missing"}; its contrast goes unchecked`);
      }
    }
    if (![ink, ...surfaces].every((t) => HEX.test(palette[t] ?? ""))) continue;
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
const sources = walk(join(root, "web/src")).map((f) => ({ file: f, text: readFileSync(f, "utf8") }));
/* The gallery mounts every component, and a comment can name a class it no longer renders:
   neither counts as rendering one. */
/* Only comments where they can stand: a JSX comment, or one opening its line. A pattern such
   as accept="image/*" is not the start of one. */
const stripComments = (text) =>
  text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
    .replace(/^\s*\/\/.*$/gm, "");
const markup = sources
  .filter((s) => !s.file.endsWith("gallery.tsx"))
  .map((s) => stripComments(s.text))
  .join("\n");
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
/* A whole class name: `.tool` must not pass because `tool-head` is rendered. */
const rendered = (cls) => new RegExp(`(?<![a-z0-9-])${cls}(?![a-z0-9-])`).test(markup);
for (const cls of [...declared].sort()) {
  if (EXTERNAL.has(cls)) continue;
  if (rendered(cls)) continue;
  if (composed.some((prefix) => cls.startsWith(prefix))) continue;
  failures.push(`dead selector: .${cls} is declared in styles.css but nothing renders it`);
}

// ---------------------------------------------------------------- rule 4
const SVG_OK = new Set(["Icon.tsx", "QrCode.tsx"]);
for (const { file, text } of sources) {
  const name = file.split(/[\\/]/).pop();
  if (!SVG_OK.has(name) && /<svg[\s>]/.test(text)) {
    failures.push(`inline svg in ${name}: take the glyph from components/Icon.tsx`);
  }
  if (name === "gallery.tsx") continue;
  for (const m of text.matchAll(/style=\{\{([^}]*)\}\}/g)) {
    if (/\d(px|rem)\b/.test(m[1])) failures.push(`pixel size in a style prop in ${name}: ${m[0].slice(0, 80)}`);
  }
}

// ----------------------------------------------------------------- report
if (failures.length) {
  console.error(`ui-audit found ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("ui-audit ok (scale, contrast, dead selectors, icons)");
