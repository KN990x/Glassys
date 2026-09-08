import type { AdapterLoginOptions } from "@glassys/adapter-contract";

export const LOGIN_URL_WAIT_MS = 20_000;

export type LoginFn = (opts?: AdapterLoginOptions) => Promise<void>;

export type LoginJobStatus = "starting" | "waiting" | "ok" | "error" | "cancelled";

type Job = {
  adapterId: string;
  status: LoginJobStatus;
  url?: string;
  error?: string;
  abort: AbortController;
  done: Promise<void>;
};

let job: Job | null = null;

function sleep(ms: number, signal?: AbortSignal): Promise<"timeout" | "aborted"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve("aborted");
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function resetLoginJob(): void {
  const current = job;
  job = null;
  current?.abort.abort();
}

export function snapshotLoginJob(adapterId: string): {
  url?: string;
  status: LoginJobStatus | "idle";
  error?: string;
} {
  if (!job || job.adapterId !== adapterId) return { status: "idle" };
  return { url: job.url, status: job.status, error: job.error };
}

export async function cancelLoginJob(): Promise<void> {
  const current = job;
  if (!current) return;
  current.abort.abort();
  await current.done;
}

export async function startLoginJob(
  adapterId: string,
  login: LoginFn,
  urlWaitMs = LOGIN_URL_WAIT_MS,
): Promise<{ url?: string }> {
  if (job && job.adapterId === adapterId && (job.status === "starting" || job.status === "waiting")) {
    if (job.url) return { url: job.url };
    const existing = job;
    const url = await Promise.race([
      existing.done.then(() => existing.url ?? ""),
      waitForUrl(existing, urlWaitMs),
    ]);
    if (typeof url === "string" && url) return { url };
    return existing.url ? { url: existing.url } : {};
  }

  if (job) {
    job.abort.abort();
    await job.done.catch(() => undefined);
    job = null;
  }

  const abort = new AbortController();
  let settleUrl: (url: string) => void = () => undefined;
  const urlPromise = new Promise<string>((resolve) => {
    settleUrl = resolve;
  });

  let resolveDone: () => void = () => undefined;
  const doneSlot = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  job = { adapterId, status: "starting", abort, done: doneSlot };

  const done = login({
    onLoginUrl: (url) => {
      if (job && job.abort === abort) {
        job.url = url;
        job.status = "waiting";
      }
      settleUrl(url);
    },
    signal: abort.signal,
  }).then(
    () => {
      if (job?.abort === abort) job.status = "ok";
    },
    (err: unknown) => {
      if (abort.signal.aborted) {
        if (job?.abort === abort) job.status = "cancelled";
        return;
      }
      if (job?.abort === abort) {
        job.status = "error";
        job.error = err instanceof Error ? err.message : String(err);
      }
      throw err;
    },
  );
  void done.finally(() => resolveDone());

  type Outcome =
    | { kind: "url"; url: string }
    | { kind: "done" }
    | { kind: "error"; err: unknown }
    | { kind: "timeout" }
    | { kind: "aborted" };

  const outcome: Outcome = await Promise.race([
    urlPromise.then((url) => ({ kind: "url" as const, url })),
    done.then(
      () => ({ kind: "done" as const }),
      (err: unknown) => ({ kind: "error" as const, err }),
    ),
    sleep(urlWaitMs, abort.signal).then((ended) =>
      ended === "aborted" ? { kind: "aborted" as const } : { kind: "timeout" as const },
    ),
  ]);

  if (outcome.kind === "url") return { url: outcome.url };
  if (outcome.kind === "done") return job.url ? { url: job.url } : {};
  if (outcome.kind === "error") {
    throw outcome.err instanceof Error ? outcome.err : new Error(String(outcome.err));
  }
  if (outcome.kind === "aborted") {
    throw new DOMException("Login cancelled", "AbortError");
  }
  abort.abort();
  throw new Error("Timed out waiting for the sign-in URL. Open the URL in this browser if it appears, or use an API key.");
}

async function waitForUrl(existing: Job, urlWaitMs: number): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < urlWaitMs) {
    if (existing.url) return existing.url;
    if (existing.status === "ok" || existing.status === "error" || existing.status === "cancelled") {
      return existing.url ?? "";
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return existing.url ?? "";
}
