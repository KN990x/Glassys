import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_REPO,
  installCommands,
  isGlassysRepo,
  listenUrl,
  needsGatewayBuild,
  resolveInstallRoot,
} from "./install.mjs";

test("isGlassysRepo only accepts this package name", () => {
  const dir = mkdtempSync(join(tmpdir(), "glassys-install-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "glassys" }));
  assert.equal(isGlassysRepo(dir), true);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "other" }));
  assert.equal(isGlassysRepo(dir), false);
});

test("needsGatewayBuild is true until gateway/dist exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "glassys-install-"));
  assert.equal(needsGatewayBuild(dir), true);
  mkdirSync(join(dir, "gateway/dist"), { recursive: true });
  writeFileSync(join(dir, "gateway/dist/index.js"), "");
  assert.equal(needsGatewayBuild(dir), false);
});

test("listenUrl stays on loopback", () => {
  assert.equal(listenUrl({}), "http://127.0.0.1:8787");
  assert.equal(listenUrl({ GLASSYS_PORT: "9000" }), "http://127.0.0.1:9000");
});

test("resolveInstallRoot uses the scripts parent when it is this repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "glassys-install-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "glassys" }));
  mkdirSync(join(dir, "scripts"));
  const scriptUrl = pathToFileURL(join(dir, "scripts/install.mjs")).href;
  const plan = resolveInstallRoot({ cwd: "/tmp", scriptUrl, env: {} });
  assert.equal(plan.root, dir);
  assert.equal(plan.clone, false);
});

test("resolveInstallRoot clones when not inside the repo", () => {
  const cwd = mkdtempSync(join(tmpdir(), "glassys-empty-"));
  const scriptUrl = pathToFileURL(join(cwd, "not-glassys/scripts/install.mjs")).href;
  const plan = resolveInstallRoot({ cwd, scriptUrl, env: { GLASSYS_DIR: join(cwd, "dest") } });
  assert.equal(plan.clone, true);
  assert.equal(plan.root, join(cwd, "dest"));
  assert.equal(plan.repo, DEFAULT_REPO);
});

test("installCommands never publishes and prints a local service install", () => {
  const cmds = installCommands({ root: "/opt/glassys", build: true, enableCorepack: true });
  assert.deepEqual(
    cmds.map((c) => [c.bin, ...c.args]),
    [
      ["corepack", "enable"],
      ["pnpm", "install"],
      ["pnpm", "run", "build"],
      ["pnpm", "run", "service:install"],
    ],
  );
  assert.equal(
    cmds.some((c) => c.args.includes("publish")),
    false,
  );
});
