import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpError } from "./errors.js";
import {
  MAX_ONE_SHOT_ATTEMPTS,
  bindScheduleRuntime,
  createSchedule,
  listSchedules,
  previewNextRun,
  setScheduleIdlePollMsForTests,
  setScheduleIdleWaitMsForTests,
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
    setScheduleIdleWaitMsForTests();
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
        return true;
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
      enqueue: async () => true,
      isIdle: () => true,
      liveThreadId: () => null,
      liveCwd: async () => dir,
      switchThread: async () => undefined,
      applyCwd: async () => undefined,
    });
    expect((await listSchedules())[0]?.text).toBe("keep");
  });

  it("keeps a one-shot enabled when enqueue does not queue", async () => {
    bindScheduleRuntime({
      enqueue: async () => false,
      isIdle: () => true,
      liveThreadId: () => null,
      liveCwd: async () => dir,
      switchThread: async () => undefined,
      applyCwd: async () => undefined,
    });
    const job = await createSchedule({
      text: "missed",
      cwd: dir,
      at: new Date(Date.now() - 1000).toISOString(),
    });
    await tickSchedulesForTests();
    const listed = (await listSchedules()).find((j) => j.id === job.id);
    expect(listed?.enabled).toBe(true);
    expect(listed?.lastError).toMatch(/not queued/i);
  });

  it("backs a failed one-shot off instead of firing it again at once, then disables it", async () => {
    let now = Date.now();
    let calls = 0;
    bindScheduleRuntime({
      enqueue: async () => {
        calls += 1;
        return false;
      },
      isIdle: () => true,
      liveThreadId: () => null,
      liveCwd: async () => dir,
      switchThread: async () => undefined,
      applyCwd: async () => undefined,
      now: () => now,
    });
    const job = await createSchedule({ text: "missed", cwd: dir, at: new Date(now - 1000).toISOString() });
    await tickSchedulesForTests();
    expect(calls).toBe(1);
    const after = (await listSchedules()).find((j) => j.id === job.id)!;
    expect(previewNextRun(after, new Date(now))).toBe(after.retryAt);
    expect(Date.parse(after.retryAt!)).toBeGreaterThan(now);

    await tickSchedulesForTests();
    expect(calls).toBe(1);

    for (let i = 1; i < MAX_ONE_SHOT_ATTEMPTS; i++) {
      now += 60 * 60_000;
      await tickSchedulesForTests();
    }
    expect(calls).toBe(MAX_ONE_SHOT_ATTEMPTS);
    const last = (await listSchedules()).find((j) => j.id === job.id)!;
    expect(last.enabled).toBe(false);
    expect(last.attempts).toBe(MAX_ONE_SHOT_ATTEMPTS);
  });

  it("does not change the workspace when the thread switch fails because the gateway is busy", async () => {
    const applied: string[] = [];
    bindScheduleRuntime({
      enqueue: async () => true,
      isIdle: () => true,
      liveThreadId: () => "t-live",
      liveCwd: async () => "/other",
      switchThread: async () => {
        throw new HttpError(409, "busy");
      },
      applyCwd: async (cwd) => {
        applied.push(cwd);
      },
    });
    const job = await createSchedule({
      text: "x",
      cwd: dir,
      threadId: "t-old",
      at: new Date(Date.now() - 1000).toISOString(),
    });
    await tickSchedulesForTests();
    expect(applied).toEqual([]);
    expect((await listSchedules()).find((j) => j.id === job.id)?.lastError).toBe("busy");
  });

  it("falls back to the job's workspace when its thread is gone", async () => {
    const applied: string[] = [];
    bindScheduleRuntime({
      enqueue: async () => true,
      isIdle: () => true,
      liveThreadId: () => "t-live",
      liveCwd: async () => "/other",
      switchThread: async () => {
        throw new HttpError(404, "Thread not found");
      },
      applyCwd: async (cwd) => {
        applied.push(cwd);
      },
    });
    await createSchedule({ text: "x", cwd: dir, threadId: "t-gone", at: new Date(Date.now() - 1000).toISOString() });
    await tickSchedulesForTests();
    expect(applied).toEqual([dir]);
  });
});
