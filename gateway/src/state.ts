import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { PROFILE_ID } from "@glassys/protocol";
import { paths } from "./paths.js";
import { createMutex } from "./lock.js";

export interface PersistedState {
  profileId: string;
  agentId: string | null;
}

const withStateLock = createMutex();

const empty = (): PersistedState => ({ profileId: PROFILE_ID, agentId: null });

export async function loadState(): Promise<PersistedState> {
  try {
    const raw = await readFile(paths.state(), "utf8");
    return { ...empty(), ...(JSON.parse(raw) as Partial<PersistedState>) };
  } catch {
    return empty();
  }
}

export async function saveState(state: PersistedState): Promise<void> {
  return withStateLock(async () => {
    await mkdir(paths.data(), { recursive: true });
    const tmp = `${paths.state()}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await rename(tmp, paths.state());
  });
}
