#!/usr/bin/env node
/**
 * Install Glassys as a user service (launchd on macOS, systemd --user on Linux)
 * so closing the terminal does not stop the gateway.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SERVICE_LABEL = "dev.kn990x.glassys";
export const SYSTEMD_UNIT = "glassys.service";

const MIN_NODE = [22, 13, 0];

export function repoRootFrom(scriptUrl = import.meta.url) {
  return join(dirname(fileURLToPath(scriptUrl)), "..");
}

export function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function systemdQuote(value) {
  if (/^[A-Za-z0-9_./:@%+=-]+$/.test(value)) return value;
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
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
 * }} opts
 */
export function renderSystemdUserUnit(opts) {
  const env = [
    `NODE_ENV=production`,
    `HOME=${opts.home}`,
    `PATH=${opts.path}`,
    `GLASSYS_DATA_DIR=${opts.dataDir}`,
    `GLASSYS_WEB_DIR=${opts.webDir}`,
  ];
  for (const [key, value] of Object.entries(opts.graphical ?? {})) {
    env.push(`${key}=${value}`);
  }
  return `[Unit]
Description=Glassys gateway
After=network.target

[Service]
Type=simple
WorkingDirectory=${opts.cwd}
${env.map((line) => `Environment=${systemdQuote(line)}`).join("\n")}
ExecStart=${systemdQuote(opts.node)} ${systemdQuote(opts.gateway)}
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
`;
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
 *   logOut: string;
 *   logErr: string;
 * }} opts
 */
export function renderLaunchdPlist(opts) {
  const env = {
    NODE_ENV: "production",
    HOME: opts.home,
    PATH: opts.path,
    GLASSYS_DATA_DIR: opts.dataDir,
    GLASSYS_WEB_DIR: opts.webDir,
    ...(opts.graphical ?? {}),
  };
  const envXml = Object.entries(env)
    .map(
      ([k, v]) =>
        `      <key>${xmlEscape(k)}</key>\n      <string>${xmlEscape(v)}</string>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(SERVICE_LABEL)}</string>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(opts.cwd)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(opts.node)}</string>
    <string>${xmlEscape(opts.gateway)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(opts.logOut)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(opts.logErr)}</string>
</dict>
</plist>
`;
}

export function launchdPlistPath(home = homedir()) {
  return join(home, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
}

export function systemdUserUnitPath(home = homedir()) {
  return join(home, ".config", "systemd", "user", SYSTEMD_UNIT);
}

export function resolveInstallPaths(env = process.env, root = repoRootFrom()) {
  const cwd = root;
  const home = env.HOME || homedir();
  const dataDir = env.GLASSYS_DATA_DIR || join(root, "data");
  const webDir = env.GLASSYS_WEB_DIR || join(root, "web", "dist");
  const nodeDir = dirname(process.execPath);
  const path = [nodeDir, env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin"]
    .filter(Boolean)
    .join(":");
  return {
    node: process.execPath,
    gateway: join(root, "gateway", "dist", "index.js"),
    cwd,
    dataDir,
    webDir,
    home,
    path,
    logOut: join(dataDir, "glassys.log"),
    logErr: join(dataDir, "glassys.err"),
    graphical: graphicalEnvFrom(env),
    port: gatewayListenPort(env),
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
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

function printNextSteps(opts) {
  console.log("");
  console.log("Glassys is installed as a background service.");
  console.log("Closing the terminal will not stop it.");
  console.log("");
  const port = opts.port || gatewayListenPort();
  console.log(`Open  http://127.0.0.1:${port}`);
  console.log(`Data  ${opts.dataDir}`);
  console.log("");
  console.log("pnpm run service:status     # is it running?");
  console.log("pnpm run service:uninstall  # stop and remove (keeps data/)");
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

function installDarwin(opts) {
  mkdirSync(dirname(opts.logOut), { recursive: true });
  mkdirSync(dirname(launchdPlistPath(opts.home)), { recursive: true });
  const plist = launchdPlistPath(opts.home);
  writeFileSync(plist, renderLaunchdPlist(opts));
  const uid = String(userInfo().uid);
  const domain = `gui/${uid}`;
  const target = `${domain}/${SERVICE_LABEL}`;
  run("launchctl", ["bootout", target]);
  const boot = run("launchctl", ["bootstrap", domain, plist]);
  if (boot.status !== 0) {
    fail(`launchctl bootstrap failed:\n${boot.stderr || boot.stdout || ""}`);
  }
  console.log(`Wrote ${plist}`);
  printNextSteps(opts);
}

function uninstallDarwin(opts) {
  const uid = String(userInfo().uid);
  const target = `gui/${uid}/${SERVICE_LABEL}`;
  run("launchctl", ["bootout", target]);
  const plist = launchdPlistPath(opts.home);
  if (existsSync(plist)) rmSync(plist);
  console.log("Removed the Glassys LaunchAgent.");
}

function statusDarwin() {
  const uid = String(userInfo().uid);
  const printed = run("launchctl", ["print", `gui/${uid}/${SERVICE_LABEL}`]);
  if (printed.status !== 0) {
    console.log("Glassys service is not loaded.");
    process.exit(1);
  }
  process.stdout.write(printed.stdout || printed.stderr || "");
}

function installLinux(opts) {
  mkdirSync(opts.dataDir, { recursive: true });
  mkdirSync(dirname(systemdUserUnitPath(opts.home)), { recursive: true });
  const unit = systemdUserUnitPath(opts.home);
  writeFileSync(unit, renderSystemdUserUnit(opts));
  const reload = run("systemctl", ["--user", "daemon-reload"]);
  if (reload.status !== 0) {
    fail(`systemctl --user daemon-reload failed:\n${reload.stderr || reload.stdout || ""}`);
  }
  const enable = run("systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT]);
  if (enable.status !== 0) {
    fail(`systemctl --user enable --now failed:\n${enable.stderr || enable.stdout || ""}`);
  }
  try {
    enableLinger(userInfo().username);
  } catch {
    console.warn("Could not check systemd linger. If Glassys dies on SSH logout, run: sudo loginctl enable-linger $USER");
  }
  console.log(`Wrote ${unit}`);
  printNextSteps(opts);
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

export function main(argv = process.argv.slice(2), platform = process.platform) {
  const cmd = argv[0] || "install";
  if (cmd === "-h" || cmd === "--help" || cmd === "help") {
    console.log(`Usage: node scripts/host-service.mjs <install|uninstall|status|print>

install     build if needed, then install and start a user service
uninstall   stop and remove the user service
status      show whether the service is running
print       write the unit/plist to stdout (no install)
`);
    return;
  }
  if (!nodeMeetsMin()) {
    fail(`Glassys needs Node.js 22.13+ (this is v${process.versions.node}).`);
  }
  if (platform !== "darwin" && platform !== "linux") {
    fail(`No user-service installer for ${platform}. Run in the foreground: pnpm start`);
  }

  const root = repoRootFrom();
  const opts = resolveInstallPaths(process.env, root);

  if (cmd === "print") {
    const body = platform === "darwin" ? renderLaunchdPlist(opts) : renderSystemdUserUnit(opts);
    process.stdout.write(body);
    return;
  }

  if (cmd === "status") {
    if (platform === "darwin") statusDarwin();
    else statusLinux();
    return;
  }

  if (cmd === "uninstall") {
    if (platform === "darwin") uninstallDarwin(opts);
    else uninstallLinux(opts);
    return;
  }

  if (cmd !== "install") fail(`Unknown command: ${cmd}`);

  ensureBuilt(root);
  mkdirSync(opts.dataDir, { recursive: true });
  if (platform === "darwin") installDarwin(opts);
  else installLinux(opts);
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
