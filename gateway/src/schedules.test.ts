import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bindScheduleRuntime,
  createSchedule,
  listSchedules,
  setScheduleIdlePollMsForTests,
  stopSchedules,
  tickSchedulesForTests,
} from "./schedules.js";

describe("schedules", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "glassys-sched-"));
    process.env.GLASSYS_DATA_DIR = dir;
    setScheduleIdlePollMsForTests(10);
  });

  afterEach(() => {
    stopSchedules();
    bindScheduleRuntime(null);
    setScheduleIdlePollMsForTests(500);
  });

  it("persists cron and at jobs", async () => {
    const cron = await createSchedule({ text: "status", cwd: dir, cron: "0 6 * * *" });
    const at = await createSchedule({
      text: "once",
      cwd: dir,
      at: new Date(Date.now() + 60_000).toISOString(),
    });
    const listed = await listSchedules();
    expect(listed.map((j) => j.id).sort()).toEqual([cron.id, at.id].sort());
    expect(listed.find((j) => j.id === cron.id)?.cron).toBe("0 6 * * *");
  });

  it("waits until idle then enqueues, switching thread when set", async () => {
    let idle = false;
    let liveThread = "t-old";
    let liveCwd = "/old";
    const enqueued: string[] = [];
    const switched: string[] = [];
    bindScheduleRuntime({
      enqueue: async (text) => {
        enqueued.push(text);
      },
      isIdle: () => idle,
      liveThreadId: () => liveThread,
      liveCwd: async () => liveCwd,
      switchThread: async (id) => {
        switched.push(id);
        liveThread = id;
      },
      applyCwd: async (cwd) => {
        liveCwd = cwd;
      },
      now: () => Date.now(),
    });
    await createSchedule({
      text: "nightly",
      cwd: dir,
      threadId: "t-live",
      at: new Date(Date.now() - 1000).toISOString(),
    });
    const pending = tickSchedulesForTests();
    await new Promise((r) => setTimeout(r, 30));
    expect(enqueued).toEqual([]);
    idle = true;
    await pending;
    expect(switched).toEqual(["t-live"]);
    expect(enqueued).toEqual(["nightly"]);
    expect((await listSchedules())[0]?.enabled).toBe(false);
  });

  it("reloads jobs after a runtime bind (restart)", async () => {
    await createSchedule({ text: "keep", cwd: dir, cron: "5 4 * * *" });
    bindScheduleRuntime(null);
    stopSchedules();
    bindScheduleRuntime({
      enqueue: async () => undefined,
      isIdle: () => true,
      liveThreadId: () => null,
      liveCwd: async () => dir,
      switchThread: async () => undefined,
      applyCwd: async () => undefined,
    });
    expect((await listSchedules())[0]?.text).toBe("keep");
  });
});
