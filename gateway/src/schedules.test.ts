import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpError } from "./errors.js";
import {
  MAX_ONE_SHOT_ATTEMPTS,
  bindScheduleRuntime,
  createSchedule,
  deleteSchedule,
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

  it("fires a cron slot once even when the timer lands just before it", async () => {
    const enqueued: string[] = [];
    // A clock 100ms short of the next whole minute.
    const nextMinute = Math.ceil((Date.now() + 1000) / 60_000) * 60_000;
    const offset = nextMinute - 100 - Date.now();
    bindScheduleRuntime({
      enqueue: async (text) => {
        enqueued.push(text);
        return true;
      },
      isIdle: () => true,
      liveThreadId: () => null,
      liveCwd: async () => dir,
      switchThread: async () => undefined,
      applyCwd: async () => undefined,
      now: () => Date.now() + offset,
    });
    await createSchedule({ text: "every minute", cwd: dir, cron: "* * * * *" });
    await tickSchedulesForTests();
    await tickSchedulesForTests();
    expect(enqueued).toEqual(["every minute"]);
  });

  /* setTimeout never fires early, and croner's nextRun(now) already skips a slot `now` has reached. */
  it.each([0, 5, 1200])("fires a cron slot once when the timer lands %ims after it", async (late) => {
    const enqueued: string[] = [];
    const slot = Math.ceil((Date.now() + 1000) / 60_000) * 60_000;
    let now = slot - 30_000;
    bindScheduleRuntime({
      enqueue: async (text) => {
        enqueued.push(text);
        return true;
      },
      isIdle: () => true,
      liveThreadId: () => null,
      liveCwd: async () => dir,
      switchThread: async () => undefined,
      applyCwd: async () => undefined,
      now: () => now,
    });
    await createSchedule({ text: "every minute", cwd: dir, cron: "* * * * *" });
    await new Promise((r) => setTimeout(r, 30)); // let the timer arm for `slot`
    now = slot + late;
    await tickSchedulesForTests();
    await tickSchedulesForTests();
    expect(enqueued).toEqual(["every minute"]);
    expect((await listSchedules())[0]?.lastRun).toBe(new Date(slot + late).toISOString());
  });

  it("fires every cron job due in the same slot", async () => {
    const enqueued: string[] = [];
    const slot = Math.ceil((Date.now() + 1000) / 60_000) * 60_000;
    let now = slot - 30_000;
    bindScheduleRuntime({
      enqueue: async (text) => {
        enqueued.push(text);
        return true;
      },
      isIdle: () => true,
      liveThreadId: () => null,
      liveCwd: async () => dir,
      switchThread: async () => undefined,
      applyCwd: async () => undefined,
      now: () => now,
    });
    await createSchedule({ text: "first", cwd: dir, cron: "* * * * *" });
    await createSchedule({ text: "second", cwd: dir, cron: "* * * * *" });
    await new Promise((r) => setTimeout(r, 30));
    now = slot + 5;
    await tickSchedulesForTests();
    now = slot + 50;
    await tickSchedulesForTests();
    await tickSchedulesForTests();
    expect(enqueued.sort()).toEqual(["first", "second"]);
  });

  it("fires a cron slot that came due while another job waited for idle, and its own slots once", async () => {
    const enqueued: string[] = [];
    const slot = Math.ceil((Date.now() + 1000) / 60_000) * 60_000;
    let now = slot - 30_000;
    let idle = true;
    bindScheduleRuntime({
      enqueue: async (text) => {
        enqueued.push(text);
        return true;
      },
      isIdle: () => idle,
      liveThreadId: () => null,
      liveCwd: async () => dir,
      switchThread: async () => undefined,
      applyCwd: async () => undefined,
      now: () => now,
    });
    await createSchedule({ text: "minutely", cwd: dir, cron: "* * * * *" });
    await createSchedule({ text: "later", cwd: dir, cron: `${new Date(slot + 60_000).getMinutes()} * * * *` });
    await new Promise((r) => setTimeout(r, 30));
    now = slot;
    idle = false;
    const busy = tickSchedulesForTests();
    await new Promise((r) => setTimeout(r, 30));
    /* Three minutes busy: "later" came due at slot + 60s meanwhile, "minutely" skipped two slots. */
    now = slot + 180_000;
    idle = true;
    await busy;
    await tickSchedulesForTests();
    await tickSchedulesForTests();
    expect(enqueued).toEqual(["minutely", "later"]);
  });

  it("skips a job deleted while it waited for the gateway to go idle", async () => {
    let idle = false;
    const enqueued: string[] = [];
    bindScheduleRuntime({
      enqueue: async (text) => {
        enqueued.push(text);
        return true;
      },
      isIdle: () => idle,
      liveThreadId: () => null,
      liveCwd: async () => dir,
      switchThread: async () => undefined,
      applyCwd: async () => undefined,
    });
    const job = await createSchedule({ text: "once", cwd: dir, at: new Date(Date.now() - 1000).toISOString() });
    const pending = tickSchedulesForTests();
    await new Promise((r) => setTimeout(r, 30));
    await deleteSchedule(job.id);
    idle = true;
    await pending;
    expect(enqueued).toEqual([]);
  });

  it("records why the runtime refused the message", async () => {
    bindScheduleRuntime({
      enqueue: async (_text, _source, onReject) => {
        onReject("Queue is full");
        return false;
      },
      isIdle: () => true,
      liveThreadId: () => null,
      liveCwd: async () => dir,
      switchThread: async () => undefined,
      applyCwd: async () => undefined,
    });
    await createSchedule({ text: "x", cwd: dir, at: new Date(Date.now() - 1000).toISOString() });
    await tickSchedulesForTests();
    expect((await listSchedules())[0]?.lastError).toBe("Queue is full");
  });

  it("fires a re-enabled one-shot again at the same time", async () => {
    const enqueued: string[] = [];
    bindScheduleRuntime({
      enqueue: async (text) => {
        enqueued.push(text);
        return true;
      },
      isIdle: () => true,
      liveThreadId: () => null,
      liveCwd: async () => dir,
      switchThread: async () => undefined,
      applyCwd: async () => undefined,
    });
    const { patchSchedule } = await import("./schedules.js");
    const job = await createSchedule({ text: "once", cwd: dir, at: new Date(Date.now() - 1000).toISOString() });
    await tickSchedulesForTests();
    await tickSchedulesForTests();
    expect(enqueued).toEqual(["once"]);
    await patchSchedule(job.id, { enabled: true });
    await tickSchedulesForTests();
    expect(enqueued).toEqual(["once", "once"]);
  });
});
