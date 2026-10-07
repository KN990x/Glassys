import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { writeFileAtomic } from "./atomic.js";
import { isLoopbackAddress, isLoopbackOrigin } from "./cors.js";
import { paths } from "./paths.js";

/*
 * First-run setup claims the instance: whoever sets the operator password owns it. A request from
 * the host itself may do that; anything else must show the one-time code the gateway printed when
 * it started. Behind a reverse proxy on the same host every visitor arrives from 127.0.0.1, so
 * "loopback" alone would hand an unclaimed instance to the first person who finds its URL.
 */

/** No 0/O, 1/I/L: the code is read off a terminal and typed on a phone. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function newCode(): string {
  const bytes = randomBytes(10);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

function normalize(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** The current setup code, created (and kept across restarts) until setup completes. */
export async function ensureSetupCode(): Promise<string> {
  try {
    const existing = (await readFile(paths.setupCode(), "utf8")).trim();
    if (existing) return existing;
  } catch {
    /* none yet */
  }
  const code = newCode();
  await writeFileAtomic(paths.setupCode(), `${code}\n`);
  return code;
}

export async function clearSetupCode(): Promise<void> {
  await rm(paths.setupCode(), { force: true });
}

export async function setupCodeMatches(given: unknown): Promise<boolean> {
  if (typeof given !== "string" || !given) return false;
  let stored: string;
  try {
    stored = (await readFile(paths.setupCode(), "utf8")).trim();
  } catch {
    return false;
  }
  const a = Buffer.from(normalize(given));
  const b = Buffer.from(normalize(stored));
  return a.length === b.length && b.length > 0 && timingSafeEqual(a, b);
}

/** Headers a reverse proxy adds; their presence means the client is not on this host. */
const FORWARDING_HEADERS = ["x-forwarded-for", "forwarded", "x-real-ip", "cf-connecting-ip", "true-client-ip"];

/**
 * A browser on the gateway's own host, talking to it directly: loopback socket, no proxy in
 * between, and (when the browser sends one) a loopback Origin, so a web page elsewhere cannot
 * drive the operator's browser into claiming the instance.
 */
export function isDirectLocalRequest(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  if (FORWARDING_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  return origin === undefined || isLoopbackOrigin(origin);
}
