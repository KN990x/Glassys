import { log } from "./paths.js";

let handler: (() => Promise<void>) | null = null;

export function setRestartHandler(fn: () => Promise<void>): void {
  handler = fn;
}

export async function requestRestart(): Promise<void> {
  log("info", "controlled restart requested");
  if (handler) {
    await handler();
    return;
  }
  process.exit(0);
}
