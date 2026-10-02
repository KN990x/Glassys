import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { writeFileAtomic } from "./atomic.js";
import { createMutex } from "./lock.js";
import { paths } from "./paths.js";

/** Logged-out session ids, kept only until the token would have expired anyway. */
const MAX_REVOKED = 1000;
const withRevoked = createMutex();
let cache: { path: string; entries: Map<string, number> } | null = null;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function prune(entries: Map<string, number>): Map<string, number> {
  const now = nowSeconds();
  for (const [jti, exp] of entries) if (exp <= now) entries.delete(jti);
  while (entries.size > MAX_REVOKED) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  return entries;
}

async function load(): Promise<Map<string, number>> {
  const path = paths.revokedSessions();
  if (cache?.path === path) return cache.entries;
  let entries = new Map<string, number>();
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as { revoked?: Record<string, number> };
    entries = new Map(Object.entries(raw.revoked ?? {}).filter(([, exp]) => typeof exp === "number"));
  } catch {
    /* none yet */
  }
  cache = { path, entries: prune(entries) };
  return cache.entries;
}

export async function revokeSession(jti: string, exp: number): Promise<void> {
  if (!jti) return;
  await withRevoked(async () => {
    const entries = prune(await load());
    entries.set(jti, exp);
    await mkdir(dirname(paths.revokedSessions()), { recursive: true });
    await writeFileAtomic(paths.revokedSessions(), JSON.stringify({ revoked: Object.fromEntries(prune(entries)) }));
  });
}

export async function isSessionRevoked(jti: string | undefined): Promise<boolean> {
  if (!jti) return false;
  const entries = await withRevoked(load);
  const exp = entries.get(jti);
  return exp !== undefined && exp > nowSeconds();
}
