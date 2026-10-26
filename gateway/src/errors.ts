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

/**
 * The agent still has a run open, so the send is retried with `force`. Judged by the message only:
 * the SDKs' generic "retryable" flag also covers rate limits and network errors, and resending
 * those at once with `force` only repeats the failure.
 */
export function isActiveRunError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("active run") ||
    msg.includes("already running") ||
    msg.includes("already has an active") ||
    /\bagent is busy\b/.test(msg)
  );
}
