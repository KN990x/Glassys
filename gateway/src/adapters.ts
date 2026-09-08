import { cursorAdapter } from "@glassys/adapter-cursor";
import { claudeAdapter } from "@glassys/adapter-claude";
import { opencodeAdapter } from "@glassys/adapter-opencode";
import { geminiAdapter } from "@glassys/adapter-gemini";
import { codexAdapter } from "@glassys/adapter-codex";
import { acpAdapter } from "@glassys/adapter-acp";
import { errorMessage, type Adapter } from "@glassys/adapter-contract";
import type { AdapterAvailability } from "@glassys/protocol";

const adapters: Adapter[] = [cursorAdapter, claudeAdapter, opencodeAdapter, geminiAdapter, codexAdapter, acpAdapter];
const byId = new Map(adapters.map((a) => [a.id, a]));

export class UnknownAdapterError extends Error {
  constructor(id: string) {
    super(`Unknown adapter: ${id}`);
    this.name = "UnknownAdapterError";
  }
}

export function listAdapters(): Adapter[] {
  return adapters;
}

export function getAdapter(id: string): Adapter {
  const adapter = byId.get(id);
  if (!adapter) throw new UnknownAdapterError(id);
  return adapter;
}

export function tryGetAdapter(id: string): Adapter | undefined {
  return byId.get(id);
}

export async function probeAdapter(
  adapter: Adapter,
  options?: Record<string, unknown>,
): Promise<AdapterAvailability> {
  if (!adapter.probe) return { ok: true };
  try {
    await adapter.probe(options);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
