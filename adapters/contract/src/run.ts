import type { AdapterRun } from "./types.js";

export function pendingRun(
  id: string,
  work: (ctl: { signal: AbortSignal; isCancelled: () => boolean }) => Promise<"finished" | "error" | "cancelled">,
): AdapterRun {
  const ac = new AbortController();
  let cancelled = false;
  let settled = false;
  const wait = work({
    signal: ac.signal,
    isCancelled: () => cancelled || ac.signal.aborted,
  })
    .catch((err): "finished" | "error" | "cancelled" => {
      if (cancelled || ac.signal.aborted) return "cancelled";
      if (err instanceof Error && err.name === "AbortError") return "cancelled";
      throw err;
    })
    .finally(() => {
      settled = true;
    });
  /* The caller may attach to wait() only after its own awaits; an early failure is not unhandled. */
  wait.catch(() => undefined);
  return {
    id,
    /*
     * A cancel that arrives once the run is over (the runtime still holds it while it writes the
     * end of the run) must not reach the adapter: its abort handler would interrupt, or after a
     * grace period close, the session the next run is using.
     */
    cancel: async () => {
      if (settled) return;
      cancelled = true;
      ac.abort();
    },
    wait: () => wait,
  };
}
