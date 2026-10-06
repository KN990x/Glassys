import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { writeFileAtomic } from "./atomic.js";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentConfig, ModelParam, ThreadSummary, TranscriptEvent } from "@glassys/protocol";
import { MAX_PINNED_CWDS, PROFILE_ID } from "@glassys/protocol";
import { paths } from "./paths.js";
import { createMutex } from "./lock.js";
import { loadState, saveState } from "./state.js";
import { loadConfig } from "./config.js";
import { parseJsonl } from "./jsonl.js";

export interface ThreadMeta {
  id: string;
  title: string;
  adapter: string;
  cwd: string;
  model: string;
  modelParams: ModelParam[];
  options: Record<string, unknown>;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
  titleManual?: boolean;
  usage?: { inputTokens: number; outputTokens: number };
}

const withThreads = createMutex();
let currentThreadId: string | null = null;

export function resetLiveThreadCache(): void {
  currentThreadId = null;
  metaCache.clear();
}

export function liveThreadId(): string | null {
  return currentThreadId;
}

export function liveTranscriptPath(): string {
  if (currentThreadId) return paths.threadTranscript(currentThreadId);
  return paths.legacyTranscript();
}

function nowIso(): string {
  return new Date().toISOString();
}

function titleFrom(cwd: string, events: TranscriptEvent[]): string {
  const base = basename(cwd) || "thread";
  const first = events.find((e) => e.type === "user.message" && e.text.trim());
  const snippet = first && first.type === "user.message" ? first.text.trim().replace(/\s+/g, " ").slice(0, 48) : "";
  return snippet ? `${base} · ${snippet}` : base;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Thread metadata by file path. Only this process writes it, so the cache is kept exact by
 * writeMeta and removeThread; the thread list is rebuilt on every usage update and used to read
 * and parse every meta.json each time. Keyed by path, so a different data dir never hits it.
 */
const metaCache = new Map<string, ThreadMeta>();

async function writeMeta(meta: ThreadMeta): Promise<void> {
  await mkdir(paths.threadDir(meta.id), { recursive: true });
  await writeFileAtomic(paths.threadMeta(meta.id), JSON.stringify(meta, null, 2));
  metaCache.set(paths.threadMeta(meta.id), structuredClone(meta));
}

async function loadMeta(id: string): Promise<ThreadMeta | null> {
  const path = paths.threadMeta(id);
  const cached = metaCache.get(path);
  if (cached) return structuredClone(cached);
  const meta = await readJson<ThreadMeta>(path);
  if (meta) metaCache.set(path, structuredClone(meta));
  return meta;
}

async function readEvents(path: string): Promise<TranscriptEvent[]> {
  try {
    return parseJsonl<TranscriptEvent>(await readFile(path, "utf8"));
  } catch {
    return [];
  }
}

function agentFromMeta(meta: ThreadMeta): AgentConfig {
  return {
    adapter: meta.adapter,
    cwd: meta.cwd,
    model: meta.model,
    modelParams: meta.modelParams ?? [],
    options: meta.options ?? {},
  };
}

function metaFromAgent(id: string, agent: AgentConfig, agentId: string | null, createdAt?: string): ThreadMeta {
  const ts = nowIso();
  return {
    id,
    title: basename(agent.cwd) || "thread",
    adapter: agent.adapter,
    cwd: agent.cwd,
    model: agent.model,
    modelParams: agent.modelParams ?? [],
    options: agent.options ?? {},
    agentId,
    createdAt: createdAt || ts,
    updatedAt: ts,
  };
}

async function createEmptyThread(agent: AgentConfig, agentId: string | null): Promise<ThreadMeta> {
  const id = randomUUID();
  await mkdir(paths.threadDir(id), { recursive: true });
  await writeFile(paths.threadTranscript(id), "", { encoding: "utf8", mode: 0o600 });
  const meta = metaFromAgent(id, agent, agentId);
  await writeMeta(meta);
  currentThreadId = id;
  await saveState({ profileId: PROFILE_ID, threadId: id, agentId });
  return meta;
}

async function ensureLiveThreadUnlocked(): Promise<string> {
  if (currentThreadId) return currentThreadId;
  const state = await loadState();
  if (state.threadId) {
    const meta = await loadMeta(state.threadId);
    if (meta) {
      currentThreadId = state.threadId;
      return currentThreadId;
    }
  }
  const cfg = await loadConfig();
  const legacy = await readEvents(paths.legacyTranscript());
  if (legacy.length) {
    const id = randomUUID();
    await mkdir(paths.threadDir(id), { recursive: true });
    try {
      await rename(paths.legacyTranscript(), paths.threadTranscript(id));
    } catch {
      /* The legacy file is not migrated again once state points here, so keep what was read. */
      const body = legacy.map((e) => JSON.stringify(e)).join("\n");
      await writeFile(paths.threadTranscript(id), body ? `${body}\n` : "", { encoding: "utf8", mode: 0o600 });
    }
    const meta = metaFromAgent(id, cfg.agent, state.agentId);
    meta.title = titleFrom(cfg.agent.cwd, legacy);
    await writeMeta(meta);
    currentThreadId = id;
    await saveState({ threadId: id });
    return id;
  }
  const meta = await createEmptyThread(cfg.agent, state.agentId);
  return meta.id;
}

export async function ensureLiveThread(): Promise<string> {
  return withThreads(() => ensureLiveThreadUnlocked());
}

/** Append to the live transcript under the same lock as rotate/switch, so a line never lands in a thread just archived. */
export async function appendLiveTranscriptLine(line: string): Promise<void> {
  return withThreads(async () => {
    const id = await ensureLiveThreadUnlocked();
    const path = paths.threadTranscript(id);
    /* One line per streamed token: append straight away, and create the directory only if it is gone. */
    try {
      await writeFile(path, line, { encoding: "utf8", flag: "a", mode: 0o600 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      await mkdir(paths.threadDir(id), { recursive: true });
      await writeFile(path, line, { encoding: "utf8", flag: "a", mode: 0o600 });
    }
  });
}

async function archiveLiveThreadUnlocked(agentId: string | null, agent?: AgentConfig): Promise<ThreadMeta | null> {
  const id = currentThreadId ?? (await loadState()).threadId;
  if (!id) return null;
  const cfgAgent = agent ?? (await loadConfig()).agent;
  const events = await readEvents(paths.threadTranscript(id));
  const prev = (await loadMeta(id)) ?? metaFromAgent(id, cfgAgent, agentId);
  const generated = titleFrom(cfgAgent.cwd, events) || prev.title;
  const meta: ThreadMeta = {
    ...prev,
    ...metaFromAgent(id, cfgAgent, agentId, prev.createdAt),
    title: prev.titleManual ? prev.title : generated,
    titleManual: prev.titleManual,
    agentId,
  };
  await writeMeta(meta);
  return meta;
}

export async function archiveLiveThread(agentId: string | null, agent?: AgentConfig): Promise<ThreadMeta | null> {
  return withThreads(() => archiveLiveThreadUnlocked(agentId, agent));
}

/**
 * Move off the live thread: archive it and open an empty one — unless it is
 * still empty. An empty live thread is rebound to the current config and kept:
 * archiving it produced a second, identical empty thread every time onboarding
 * or a config change rotated before the first run, and since no session had
 * started, the archived one even took the new cwd for its title.
 *
 * `previousAgent` is the config the live thread ran under, when the caller
 * knows it; without it the archive falls back to the current config.
 */
async function rotateLiveThreadUnlocked(
  agentId: string | null,
  previousAgent?: AgentConfig,
  fresh = false,
): Promise<ThreadMeta> {
  const id = await ensureLiveThreadUnlocked();
  const cfg = await loadConfig();
  const events = await readEvents(paths.threadTranscript(id));
  if (events.length === 0 && !fresh) {
    const prev = await loadMeta(id);
    const meta: ThreadMeta = {
      ...metaFromAgent(id, cfg.agent, null, prev?.createdAt),
      ...(prev?.titleManual ? { title: prev.title, titleManual: true } : {}),
    };
    await writeMeta(meta);
    currentThreadId = id;
    await saveState({ profileId: PROFILE_ID, threadId: id, agentId: null });
    return meta;
  }
  await archiveLiveThreadUnlocked(agentId, previousAgent);
  return createEmptyThread(cfg.agent, null);
}

export async function rotateLiveThread(agentId: string | null, previousAgent?: AgentConfig): Promise<ThreadMeta> {
  return withThreads(() => rotateLiveThreadUnlocked(agentId, previousAgent));
}

/** `fresh` always opens a new thread, for callers that remove the current one. */
export async function startNewThread(agentId: string | null, opts?: { fresh?: boolean }): Promise<ThreadMeta> {
  return withThreads(() => rotateLiveThreadUnlocked(agentId, undefined, opts?.fresh));
}

export async function listThreads(): Promise<ThreadSummary[]> {
  await ensureLiveThread();
  const live = currentThreadId;
  let ids: string[] = [];
  try {
    ids = await readdir(paths.threads());
  } catch {
    return [];
  }
  const out: ThreadSummary[] = [];
  for (const id of ids) {
    const meta = await loadMeta(id);
    if (!meta) continue;
    out.push({
      id: meta.id,
      title: meta.title,
      adapter: meta.adapter,
      cwd: meta.cwd,
      updatedAt: meta.updatedAt,
      ...(meta.usage ? { usage: meta.usage } : {}),
    });
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  if (live) {
    const idx = out.findIndex((t) => t.id === live);
    if (idx > 0) {
      const [cur] = out.splice(idx, 1);
      out.unshift(cur);
    }
  }
  return out;
}

export async function loadThread(id: string): Promise<{ meta: ThreadMeta; agent: AgentConfig } | null> {
  const meta = await loadMeta(id);
  if (!meta) return null;
  return { meta, agent: agentFromMeta(meta) };
}

export async function activateThread(id: string, agentId: string | null): Promise<ThreadMeta> {
  return withThreads(async () => {
    const meta = await loadMeta(id);
    if (!meta) throw new Error("Thread not found");
    currentThreadId = id;
    await saveState({ profileId: PROFILE_ID, threadId: id, agentId: agentId ?? meta.agentId });
    return meta;
  });
}

export async function rememberCwd(cwd: string): Promise<void> {
  if (!cwd) return;
  const state = await loadState();
  const recents = [cwd, ...(state.recentCwds || []).filter((p) => p !== cwd)].slice(0, 8);
  await saveState({ recentCwds: recents });
}

export async function setPinnedCwds(pins: string[]): Promise<string[]> {
  const next = [...new Set(pins.filter((p) => typeof p === "string" && p.length > 0))].slice(0, MAX_PINNED_CWDS);
  await saveState({ pinnedCwds: next });
  return next;
}

export async function addLiveUsage(inputTokens?: number, outputTokens?: number): Promise<void> {
  return withThreads(async () => {
    const id = currentThreadId;
    if (!id) return;
    const meta = await loadMeta(id);
    if (!meta) return;
    const input = meta.usage?.inputTokens ?? 0;
    const output = meta.usage?.outputTokens ?? 0;
    await writeMeta({
      ...meta,
      usage: {
        inputTokens: input + (typeof inputTokens === "number" ? inputTokens : 0),
        outputTokens: output + (typeof outputTokens === "number" ? outputTokens : 0),
      },
      updatedAt: nowIso(),
    });
  });
}

export async function refreshLiveTitle(): Promise<void> {
  return withThreads(async () => {
    const id = currentThreadId;
    if (!id) return;
    const meta = await loadMeta(id);
    if (!meta) return;
    if (meta.titleManual) return;
    const events = await readEvents(paths.threadTranscript(id));
    const next = titleFrom(meta.cwd, events);
    if (!next || next === meta.title) return;
    await writeMeta({ ...meta, title: next, updatedAt: nowIso() });
  });
}

export async function removeThread(id: string): Promise<void> {
  return withThreads(async () => {
    if (!id || id.includes("/") || id.includes("..")) throw new Error("invalid thread id");
    if (id === currentThreadId) throw new Error("cannot remove the live thread");
    const meta = await loadMeta(id);
    if (!meta) throw new Error("Thread not found");
    await rm(paths.threadDir(id), { recursive: true, force: true });
    metaCache.delete(paths.threadMeta(id));
  });
}

export async function renameThread(id: string, title: string): Promise<ThreadMeta> {
  return withThreads(async () => {
    if (!id || id.includes("/") || id.includes("..")) throw new Error("invalid thread id");
    const next = title.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!next) throw new Error("title required");
    const meta = await loadMeta(id);
    if (!meta) throw new Error("Thread not found");
    const updated: ThreadMeta = { ...meta, title: next, titleManual: true, updatedAt: nowIso() };
    await writeMeta(updated);
    return updated;
  });
}

export async function readThreadBundle(id: string): Promise<{ meta: ThreadMeta; events: TranscriptEvent[] } | null> {
  if (!id || id.includes("/") || id.includes("..")) return null;
  const meta = await loadMeta(id);
  if (!meta) return null;
  return { meta, events: await readEvents(paths.threadTranscript(id)) };
}
