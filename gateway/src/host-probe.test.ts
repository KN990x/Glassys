import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hostCapabilities,
  listDir,
  listServices,
  parseDf,
  parseJournal,
  parseLaunchctl,
  parseMeminfoSwap,
  parseOsRelease,
  parseSystemctlJson,
  parseSystemctlPlain,
  previewFile,
  readLogs,
  setHostProbeForTests,
  validUnit,
  type Exec,
} from "./host-probe.js";

const DF = `Filesystem     1024-blocks      Used Available Capacity Mounted on
udev               4001234         0   4001234       0% /dev
tmpfs               803456      1234    802222       1% /run
/dev/sda1         51290592  48212344   3078248      94% /
/dev/sda1         51290592  48212344   3078248      94% /var/lib/docker/overlay
/dev/loop3           65536     65536         0     100% /snap/core/123
/dev/sdb1        103081248  20000000  83081248      20% /srv/data with space
`;

describe("parsers", () => {
  it("keeps real block devices from df, once each", () => {
    expect(parseDf(DF)).toEqual([
      { fs: "/dev/sda1", mount: "/", size: 51290592 * 1024, used: 48212344 * 1024 },
      { fs: "/dev/sdb1", mount: "/srv/data with space", size: 103081248 * 1024, used: 20000000 * 1024 },
    ]);
  });

  it("keeps only the system and data volumes on macOS", () => {
    const mac = `Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/disk3s1s1 482797652 11000000 200000000 6% /
/dev/disk3s6 482797652 4000000 200000000 2% /System/Volumes/VM
/dev/disk3s5 482797652 250000000 200000000 56% /System/Volumes/Data
`;
    expect(parseDf(mac).map((d) => d.mount)).toEqual(["/", "/System/Volumes/Data"]);
  });

  it("reads swap and the distribution name", () => {
    expect(parseMeminfoSwap("SwapTotal:  2048 kB\nSwapFree:   512 kB\n")).toEqual({ total: 2048 * 1024, used: 1536 * 1024 });
    expect(parseMeminfoSwap("SwapTotal: 0 kB\nSwapFree: 0 kB\n")).toBeUndefined();
    expect(parseOsRelease('NAME="Debian"\nPRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\n')).toBe("Debian GNU/Linux 12 (bookworm)");
  });

  it("reads systemctl in JSON and in plain columns", () => {
    const json = JSON.stringify([
      { unit: "caddy.service", load: "loaded", active: "active", sub: "running", description: "Caddy" },
      { unit: "backup.service", load: "loaded", active: "failed", sub: "failed", description: "Nightly backup" },
    ]);
    expect(parseSystemctlJson(json)[1]).toEqual({
      name: "backup.service",
      load: "loaded",
      active: "failed",
      sub: "failed",
      description: "Nightly backup",
    });
    const plain = "● backup.service loaded failed failed Nightly backup\n  caddy.service  loaded active running Caddy web server\n";
    expect(parseSystemctlPlain(plain)).toEqual([
      { name: "backup.service", load: "loaded", active: "failed", sub: "failed", description: "Nightly backup" },
      { name: "caddy.service", load: "loaded", active: "active", sub: "running", description: "Caddy web server" },
    ]);
  });

  it("reads launchctl list", () => {
    const out = "PID\tStatus\tLabel\n123\t0\tcom.example.run\n-\t78\tcom.example.broken\n-\t0\tcom.example.idle\n";
    expect(parseLaunchctl(out).map((u) => [u.name, u.active])).toEqual([
      ["com.example.run", "active"],
      ["com.example.broken", "failed"],
      ["com.example.idle", "inactive"],
    ]);
  });

  it("reads journald JSON, including byte-array messages", () => {
    const lines = [
      JSON.stringify({ __REALTIME_TIMESTAMP: "1700000000000000", PRIORITY: "3", MESSAGE: "boom", _SYSTEMD_UNIT: "backup.service", _PID: "42", __CURSOR: "c1" }),
      JSON.stringify({ __REALTIME_TIMESTAMP: "1700000001000000", PRIORITY: "6", MESSAGE: [104, 105], SYSLOG_IDENTIFIER: "kernel", __CURSOR: "c2" }),
      "not json",
    ].join("\n");
    expect(parseJournal(lines)).toEqual({
      entries: [
        { ts: 1700000000000, priority: 3, message: "boom", unit: "backup.service", pid: 42 },
        { ts: 1700000001000, priority: 6, message: "hi", unit: "kernel" },
      ],
      cursor: "c2",
    });
  });

  it("refuses a unit name that could be read as a flag", () => {
    expect(validUnit("nginx.service")).toBe(true);
    expect(validUnit("getty@tty1.service")).toBe(true);
    expect(validUnit("--since=yesterday")).toBe(false);
    expect(validUnit("a b")).toBe(false);
  });
});

describe("probes", () => {
  let calls: string[][];

  function fake(outputs: Record<string, string>): Exec {
    return async (cmd, args) => {
      calls.push([cmd, ...args]);
      const key = Object.keys(outputs).find((k) => [cmd, ...args].join(" ").startsWith(k));
      if (key === undefined) throw new Error(`not found: ${cmd}`);
      return { stdout: outputs[key]! };
    };
  }

  beforeEach(() => {
    calls = [];
  });
  afterEach(() => setHostProbeForTests(null));

  it("detects systemd and journald on Linux", async () => {
    setHostProbeForTests(fake({ "systemctl --version": "systemd 252", "journalctl --version": "systemd 252" }), "linux");
    expect(await hostCapabilities()).toEqual({ overview: true, services: "systemd", logs: "journald", files: true });
  });

  it("reports no service manager or journal where there is none", async () => {
    setHostProbeForTests(fake({}), "win32");
    expect(await hostCapabilities()).toEqual({ overview: true, services: null, logs: null, files: true });
    await expect(listServices("system", "all")).rejects.toMatchObject({ status: 404 });
    await expect(readLogs({})).rejects.toMatchObject({ status: 404 });
  });

  it("falls back to plain systemctl output and filters by state", async () => {
    setHostProbeForTests(
      async (cmd, args) => {
        calls.push([cmd, ...args]);
        if (args[0] === "--version") return { stdout: "systemd 239" };
        if (args.includes("--output=json")) throw new Error("unknown option");
        return { stdout: "● backup.service loaded failed failed Nightly backup\ncaddy.service loaded active running Caddy\n" };
      },
      "linux",
    );
    const failed = await listServices("user", "failed");
    expect(failed.map((u) => u.name)).toEqual(["backup.service"]);
    expect(calls.some((c) => c.includes("--user") && c.includes("--plain"))).toBe(true);
  });

  it("passes filters to journalctl as separate arguments and keeps the cursor when nothing is new", async () => {
    setHostProbeForTests(fake({ "systemctl --version": "x", "journalctl --version": "x", "journalctl -o json": "" }), "linux");
    const page = await readLogs({ unit: "caddy.service", priority: "err", lines: 5000, cursor: "c9" });
    expect(page).toEqual({ entries: [], cursor: "c9" });
    const call = calls.find((c) => c[0] === "journalctl" && c.includes("json"))!;
    expect(call).toEqual(["journalctl", "-o", "json", "--no-pager", "-n", "1000", "-u", "caddy.service", "-p", "err", "--after-cursor=c9"]);
    await expect(readLogs({ unit: "-f" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("files", () => {
  let data: string;
  let root: string;

  beforeEach(async () => {
    data = await mkdtemp(join(tmpdir(), "glassys-data-"));
    root = await mkdtemp(join(tmpdir(), "glassys-files-"));
    process.env.GLASSYS_DATA_DIR = data;
    await writeFile(join(data, "secrets.json"), '{"operatorPasswordHash":"x"}');
    await mkdir(join(root, "etc"));
    await writeFile(join(root, "notes.txt"), "hello\n");
    await writeFile(join(root, "blob.bin"), Buffer.from([1, 0, 2, 3]));
  });

  it("lists a directory with folders first", async () => {
    const listing = await listDir(root);
    expect(listing.entries.map((e) => [e.name, e.type])).toEqual([
      ["etc", "dir"],
      ["blob.bin", "file"],
      ["notes.txt", "file"],
    ]);
    expect(listing.parent).toBeTruthy();
  });

  it("previews text and flags binary files", async () => {
    expect(await previewFile(join(root, "notes.txt"))).toMatchObject({ text: "hello\n", binary: false, truncated: false });
    const bin = await previewFile(join(root, "blob.bin"));
    expect(bin.binary).toBe(true);
    expect(bin.text).toBeUndefined();
  });

  it("never shows the Glassys data directory", async () => {
    await expect(listDir(data)).rejects.toMatchObject({ status: 403 });
    await expect(previewFile(join(data, "secrets.json"))).rejects.toMatchObject({ status: 403 });
    await expect(previewFile(join(data, "..", data.split("/").pop()!, "secrets.json"))).rejects.toMatchObject({ status: 403 });
  });

  it("rejects relative and missing paths", async () => {
    await expect(listDir("etc")).rejects.toMatchObject({ status: 400 });
    await expect(listDir(join(root, "missing"))).rejects.toMatchObject({ status: 404 });
    await expect(listDir(join(root, "notes.txt"))).rejects.toMatchObject({ status: 400 });
  });
});
