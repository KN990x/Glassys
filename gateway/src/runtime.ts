import { mkdir, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
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
import { PROFILE_ID, isMessageId, isPersistedTranscriptEvent } from "@glassys/protocol";
import { agentFingerprint, applyPatch, loadConfig, redacted } from "./config.js";
import { adapterApiKey, loadSecrets, secretsFlags } from "./secrets.js";
import { getAdapter, listAdapters, probeAdapter } from "./adapters.js";
import { cancelLoginJob, snapshotLoginJob, startLoginJob } from "./adapter-login.js";
import { hub } from "./hub.js";
import { log, paths } from "./paths.js";
import { loadState, saveState } from "./state.js";
import { appendTranscript, readTranscript } from "./transcript.js";
import { HttpError, isActiveRunError } from "./errors.js";
import { createMutex } from "./lock.js";
import {
  activateThread,
  archiveLiveThread,
  ensureLiveThread,
  listThreads,
  liveThreadId,
  loadThread,
  openEmptyThread,
  rememberCwd,
  removeThread,
  resetLiveThreadCache,
  startNewThread,
} from "./threads.js";
import { gcUploads, resolveAttachments } from "./uploads.js";

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

type QueueJob = {
  id: string;
  text: string;
  generation: number;
  attachments?: MessageAttachment[];
};

let session: AdapterSession | null = null;
let currentRun: AdapterRun | null = null;
let currentJobId: string | null = null;
let runStartedAt: number | undefined;
let queue: QueueJob[] = [];
let processing = false;
let cancelGeneration = 0;
let identityGeneration = 0;
let emitChain: Promise<void> = Promise.resolve();
let pendingIdentityReset = false;
const withQueueLock = createMutex();

function persistable(event: ServerMessage): TranscriptEvent | null {
  if (!isPersistedTranscriptEvent(event)) return null;
  return event;
}

async function emit(event: ServerMessage, agentId?: string | null): Promise<void> {
  const done = emitChain.then(async () => {
    if (agentId) await persistAgentId(agentId);
    const stored = persistable(event);
    if (stored) await appendTranscript(stored);
    hub.broadcast(event);
  });
  emitChain = done.catch((err) => {
    log("error", "emit failed", { error: String(err) });
  });
  await emitChain;
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
    }));
}

async function broadcastQueue(): Promise<void> {
  hub.broadcast({ type: "queue.snapshot", items: snapshotQueue() });
}

async function broadcastSession(): Promise<void> {
  hub.broadcast({ type: "session", ...snapshotRuntime() });
}

async function broadcastConfig(restart?: boolean): Promise<void> {
  hub.broadcast({ type: "config", config: await redacted(undefined, restart) });
}

export async function validateCwd(cwd: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!cwd) return { ok: false, error: "Workspace path is required" };
  if (!isAbsolute(cwd)) return { ok: false, error: "Workspace path must be absolute" };
  try {
    const s = await stat(cwd);
    if (!s.isDirectory()) return { ok: false, error: "Workspace path is not a directory" };
    return { ok: true };
  } catch {
    return { ok: false, error: "Workspace path does not exist" };
  }
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
  };
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
  for (const job of jobs) {
    await appendTranscript({ type: "user.message", text: job.text, id: job.id, attachments: job.attachments });
  }
  hub.broadcast({ type: "transcript.snapshot", events: await readTranscript() });
  await broadcastQueue();
}

async function rotateToNewThread(previousAgentId: string | null): Promise<void> {
  await ensureLiveThread();
  await archiveLiveThread(previousAgentId, runtime.identityAgent ?? undefined);
  await openEmptyThread();
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

  if (session && runtime.fingerprint === fp) return session;

  const identityChanged = runtime.fingerprint !== null && runtime.fingerprint !== fp;
  const previousAgentId = runtime.agentId;
  await disposeSession();

  if (identityChanged) {
    await rotateToNewThread(previousAgentId);
    await restoreQueuedUserMessages(current);
  }

  const state = await loadState();
  const canResume =
    adapter.capabilities.resume ||
    (Boolean(adapter.shouldResume) && usableAgentId(state.agentId)
      ? await adapter.shouldResume!(state.agentId, opts)
      : false);
  if (cfg.session.resumeOnStart && canResume && usableAgentId(state.agentId) && runtime.fingerprint === null) {
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
  const go = await withQueueLock(async () => {
    if (!pendingIdentityReset) return false;
    pendingIdentityReset = false;
    return true;
  });
  if (!go) return;
  const previousAgentId = runtime.agentId;
  await disposeSession();
  await rotateToNewThread(previousAgentId);
  await restoreQueuedUserMessages();
}

async function finishIdentityResetIfIdle(): Promise<void> {
  const idle = await withQueueLock(async () => !processing && !currentRun);
  if (!idle) return;
  await performIdentityReset();
}

async function waitRun(run: AdapterRun): Promise<"finished" | "error" | "cancelled"> {
  try {
    return await run.wait();
  } catch {
    return "error";
  }
}

async function cancelAndWait(run: AdapterRun): Promise<"finished" | "error" | "cancelled"> {
  try {
    await run.cancel();
  } catch {
    /* ignore */
  }
  return waitRun(run);
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
          if (pendingIdentityReset) return { kind: "reset" as const };
          const idx = queue.findIndex((j) => j.generation === identityGeneration);
          if (idx < 0) {
            queue = [];
            return { kind: "empty" as const };
          }
          const job = queue[idx];
          queue.splice(idx, 1);
          currentJobId = job.id;
          return { kind: "job" as const, job };
        });
        if (item.kind === "reset") {
          await performIdentityReset();
          continue;
        }
        if (item.kind === "empty") break;
        await broadcastQueue();

        const stillCurrent = await withQueueLock(async () => {
          if (pendingIdentityReset || item.job.generation !== identityGeneration) {
            if (item.job.generation === identityGeneration) queue.unshift(item.job);
            return false;
          }
          return true;
        });
        if (!stillCurrent) continue;

        try {
          const gen = await withQueueLock(async () => {
            runtime.busy = true;
            runStartedAt = Date.now();
            return cancelGeneration;
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
    throw err;
  }
}

async function runOnce(job: QueueJob, gen: number): Promise<void> {
  let handle: AdapterSession;
  try {
    handle = await ensureSession(job);
  } catch (err) {
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
  const onEvent = (event: ServerMessage) => {
    if (event.type === "run.error") sawRunError = true;
    if (event.type === "thinking.delta" && !thinkingOpen) {
      thinkingOpen = true;
      thinkingStarted = Date.now();
    }
    if (event.type === "thinking.done") thinkingOpen = false;
    void emit(event, handle.agentId);
  };

  const closeThinkingIfOpen = async () => {
    if (!thinkingOpen) return;
    thinkingOpen = false;
    await emit({ type: "thinking.done", durationMs: Math.max(0, Date.now() - thinkingStarted) }, handle.agentId);
  };

  const cfg = await loadConfig();
  const runId = randomUUID();
  runStartedAt = Date.now();
  await emit({ type: "run.start", runId });
  await broadcastSession();

  if (cancelGeneration !== gen) {
    await emit({ type: "run.cancelled" });
    return;
  }

  const files = await resolveAttachments(job.attachments);
  const sendOpts = {
    model: cfg.agent.model,
    modelParams: cfg.agent.modelParams,
    attachments: files.length ? files : undefined,
  };

  try {
    let run: AdapterRun;
    try {
      run = await handle.send(job.text, onEvent, sendOpts);
    } catch (err) {
      if (isActiveRunError(err)) {
        run = await handle.send(job.text, onEvent, { ...sendOpts, force: true });
      } else {
        throw err;
      }
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
    const status = await run.wait();
    await persistAgentId(handle.agentId);
    await drainEmit();
    await closeThinkingIfOpen();
    if (cancelGeneration !== gen || status === "cancelled") await emit({ type: "run.cancelled" });
    else if (status === "error") {
      if (!sawRunError) await emit({ type: "run.error", message: "Run failed", phase: "run" });
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
  } finally {
    currentRun = null;
    currentJobId = null;
  }
}

export async function enqueueMessage(
  text: string,
  attachments?: MessageAttachment[],
  clientId?: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed && !attachments?.length) return;
  const cfg = await loadConfig();
  if (!cfg.onboarding.completed) {
    await emit({ type: "run.error", message: "Onboarding is not complete", phase: "startup" });
    return;
  }
  return withQueueLock(async () => {
    const id = isMessageId(clientId) ? clientId : randomUUID();
    if (currentJobId === id || queue.some((j) => j.id === id)) return;
    await emit({ type: "user.message", text: trimmed, id, attachments: attachments?.length ? attachments : undefined });
    const busy = runtime.busy || processing || queue.length > 0;
    queue.push({ id, text: trimmed, attachments, generation: identityGeneration });
    if (busy) await emit({ type: "run.queued" });
    await broadcastQueue();
    void processQueue().catch((err) => log("error", "processQueue", { error: String(err) }));
  });
}

export async function cancelQueued(id: string): Promise<void> {
  if (!id) return;
  if (currentJobId === id) {
    await cancelRun();
    return;
  }
  const removed = await withQueueLock(async () => {
    const idx = queue.findIndex((j) => j.id === id);
    if (idx < 0) return false;
    queue.splice(idx, 1);
    return true;
  });
  if (!removed) return;
  await emit({ type: "user.retracted", id });
  await broadcastQueue();
}

export async function cancelRun(): Promise<void> {
  const gen = cancelGeneration + 1;
  cancelGeneration = gen;
  if (!currentRun) return;
  try {
    await currentRun.cancel();
  } catch (err) {
    log("warn", "cancel failed", { error: String(err) });
  }
}

export async function applyConfigPatch(
  patch: ConfigPatch,
  opts?: { identity?: "auto" | "preserve" },
): Promise<{ restart: boolean }> {
  const before = await loadConfig();
  const { config, restart } = await applyPatch(patch);
  invalidateAdapterInfoCache();
  if (config.agent.cwd) await rememberCwd(config.agent.cwd);
  if (opts?.identity !== "preserve") {
    const identityChanged = agentFingerprint(before) !== agentFingerprint(config);
    if (identityChanged) {
      const dropped = await withQueueLock(async () => {
        cancelGeneration += 1;
        identityGeneration += 1;
        const jobs = queue;
        queue = [];
        pendingIdentityReset = true;
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
      }
      await finishIdentityResetIfIdle();
    }
  }
  await broadcastConfig(restart);
  await broadcastSession();
  return { restart };
}

function assertIdle(): void {
  if (runtime.busy || processing || currentRun) throw new HttpError(409, "busy");
}

export async function listLiveThreads() {
  await ensureLiveThread();
  return listThreads();
}

export async function startNewLiveThread(): Promise<void> {
  assertIdle();
  await withQueueLock(async () => {
    queue = [];
    identityGeneration += 1;
  });
  const previous = runtime.agentId;
  await disposeSession();
  runtime.fingerprint = null;
  await startNewThread(previous);
  runtime.agentId = null;
  runtime.fingerprint = null;
  runtime.identityAgent = null;
  await saveState({ agentId: null });
  hub.broadcast({ type: "transcript.snapshot", events: await readTranscript() });
  await broadcastConfig();
  await broadcastSession();
  await broadcastQueue();
  await gcUploads();
}

export async function switchLiveThread(id: string): Promise<void> {
  assertIdle();
  await ensureLiveThread();
  if (liveThreadId() === id) return;
  const loaded = await loadThread(id);
  if (!loaded) throw new HttpError(404, "Thread not found");
  await withQueueLock(async () => {
    queue = [];
    identityGeneration += 1;
  });
  await archiveLiveThread(runtime.agentId);
  await disposeSession();
  runtime.fingerprint = null;
  await applyConfigPatch({ agent: loaded.agent }, { identity: "preserve" });
  await activateThread(id, loaded.meta.agentId);
  runtime.agentId = loaded.meta.agentId;
  hub.broadcast({ type: "transcript.snapshot", events: await readTranscript() });
  await broadcastSession();
  await broadcastQueue();
}

export async function deleteLiveThread(id: string): Promise<void> {
  if (!id || id.includes("/") || id.includes("..")) throw new HttpError(400, "invalid thread id");
  assertIdle();
  const wasLive = liveThreadId() === id;
  if (wasLive) await startNewLiveThread();
  try {
    await removeThread(id);
  } catch (err) {
    if (wasLive) throw err;
    throw new HttpError(404, err instanceof Error ? err.message : "Thread not found");
  }
  await gcUploads();
  if (wasLive) {
    hub.broadcast({ type: "transcript.snapshot", events: await readTranscript() });
    await broadcastSession();
  }
}

export async function initRuntime(): Promise<void> {
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
}

export async function shutdownRuntime(): Promise<void> {
  await cancelLoginJob().catch(() => undefined);
  await withQueueLock(async () => {
    queue = [];
    cancelGeneration += 1;
    identityGeneration += 1;
    pendingIdentityReset = false;
    processing = false;
    runtime.busy = false;
  });
  const run = currentRun;
  currentRun = null;
  if (run) await cancelAndWait(run);
  await disposeSession();
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

export async function cursorLogin(): Promise<{ url?: string }> {
  return adapterLogin("cursor");
}

export async function cursorAuthStatus(): Promise<{ loggedIn: boolean; email?: string; apiKeyConfigured: boolean }> {
  return adapterAuthStatus("cursor");
}

export { readTranscript };
export { isActiveRunError } from "./errors.js";
