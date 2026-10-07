import { mkdir, readFile } from "node:fs/promises";
import { writeFileAtomic } from "./atomic.js";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import { paths, log } from "./paths.js";
import { createMutex } from "./lock.js";
import { HttpError } from "./errors.js";

export const MAX_SCHEDULES = 20;
/** A one-shot that keeps failing to queue is retried with backoff and then disabled. */
export const MAX_ONE_SHOT_ATTEMPTS = 5;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 30 * 60_000;

export interface ScheduleJob {
  id: string;
  text: string;
  cwd: string;
  threadId?: string;
  cron?: string;
  at?: string;
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  lastError?: string;
  /** Failed attempts of a one-shot since it was created or last edited. */
  attempts?: number;
  /** Earliest time a failed one-shot fires again. */
  retryAt?: string;
}

export interface ScheduleHooks {
  enqueue: (text: string, source: "schedule") => Promise<boolean>;
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
  try {
    const raw = JSON.parse(await readFile(paths.schedules(), "utf8")) as { jobs?: ScheduleJob[] };
    return Array.isArray(raw.jobs) ? raw.jobs.filter((j) => j && typeof j.text === "string") : [];
  } catch {
    return [];
  }
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
  armTimer();
}

async function soonestDue(): Promise<{ job: ScheduleJob; at: number } | null> {
  const jobs = await readJobs();
  const from = new Date(nowMs());
  let best: { job: ScheduleJob; at: number } | null = null;
  for (const job of jobs) {
    let at: number | null = null;
    try {
      at = nextFireMs(job, from);
    } catch {
      continue;
    }
    if (at == null) continue;
    if (!best || at < best.at) best = { job, at };
  }
  return best;
}

let armGeneration = 0;

function armTimer(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  const gen = ++armGeneration;
  if (!hooks) return;
  void (async () => {
    const due = await soonestDue();
    if (!due || gen !== armGeneration) return;
    const wait = Math.max(0, due.at - nowMs());
    timer = setTimeout(() => {
      void tickSchedules();
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

async function fireJob(job: ScheduleJob): Promise<void> {
  if (!hooks) return;
  const deadline = nowMs() + idleWaitMaxMs;
  while (!hooks.isIdle()) {
    if (nowMs() >= deadline) {
      await failJob(job, "Gateway stayed busy");
      return;
    }
    await new Promise((r) => setTimeout(r, idlePollMs));
    if (!hooks) return;
  }
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
    const queued = await hooks.enqueue(job.text, "schedule");
    if (!queued) {
      await failJob(job, "Message was not queued");
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

async function tickSchedules(): Promise<void> {
  /* The tick in progress re-arms when it finishes; re-arming here would spin on a job that is already due. */
  if (firing || !hooks) return;
  firing = true;
  try {
    const due = await soonestDue();
    if (due && due.at <= nowMs() + 250) {
      /*
       * Never fire ahead of the slot: re-arming from a moment still before it finds that same cron
       * slot again, and the message went out twice.
       */
      const early = due.at - nowMs();
      if (early > 0) await new Promise((r) => setTimeout(r, early));
      await fireJob(due.job);
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
}

export async function tickSchedulesForTests(): Promise<void> {
  await tickSchedules();
}
