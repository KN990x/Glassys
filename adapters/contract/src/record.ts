import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * With GLASSYS_RECORD_FIXTURES=<dir>, an adapter writes every raw SDK event it receives, before
 * mapping, to <dir>/<adapter>-<time>.jsonl. Mapper tests are only as good as their payloads, and
 * hand-written ones drifted from what the SDKs really send; a recorded session is the real shape.
 *
 * Off by default. A recording holds whatever the agent read and ran, so it is for a test
 * workspace, and gets reviewed before it becomes a fixture.
 */
export function fixtureRecorder(adapterId: string, env: NodeJS.ProcessEnv = process.env): ((raw: unknown) => void) | null {
  const dir = env.GLASSYS_RECORD_FIXTURES?.trim();
  if (!dir) return null;
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${adapterId}-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  return (raw) => {
    try {
      appendFileSync(file, `${JSON.stringify(raw)}\n`, { mode: 0o600 });
    } catch {
      /* recording is best-effort; the run goes on */
    }
  };
}
