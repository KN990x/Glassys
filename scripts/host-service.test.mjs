import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  gatewayListenPort,
  nodePathIsVersioned,
  openUrl,
  runningInsideUnit,
  sanitizePath,
  stableNodePath,
  systemdStartCommands,
  writeUpgradeStatus,
  graphicalEnvFrom,
  healthProbeHosts,
  isRoot,
  nodeMeetsMin,
  renderLaunchdPlist,
  renderSystemdUserUnit,
  systemdQuote,
  spawnFailure,
  upgradeRepo,
  xmlEscape,
} from "./host-service.mjs";

const opts = {
  node: "/opt/homebrew/bin/node",
  gateway: "/opt/glassys/gateway/dist/index.js",
  cwd: "/opt/glassys",
  dataDir: "/opt/glassys/data",
  webDir: "/opt/glassys/web/dist",
  home: "/Users/op",
  path: "/opt/homebrew/bin:/usr/bin:/bin",
  logOut: "/opt/glassys/data/glassys.log",
  logErr: "/opt/glassys/data/glassys.err",
};

test("nodeMeetsMin accepts 22.13+", () => {
  assert.equal(nodeMeetsMin("22.13.0"), true);
  assert.equal(nodeMeetsMin("22.22.2"), true);
  assert.equal(nodeMeetsMin("23.0.0"), true);
  assert.equal(nodeMeetsMin("22.12.0"), false);
  assert.equal(nodeMeetsMin("20.19.0"), false);
});

test("xmlEscape encodes plist specials", () => {
  assert.equal(xmlEscape(`a&b<"c">`), "a&amp;b&lt;&quot;c&quot;&gt;");
});

test("systemdQuote leaves safe paths, quotes spaces", () => {
  assert.equal(systemdQuote("/usr/bin/node"), "/usr/bin/node");
  assert.equal(systemdQuote("/home/op/My Apps/node"), `"/home/op/My Apps/node"`);
});

test("launchd plist keeps the process alive and does not embed secrets", () => {
  const xml = renderLaunchdPlist(opts);
  assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(xml, /<string>\/opt\/homebrew\/bin\/node<\/string>/);
  assert.match(xml, /<key>GLASSYS_SERVICE<\/key>\s*<string>1<\/string>/);
  assert.match(xml, /<key>GLASSYS_DATA_DIR<\/key>\s*<string>\/opt\/glassys\/data<\/string>/);
  assert.doesNotMatch(xml, /CURSOR_API_KEY|ANTHROPIC_API_KEY|password/i);
});

test("systemd user unit restarts and uses default.target", () => {
  const unit = renderSystemdUserUnit(opts);
  assert.match(unit, /StartLimitIntervalSec=0/);
  assert.match(unit, /Environment=GLASSYS_SERVICE=1/);
  assert.match(unit, /Restart=always/);
  assert.match(unit, /WantedBy=default.target/);
  assert.match(unit, /WorkingDirectory=\/opt\/glassys/);
  assert.match(unit, /ExecStart=\/opt\/homebrew\/bin\/node \/opt\/glassys\/gateway\/dist\/index.js/);
  assert.doesNotMatch(unit, /CURSOR_API_KEY|User=glassys/);
  assert.doesNotMatch(unit, /Environment=DISPLAY=/);
});

test("systemd user unit writes a working directory with spaces as is, escaping %", () => {
  const unit = renderSystemdUserUnit({ ...opts, cwd: "/home/op/My Apps/50%/glassys" });
  assert.match(unit, /WorkingDirectory=\/home\/op\/My Apps\/50%%\/glassys\n/);
  assert.doesNotMatch(unit, /After=network.target/);
});

test("systemdQuote escapes specifiers", () => {
  assert.equal(systemdQuote("/opt/50%/node"), "/opt/50%%/node");
});

test("spawnFailure names a missing binary", () => {
  assert.match(spawnFailure("pnpm", { error: Object.assign(new Error("spawn pnpm ENOENT"), { code: "ENOENT" }) }), /not on PATH/);
  assert.equal(spawnFailure("pnpm", { status: 1 }), null);
});

test("isRoot only flags uid 0", () => {
  assert.equal(isRoot(0), true);
  assert.equal(isRoot(501), false);
  assert.equal(isRoot(undefined), false);
});

test("systemd user unit inherits graphical session env when present", () => {
  const unit = renderSystemdUserUnit({
    ...opts,
    graphical: graphicalEnvFrom({
      DISPLAY: ":0",
      WAYLAND_DISPLAY: "wayland-0",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
      CURSOR_API_KEY: "cursor_secret",
    }),
  });
  assert.match(unit, /Environment=DISPLAY=:0/);
  assert.match(unit, /Environment=WAYLAND_DISPLAY=wayland-0/);
  assert.match(unit, /Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=\/run\/user\/1000\/bus/);
  assert.doesNotMatch(unit, /CURSOR_API_KEY/);
});

test("healthProbeHosts tries loopback then a LAN bind", () => {
  assert.deepEqual(healthProbeHosts("127.0.0.1"), ["127.0.0.1"]);
  assert.deepEqual(healthProbeHosts("0.0.0.0"), ["127.0.0.1"]);
  assert.deepEqual(healthProbeHosts("192.168.1.10"), ["127.0.0.1", "192.168.1.10"]);
  assert.deepEqual(healthProbeHosts("::1"), ["127.0.0.1", "[::1]"]);
});

test("gatewayListenPort reads GLASSYS_PORT", () => {
  assert.equal(gatewayListenPort({}), 8787);
  assert.equal(gatewayListenPort({ GLASSYS_PORT: "9000" }), 9000);
  assert.equal(gatewayListenPort({ GLASSYS_PORT: "nope" }), 8787);
});

test("unit and plist inject GLASSYS_PORT from listenEnv", () => {
  const unit = renderSystemdUserUnit({
    ...opts,
    listenEnv: { GLASSYS_PORT: "9000", GLASSYS_BIND: "127.0.0.1" },
  });
  assert.match(unit, /Environment=GLASSYS_PORT=9000/);
  assert.match(unit, /Environment=GLASSYS_BIND=127.0.0.1/);
  const xml = renderLaunchdPlist({
    ...opts,
    listenEnv: { GLASSYS_PORT: "9000", GLASSYS_BIND: "127.0.0.1" },
  });
  assert.match(xml, /<key>GLASSYS_PORT<\/key>\s*<string>9000<\/string>/);
  assert.match(xml, /<key>GLASSYS_BIND<\/key>\s*<string>127.0.0.1<\/string>/);
});

test("a failed git pull stops the upgrade by default", () => {
  let installed = false;
  let built = false;
  assert.throws(
    () =>
      upgradeRepo("/tmp", {
        gitPull: () => ({ status: 1, stderr: "not ff", stdout: "" }),
        pnpmInstall: () => {
          installed = true;
          return { status: 0 };
        },
        pnpmBuild: () => {
          built = true;
          return { status: 0 };
        },
      }),
    /ff-only/,
  );
  assert.equal(installed, false);
  assert.equal(built, false);
});

test("--allow-stale keeps going with the current clone", () => {
  let built = false;
  upgradeRepo("/tmp", {
    strict: false,
    gitPull: () => ({ status: 1, stderr: "not ff", stdout: "" }),
    pnpmInstall: () => ({ status: 0 }),
    pnpmBuild: () => {
      built = true;
      return { status: 0 };
    },
  });
  assert.equal(built, true);
});

test("systemd install restarts a running unit instead of enable --now", () => {
  const cmds = systemdStartCommands();
  assert.deepEqual(cmds[0], ["--user", "enable", "glassys.service"]);
  assert.deepEqual(cmds[1], ["--user", "restart", "glassys.service"]);
  assert.ok(!cmds.flat().includes("--now"));
  assert.deepEqual(systemdStartCommands({ insideUnit: true })[1], ["--user", "restart", "--no-block", "glassys.service"]);
});

test("runningInsideUnit reads the systemd cgroup", () => {
  assert.equal(runningInsideUnit(() => "0::/user.slice/user-1000.slice/user@1000.service/app.slice/glassys.service\n"), true);
  assert.equal(runningInsideUnit(() => "0::/user.slice/user-1000.slice/session-3.scope\n"), false);
  assert.equal(runningInsideUnit(() => { throw new Error("no /proc"); }), false);
});

test("stableNodePath swaps a Homebrew Cellar path for the opt link", () => {
  const exists = (p) => p === "/home/op/.linuxbrew/opt/node/bin/node" || p === "/home/op/.linuxbrew/bin/node";
  assert.equal(
    stableNodePath("/home/op/.linuxbrew/Cellar/node/26.10.0_2/bin/node", { env: {}, exists }),
    "/home/op/.linuxbrew/opt/node/bin/node",
  );
  assert.equal(
    stableNodePath("/opt/homebrew/Cellar/node@22/22.13.0/bin/node", {
      env: {},
      exists: (p) => p === "/opt/homebrew/opt/node@22/bin/node",
    }),
    "/opt/homebrew/opt/node@22/bin/node",
  );
  assert.equal(stableNodePath("/usr/bin/node", { env: {}, exists }), "/usr/bin/node");
  assert.equal(stableNodePath("/x/Cellar/node/1/bin/node", { env: { GLASSYS_NODE: "/usr/local/bin/node" }, exists }), "/usr/local/bin/node");
});

test("stableNodePath uses fnm's default alias only when it is the same node", () => {
  const exec = "/h/.local/share/fnm/node-versions/v22.22.2/installation/bin/node";
  const alias = "/h/.local/share/fnm/aliases/default/bin/node";
  assert.equal(stableNodePath(exec, { env: {}, exists: () => true, realpath: () => exec }), alias);
  assert.equal(
    stableNodePath(exec, { env: {}, exists: () => true, realpath: (p) => (p === alias ? "/other/node" : exec) }),
    exec,
  );
});

test("nodePathIsVersioned flags version-pinned paths", () => {
  assert.equal(nodePathIsVersioned("/home/op/.linuxbrew/Cellar/node/26.10.0_2/bin/node"), true);
  assert.equal(nodePathIsVersioned("/home/op/.nvm/versions/node/v22.13.0/bin/node"), true);
  assert.equal(nodePathIsVersioned("/home/op/.linuxbrew/bin/node"), false);
  assert.equal(nodePathIsVersioned("/usr/bin/node"), false);
});

test("sanitizePath drops pnpm, Cellar, versioned and missing dirs", () => {
  const path = [
    "/repo/node_modules/.bin",
    "/home/op/.local/share/pnpm/.pnpm/abc/node_modules/.bin",
    "/home/op/.linuxbrew/Cellar/node/26.10.0_2/bin",
    "/home/op/.local/share/cursor-agent/versions/2026.09.28-abc",
    "/Users/op/.local/state/fnm_multishells/1900_17/bin",
    "/tmp/xyz",
    "/home/op/.local/bin",
    "/gone",
    "/usr/bin",
    "/home/op/.local/bin",
  ].join(":");
  const out = sanitizePath(path, "/home/op/.linuxbrew/bin", { exists: (p) => p !== "/gone" });
  assert.equal(out, "/home/op/.linuxbrew/bin:/home/op/.local/bin:/usr/bin:/bin");
});

test("openUrl prefers the public URL, else the address actually bound", () => {
  assert.equal(openUrl({ bind: "172.18.0.1", port: 8787, publicUrl: "" }), "http://172.18.0.1:8787");
  assert.equal(openUrl({ bind: "0.0.0.0", port: 9000, publicUrl: "" }), "http://127.0.0.1:9000");
  assert.equal(openUrl({ bind: "127.0.0.1", port: 8787, publicUrl: "https://glassys.example" }), "https://glassys.example");
});

test("upgrade status is owner-only, replaces a looser file and keeps startedAt", () => {
  const dir = mkdtempSync(join(tmpdir(), "glassys-status-"));
  const file = join(dir, "upgrade-status.json");
  writeFileSync(file, "{}", { mode: 0o664 });
  const run = { startedAt: "2026-10-06T10:00:00.000Z", fromSha: "a".repeat(40) };
  writeUpgradeStatus(dir, "pulling", undefined, run);
  writeUpgradeStatus(dir, "build", undefined, run);
  const body = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(body.phase, "build");
  assert.equal(body.startedAt, run.startedAt);
  assert.equal(body.fromSha, run.fromSha);
  assert.equal(statSync(file).mode & 0o777, 0o600);
});
