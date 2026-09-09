import assert from "node:assert/strict";
import { test } from "node:test";
import {
  gatewayListenPort,
  graphicalEnvFrom,
  healthProbeHosts,
  nodeMeetsMin,
  renderLaunchdPlist,
  renderSystemdUserUnit,
  systemdQuote,
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
  assert.match(unit, /Environment=GLASSYS_SERVICE=1/);
  assert.match(unit, /Restart=always/);
  assert.match(unit, /WantedBy=default.target/);
  assert.match(unit, /WorkingDirectory=\/opt\/glassys/);
  assert.match(unit, /ExecStart=\/opt\/homebrew\/bin\/node \/opt\/glassys\/gateway\/dist\/index.js/);
  assert.doesNotMatch(unit, /CURSOR_API_KEY|User=glassys/);
  assert.doesNotMatch(unit, /Environment=DISPLAY=/);
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

test("strict git pull failure does not install or build", () => {
  let installed = false;
  let built = false;
  assert.throws(
    () =>
      upgradeRepo("/tmp", {
        strict: true,
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
