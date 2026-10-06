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
  setUpgradeSpawnForTests,
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
  });

  it("treats GLASSYS_SERVICE=1 as the user service", () => {
    expect(detectService({ GLASSYS_SERVICE: "1" }, "darwin")).toBe("launchd");
    expect(detectService({ GLASSYS_SERVICE: "1" }, "linux")).toBe("systemd");
  });

  it("honors the test override", () => {
    setDetectServiceForTests("none");
    expect(detectService({ GLASSYS_SERVICE: "1" }, "darwin")).toBe("none");
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
});
