#!/usr/bin/env node
/**
 * Install Glassys as a systemd --user service so closing the terminal does not stop the gateway.
 * Glassys runs on Linux only.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SERVICE_LABEL = "dev.kn990x.glassys";
export const SYSTEMD_UNIT = "glassys.service";

const MIN_NODE = [22, 13, 0];

export function repoRootFrom(scriptUrl = import.meta.url) {
  return join(dirname(fileURLToPath(scriptUrl)), "..");
}

/** systemd expands %-specifiers in most unit settings; a literal % is %%. */
export function systemdEscapeSpecifiers(value) {
  return value.replaceAll("%", "%%");
}

/** Quoting for settings systemd unquotes (Environment=, ExecStart=), with specifiers escaped. */
export function systemdQuote(value) {
  const escaped = systemdEscapeSpecifiers(value);
  if (/^[A-Za-z0-9_./:@%+=-]+$/.test(escaped)) return escaped;
  return `"${escaped.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export const GRAPHICAL_ENV_KEYS = ["DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS"];

export function graphicalEnvFrom(env = process.env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const key of GRAPHICAL_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return out;
}

export function gatewayListenPort(env = process.env) {
  const raw = env.GLASSYS_PORT;
  const n = raw ? Number.parseInt(raw, 10) : 8787;
  return Number.isFinite(n) && n > 0 ? n : 8787;
}

export function listenEnvFrom(env = process.env) {
  /** @type {Record<string, string>} */
  const out = {};
  if (typeof env.GLASSYS_PORT === "string" && env.GLASSYS_PORT.trim()) out.GLASSYS_PORT = env.GLASSYS_PORT.trim();
  if (typeof env.GLASSYS_BIND === "string" && env.GLASSYS_BIND.trim()) out.GLASSYS_BIND = env.GLASSYS_BIND.trim();
  return out;
}

/**
 * Where the gateway will listen: the gateway's own resolver (env over config.yaml over defaults),
 * so a bind written only in config.yaml is probed where it really is. Falls back to env and
 * defaults when the gateway is not built yet.
 */
export async function resolveListen(root, dataDir, env = process.env) {
  try {
    const mod = await import(pathToFileURL(join(root, "gateway", "dist", "listen.js")).href);
    if (typeof mod.resolveListenFromDataDir === "function") return mod.resolveListenFromDataDir(dataDir, env);
  } catch {
    /* not built yet */
  }
  return { bind: env.GLASSYS_BIND || "127.0.0.1", port: gatewayListenPort(env), publicUrl: "" };
}

/** The URL to print after install: the operator's public URL, else the address actually bound. */
export function openUrl({ bind, port, publicUrl }) {
  if (publicUrl) return publicUrl;
  const hosts = healthProbeHosts(bind);
  return `http://${hosts[hosts.length - 1]}:${port}`;
}

/** Hosts to probe for GET /health after install (loopback first, then a LAN bind). */
export function healthProbeHosts(bind = process.env.GLASSYS_BIND || "127.0.0.1") {
  const hosts = ["127.0.0.1"];
  const b = String(bind || "127.0.0.1").trim() || "127.0.0.1";
  if (b === "127.0.0.1" || b === "0.0.0.0" || b === "::" || b === "[::]") return hosts;
  if (b === "::1" || b === "[::1]") {
    hosts.push("[::1]");
    return [...new Set(hosts)];
  }
  hosts.push(b.includes(":") && !b.startsWith("[") ? `[${b}]` : b);
  return [...new Set(hosts)];
}

/**
 * A node path that survives the package manager upgrading node. Linuxbrew's Cellar path carries
 * the version (`Cellar/node/26.10.0_2/bin/node`) and is deleted by the next `brew upgrade`, so a
 * service pinned to it stops starting. `opt/<formula>` (also right for keg-only `node@22`) and
 * `bin/` are the stable links. GLASSYS_NODE wins when the operator sets it.
 */
export function stableNodePath(
  execPath = process.execPath,
  { env = process.env, exists = existsSync, realpath = realpathSync } = {},
) {
  const override = env.GLASSYS_NODE?.trim();
  if (override) return override;
  const brew = /^(.*)\/Cellar\/([^/]+)\/[^/]+\/bin\/node$/.exec(execPath);
  if (brew) {
    const [, prefix, formula] = brew;
    for (const candidate of [`${prefix}/opt/${formula}/bin/node`, `${prefix}/bin/node`]) {
      if (exists(candidate)) return candidate;
    }
  }
  // fnm: the `default` alias is a stable link; use it only while it points at this same node.
  const fnm = /^(.*)\/node-versions\/[^/]+\/installation\/bin\/node$/.exec(execPath);
  if (fnm) {
    const alias = `${fnm[1]}/aliases/default/bin/node`;
    try {
      if (exists(alias) && realpath(alias) === realpath(execPath)) return alias;
    } catch {
      /* keep execPath */
    }
  }
  return execPath;
}

/** True when a node path still names one installed version (nvm, fnm, volta, a Cellar keg). */
export function nodePathIsVersioned(nodePath) {
  return /\/Cellar\/|\/versions\/node\/|\/node-versions\/|\/v?\d+\.\d+\.\d+[^/]*\/(installation\/)?bin\//.test(nodePath);
}

/**
 * PATH for the service. The shell's PATH at install time carries entries that do not outlive it:
 * pnpm's `node_modules/.bin` dirs (and store hashes) when run through `pnpm run`, Linuxbrew Cellar
 * kegs, versioned tool dirs, temp dirs. Keep what is stable, drop what is gone, dedupe, and put
 * the node dir first.
 */
export function sanitizePath(envPath, nodeDir, { exists = existsSync } = {}) {
  const ephemeral = [
    /\/node_modules(\/|$)/,
    /\/\.pnpm(\/|$)/,
    /\/Cellar\//,
    /\/versions\/[^/]*\d[^/]*(\/|$)/,
    /\/v?\d+\.\d+\.\d+[^/]*(\/|$)/,
    /\/fnm_multishells\//,
    /^\/tmp(\/|$)/,
  ];
  const fallback = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  const out = [];
  for (const entry of [nodeDir, ...String(envPath || fallback).split(":")]) {
    if (!entry || !entry.startsWith("/")) continue;
    if (entry !== nodeDir && ephemeral.some((re) => re.test(entry))) continue;
    if (entry !== nodeDir && !exists(entry)) continue;
    if (!out.includes(entry)) out.push(entry);
  }
  for (const entry of ["/usr/bin", "/bin"]) if (!out.includes(entry)) out.push(entry);
  return out.join(":");
}

export function nodeMeetsMin(version = process.versions.node) {
  const parts = String(version)
    .split(".")
    .map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < MIN_NODE.length; i += 1) {
    const a = parts[i] ?? 0;
    const b = MIN_NODE[i];
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

/**
 * @param {{
 *   node: string;
 *   gateway: string;
 *   cwd: string;
 *   dataDir: string;
 *   webDir: string;
 *   home: string;
 *   path: string;
 *   graphical?: Record<string, string>;
 *   listenEnv?: Record<string, string>;
 * }} opts
 */
export function renderSystemdUserUnit(opts) {
  const env = [
    `NODE_ENV=production`,
    `HOME=${opts.home}`,
    `PATH=${opts.path}`,
    `GLASSYS_DATA_DIR=${opts.dataDir}`,
    `GLASSYS_WEB_DIR=${opts.webDir}`,
    `GLASSYS_SERVICE=1`,
  ];
  for (const [key, value] of Object.entries(opts.graphical ?? {})) {
    env.push(`${key}=${value}`);
  }
  for (const [key, value] of Object.entries(opts.listenEnv ?? {})) {
    env.push(`${key}=${value}`);
  }
  // StartLimitIntervalSec=0: with Restart=always, systemd's default limit (5 starts in 10s)
  // would leave the unit failed for good after a short crash loop.
  // WorkingDirectory= is a path setting: systemd does not unquote it, so a path with spaces goes
  // in as is. No After=network.target: a user manager has no such target to order against.
  return `[Unit]
Description=Glassys gateway
StartLimitIntervalSec=0

[Service]
Type=simple
WorkingDirectory=${systemdEscapeSpecifiers(opts.cwd)}
${env.map((line) => `Environment=${systemdQuote(line)}`).join("\n")}
ExecStart=${systemdQuote(opts.node)} ${systemdQuote(opts.gateway)}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}

export function systemdUserUnitPath(home = homedir()) {
  return join(home, ".config", "systemd", "user", SYSTEMD_UNIT);
}

export function resolveInstallPaths(env = process.env, root = repoRootFrom()) {
  const cwd = root;
  const home = env.HOME || homedir();
  const dataDir = env.GLASSYS_DATA_DIR || join(root, "data");
  const webDir = env.GLASSYS_WEB_DIR || join(root, "web", "dist");
  const node = stableNodePath(process.execPath, { env });
  const path = sanitizePath(env.PATH, dirname(node));
  return {
    node,
    gateway: join(root, "gateway", "dist", "index.js"),
    cwd,
    dataDir,
    webDir,
    home,
    path,
    graphical: graphicalEnvFrom(env),
    listenEnv: listenEnvFrom(env),
    port: gatewayListenPort(env),
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

export function isRoot(uid = process.getuid?.()) {
  return uid === 0;
}

/** Why a spawn never ran (a missing binary), or null when it ran and failed on its own. */
export function spawnFailure(cmd, result) {
  const code = result?.error?.code;
  if (code === "ENOENT") {
    if (cmd !== "pnpm") return `${cmd} is not on PATH.`;
    /* Node 25 and later no longer ship Corepack, so `corepack enable` alone is not always there. */
    return "pnpm is not on PATH. Run `corepack enable` (on Node 25+ install Corepack first: `npm install -g corepack`), or install pnpm from https://pnpm.io/installation.";
  }
  if (result?.error) return `${cmd} could not start: ${result.error.message}`;
  return null;
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
}

function ensureBuilt(root) {
  const gateway = join(root, "gateway", "dist", "index.js");
  const web = join(root, "web", "dist", "index.html");
  if (existsSync(gateway) && existsSync(web)) return;
  if (!existsSync(join(root, "node_modules"))) {
    fail("Run `pnpm install` in the Glassys repo, then `pnpm run service:install` again.");
  }
  console.log("Building Glassys (gateway + PWA)…");
  const built = spawnSync("pnpm", ["run", "build"], { cwd: root, stdio: "inherit" });
  if (built.status !== 0) fail("pnpm run build failed.");
  if (!existsSync(gateway) || !existsSync(web)) {
    fail("Build finished but gateway/dist or web/dist is missing.");
  }
}

/** The one-time code the gateway writes until the operator password is set, if any. */
export function readSetupCode(dataDir) {
  try {
    return readFileSync(join(dataDir, "setup-code"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

function printNextSteps(opts, health) {
  console.log("");
  console.log("Glassys is installed as a background service.");
  console.log("Closing the terminal will not stop it.");
  console.log("");
  console.log(`Open  ${openUrl(opts.listen)}`);
  console.log(`Data  ${opts.dataDir}`);
  if (nodePathIsVersioned(opts.node)) {
    console.warn(`Node  ${opts.node} names one installed version; set GLASSYS_NODE to a stable path and reinstall.`);
  }
  if (health.ok) console.log(`Health  ok${health.commit ? ` (${health.commit.slice(0, 7)})` : ""}`);
  else if (health.reason !== "skipped") {
    console.warn(`Health  ${health.reason}. Check service:status.`);
  }
  const setupCode = health.ok ? readSetupCode(opts.dataDir) : null;
  if (setupCode) {
    /* Setup from any other device (or through a proxy) asks for this code once. */
    console.log("");
    console.log(`Setup code  ${setupCode}`);
    console.log(`First run   ${openUrl(opts.listen)}/?setup=${encodeURIComponent(setupCode)}`);
  }
  console.log("");
  console.log("pnpm run service:status     # is it running?");
  console.log("pnpm run service:upgrade    # git pull, rebuild, restart");
  console.log("pnpm run service:uninstall  # stop and remove (keeps data/)");
}

/**
 * Poll GET /health on the real bind until it answers, and, when `expectCommit` is set, until it
 * answers with that commit: an old process still serving is a failed restart, not a success.
 * @returns {{ ok: boolean, commit?: string, reason?: string }}
 */
export function waitForHealth({ bind, port }, { timeoutMs = 8000, expectCommit } = {}) {
  const hosts = JSON.stringify(healthProbeHosts(bind));
  const script = `
    const port = ${Number(port)};
    const hosts = ${hosts};
    const expect = ${JSON.stringify(expectCommit || "")};
    const deadline = Date.now() + ${Number(timeoutMs)};
    let last = "";
    (async () => {
      while (Date.now() < deadline) {
        for (const host of hosts) {
          try {
            const res = await fetch("http://" + host + ":" + port + "/health", { signal: AbortSignal.timeout(2000) });
            if (!res.ok) continue;
            const body = await res.json().catch(() => ({}));
            last = body.commit || "";
            if (!expect || last === expect) {
              process.stdout.write(JSON.stringify({ ok: true, commit: last }));
              process.exit(0);
            }
          } catch {}
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      process.stdout.write(JSON.stringify({ ok: false, commit: last }));
      process.exit(1);
    })();
  `;
  const probe = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  let parsed = {};
  try {
    parsed = JSON.parse(probe.stdout || "{}");
  } catch {
    /* no output */
  }
  if (probe.status === 0) return { ok: true, commit: parsed.commit || undefined };
  const urls = healthProbeHosts(bind).map((host) => `http://${host}:${port}/health`).join(" or ");
  if (expectCommit && parsed.commit) {
    return {
      ok: false,
      commit: parsed.commit,
      reason: `gateway at ${urls} still runs ${parsed.commit.slice(0, 7)}, not ${expectCommit.slice(0, 7)}`,
    };
  }
  return { ok: false, reason: `gateway did not answer GET ${urls}` };
}

function enableLinger(username) {
  const probe = run("loginctl", ["show-user", username, "-p", "Linger"]);
  if (probe.status === 0 && /Linger=yes/.test(probe.stdout || "")) return true;
  const attempt = run("loginctl", ["enable-linger", username]);
  if (attempt.status === 0) return true;
  console.warn("");
  console.warn("This Linux user session will stop Glassys when you log out (SSH close).");
  console.warn("Keep it running after logout with:");
  console.warn(`  sudo loginctl enable-linger ${username}`);
  return false;
}

function installLinux(opts) {
  mkdirSync(opts.dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(systemdUserUnitPath(opts.home)), { recursive: true });
  const unit = systemdUserUnitPath(opts.home);
  writeFileSync(unit, renderSystemdUserUnit(opts));
  const reload = run("systemctl", ["--user", "daemon-reload"]);
  if (reload.status !== 0) {
    throw new Error(`systemctl --user daemon-reload failed:\n${reload.stderr || reload.stdout || ""}`);
  }
  try {
    enableLinger(userInfo().username);
  } catch {
    console.warn("Could not check systemd linger. If Glassys dies on SSH logout, run: sudo loginctl enable-linger $USER");
  }
  console.log(`Wrote ${unit}`);
  const insideUnit = runningInsideUnit();
  for (const args of systemdStartCommands({ insideUnit })) {
    const res = run("systemctl", args);
    if (res.status !== 0) {
      // Thrown, not exited: an upgrade records the failure in upgrade-status.json first.
      throw new Error(`systemctl ${args.join(" ")} failed:\n${res.stderr || res.stdout || ""}`);
    }
  }
  if (insideUnit) return { ok: true, detached: true };
  return finishInstall(opts);
}

/**
 * `enable --now` starts a stopped unit but leaves a running one alone, so an upgrade kept the old
 * process serving. Enable, then restart. A script running inside the unit's own cgroup (an
 * upgrade started from the PWA) is killed by that restart, so it queues the job and lets the new
 * gateway close the run (reconcileUpgradeStatus).
 */
export function systemdStartCommands({ insideUnit = false } = {}) {
  return [
    ["--user", "enable", SYSTEMD_UNIT],
    ["--user", "restart", ...(insideUnit ? ["--no-block"] : []), SYSTEMD_UNIT],
  ];
}

/** Whether this process lives in glassys.service's cgroup (spawned by the gateway). */
export function runningInsideUnit(readCgroup = () => readFileSync("/proc/self/cgroup", "utf8")) {
  try {
    return /\/glassys\.service(\/|$)/m.test(readCgroup());
  } catch {
    return false;
  }
}

function finishInstall(opts) {
  const health = waitForHealth(opts.listen, {
    timeoutMs: opts.expectCommit ? 30_000 : 8000,
    expectCommit: opts.expectCommit,
  });
  printNextSteps(opts, health);
  return health;
}

function uninstallLinux(opts) {
  run("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT]);
  run("systemctl", ["--user", "daemon-reload"]);
  const unit = systemdUserUnitPath(opts.home);
  if (existsSync(unit)) rmSync(unit);
  console.log("Removed the Glassys user systemd unit.");
}

function statusLinux() {
  const st = spawnSync("systemctl", ["--user", "status", SYSTEMD_UNIT], { stdio: "inherit" });
  process.exit(st.status === 0 ? 0 : 1);
}

/** Glassys is built for Linux servers: systemd, the journal and the host views assume one. */
export function linuxOnlyMessage(platform) {
  return `Glassys runs on Linux only (systemd --user); this host is ${platform}.`;
}

export async function main(argv = process.argv.slice(2), platform = process.platform) {
  const cmd = argv[0] || "install";
  if (cmd === "-h" || cmd === "--help" || cmd === "help") {
    console.log(`Usage: node scripts/host-service.mjs <install|uninstall|status|upgrade|print>

install     build if needed, then install and start a user service
upgrade     git pull --ff-only, pnpm install, build, reinstall and restart the user service
            (--allow-stale: keep going with the current clone when the pull fails)
uninstall   stop and remove the user service
status      show whether the service is running
print       write the systemd unit to stdout (no install)
`);
    return;
  }
  if (!nodeMeetsMin()) {
    fail(`Glassys needs Node.js 22.13+ (this is v${process.versions.node}).`);
  }
  if (platform !== "linux") {
    fail(linuxOnlyMessage(platform));
  }

  const root = repoRootFrom();
  const opts = resolveInstallPaths(process.env, root);
  opts.listen = await resolveListen(root, opts.dataDir);

  if (cmd === "print") {
    process.stdout.write(renderSystemdUserUnit(opts));
    return;
  }

  if (cmd === "status") {
    statusLinux();
    return;
  }

  if (cmd === "uninstall") {
    uninstallLinux(opts);
    return;
  }

  if ((cmd === "install" || cmd === "upgrade") && isRoot()) {
    fail("Do not install Glassys as root. Run this as the user the agent should act as.");
  }

  if (cmd === "upgrade") {
    const strict = !argv.includes("--allow-stale") && process.env.GLASSYS_UPGRADE_STRICT !== "0";
    upgradeRun = {
      startedAt: process.env.GLASSYS_UPGRADE_STARTED_AT || new Date().toISOString(),
      fromSha: gitHead(root),
    };
    writeUpgradeStatus(opts.dataDir, "pulling");
    try {
      upgradeRepo(root, { strict, dataDir: opts.dataDir });
      const targetSha = gitHead(root);
      if (targetSha) upgradeRun.targetSha = targetSha;
      opts.expectCommit = targetSha;
      mkdirSync(opts.dataDir, { recursive: true, mode: 0o700 });
      // Written before the restart: on systemd the restart can stop this script, and the new
      // gateway reads this to close the run.
      writeUpgradeStatus(opts.dataDir, "restart");
      const health = installLinux(opts);
      if (health.detached) return;
      if (!health.ok) throw new Error(`Upgrade restart did not come up: ${health.reason}`);
      writeUpgradeStatus(opts.dataDir, "idle");
    } catch (err) {
      writeUpgradeStatus(opts.dataDir, "error", err instanceof Error ? err.message : String(err));
      throw err;
    }
    return;
  }

  if (cmd !== "install") fail(`Unknown command: ${cmd}`);

  ensureBuilt(root);
  mkdirSync(opts.dataDir, { recursive: true, mode: 0o700 });
  installLinux(opts);
}

/** @type {{ startedAt?: string, fromSha?: string, targetSha?: string }} */
let upgradeRun = {};

function gitHead(root) {
  const res = run("git", ["rev-parse", "HEAD"], { cwd: root, timeout: 5000 });
  const sha = (res.stdout || "").trim();
  return res.status === 0 && /^[0-9a-f]{40,64}$/.test(sha) ? sha : undefined;
}

/**
 * Same file and shape the gateway writes (admin-update.ts): owner-only, replaced atomically so a
 * looser mode left by an older build does not survive, and `startedAt` fixed for the whole run.
 */
export function writeUpgradeStatus(dataDir, phase, error, run = upgradeRun) {
  try {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const target = join(dataDir, "upgrade-status.json");
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const body = {
      phase,
      ...(error ? { error } : {}),
      startedAt: run.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(run.fromSha ? { fromSha: run.fromSha } : {}),
      ...(run.targetSha ? { targetSha: run.targetSha } : {}),
      // Lets the gateway tell a running upgrade from one that died mid-way.
      ...(phase !== "idle" && phase !== "error" ? { pid: process.pid } : {}),
    };
    writeFileSync(tmp, JSON.stringify(body, null, 2), { mode: 0o600 });
    renameSync(tmp, target);
  } catch {
    /* ignore */
  }
}

export function upgradeRepo(root, { strict = true, dataDir, gitPull, pnpmInstall, pnpmBuild } = {}) {
  const pull = gitPull ? gitPull() : run("git", ["pull", "--ff-only"], { cwd: root });
  if (pull.status !== 0) {
    const detail = (pull.stderr || pull.stdout || "git pull --ff-only failed").trim();
    if (strict) {
      if (dataDir) writeUpgradeStatus(dataDir, "error", detail);
      throw new Error(
        `git pull --ff-only failed:\n${detail}\n\n` +
          "Nothing was upgraded. Usual causes: local commits or changes in this clone, or the remote " +
          "history was rewritten. If you have nothing local to keep: git fetch && git reset --hard @{u}, " +
          "then run the upgrade again. To rebuild the current clone anyway: service:upgrade -- --allow-stale",
      );
    }
    console.warn("git pull --ff-only failed; --allow-stale: continuing with the current clone.");
    if (pull.stderr) console.warn(pull.stderr.trim());
  }
  if (dataDir) writeUpgradeStatus(dataDir, "install");
  /* --frozen-lockfile: a lockfile rewritten here would leave the clone dirty, and the PWA refuses
     every later upgrade of a dirty clone. */
  const inst = pnpmInstall
    ? pnpmInstall()
    : spawnSync("pnpm", ["install", "--frozen-lockfile"], { cwd: root, stdio: "inherit" });
  if (inst.status !== 0) {
    const why = spawnFailure("pnpm", inst) ?? "pnpm install failed.";
    if (dataDir) writeUpgradeStatus(dataDir, "error", why);
    throw new Error(why);
  }
  if (dataDir) writeUpgradeStatus(dataDir, "build");
  const built = pnpmBuild
    ? pnpmBuild()
    : spawnSync("pnpm", ["run", "build"], { cwd: root, stdio: "inherit" });
  if (built.status !== 0) {
    const why = spawnFailure("pnpm", built) ?? "pnpm run build failed.";
    if (dataDir) writeUpgradeStatus(dataDir, "error", why);
    throw new Error(why);
  }
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
  main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
}
