import { mkdir, readFile, rename, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentConfig, ModelParam, ThreadSummary, TranscriptEvent } from "@glassys/protocol";
import { PROFILE_ID } from "@glassys/protocol";
import { paths } from "./paths.js";
import { createMutex } from "./lock.js";
import { loadState, saveState } from "./state.js";
import { loadConfig } from "./config.js";

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
    const raw = await readFile(path, "utf8");
    const events: TranscriptEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as TranscriptEvent);
      } catch {
        /* skip corrupt line */
      }
    }
    return events;
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

export async function ensureLiveThread(): Promise<string> {
  return withThreads(async () => {
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
  });
}

export async function archiveLiveThread(agentId: string | null, agent?: AgentConfig): Promise<ThreadMeta | null> {
  return withThreads(async () => {
    const id = currentThreadId ?? (await loadState()).threadId;
    if (!id) return null;
    const cfgAgent = agent ?? (await loadConfig()).agent;
    const events = await readEvents(paths.threadTranscript(id));
    const prev = (await loadMeta(id)) ?? metaFromAgent(id, cfgAgent, agentId);
    const meta: ThreadMeta = {
      ...prev,
      ...metaFromAgent(id, cfgAgent, agentId, prev.createdAt),
      title: titleFrom(cfgAgent.cwd, events) || prev.title,
      agentId,
    };
    await writeMeta(meta);
    return meta;
  });
}

export async function openEmptyThread(): Promise<ThreadMeta> {
  return withThreads(async () => {
    const cfg = await loadConfig();
    return createEmptyThread(cfg.agent, null);
  });
}

export async function startNewThread(agentId: string | null): Promise<ThreadMeta> {
  await ensureLiveThread();
  await archiveLiveThread(agentId);
  return openEmptyThread();
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

export function joinThreadPath(id: string, file: string): string {
  return join(paths.threadDir(id), file);
}
