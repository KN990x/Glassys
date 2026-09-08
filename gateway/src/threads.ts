import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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

async function writeMeta(meta: ThreadMeta): Promise<void> {
  await mkdir(paths.threadDir(meta.id), { recursive: true });
  const tmp = `${paths.threadMeta(meta.id)}.tmp`;
  await writeFile(tmp, JSON.stringify(meta, null, 2), "utf8");
  await rename(tmp, paths.threadMeta(meta.id));
}

async function loadMeta(id: string): Promise<ThreadMeta | null> {
  return readJson<ThreadMeta>(paths.threadMeta(id));
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
  await writeFile(paths.threadTranscript(id), "", "utf8");
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
      await writeFile(paths.threadTranscript(id), "", "utf8");
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

export async function openEmptyThread(): Promise<ThreadMeta> {
  return withThreads(async () => {
    const cfg = await loadConfig();
    return createEmptyThread(cfg.agent, null);
  });
}

export async function startNewThread(agentId: string | null): Promise<ThreadMeta> {
  return withThreads(async () => {
    await ensureLiveThreadUnlocked();
    await archiveLiveThreadUnlocked(agentId);
    const cfg = await loadConfig();
    return createEmptyThread(cfg.agent, null);
  });
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
