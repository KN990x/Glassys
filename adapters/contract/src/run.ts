import type { AdapterRun } from "./types.js";

export function pendingRun(
  id: string,
  work: (ctl: { signal: AbortSignal; isCancelled: () => boolean }) => Promise<"finished" | "error" | "cancelled">,
): AdapterRun {
  const ac = new AbortController();
  let cancelled = false;
  const wait = work({
    signal: ac.signal,
    isCancelled: () => cancelled || ac.signal.aborted,
  }).catch((err): "finished" | "error" | "cancelled" => {
    if (cancelled || ac.signal.aborted) return "cancelled";
    if (err instanceof Error && err.name === "AbortError") return "cancelled";
    throw err;
  });
  return {
    id,
    cancel: async () => {
      cancelled = true;
      ac.abort();
    },
    wait: () => wait,
  };
}
