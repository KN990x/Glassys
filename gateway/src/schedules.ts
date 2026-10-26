import { mkdir } from "node:fs/promises";
import { readJsonFile } from "./json-file.js";
import { writeFileAtomic } from "./atomic.js";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import { paths, log } from "./paths.js";
import { createMutex } from "./lock.js";
import { HttpError } from "./errors.js";
import type { ScheduleJob } from "@glassys/protocol";

export const MAX_SCHEDULES = 20;
/** A one-shot that keeps failing to queue is retried with backoff and then disabled. */
export const MAX_ONE_SHOT_ATTEMPTS = 5;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 30 * 60_000;

export type { ScheduleJob };

export interface ScheduleHooks {
  enqueue: (text: string, source: "schedule", onReject: (message: string) => void) => Promise<boolean>;
  isIdle: () => boolean;
  liveThreadId: () => string | null;
  liveCwd: () => Promise<string>;
  switchThread: (id: string) => Promise<void>;
  applyCwd: (cwd: string) => Promise<void>;
  now?: () => number;
}

const withSchedules = createMutex();
let hooks: ScheduleHooks | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let firing = false;
let idlePollMs = 500;
let idleWaitMaxMs = 180_000;
/**
 * The last slot each job fired for. An arm computed just before a tick fired that slot can land
 * after it and arm the same slot again; this keeps a slot to one fire.
 */
const firedSlots = new Map<string, number>();
/**
 * Where each cron job looks for its next slot: when the scheduler first saw it, or when it last
 * fired. Looking from `now` instead loses the slot of a job that came due while another one fired or
 * waited for the gateway to go idle.
 */
const scanFrom = new Map<string, number>();
/** A cron job late by many slots still fires once: catching up is for missed slots, not each of them. */
const MAX_SLOT_SKIP = 10_000;

export function setScheduleIdlePollMsForTests(ms: number): void {
  idlePollMs = ms;
}

export function setScheduleIdleWaitMsForTests(ms?: number): void {
  idleWaitMaxMs = ms ?? 180_000;
}

export function scheduleTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function nowMs(): number {
  return hooks?.now?.() ?? Date.now();
}

async function readJobs(): Promise<ScheduleJob[]> {
  const raw = await readJsonFile<{ jobs?: ScheduleJob[] } | null>(paths.schedules());
  return Array.isArray(raw?.jobs) ? raw.jobs.filter((j) => j && typeof j.text === "string") : [];
}

async function writeJobs(jobs: ScheduleJob[]): Promise<void> {
  await mkdir(dirname(paths.schedules()), { recursive: true });
  await writeFileAtomic(paths.schedules(), JSON.stringify({ jobs }, null, 2));
}

export function bindScheduleRuntime(next: ScheduleHooks | null): void {
  hooks = next;
}

export async function listSchedules(): Promise<ScheduleJob[]> {
  return withSchedules(readJobs);
}

function assertXor(cron?: string, at?: string): void {
  const hasCron = Boolean(cron?.trim());
  const hasAt = Boolean(at?.trim());
  if (hasCron === hasAt) throw new HttpError(400, "Schedule needs either cron or at");
}

function nextFireMs(job: ScheduleJob, from: Date): number | null {
  if (!job.enabled) return null;
  if (job.at) {
    const t = Date.parse(job.at);
    if (!Number.isFinite(t)) return null;
    const retry = job.retryAt ? Date.parse(job.retryAt) : NaN;
    return Number.isFinite(retry) && retry > t ? retry : t;
  }
  if (!job.cron) return null;
  try {
    const cron = new Cron(job.cron, { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    const next = cron.nextRun(from);
    return next ? next.getTime() : null;
  } catch {
    throw new HttpError(400, "Invalid cron expression");
  }
}

export function previewNextRun(job: ScheduleJob, from = new Date()): string | null {
  try {
    const ms = nextFireMs(job, from);
    return ms ? new Date(ms).toISOString() : null;
  } catch {
    return null;
  }
}

type ScheduleInput = Partial<Pick<ScheduleJob, "text" | "cwd" | "threadId" | "cron" | "at" | "enabled">>;

/**
 * The fields a client may set, type-checked. Anything else in the body (an `id`, `createdAt`,
 * run bookkeeping) is ignored; a wrong type is a 400, not a TypeError on `.trim()`.
 */
export function scheduleInput(body: unknown): ScheduleInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid json");
  const raw = body as Record<string, unknown>;
  const out: ScheduleInput = {};
  for (const key of ["text", "cwd", "threadId", "cron", "at"] as const) {
    const v = raw[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") throw new HttpError(400, `${key} must be a string`);
    out[key] = v;
  }
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") throw new HttpError(400, "enabled must be a boolean");
    out.enabled = raw.enabled;
  }
  return out;
}

export async function createSchedule(input: {
  text: string;
  cwd: string;
  threadId?: string;
  cron?: string;
  at?: string;
  enabled?: boolean;
}): Promise<ScheduleJob> {
  const text = input.text.trim();
  if (!text) throw new HttpError(400, "Schedule text required");
  if (!input.cwd) throw new HttpError(400, "Workspace path is required");
  assertXor(input.cron, input.at);
  const job: ScheduleJob = {
    id: randomUUID(),
    text,
    cwd: input.cwd,
    threadId: input.threadId,
    cron: input.cron?.trim() || undefined,
    at: input.at?.trim() || undefined,
    enabled: input.enabled !== false,
    createdAt: new Date().toISOString(),
  };
  nextFireMs(job, new Date());
  await withSchedules(async () => {
    const jobs = await readJobs();
    if (jobs.length >= MAX_SCHEDULES) throw new HttpError(400, "Too many schedules");
    jobs.push(job);
    await writeJobs(jobs);
  });
  armTimer();
  return job;
}

export async function patchSchedule(id: string, raw: unknown): Promise<ScheduleJob> {
  const patch = scheduleInput(raw);
  const updated = await withSchedules(async () => {
    const jobs = await readJobs();
    const idx = jobs.findIndex((j) => j.id === id);
    if (idx < 0) throw new HttpError(404, "Schedule not found");
    const cur = jobs[idx]!;
    const next: ScheduleJob = {
      ...cur,
      ...patch,
      text: patch.text !== undefined ? patch.text.trim() : cur.text,
      cron: patch.cron !== undefined ? patch.cron.trim() || undefined : cur.cron,
      at: patch.at !== undefined ? patch.at.trim() || undefined : cur.at,
      attempts: undefined,
      retryAt: undefined,
    };
    if (!next.text) throw new HttpError(400, "Schedule text required");
    assertXor(next.cron, next.at);
    nextFireMs(next, new Date());
    jobs[idx] = next;
    await writeJobs(jobs);
    return next;
  });
  /* An edit (re-enabling a one-shot, say) may mean the same slot again, on purpose. */
  firedSlots.delete(id);
  /* An edited or re-enabled cron starts from now; it does not owe the slots it was off for. */
  scanFrom.delete(id);
  armTimer();
  return updated;
}

export async function deleteSchedule(id: string): Promise<void> {
  await withSchedules(async () => {
    const jobs = await readJobs();
    const next = jobs.filter((j) => j.id !== id);
    if (next.length === jobs.length) throw new HttpError(404, "Schedule not found");
    await writeJobs(next);
  });
  firedSlots.delete(id);
  scanFrom.delete(id);
  armTimer();
}

/** A one-shot's own time; a cron's latest slot due since `scanFrom`, else its next one. */
function dueSlot(job: ScheduleJob, now: number): number | null {
  if (job.at || !job.cron) return nextFireMs(job, new Date(now));
  let from = scanFrom.get(job.id);
  if (from === undefined) {
    from = now;
    scanFrom.set(job.id, from);
  }
  let at = nextFireMs(job, new Date(from));
  for (let i = 0; at !== null && at <= now && i < MAX_SLOT_SKIP; i++) {
    const later = nextFireMs(job, new Date(at));
    if (later === null || later > now) break;
    at = later;
  }
  return at;
}

async function soonestDue(): Promise<{ job: ScheduleJob; at: number } | null> {
  const jobs = await readJobs();
  const now = nowMs();
  let best: { job: ScheduleJob; at: number } | null = null;
  for (const job of jobs) {
    let at: number | null = null;
    try {
      at = dueSlot(job, now);
    } catch {
      continue;
    }
    if (at == null) continue;
    if (!best || at < best.at) best = { job, at };
  }
  return best;
}

let armGeneration = 0;
/**
 * The slot the timer was armed for. Croner's `nextRun(now)` skips a slot once `now` reaches it, so
 * a timer that lands on (or just after) its slot must fire what it was armed for instead of asking
 * for the next run again, or a cron job never fires.
 */
let armed: { jobId: string; at: number } | null = null;

function armTimer(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  const gen = ++armGeneration;
  if (!hooks) return;
  void (async () => {
    const due = await soonestDue();
    if (gen !== armGeneration) return;
    armed = due ? { jobId: due.job.id, at: due.at } : null;
    if (!due) return;
    const wait = Math.max(0, due.at - nowMs());
    timer = setTimeout(() => {
      tickSchedules().catch((err) => log("warn", "schedule tick failed", { error: String(err) }));
    }, Math.min(wait, 60_000));
  })().catch((err) => log("warn", "schedule arm failed", { error: String(err) }));
}

async function patchJob(id: string, patch: Partial<ScheduleJob>): Promise<void> {
  await withSchedules(async () => {
    const jobs = await readJobs();
    await writeJobs(jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  });
}

/** Record a failed fire. A cron simply waits for its next slot; a one-shot backs off, then gives up. */
async function failJob(job: ScheduleJob, lastError: string): Promise<void> {
  if (!job.at) {
    await patchJob(job.id, { lastError });
    return;
  }
  const attempts = (job.attempts ?? 0) + 1;
  if (attempts >= MAX_ONE_SHOT_ATTEMPTS) {
    await patchJob(job.id, { lastError, attempts, retryAt: undefined, enabled: false });
    return;
  }
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempts - 1));
  await patchJob(job.id, { lastError, attempts, retryAt: new Date(nowMs() + backoff).toISOString() });
}

function errorStatus(err: unknown): number | undefined {
  return err instanceof HttpError ? err.status : undefined;
}

/** The job as stored now, if it still fires at `at`: deleted, disabled or edited jobs are skipped. */
async function stillDue(id: string, at: number): Promise<ScheduleJob | null> {
  const job = (await readJobs()).find((j) => j.id === id);
  if (!job) return null;
  try {
    return nextFireMs(job, new Date(at - 1)) === at ? job : null;
  } catch {
    return null;
  }
}

async function fireJob(due: { job: ScheduleJob; at: number }): Promise<void> {
  if (!hooks) return;
  const deadline = nowMs() + idleWaitMaxMs;
  while (!hooks.isIdle()) {
    if (nowMs() >= deadline) {
      await failJob(due.job, "Gateway stayed busy");
      return;
    }
    await new Promise((r) => setTimeout(r, idlePollMs));
    if (!hooks) return;
  }
  /* The wait for idle can last minutes; the operator may have deleted or changed the job meanwhile. */
  const job = await stillDue(due.job.id, due.at);
  if (!job) return;
  try {
    if (job.threadId) {
      try {
        if (hooks.liveThreadId() !== job.threadId) await hooks.switchThread(job.threadId);
      } catch (err) {
        /* Only a missing thread falls back to the job's workspace; a busy gateway must not lose its run. */
        if (errorStatus(err) !== 404) throw err;
        const cwd = await hooks.liveCwd();
        if (job.cwd && cwd !== job.cwd) await hooks.applyCwd(job.cwd);
      }
    } else {
      const cwd = await hooks.liveCwd();
      if (job.cwd && cwd !== job.cwd) await hooks.applyCwd(job.cwd);
    }
    let refusal = "Message was not queued";
    const queued = await hooks.enqueue(job.text, "schedule", (message) => {
      refusal = message;
    });
    if (!queued) {
      await failJob(job, refusal);
      return;
    }
    await patchJob(job.id, {
      lastRun: new Date(nowMs()).toISOString(),
      lastError: undefined,
      attempts: undefined,
      retryAt: undefined,
      enabled: job.at ? false : job.enabled,
    });
  } catch (err) {
    log("warn", "schedule fire failed", { id: job.id, error: String(err) });
    await failJob(job, err instanceof Error ? err.message : String(err));
  }
}

/** The armed slot once its time has come, else whatever is due from now (one-shots in the past). */
async function dueNow(): Promise<{ job: ScheduleJob; at: number } | null> {
  const target = armed;
  if (target && target.at <= nowMs() + 250) {
    const job = await stillDue(target.jobId, target.at);
    if (job) return { job, at: target.at };
  }
  const due = await soonestDue();
  return due && due.at <= nowMs() + 250 ? due : null;
}

async function tickSchedules(): Promise<void> {
  /* The tick in progress re-arms when it finishes; re-arming here would spin on a job that is already due. */
  if (firing || !hooks) return;
  firing = true;
  try {
    const due = await dueNow();
    if (due && firedSlots.get(due.job.id) !== due.at) {
      armed = null;
      firedSlots.set(due.job.id, due.at);
      /*
       * Never fire ahead of the slot: re-arming from a moment still before it finds that same cron
       * slot again, and the message went out twice.
       */
      const early = due.at - nowMs();
      if (early > 0) await new Promise((r) => setTimeout(r, early));
      try {
        await fireJob(due);
      } finally {
        /* Slots that passed while this job waited for idle are covered by this fire. */
        scanFrom.set(due.job.id, Math.max(due.at, nowMs()));
      }
    }
  } finally {
    firing = false;
    armTimer();
  }
}

export function startSchedules(): void {
  armTimer();
}

export function stopSchedules(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  /* An arm still reading the jobs must not set a timer after the stop. */
  armGeneration++;
  armed = null;
  firedSlots.clear();
  scanFrom.clear();
}

export async function tickSchedulesForTests(): Promise<void> {
  await tickSchedules();
}
