import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { PROFILE_ID } from "@glassys/protocol";
import { paths } from "./paths.js";
import { createMutex } from "./lock.js";

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  byAdapter: Record<string, { inputTokens: number; outputTokens: number }>;
  updatedAt: string;
}

export interface PersistedState {
  profileId: string;
  agentId: string | null;
  threadId: string | null;
  recentCwds: string[];
  pinnedCwds: string[];
  usage: UsageTotals;
}

const withStateLock = createMutex();

const emptyUsage = (): UsageTotals => ({
  inputTokens: 0,
  outputTokens: 0,
  byAdapter: {},
  updatedAt: new Date(0).toISOString(),
});

const empty = (): PersistedState => ({
  profileId: PROFILE_ID,
  agentId: null,
  threadId: null,
  recentCwds: [],
  pinnedCwds: [],
  usage: emptyUsage(),
});

async function readUnlocked(): Promise<PersistedState> {
  try {
    const raw = await readFile(paths.state(), "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      ...empty(),
      ...parsed,
      recentCwds: Array.isArray(parsed.recentCwds) ? parsed.recentCwds.filter((p) => typeof p === "string") : [],
      pinnedCwds: Array.isArray(parsed.pinnedCwds) ? parsed.pinnedCwds.filter((p) => typeof p === "string") : [],
      usage: { ...emptyUsage(), ...(parsed.usage && typeof parsed.usage === "object" ? parsed.usage : {}) },
    };
  } catch {
    return empty();
  }
}

export async function loadState(): Promise<PersistedState> {
  return withStateLock(() => readUnlocked());
}

export async function saveState(patch: Partial<PersistedState>): Promise<void> {
  return withStateLock(async () => {
    const next = { ...empty(), ...(await readUnlocked()), ...patch };
    await mkdir(paths.data(), { recursive: true });
    const tmp = `${paths.state()}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await rename(tmp, paths.state());
  });
}

export async function addUsageTotals(
  adapter: string,
  inputTokens?: number,
  outputTokens?: number,
): Promise<UsageTotals> {
  return withStateLock(async () => {
    const cur = await readUnlocked();
    const input = typeof inputTokens === "number" ? inputTokens : 0;
    const output = typeof outputTokens === "number" ? outputTokens : 0;
    const prevAdapter = cur.usage.byAdapter[adapter] ?? { inputTokens: 0, outputTokens: 0 };
    const usage: UsageTotals = {
      inputTokens: cur.usage.inputTokens + input,
      outputTokens: cur.usage.outputTokens + output,
      byAdapter: {
        ...cur.usage.byAdapter,
        [adapter]: {
          inputTokens: prevAdapter.inputTokens + input,
          outputTokens: prevAdapter.outputTokens + output,
        },
      },
      updatedAt: new Date().toISOString(),
    };
    const next = { ...cur, usage };
    await mkdir(paths.data(), { recursive: true });
    const tmp = `${paths.state()}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await rename(tmp, paths.state());
    return usage;
  });
}
