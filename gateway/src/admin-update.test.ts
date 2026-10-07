import { EventEmitter } from "node:events";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setRunningCommitForTests } from "./build-info.js";
import { paths } from "./paths.js";
import {
  detectService,
  readUpgradeStatus,
  reconcileUpgradeStatus,
  writeUpgradeStatus,
  setDetectServiceForTests,
  setInstallGitForTests,
  setPidAliveForTests,
  setUpgradeSpawnForTests,
  stalledUpgradeReason,
  startUpgrade,
} from "./admin-update.js";

describe("admin update", () => {
  beforeEach(async () => {
    process.env.GLASSYS_DATA_DIR = await mkdtemp(join(tmpdir(), "glassys-upd-"));
  });

  afterEach(() => {
    setDetectServiceForTests(null);
    setInstallGitForTests(undefined);
    setUpgradeSpawnForTests(null);
    setRunningCommitForTests(undefined);
    setPidAliveForTests(null);
  });

  it("treats GLASSYS_SERVICE=1 as the user service", async () => {
    expect(await detectService({ GLASSYS_SERVICE: "1" }, "darwin")).toBe("launchd");
    expect(await detectService({ GLASSYS_SERVICE: "1" }, "linux")).toBe("systemd");
  });

  it("honors the test override", async () => {
    setDetectServiceForTests("none");
    expect(await detectService({ GLASSYS_SERVICE: "1" }, "darwin")).toBe("none");
  });

  it("rejects upgrade when the working tree is dirty", async () => {
    setDetectServiceForTests("launchd");
    setInstallGitForTests({ sha: "abc", branch: "main", dirty: true });
    await expect(startUpgrade()).rejects.toThrow(/dirty/i);
  });

  it("records error phase when spawn fails", async () => {
    setDetectServiceForTests("launchd");
    setInstallGitForTests({ sha: "abc", branch: "main", dirty: false });
    setUpgradeSpawnForTests((() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void; pid?: number };
      child.unref = () => undefined;
      child.pid = 1;
      queueMicrotask(() => child.emit("error", new Error("spawn ENOENT")));
      return child as unknown as ReturnType<typeof import("node:child_process").spawn>;
    }) as typeof import("node:child_process").spawn);
    await expect(startUpgrade()).rejects.toThrow(/ENOENT/);
    expect((await readUpgradeStatus()).phase).toBe("error");
  });

  it("writes the status owner-only even over a looser file", async () => {
    await writeFile(paths.upgradeStatus(), "{}", { mode: 0o664 });
    await writeUpgradeStatus({ phase: "pulling", startedAt: "2026-10-06T10:00:00.000Z" });
    expect((await stat(paths.upgradeStatus())).mode & 0o777).toBe(0o600);
  });

  it("closes a restart phase when the new process runs the target commit", async () => {
    const sha = "b".repeat(40);
    setRunningCommitForTests(sha);
    await writeUpgradeStatus({ phase: "restart", startedAt: "2026-10-06T10:00:00.000Z", targetSha: sha });
    await reconcileUpgradeStatus();
    const status = await readUpgradeStatus();
    expect(status.phase).toBe("idle");
    expect(status.startedAt).toBe("2026-10-06T10:00:00.000Z");
  });

  it("flags a restart that came back on another commit", async () => {
    setRunningCommitForTests("c".repeat(40));
    await writeUpgradeStatus({ phase: "restart", targetSha: "b".repeat(40) });
    await reconcileUpgradeStatus();
    const status = await readUpgradeStatus();
    expect(status.phase).toBe("error");
    expect(status.error).toMatch(/expected bbbbbbb/);
  });

  it("treats an upgrade whose script died as failed, so the next one is not refused", async () => {
    setDetectServiceForTests("launchd");
    setInstallGitForTests({ sha: "abc", branch: "main", dirty: false });
    setPidAliveForTests(() => false);
    await writeUpgradeStatus({ phase: "build", startedAt: new Date().toISOString(), pid: 999_999 });
    const status = await readUpgradeStatus();
    expect(status.phase).toBe("build");
    let spawned = false;
    setUpgradeSpawnForTests((() => {
      spawned = true;
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = () => undefined;
      queueMicrotask(() => child.emit("spawn"));
      return child as unknown as ReturnType<typeof import("node:child_process").spawn>;
    }) as typeof import("node:child_process").spawn);
    await startUpgrade();
    expect(spawned).toBe(true);
  });

  it("keeps a live, recent upgrade running", () => {
    const now = Date.parse("2026-10-06T12:00:00.000Z");
    const recent = "2026-10-06T11:50:00.000Z";
    expect(stalledUpgradeReason({ phase: "build", updatedAt: recent, pid: 42 }, now, () => true)).toBeUndefined();
    expect(stalledUpgradeReason({ phase: "build", updatedAt: recent, pid: 42 }, now, () => false)).toMatch(/stopped/);
    expect(stalledUpgradeReason({ phase: "build", updatedAt: "2026-10-06T10:00:00.000Z", pid: 42 }, now, () => true)).toMatch(/no progress/);
    expect(stalledUpgradeReason({ phase: "starting", updatedAt: "2026-10-06T11:59:30.000Z" }, now)).toBeUndefined();
    expect(stalledUpgradeReason({ phase: "starting", updatedAt: "2026-10-06T11:50:00.000Z" }, now)).toMatch(/did not start/);
    expect(stalledUpgradeReason({ phase: "restart", updatedAt: "2026-10-06T11:50:00.000Z" }, now)).toMatch(/restart/);
    expect(stalledUpgradeReason({ phase: "error", updatedAt: "2026-10-06T01:00:00.000Z" }, now)).toBeUndefined();
  });

  it("closes a restart on start however long it took", async () => {
    const sha = "e".repeat(40);
    setRunningCommitForTests(sha);
    const { writeFile: raw } = await import("node:fs/promises");
    await raw(paths.upgradeStatus(), JSON.stringify({ phase: "restart", updatedAt: "2026-10-06T01:00:00.000Z", targetSha: sha, pid: 7 }));
    await reconcileUpgradeStatus();
    const status = await readUpgradeStatus();
    expect(status.phase).toBe("idle");
    expect(status.pid).toBeUndefined();
  });
});
