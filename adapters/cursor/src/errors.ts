import { CursorAgentError } from "@cursor/sdk";
import { AdapterError } from "@glassys/adapter-contract";

export function wrapSdkError(err: unknown, phase: "startup" | "run" = "startup"): never {
  if (err instanceof AdapterError) throw err;
  if (err instanceof CursorAgentError) {
    throw new AdapterError(err.message, phase, Boolean(err.isRetryable));
  }
  const message = err instanceof Error ? err.message : String(err);
  throw new AdapterError(message, phase);
}

export function runResultErrorMessage(result: unknown): string {
  const rec = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  if (typeof rec.message === "string" && rec.message.trim()) return rec.message;
  const err = rec.error;
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    const msg = (err as { message: string }).message.trim();
    if (msg) return msg;
  }
  if (typeof rec.result === "string" && rec.result.trim()) return rec.result;
  if (typeof rec.id === "string" && rec.id) return `Run failed (${rec.id})`;
  return "Run failed";
}
