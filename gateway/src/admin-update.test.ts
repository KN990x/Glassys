import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectService,
  readUpgradeStatus,
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
});
