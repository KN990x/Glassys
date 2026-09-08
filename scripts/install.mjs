#!/usr/bin/env node
/**
 * Clone (if needed), install deps, build, and install the user service.
 * Invoked by scripts/install.sh. Not an npm publish.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gatewayListenPort, nodeMeetsMin } from "./host-service.mjs";

export const DEFAULT_REPO = "https://github.com/KN990x/Glassys.git";

export function repoRootFromScript(scriptUrl = import.meta.url) {
  return join(dirname(fileURLToPath(scriptUrl)), "..");
}

export function isGlassysRepo(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return pkg.name === "glassys";
  } catch {
    return false;
  }
}

export function needsGatewayBuild(root) {
  return !existsSync(join(root, "gateway/dist/index.js"));
}

export function listenUrl(env = process.env) {
  return `http://127.0.0.1:${gatewayListenPort(env)}`;
}

export function resolveInstallRoot({ cwd, scriptUrl, env } = {}) {
  const fromScript = repoRootFromScript(scriptUrl);
  if (isGlassysRepo(fromScript)) return { root: fromScript, clone: false };
  const dest = env?.GLASSYS_DIR || join(cwd || process.cwd(), "glassys");
  if (isGlassysRepo(dest)) return { root: dest, clone: false };
  return { root: dest, clone: true, repo: env?.GLASSYS_REPO || DEFAULT_REPO };
}

export function installCommands({ root, build, enableCorepack }) {
  const cmds = [];
  if (enableCorepack) cmds.push({ bin: "corepack", args: ["enable"], cwd: root, optional: true });
  cmds.push({ bin: "pnpm", args: ["install"], cwd: root });
  if (build) cmds.push({ bin: "pnpm", args: ["run", "build"], cwd: root });
  cmds.push({ bin: "pnpm", args: ["run", "service:install"], cwd: root });
  return cmds;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(bin, args, cwd, optional = false) {
  const result = spawnSync(bin, args, { cwd, stdio: "inherit", encoding: "utf8" });
  if (result.status !== 0 && !optional) {
    fail(`${bin} ${args.join(" ")} failed (${result.status ?? "spawn"})`);
  }
  return result.status === 0;
}

export function main(argv = process.argv.slice(2), opts = {}) {
  const env = opts.env || process.env;
  const cwd = opts.cwd || process.cwd();
  if (argv[0] === "-h" || argv[0] === "--help") {
    console.log(`Usage: node scripts/install.mjs

Installs Glassys on this machine (Node 22.13+, pnpm via Corepack).
If this file is already inside a clone, that clone is used.
Otherwise clones ${DEFAULT_REPO} into ./glassys (or $GLASSYS_DIR).
`);
    return;
  }
  if (!nodeMeetsMin(opts.nodeVersion || process.versions.node)) {
    fail(`Glassys needs Node.js 22.13+ (this is v${opts.nodeVersion || process.versions.node}).`);
  }
  const plan = resolveInstallRoot({ cwd, scriptUrl: opts.scriptUrl || import.meta.url, env });
  if (plan.clone) {
    console.log(`Cloning ${plan.repo} → ${plan.root}`);
    run("git", ["clone", plan.repo, plan.root], cwd);
  }
  if (!isGlassysRepo(plan.root)) {
    fail(`Not a Glassys repo: ${plan.root}`);
  }
  const cmds = installCommands({
    root: plan.root,
    build: needsGatewayBuild(plan.root),
    enableCorepack: true,
  });
  for (const cmd of cmds) {
    run(cmd.bin, cmd.args, cmd.cwd, cmd.optional);
  }
  console.log(`Glassys should be reachable at ${listenUrl(env)}`);
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    main();
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}
