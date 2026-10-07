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
  resolveInstallRoot,
} from "./install.mjs";

test("isGlassysRepo only accepts this package name", () => {
  const dir = mkdtempSync(join(tmpdir(), "glassys-install-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "glassys" }));
  assert.equal(isGlassysRepo(dir), true);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "other" }));
  assert.equal(isGlassysRepo(dir), false);
});

test("listenUrl falls back to env and loopback before the gateway is built", async () => {
  const root = mkdtempSync(join(tmpdir(), "glassys-install-"));
  assert.equal(await listenUrl(root, {}), "http://127.0.0.1:8787");
  assert.equal(await listenUrl(root, { GLASSYS_PORT: "9000" }), "http://127.0.0.1:9000");
});

test("listenUrl asks the built gateway, with the clone's data dir", async () => {
  // A stand-in for gateway/dist/listen.js; the real resolver is tested in gateway/src/listen.test.ts.
  const root = mkdtempSync(join(tmpdir(), "glassys-install-"));
  mkdirSync(join(root, "gateway", "dist"), { recursive: true });
  writeFileSync(
    join(root, "gateway", "dist", "listen.js"),
    "export function resolveListenFromDataDir(dataDir) { return { bind: '172.18.0.1', port: 8790, publicUrl: dataDir.endsWith('custom') ? 'https://g.example' : '' }; }\n",
  );
  assert.equal(await listenUrl(root, {}), "http://172.18.0.1:8790");
  assert.equal(await listenUrl(root, { GLASSYS_DATA_DIR: join(root, "custom") }), "https://g.example");
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
      ["pnpm", "install", "--frozen-lockfile"],
      ["pnpm", "run", "build"],
      ["pnpm", "run", "service:install"],
    ],
  );
  assert.equal(
    cmds.some((c) => c.args.includes("publish")),
    false,
  );
});
