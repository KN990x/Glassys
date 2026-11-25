#!/usr/bin/env node
/**
 * `pnpm run setup`: takes a fresh clone to "ready for `pnpm run dev`" on a new machine.
 * Idempotent: safe to run again, it never overwrites anything that already exists.
 *
 *   1. Node against `.nvmrc` (the minimum; mise installs it) and pnpm against `packageManager`.
 *   2. `pnpm install --frozen-lockfile` for the whole workspace.
 *   3. Reports what is left to configure, by name only (never a value).
 *
 * There is nothing to copy or migrate: the gateway does not read a `.env` file (every variable in
 * `.env.example` is optional and comes from the shell or the service unit), it creates
 * `$GLASSYS_DATA_DIR/config.yaml` and `secrets.json` itself on first start, and the onboarding
 * wizard sets the operator password. Copying `.env.example` to `.env` would only add a file
 * nothing loads.
 *
 * Not the host installer: `scripts/install.sh` / `pnpm run service:install` install the service.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const ok = (msg) => console.log(`[setup] ✓ ${msg}`);
function abort(msg) {
  console.error(`[setup] ✗ ${msg}`);
  process.exit(1);
}

/** Stdout of a command, or null when it is missing or fails. */
function output(bin, args) {
  try {
    return execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** `v22.13.0` >= `22.13`, compared part by part (missing parts count as 0). */
function atLeast(version, minimum) {
  const parse = (v) => String(v).replace(/^v/, "").split(".").map((p) => Number.parseInt(p, 10) || 0);
  const a = parse(version);
  const b = parse(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

/* ---------------------------------------------------------------- 1. toolchain */
const nvmrc = readFileSync(".nvmrc", "utf8").trim();
if (!atLeast(process.version, nvmrc)) {
  abort(`Node ${process.version}, but .nvmrc asks for ${nvmrc} or newer. Install it and run setup again:\n    mise install && pnpm run setup`);
}
ok(`Node ${process.version} (.nvmrc: ${nvmrc} or newer)`);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const wantedPnpm = String(pkg.packageManager ?? "").replace(/^pnpm@/, "");
const currentPnpm = output("pnpm", ["--version"]);
if (currentPnpm !== wantedPnpm) {
  abort(
    `pnpm ${currentPnpm ?? "(not found)"}, but packageManager asks for ${wantedPnpm}. With Corepack:\n` +
      "    corepack enable && corepack install && pnpm run setup\n" +
      "    (Node 25+ no longer ships Corepack: npm install -g corepack@latest first)",
  );
}
ok(`pnpm ${currentPnpm} (packageManager)`);

/* ---------------------------------------------------------------- 2. dependencies */
if (spawnSync("pnpm", ["install", "--frozen-lockfile"], { stdio: "inherit" }).status !== 0) {
  abort("`pnpm install --frozen-lockfile` failed: see the error above.");
}
ok("dependencies installed (frozen lockfile)");

/* ---------------------------------------------------------------- 3. what is left */
const optional = readFileSync(".env.example", "utf8")
  .split("\n")
  .map((line) => /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line.trim())?.[1])
  .filter((name) => name && name !== "GLASSYS_DATA_DIR");
ok("nothing to fill in: data/config.yaml and data/secrets.json are created on first start");
console.log(`[setup]   optional, from the shell or the service unit: ${optional.join(", ")}`);
console.log("[setup]   each agent also needs its own login on this machine, or its API key above");

console.log("");
console.log("[setup] ✅ Ready. Next: `pnpm run dev`, then open the PWA and finish the onboarding wizard.");
