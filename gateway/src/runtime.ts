import { mkdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { AdapterError } from "@glassys/adapter-contract";
import type { AdapterRun, AdapterSession } from "@glassys/adapter-contract";
import type {
  AdapterDiscoverItem,
  AdapterPublicInfo,
  ConfigPatch,
  MessageAttachment,
  ModelListResponse,
  QueueItem,
  ServerMessage,
  TranscriptEvent,
} from "@glassys/protocol";
import {
  MAX_ATTACHMENTS,
  MAX_PINNED_CWDS,
  PROFILE_ID,
  isMessageId,
  isPersistedTranscriptEvent,
} from "@glassys/protocol";
import { agentFingerprint, applyPatch, loadConfig, redacted } from "./config.js";
import { adapterApiKey, loadSecrets, secretsFlags } from "./secrets.js";
import { getAdapter, listAdapters, probeAdapter } from "./adapters.js";
import { cancelLoginJob, snapshotLoginJob, startLoginJob } from "./adapter-login.js";
import { hub } from "./hub.js";
import { log, paths } from "./paths.js";
import { loadState, saveState, addUsageTotals } from "./state.js";
import { appendTranscript, readTranscript, readTranscriptSnapshot } from "./transcript.js";
import { HttpError, isActiveRunError } from "./errors.js";
import { createMutex } from "./lock.js";
import {
  activateThread,
  archiveLiveThread,
  flushLiveTranscript,
  refreshLiveTitle,
  setTranscriptFlushErrorHandler,
  stageLiveEvent,
  ensureLiveThread,
  listThreads,
  liveThreadId,
  loadThread,
  rememberCwd,
  removeThread,
  renameThread,
  readThreadBundle,
  resetLiveThreadCache,
  rotateLiveThread,
  startNewThread,
  addLiveUsage,
  setPinnedCwds,
} from "./threads.js";
import { gcUploads, materializeAttachments } from "./uploads.js";
import { assertPasswordChangeAllowed } from "./password-change.js";
import { eventsToMarkdown } from "./transcript-export.js";
import { notifyFromEvent, resetPushRunFlags } from "./push.js";
import { bindScheduleRuntime, startSchedules, stopSchedules } from "./schedules.js";

export interface Runtime {
  busy: boolean;
  agentId: string | null;
  fingerprint: string | null;
  identityAgent: import("@glassys/protocol").AgentConfig | null;
}

const runtime: Runtime = {
  busy: false,
  agentId: null,
  fingerprint: null,
  identityAgent: null,
};

export function setRuntimeBusyForTests(busy: boolean): void {
  runtime.busy = busy;
}

type QueueJob = {
  id: string;
  text: string;
  generation: number;
  attachments?: MessageAttachment[];
  source?: "user" | "schedule";
};

let session: AdapterSession | null = null;
let currentRun: AdapterRun | null = null;
let currentJobId: string | null = null;
let runStartedAt: number | undefined;
let queue: QueueJob[] = [];
let processing = false;
let cancelGeneration = 0;
/** Fires whenever cancelGeneration moves, so a waiting run reacts at once instead of polling. */
const cancelEvents = new EventTarget();

function bumpCancelGeneration(): number {
  cancelGeneration += 1;
  cancelEvents.dispatchEvent(new Event("cancel"));
  return cancelGeneration;
}

/** Resolves once cancelGeneration differs from `gen` (now, or the next time it moves). */
function cancelledSince(gen: number): { promise: Promise<void>; dispose: () => void } {
  if (cancelGeneration !== gen) return { promise: Promise.resolve(), dispose: () => undefined };
  let onCancel: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    onCancel = () => {
      if (cancelGeneration !== gen) resolve();
    };
    cancelEvents.addEventListener("cancel", onCancel);
  });
  return { promise, dispose: () => cancelEvents.removeEventListener("cancel", onCancel) };
}
let identityGeneration = 0;
let emitChain: Promise<void> = Promise.resolve();
let pendingIdentityReset = false;
/** Config the live thread belonged to before the identity change now pending. */
let resetFromAgent: import("@glassys/protocol").AgentConfig | null = null;
let rotating = false;
let shuttingDown = false;
/** Aborts the run that is still in ensureSession/send, before `currentRun` exists to cancel. */
let startAbort: AbortController | null = null;
/** One ensureSession at a time: a run abandoned mid-startup must not race the next one into a second session. */
let sessionInFlight: Promise<AdapterSession> | null = null;
const waitErrors = new WeakMap<AdapterRun, unknown>();
const withQueueLock = createMutex();
/** Consecutive processQueue crashes, for its retry backoff. */
let queueCrashes = 0;

class RunAborted extends Error {
  constructor() {
    super("run aborted before it started");
    this.name = "RunAborted";
  }
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new RunAborted());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new RunAborted());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function abortStartingRun(): void {
  startAbort?.abort();
}

export const MAX_QUEUE = 32;
export { MAX_ATTACHMENTS };
export const DEFAULT_RUN_CANCEL_TIMEOUT_MS = 15_000;
export const DEFAULT_ENQUEUE_ROTATING_RETRIES = 200;
let runCancelTimeoutMs = DEFAULT_RUN_CANCEL_TIMEOUT_MS;
let enqueueRotatingRetries = DEFAULT_ENQUEUE_ROTATING_RETRIES;

export function setRunCancelTimeoutForTests(ms: number): void {
  runCancelTimeoutMs = ms;
}

export function setRotatingForTests(value: boolean): void {
  rotating = value;
}

export function setEnqueueRotatingRetriesForTests(n?: number): void {
  enqueueRotatingRetries = n ?? DEFAULT_ENQUEUE_ROTATING_RETRIES;
}

let nowFn = () => Date.now();
let stallPollMs = 1000;

export function setNowForTests(fn?: () => number): void {
  nowFn = fn ?? (() => Date.now());
}

export function setStallPollMsForTests(ms: number): void {
  stallPollMs = ms;
}

export function runtimeBusy(): boolean {
  return runtime.busy || processing || Boolean(currentRun) || rotating;
}

function persistable(event: ServerMessage): TranscriptEvent | null {
  if (!isPersistedTranscriptEvent(event)) return null;
  return event;
}

/** Set while transcript writes fail, so the operator is told once rather than per token. */
let persistFailing = false;

function reportPersistFailure(err: unknown): void {
  log("error", "transcript write failed", { error: String(err) });
  if (persistFailing) return;
  persistFailing = true;
  /* Not persisted itself: the transcript is what cannot be written. */
  hub.broadcast({
    type: "run.error",
    message: `Glassys could not save this transcript: ${err instanceof Error ? err.message : String(err)}`,
    phase: "run",
  });
}

async function emit(event: ServerMessage, agentId?: string | null): Promise<void> {
  const done = emitChain.then(async () => {
    if (agentId) await persistAgentId(agentId);
    let out = event;
    let flushNow = false;
    const stored = persistable(event);
    if (stored) {
      try {
        const staged = await stageLiveEvent(stored);
        out = staged.event;
        flushNow = staged.flushNow;
      } catch (err) {
        reportPersistFailure(err);
      }
    }
    if (event.type === "run.usage") {
      const cfg = await loadConfig();
      await addUsageTotals(cfg.agent.adapter, event.inputTokens, event.outputTokens);
      await addLiveUsage(event.inputTokens, event.outputTokens);
      hub.broadcast({ type: "threads.snapshot", threads: await listThreads(), currentId: liveThreadId() });
    }
    /* Screens first: a slow or failing disk must not hold back (or swallow) what the agent says. */
    hub.broadcast(out);
    if (stored) {
      try {
        if (flushNow) await flushLiveTranscript();
        if (stored.type === "user.message") await refreshLiveTitle(stored.text);
        persistFailing = false;
      } catch (err) {
        reportPersistFailure(err);
      }
    }
    void notifyFromEvent(out).catch((err) => log("warn", "push notify failed", { error: String(err) }));
  });
  emitChain = done.catch((err) => {
    log("error", "emit failed", { error: String(err) });
  });
  await done;
}

export async function drainEmit(): Promise<void> {
  await emitChain;
}

export function snapshotRuntime(): {
  profileId: string;
  agentId: string | null;
  busy: boolean;
  threadId?: string;
  runStartedAt?: number;
} {
  return {
    profileId: PROFILE_ID,
    agentId: runtime.agentId,
    busy: runtime.busy,
    threadId: liveThreadId() ?? undefined,
    runStartedAt: runtime.busy ? runStartedAt : undefined,
  };
}

export function snapshotQueue(): QueueItem[] {
  return queue
    .filter((j) => j.generation === identityGeneration)
    .map((j) => ({
      id: j.id,
      text: j.text,
      hasAttachments: j.attachments?.length ? true : undefined,
      source: j.source,
    }));
}

async function broadcastQueue(): Promise<void> {
  hub.broadcast({ type: "queue.snapshot", items: snapshotQueue() });
}

async function broadcastSession(): Promise<void> {
  hub.broadcast({ type: "session", ...snapshotRuntime() });
}

async function broadcastThreads(): Promise<void> {
  hub.broadcast({ type: "threads.snapshot", threads: await listThreads(), currentId: liveThreadId() });
}

async function broadcastConfig(restart?: boolean): Promise<void> {
  hub.broadcast({ type: "config", config: await redacted(undefined, restart) });
}

export async function validateCwd(cwd: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!cwd || typeof cwd !== "string") return { ok: false, error: "Workspace path is required" };
  if (!isAbsolute(cwd)) return { ok: false, error: "Workspace path must be absolute" };
  try {
    const s = await stat(cwd);
    if (!s.isDirectory()) return { ok: false, error: "Workspace path is not a directory" };
  } catch {
    return { ok: false, error: "Workspace path does not exist" };
  }
  /* An agent working inside the data dir would be working on the secrets and transcripts. */
  const real = await realpath(cwd).catch(() => resolve(cwd));
  for (const data of await protectedPaths()) {
    if (real === data || real.startsWith(data + sep)) {
      return { ok: false, error: "Workspace path is inside the Glassys data directory" };
    }
  }
  return { ok: true };
}

export async function cwdErrorInPatch(patch: ConfigPatch): Promise<string | null> {
  const nextCwd =
    patch.agent && "cwd" in patch.agent && typeof patch.agent.cwd === "string" ? patch.agent.cwd : undefined;
  if (nextCwd !== undefined) {
    const check = await validateCwd(nextCwd);
    if (!check.ok) return check.error;
  }
  if (patch.onboarding?.completed === true) {
    const cwd = nextCwd ?? (await loadConfig()).agent.cwd;
    const check = await validateCwd(cwd);
    if (!check.ok) return check.error;
  }
  return null;
}

function usableAgentId(agentId: string | null | undefined): agentId is string {
  return Boolean(agentId) && agentId !== "pending";
}

async function persistAgentId(agentId: string): Promise<void> {
  if (!usableAgentId(agentId)) return;
  if (runtime.agentId === agentId) return;
  runtime.agentId = agentId;
  await saveState({ agentId });
}

async function createOpts() {
  const cfg = await loadConfig();
  const secrets = await loadSecrets();
  const adapter = getAdapter(cfg.agent.adapter);
  await mkdir(paths.adapterStore(adapter.id), { recursive: true });
  const apiKey = adapterApiKey(secrets, adapter.id);
  return {
    ...(apiKey ? { apiKey } : {}),
    cwd: cfg.agent.cwd,
    model: cfg.agent.model,
    modelParams: cfg.agent.modelParams ?? [],
    storeDir: paths.adapterStore(adapter.id),
    options: cfg.agent.options ?? {},
    protectedPaths: await protectedPaths(),
  };
}

/** The data dir (secrets, sessions, transcripts), lexically and through any symlink. */
async function protectedPaths(): Promise<string[]> {
  const dir = resolve(paths.data());
  const real = await realpath(dir).catch(() => dir);
  return [...new Set([dir, real])];
}

async function disposeSession(): Promise<void> {
  if (!session) return;
  try {
    await session.dispose();
  } catch (err) {
    log("warn", "adapter dispose failed", { error: String(err) });
  }
  session = null;
}

async function shutdownAdapters(): Promise<void> {
  for (const adapter of listAdapters()) {
    if (!adapter.shutdown) continue;
    try {
      await adapter.shutdown();
    } catch (err) {
      log("warn", "adapter shutdown failed", { adapter: adapter.id, error: String(err) });
    }
  }
}

async function restoreQueuedUserMessages(current?: QueueJob): Promise<void> {
  const queued = await withQueueLock(async () => queue.filter((j) => j.generation === identityGeneration));
  const jobs =
    current && current.generation === identityGeneration && !queued.some((j) => j.id === current.id)
      ? [current, ...queued]
      : queued;
  const done = emitChain.then(async () => {
    for (const job of jobs) {
      await appendTranscript({ type: "user.message", text: job.text, id: job.id, attachments: job.attachments });
    }
  });
  emitChain = done.catch((err) => {
    log("error", "emit failed", { error: String(err) });
  });
  await done;
  await broadcastTranscriptSnapshot();
  await broadcastQueue();
  await broadcastThreads();
}

async function broadcastTranscriptSnapshot(): Promise<void> {
  const snap = await readTranscriptSnapshot();
  hub.broadcast({
    type: "transcript.snapshot",
    events: snap.events,
    ...(snap.truncated ? { truncated: true } : {}),
    lastSeq: snap.lastSeq,
  });
}

async function rotateToNewThread(previousAgentId: string | null): Promise<void> {
  // The agent the live thread ran under: the session's, or — when no run ever
  // started a session — the config from before the change that caused this.
  const previousAgent = runtime.identityAgent ?? resetFromAgent ?? undefined;
  resetFromAgent = null;
  await rotateLiveThread(previousAgentId, previousAgent);
  runtime.agentId = null;
  runtime.fingerprint = null;
  runtime.identityAgent = null;
  await saveState({ agentId: null });
  await gcUploads();
}

async function ensureSession(current?: QueueJob): Promise<AdapterSession> {
  const cfg = await loadConfig();
  const adapter = getAdapter(cfg.agent.adapter);
  const fp = agentFingerprint(cfg);
  const opts = await createOpts();
  const cwdCheck = await validateCwd(opts.cwd);
  if (!cwdCheck.ok) throw new Error(cwdCheck.error);

  if (session && !session.closed && runtime.fingerprint === fp) return session;

  const identityChanged = runtime.fingerprint !== null && runtime.fingerprint !== fp;
  const previousAgentId = runtime.agentId;
  await disposeSession();

  if (identityChanged) {
    /* A config patch already owns this rotation; rotating here too archives twice and starts an extra agent. */
    if (await withQueueLock(async () => pendingIdentityReset)) throw new RunAborted();
    await rotateToNewThread(previousAgentId);
    await restoreQueuedUserMessages(current);
  }

  const state = await loadState();
  const canResume =
    adapter.capabilities.resume ||
    (Boolean(adapter.shouldResume) && usableAgentId(state.agentId)
      ? await adapter.shouldResume!(state.agentId, opts)
      : false);
  /*
   * Also when this same identity's session closed under us (its process died, a hung run was
   * abandoned): the thread keeps its agent and the next send resumes it. After an identity
   * change the rotation above has already cleared the stored agent.
   */
  if (canResume && usableAgentId(state.agentId)) {
    try {
      session = await adapter.resume(state.agentId, opts);
      runtime.fingerprint = fp;
      runtime.identityAgent = cfg.agent;
      await persistAgentId(session.agentId);
      log("info", "resumed agent", { adapter: adapter.id, agentId: session.agentId });
      return session;
    } catch (err) {
      log("warn", "resume failed, creating a new agent", { error: String(err) });
      try {
        session = await adapter.create(opts);
      } catch (createErr) {
        log("warn", "create after resume failed", { error: String(createErr) });
        throw createErr;
      }
      runtime.agentId = null;
      await saveState({ agentId: null });
      runtime.fingerprint = fp;
      runtime.identityAgent = cfg.agent;
      await persistAgentId(session.agentId);
      log("info", "created agent", { adapter: adapter.id, agentId: session.agentId });
      return session;
    }
  }

  session = await adapter.create(opts);
  runtime.fingerprint = fp;
  runtime.identityAgent = cfg.agent;
  await persistAgentId(session.agentId);
  log("info", "created agent", { adapter: adapter.id, agentId: session.agentId });
  return session;
}

async function performIdentityReset(): Promise<void> {
  /* `rotating` for the whole reset: a message sent meanwhile waits instead of landing in the
     thread being archived and then starting a second rotation of its own. */
  const go = await withQueueLock(async () => {
    if (!pendingIdentityReset || rotating) return false;
    pendingIdentityReset = false;
    rotating = true;
    return true;
  });
  if (!go) return;
  try {
    const previousAgentId = runtime.agentId;
    await disposeSession();
    await rotateToNewThread(previousAgentId);
    await restoreQueuedUserMessages();
  } finally {
    await withQueueLock(async () => {
      rotating = false;
    });
  }
}

async function finishIdentityResetIfIdle(): Promise<void> {
  const idle = await withQueueLock(async () => !processing && !currentRun);
  if (!idle) return;
  await performIdentityReset();
}

function ensureSessionShared(current?: QueueJob): Promise<AdapterSession> {
  if (!sessionInFlight) {
    const pending = ensureSession(current).finally(() => {
      if (sessionInFlight === pending) sessionInFlight = null;
    });
    pending.catch(() => undefined);
    sessionInFlight = pending;
  }
  return sessionInFlight;
}

async function waitRun(run: AdapterRun): Promise<"finished" | "error" | "cancelled"> {
  try {
    return await run.wait();
  } catch (err) {
    waitErrors.set(run, err);
    return "error";
  }
}

function delay(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
}

async function abandonTimedOutRun(): Promise<"cancelled"> {
  /* The run ignored its cancel: dropping the session is the only way left to stop it. Its wait()
     is still pending inside waitRun, which swallows whatever it settles with. */
  log("warn", "run did not stop after cancel; disposing its session", { timeoutMs: runCancelTimeoutMs });
  await disposeSession();
  return "cancelled";
}

async function waitRunRespectingCancel(
  run: AdapterRun,
  gen: number,
): Promise<"finished" | "error" | "cancelled"> {
  const waited = waitRun(run);
  /* After a cancel the run gets runCancelTimeoutMs to wind down before its session is dropped. */
  const cancelled = cancelledSince(gen);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = cancelled.promise.then(
    () => new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), runCancelTimeoutMs))),
  );
  try {
    const raced = await Promise.race([waited, timedOut]);
    return raced === "timeout" ? abandonTimedOutRun() : raced;
  } finally {
    cancelled.dispose();
    if (timer) clearTimeout(timer);
  }
}

async function cancelAndWait(run: AdapterRun): Promise<"finished" | "error" | "cancelled"> {
  try {
    await run.cancel();
  } catch {
    /* ignore */
  }
  const raced = await Promise.race([waitRun(run), delay(runCancelTimeoutMs)]);
  return raced === "timeout" ? abandonTimedOutRun() : raced;
}

async function processQueue(): Promise<void> {
  const started = await withQueueLock(async () => {
    if (processing) return false;
    processing = true;
    return true;
  });
  if (!started) return;

  try {
    for (;;) {
      while (true) {
        const item = await withQueueLock(async () => {
          if (shuttingDown) return { kind: "empty" as const };
          if (pendingIdentityReset) return { kind: "reset" as const };
          const idx = queue.findIndex((j) => j.generation === identityGeneration);
          if (idx < 0) {
            queue = [];
            return { kind: "empty" as const };
          }
          const job = queue[idx];
          queue.splice(idx, 1);
          currentJobId = job.id;
          return { kind: "job" as const, job, gen: cancelGeneration };
        });
        if (item.kind === "reset") {
          await performIdentityReset();
          continue;
        }
        if (item.kind === "empty") break;
        await broadcastQueue();

        const stillCurrent = await withQueueLock(async () => {
          if (pendingIdentityReset || item.job.generation !== identityGeneration) {
            currentJobId = null;
            if (item.job.generation === identityGeneration) {
              queue.unshift(item.job);
              return "requeued" as const;
            }
            return "dropped" as const;
          }
          return "current" as const;
        });
        if (stillCurrent === "dropped") {
          /* The patch that dropped the queue already retracted what was still in it; this one had left it. */
          await emit({ type: "user.retracted", id: item.job.id });
          await broadcastQueue();
        }
        if (stillCurrent !== "current") continue;

        try {
          const gen = await withQueueLock(async () => {
            runtime.busy = true;
            runStartedAt = nowFn();
            return item.gen;
          });
          await broadcastSession();
          await runOnce(item.job, gen);
        } catch (err) {
          log("error", "runOnce failed", { error: String(err) });
          try {
            await emit({
              type: "run.error",
              message: err instanceof Error ? err.message : String(err),
              phase: "run",
            });
          } catch (emitErr) {
            log("error", "emit after runOnce failed", { error: String(emitErr) });
          }
        }
      }

      const more = await withQueueLock(async () => {
        if (pendingIdentityReset) return true;
        if (queue.some((j) => j.generation === identityGeneration)) return true;
        processing = false;
        runtime.busy = false;
        currentJobId = null;
        runStartedAt = undefined;
        return false;
      });
      if (!more) {
        queueCrashes = 0;
        await broadcastSession();
        await broadcastQueue();
        return;
      }
    }
  } catch (err) {
    await withQueueLock(async () => {
      processing = false;
      runtime.busy = false;
      currentJobId = null;
      runStartedAt = undefined;
    });
    log("error", "processQueue crashed", { error: String(err) });
    try {
      await emit({
        type: "run.error",
        message: err instanceof Error ? err.message : String(err),
        phase: "run",
      });
    } catch (emitErr) {
      log("error", "emit after processQueue crash failed", { error: String(emitErr) });
    }
    /* Try again, but not in a tight loop if whatever crashed it keeps failing. */
    queueCrashes += 1;
    const wait = Math.min(30_000, 250 * 2 ** Math.min(queueCrashes - 1, 7));
    setTimeout(() => void processQueue().catch((next) => log("error", "processQueue", { error: String(next) })), wait).unref?.();
  }
}

async function runOnce(job: QueueJob, gen: number): Promise<void> {
  let stallTimer: ReturnType<typeof setInterval> | undefined;
  let eventsClosed = false;
  const starting = new AbortController();
  startAbort = starting;
  if (cancelGeneration !== gen) starting.abort();
  try {
    let handle: AdapterSession;
    try {
      handle = await abortable(ensureSessionShared(job), starting.signal);
    } catch (err) {
      if (err instanceof RunAborted || cancelGeneration !== gen) {
        await emit({ type: "run.cancelled" });
        return;
      }
      await emit({ type: "run.error", message: err instanceof Error ? err.message : String(err), phase: "startup" });
      return;
    }

    if (cancelGeneration !== gen) {
      await emit({ type: "run.cancelled" });
      return;
    }

    let sawRunError = false;
    let thinkingOpen = false;
    let thinkingStarted = 0;
    let lastEventAt = nowFn();
    let stalledEmitted = false;
    const onEvent = (raw: ServerMessage) => {
      /* A run started late by an abandoned send() must not paint into the transcript after run.cancelled. */
      if (eventsClosed) return;
      /* Tools cut short by the operator's cancel end "cancelled" too; that is not Auto-review denying them. */
      const event =
        raw.type === "tool.end" && raw.denied && cancelGeneration !== gen ? { ...raw, denied: undefined } : raw;
      lastEventAt = nowFn();
      /* Output again: a later silence deserves its own warning. */
      stalledEmitted = false;
      if (event.type === "run.error") sawRunError = true;
      if (event.type === "thinking.delta" && !thinkingOpen) {
        thinkingOpen = true;
        thinkingStarted = nowFn();
      }
      if (event.type === "thinking.done") thinkingOpen = false;
      void emit(event, handle.agentId);
    };

    const closeThinkingIfOpen = async () => {
      if (!thinkingOpen) return;
      thinkingOpen = false;
      await emit({ type: "thinking.done", durationMs: Math.max(0, nowFn() - thinkingStarted) }, handle.agentId);
    };

    const cfg = await loadConfig();
    const runId = randomUUID();
    runStartedAt = nowFn();
    lastEventAt = nowFn();
    resetPushRunFlags();
    await emit({ type: "run.start", runId });
    await broadcastSession();
    const stallSeconds = cfg.session.stallSeconds;
    if (stallSeconds > 0) {
      stallTimer = setInterval(() => {
        if (stalledEmitted) return;
        const idleMs = nowFn() - lastEventAt;
        if (idleMs >= stallSeconds * 1000) {
          stalledEmitted = true;
          void emit({ type: "run.stalled", idleMs });
        }
      }, stallPollMs);
    }

    if (cancelGeneration !== gen) {
      await emit({ type: "run.cancelled" });
      return;
    }

    let files: Awaited<ReturnType<typeof materializeAttachments>> = [];
    try {
      files = await materializeAttachments(cfg.agent.cwd, job.attachments);
    } catch (err) {
      await emit({
        type: "run.error",
        message: err instanceof Error ? err.message : String(err),
        phase: "startup",
      });
      return;
    }
    if (job.attachments?.length && files.length === 0) {
      await emit({ type: "run.error", message: "Attachments could not be read", phase: "startup" });
      return;
    }
    /* Copying attachments takes a moment; a cancel during it must not still start the run. */
    if (cancelGeneration !== gen) {
      await emit({ type: "run.cancelled" });
      return;
    }
    const sendOpts = {
      model: cfg.agent.model,
      modelParams: cfg.agent.modelParams,
      attachments: files.length ? files : undefined,
    };

    try {
      const sending = (async () => {
        try {
          return await handle.send(job.text, onEvent, sendOpts);
        } catch (err) {
          if (isActiveRunError(err)) return handle.send(job.text, onEvent, { ...sendOpts, force: true });
          throw err;
        }
      })();
      let run: AdapterRun;
      try {
        run = await abortable(sending, starting.signal);
      } catch (err) {
        if (err instanceof RunAborted) {
          /* send() may still start the run after we stopped waiting; stop it as soon as it does,
             and wait for it, as every run is waited on. */
          void sending
            .then(async (late) => {
              log("info", "cancelling a run that started after its cancel", { agentId: handle.agentId, runId: late.id });
              await late.cancel().catch(() => undefined);
              await late.wait().catch(() => undefined);
            })
            .catch(() => undefined);
        }
        throw err;
      }
      currentRun = run;
      if (cancelGeneration !== gen) {
        await cancelAndWait(run);
        await drainEmit();
        await closeThinkingIfOpen();
        await emit({ type: "run.cancelled" });
        return;
      }
      await persistAgentId(handle.agentId);
      log("info", "run started", { agentId: handle.agentId, runId: run.id });
      const status = await waitRunRespectingCancel(run, gen);
      await persistAgentId(handle.agentId);
      await drainEmit();
      await closeThinkingIfOpen();
      if (cancelGeneration !== gen || status === "cancelled") await emit({ type: "run.cancelled" });
      else if (status === "error") {
        if (!sawRunError) {
          const failure = waitErrors.get(run);
          await emit({
            type: "run.error",
            message: failure instanceof Error && failure.message ? failure.message : "Run failed",
            phase: failure instanceof AdapterError ? failure.phase : "run",
          });
        }
      } else await emit({ type: "run.done" });
    } catch (err) {
      if (cancelGeneration !== gen) {
        await closeThinkingIfOpen();
        await emit({ type: "run.cancelled" });
        return;
      }
      const phase = err instanceof AdapterError ? err.phase : "run";
      await closeThinkingIfOpen();
      if (!sawRunError) {
        await emit({
          type: "run.error",
          message: err instanceof Error ? err.message : String(err),
          phase,
        });
      }
    }
  } finally {
    eventsClosed = true;
    if (stallTimer) clearInterval(stallTimer);
    if (startAbort === starting) startAbort = null;
    currentRun = null;
    currentJobId = null;
  }
}

/**
 * Queue a message. A refusal (queue full, onboarding not done) is told to `onReject`, the client
 * that sent it: it is not part of the conversation, so it is neither saved nor pushed to every
 * device as a failed run.
 */
export async function enqueueMessage(
  text: string,
  attachments?: MessageAttachment[],
  clientId?: string,
  source: "user" | "schedule" = "user",
  onReject?: (message: string) => void,
): Promise<boolean> {
  const reject = (message: string) => {
    if (onReject) onReject(message);
    else log("warn", "message refused", { message, source });
    return false;
  };
  const trimmed = text.trim();
  if (!trimmed && !attachments?.length) return false;
  if (attachments && attachments.length > MAX_ATTACHMENTS) return reject("Too many attachments");
  const cfg = await loadConfig();
  if (!cfg.onboarding.completed) return reject("Onboarding is not complete");

  for (let attempt = 0; attempt < enqueueRotatingRetries; attempt++) {
    const prepared = await withQueueLock(async () => {
      if (shuttingDown) return { kind: "skip" as const };
      if (rotating) return { kind: "retry" as const };
      const id = isMessageId(clientId) ? clientId : randomUUID();
      if (currentJobId === id || queue.some((j) => j.id === id)) return { kind: "skip" as const };
      const live = queue.filter((j) => j.generation === identityGeneration).length;
      if (live >= MAX_QUEUE) return { kind: "full" as const };
      return { kind: "ok" as const, id, generation: identityGeneration };
    });
    if (prepared.kind === "skip") return false;
    if (prepared.kind === "full") return reject("Queue is full");
    if (prepared.kind === "retry") {
      await new Promise((r) => setTimeout(r, 25));
      continue;
    }

    try {
      await emit({
        type: "user.message",
        text: trimmed,
        id: prepared.id,
        attachments: attachments?.length ? attachments : undefined,
      });
    } catch (err) {
      log("error", "persist user.message failed", { error: String(err) });
      try {
        await emit({
          type: "run.error",
          message: err instanceof Error ? err.message : String(err),
          phase: "startup",
        });
      } catch {
        /* already logged */
      }
      return false;
    }

    const queued = await withQueueLock(async () => {
      if (shuttingDown || rotating || identityGeneration !== prepared.generation) return { ok: false as const };
      const busy = runtime.busy || processing || queue.length > 0;
      queue.push({ id: prepared.id, text: trimmed, attachments, generation: prepared.generation, source });
      return { ok: true as const, busy };
    });
    if (!queued.ok) {
      /* The message is already in a transcript and on every screen; it will not run, so take it back. */
      await emit({ type: "user.retracted", id: prepared.id });
      return false;
    }
    if (queued.busy) await emit({ type: "run.queued" });
    await broadcastQueue();
    void processQueue().catch((err) => log("error", "processQueue", { error: String(err) }));
    return true;
  }
  return reject("Gateway is busy, try again");
}

export async function cancelQueued(id: string): Promise<void> {
  if (!id) return;
  const action = await withQueueLock(async () => {
    if (currentJobId === id) return "run" as const;
    const idx = queue.findIndex((j) => j.id === id);
    if (idx < 0) return "none" as const;
    queue.splice(idx, 1);
    return "retract" as const;
  });
  if (action === "run") {
    await cancelRun();
    return;
  }
  if (action !== "retract") return;
  await emit({ type: "user.retracted", id });
  await broadcastQueue();
}

export async function cancelRun(): Promise<void> {
  bumpCancelGeneration();
  if (!currentRun) {
    abortStartingRun();
    return;
  }
  try {
    await currentRun.cancel();
  } catch (err) {
    log("warn", "cancel failed", { error: String(err) });
  }
}

/**
 * Config changes and thread moves (new, switch, delete, open workspace) one at a time: a cwd
 * change arriving mid-switch used to be overwritten by the switch, or archive the thread the
 * switch had just opened. A switch applies its thread's config under the same turn.
 */
const withThreadOps = createMutex();

export async function applyConfigPatch(
  patch: ConfigPatch,
  opts?: { identity?: "auto" | "preserve" },
): Promise<{ restart: boolean }> {
  if (opts?.identity === "preserve") return applyConfigPatchUnlocked(patch, opts);
  return withThreadOps(() => applyConfigPatchUnlocked(patch, opts));
}

async function applyConfigPatchUnlocked(
  patch: ConfigPatch,
  opts?: { identity?: "auto" | "preserve"; replaceAgentOptions?: boolean },
): Promise<{ restart: boolean }> {
  await assertPasswordChangeAllowed(patch);
  const before = await loadConfig();
  const { config, restart } = await applyPatch(patch, { replaceAgentOptions: opts?.replaceAgentOptions });
  invalidateAdapterInfoCache();
  if (config.agent.cwd && config.agent.cwd !== before.agent.cwd) await rememberCwd(config.agent.cwd);
  if (opts?.identity !== "preserve") {
    const identityChanged = agentFingerprint(before) !== agentFingerprint(config);
    if (identityChanged) {
      const dropped = await withQueueLock(async () => {
        bumpCancelGeneration();
        identityGeneration += 1;
        const jobs = queue;
        queue = [];
        pendingIdentityReset = true;
        resetFromAgent ??= before.agent;
        return jobs;
      });
      for (const job of dropped) {
        await emit({ type: "user.retracted", id: job.id });
      }
      await broadcastQueue();
      if (currentRun) {
        try {
          await currentRun.cancel();
        } catch {
          /* ignore */
        }
      } else abortStartingRun();
      await finishIdentityResetIfIdle();
    }
  }
  await broadcastConfig(restart);
  await broadcastSession();
  await broadcastThreads();
  return { restart };
}

function assertThreadId(id: string): void {
  if (!id || id.includes("/") || id.includes("..")) throw new HttpError(400, "invalid thread id");
}

async function beginIdleThreadOp(): Promise<void> {
  await withQueueLock(async () => {
    if (runtime.busy || processing || currentRun || rotating) throw new HttpError(409, "busy");
    rotating = true;
    bumpCancelGeneration();
    identityGeneration += 1;
    queue = [];
  });
}

async function endThreadOp(): Promise<void> {
  await withQueueLock(async () => {
    rotating = false;
  });
}

export async function listLiveThreads() {
  await ensureLiveThread();
  return listThreads();
}

export async function startNewLiveThread(opts?: { fresh?: boolean }): Promise<void> {
  return withThreadOps(() => startNewLiveThreadUnlocked(opts));
}

async function startNewLiveThreadUnlocked(opts?: { fresh?: boolean }): Promise<void> {
  await beginIdleThreadOp();
  try {
    const previous = runtime.agentId;
    await disposeSession();
    runtime.fingerprint = null;
    await startNewThread(previous, opts);
    runtime.agentId = null;
    runtime.fingerprint = null;
    runtime.identityAgent = null;
    await saveState({ agentId: null });
    await broadcastTranscriptSnapshot();
    await broadcastConfig();
    await broadcastSession();
    await broadcastQueue();
    await broadcastThreads();
    await gcUploads();
  } finally {
    await endThreadOp();
  }
}

export async function switchLiveThread(id: string): Promise<void> {
  return withThreadOps(() => switchLiveThreadUnlocked(id));
}

async function switchLiveThreadUnlocked(id: string): Promise<void> {
  assertThreadId(id);
  await ensureLiveThread();
  const same = liveThreadId() === id;
  if (!same) {
    /* Check the target before tearing anything down: a thread whose adapter is gone or whose
       folder was removed used to fail only after the live thread was archived and disposed. */
    const target = await loadThread(id);
    if (!target) throw new HttpError(404, "Thread not found");
    const cwd = await validateCwd(target.agent.cwd);
    if (!cwd.ok) throw new HttpError(400, cwd.error);
    const adapter = getAdapter(target.agent.adapter);
    const available = await probeAdapter(adapter, target.agent.options);
    if (!available.ok) throw new HttpError(400, available.error);
  }
  const start = await withQueueLock(async () => {
    if (runtime.busy || processing || currentRun || rotating) throw new HttpError(409, "busy");
    if (same) return false;
    rotating = true;
    bumpCancelGeneration();
    identityGeneration += 1;
    queue = [];
    return true;
  });
  if (!start) return;
  try {
    const loaded = await loadThread(id);
    if (!loaded) throw new HttpError(404, "Thread not found");
    await archiveLiveThread(runtime.agentId);
    await disposeSession();
    runtime.fingerprint = null;
    await applyConfigPatchUnlocked({ agent: loaded.agent }, { identity: "preserve", replaceAgentOptions: true });
    await activateThread(id, loaded.meta.agentId);
    runtime.agentId = loaded.meta.agentId;
    await broadcastTranscriptSnapshot();
    await broadcastSession();
    await broadcastQueue();
    await broadcastThreads();
  } finally {
    await endThreadOp();
  }
}

export async function deleteLiveThread(id: string): Promise<void> {
  return withThreadOps(() => deleteLiveThreadUnlocked(id));
}

async function deleteLiveThreadUnlocked(id: string): Promise<void> {
  assertThreadId(id);
  await ensureLiveThread();
  const wasLive = liveThreadId() === id;
  // A new thread even if the deleted one was empty: it cannot be kept live.
  if (wasLive) await startNewLiveThreadUnlocked({ fresh: true });
  try {
    await removeThread(id);
  } catch (err) {
    if (wasLive) throw err;
    throw new HttpError(404, err instanceof Error ? err.message : "Thread not found");
  }
  await gcUploads();
  if (wasLive) {
    await broadcastTranscriptSnapshot();
    await broadcastSession();
  }
  await broadcastThreads();
}

export async function renameLiveThread(id: string, title: string): Promise<void> {
  assertThreadId(id);
  try {
    await renameThread(id, title);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Thread not found";
    if (message === "title required") throw new HttpError(400, message);
    throw new HttpError(404, message);
  }
  await broadcastThreads();
}

export async function openWorkspace(cwd: string): Promise<void> {
  return withThreadOps(async () => {
    const check = await validateCwd(cwd);
    if (!check.ok) throw new HttpError(400, check.error);
    const cfg = await loadConfig();
    if (cfg.agent.cwd === cwd) return;
    /* Either way the live thread is left; a run in it is the operator's to stop, not this route's. */
    if (runtimeBusy()) throw new HttpError(409, "busy");
    const threads = await listThreads();
    const match = threads
      .filter((t) => t.cwd === cwd)
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    if (match.length) {
      await switchLiveThreadUnlocked(match[0]!.id);
      return;
    }
    await applyConfigPatchUnlocked({ agent: { cwd } });
  });
}

export async function pinWorkspaces(pins: string[]): Promise<string[]> {
  if (pins.length > MAX_PINNED_CWDS) throw new HttpError(400, "Too many pinned workspaces");
  for (const cwd of pins) {
    const check = await validateCwd(cwd);
    if (!check.ok) throw new HttpError(400, check.error);
  }
  return setPinnedCwds(pins);
}

export async function exportLiveThread(id: string): Promise<{ filename: string; markdown: string }> {
  assertThreadId(id);
  const bundle = await readThreadBundle(id);
  if (!bundle) throw new HttpError(404, "Thread not found");
  const slug = bundle.meta.title.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40) || "thread";
  return { filename: `${slug}.md`, markdown: eventsToMarkdown(bundle.meta, bundle.events) };
}

export async function initRuntime(): Promise<void> {
  shuttingDown = false;
  setTranscriptFlushErrorHandler(reportPersistFailure);
  await ensureLiveThread();
  const state = await loadState();
  runtime.agentId = usableAgentId(state.agentId) ? state.agentId : null;
  const cfg = await loadConfig();
  const adapter = getAdapter(cfg.agent.adapter);
  if (cfg.session.resumeOnStart && usableAgentId(state.agentId)) {
    try {
      const opts = await createOpts();
      const canResume =
        adapter.capabilities.resume ||
        (adapter.shouldResume ? await adapter.shouldResume(state.agentId, opts) : false);
      if (canResume) await ensureSession();
    } catch (err) {
      log("warn", "startup resume skipped", { error: String(err) });
    }
  }
  bindScheduleRuntime({
    enqueue: (text, source) => enqueueMessage(text, undefined, undefined, source),
    isIdle: () => !runtimeBusy(),
    liveThreadId,
    liveCwd: async () => (await loadConfig()).agent.cwd,
    switchThread: (id) => switchLiveThread(id),
    applyCwd: async (cwd) => {
      /* The folder may be gone since the job was saved; fail the job, not the live thread. */
      const check = await validateCwd(cwd);
      if (!check.ok) throw new HttpError(400, check.error);
      await applyConfigPatch({ agent: { cwd } });
    },
  });
  startSchedules();
}

export async function shutdownRuntime(): Promise<void> {
  stopSchedules();
  bindScheduleRuntime(null);
  await cancelLoginJob().catch(() => undefined);
  await withQueueLock(async () => {
    shuttingDown = true;
    queue = [];
    bumpCancelGeneration();
    identityGeneration += 1;
    pendingIdentityReset = false;
    resetFromAgent = null;
    rotating = false;
  });
  abortStartingRun();
  const run = currentRun;
  if (run) await cancelAndWait(run);
  /* Let the queue loop see the cancel and leave; disposing under a run that is still starting leaks it. */
  const deadline = nowFn() + runCancelTimeoutMs + 2_000;
  while (processing && nowFn() < deadline) await new Promise((r) => setTimeout(r, 25));
  await sessionInFlight?.catch(() => undefined);
  await withQueueLock(async () => {
    processing = false;
    runtime.busy = false;
  });
  currentRun = null;
  await disposeSession();
  await flushLiveTranscript().catch((err) => log("error", "transcript flush at shutdown failed", { error: String(err) }));
  setTranscriptFlushErrorHandler(null);
  runtime.agentId = null;
  runtime.fingerprint = null;
  runtime.identityAgent = null;
  resetLiveThreadCache();
  await shutdownAdapters();
}

export async function listModels(adapterId?: string): Promise<ModelListResponse> {
  const cfg = await loadConfig();
  const id = adapterId || cfg.agent.adapter;
  const adapter = getAdapter(id);
  const secrets = await loadSecrets();
  const key = adapterApiKey(secrets, id);
  const result = await adapter.listModels(key || undefined, cfg.agent.cwd || undefined);
  const ids = result.models.map((m) => m.id);
  if (result.source === "fallback") {
    log("warn", "model catalog fallback", { adapter: id, error: result.error, count: ids.length, ids });
  } else {
    log("info", "model catalog live", { adapter: id, count: ids.length, ids });
  }
  return result;
}

const ADAPTER_INFO_TTL_MS = 30_000;
let adapterInfoCache: { at: number; value: AdapterPublicInfo[] } | null = null;

export function invalidateAdapterInfoCache(): void {
  adapterInfoCache = null;
}

export async function listAdapterInfo(): Promise<AdapterPublicInfo[]> {
  if (adapterInfoCache && Date.now() - adapterInfoCache.at < ADAPTER_INFO_TTL_MS) {
    return adapterInfoCache.value;
  }
  const secrets = await loadSecrets();
  const flags = secretsFlags(secrets);
  const cfg = await loadConfig();
  const out = await Promise.all(
    listAdapters().map(async (adapter) => {
      let status: { loggedIn: boolean; email?: string } = { loggedIn: false };
      try {
        status = adapter.authStatus ? await adapter.authStatus() : { loggedIn: false };
      } catch (err) {
        log("warn", "adapter authStatus failed", { adapter: adapter.id, error: String(err) });
      }
      const probeOpts = adapter.id === cfg.agent.adapter ? cfg.agent.options : undefined;
      return {
        id: adapter.id,
        displayName: adapter.displayName,
        description: adapter.description,
        capabilities: adapter.capabilities,
        available: await probeAdapter(adapter, probeOpts),
        auth: {
          loggedIn: status.loggedIn,
          email: status.email,
          apiKeyConfigured: Boolean(flags.adapters[adapter.id]?.apiKey || adapterApiKey(secrets, adapter.id)),
        },
      } satisfies AdapterPublicInfo;
    }),
  );
  adapterInfoCache = { at: Date.now(), value: out };
  return out;
}

export async function adapterLogin(adapterId: string): Promise<{ url?: string }> {
  const adapter = getAdapter(adapterId);
  if (!adapter.loginInteractive) throw new Error("Interactive login is not available for this adapter");
  invalidateAdapterInfoCache();
  return startLoginJob(adapterId, (opts) => adapter.loginInteractive!(opts));
}

export async function adapterLoginCancel(): Promise<void> {
  await cancelLoginJob();
}

export async function adapterAuthStatus(adapterId: string): Promise<{
  loggedIn: boolean;
  email?: string;
  apiKeyConfigured: boolean;
  loginUrl?: string;
  loginStatus?: string;
  loginError?: string;
}> {
  const adapter = getAdapter(adapterId);
  const secrets = await loadSecrets();
  let status: { loggedIn: boolean; email?: string } = { loggedIn: false };
  try {
    status = adapter.authStatus ? await adapter.authStatus() : { loggedIn: false };
  } catch (err) {
    log("warn", "adapter authStatus failed", { adapter: adapterId, error: String(err) });
  }
  const login = snapshotLoginJob(adapterId);
  if (status.loggedIn) invalidateAdapterInfoCache();
  return {
    loggedIn: status.loggedIn,
    email: status.email,
    apiKeyConfigured: adapterApiKey(secrets, adapterId).length > 0,
    ...(login.status !== "idle" && login.url ? { loginUrl: login.url } : {}),
    ...(login.status !== "idle" ? { loginStatus: login.status } : {}),
    ...(login.error ? { loginError: login.error } : {}),
  };
}

export async function discoverAdapter(adapterId: string): Promise<AdapterDiscoverItem[]> {
  const adapter = getAdapter(adapterId);
  if (!adapter.discover) return [];
  return adapter.discover();
}

export { readTranscript, readTranscriptSnapshot };
export { isActiveRunError } from "./errors.js";
