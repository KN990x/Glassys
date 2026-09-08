import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { PROFILE_ID } from "@glassys/protocol";
import { paths } from "./paths.js";
import { createMutex } from "./lock.js";

export interface PersistedState {
  profileId: string;
  agentId: string | null;
  threadId: string | null;
  recentCwds: string[];
}

const withStateLock = createMutex();

const empty = (): PersistedState => ({
  profileId: PROFILE_ID,
  agentId: null,
  threadId: null,
  recentCwds: [],
});

async function readUnlocked(): Promise<PersistedState> {
  try {
    const raw = await readFile(paths.state(), "utf8");
    return { ...empty(), ...(JSON.parse(raw) as Partial<PersistedState>) };
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
