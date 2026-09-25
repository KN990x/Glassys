import { AdapterError } from "@glassys/adapter-contract";
import { log } from "./paths.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Text for an error response. An Error's own message is operator-facing by design; anything else
 * thrown (a string, an object, a stack) stays in the server log and the response gets `fallback`.
 */
export function publicErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  log("error", fallback, { detail: String(err) });
  return fallback;
}

export function isActiveRunError(err: unknown): boolean {
  if (err instanceof AdapterError && err.retryable) return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("active run") ||
    msg.includes("already running") ||
    msg.includes("already has an active") ||
    /\bagent is busy\b/.test(msg)
  );
}
