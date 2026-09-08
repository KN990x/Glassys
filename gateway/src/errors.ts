import { AdapterError } from "@glassys/adapter-contract";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
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
