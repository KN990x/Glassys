import { mkdir } from "node:fs/promises";
import { readJsonFile } from "./json-file.js";
import { writeFileAtomic } from "./atomic.js";
import { dirname } from "node:path";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { log, paths } from "./paths.js";
import { createMutex } from "./lock.js";
import { listAdapters } from "./adapters.js";

const withSecretsLock = createMutex();

const scrypt = promisify(scryptCb);

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface SecretsFile {
  jwtSecret: string;
  operatorPasswordHash: string;
  jwtEpoch: number;
  adapters: Record<string, { apiKey: string }>;
  vapid?: VapidKeys;
}

/** Each adapter's key variables, as it declares them in capabilities.auth.envNames. */
function envByAdapter(): Array<[string, readonly string[]]> {
  return listAdapters().map((a) => [a.id, a.capabilities.auth?.envNames ?? []]);
}

const empty = (): SecretsFile => ({ jwtSecret: "", operatorPasswordHash: "", jwtEpoch: 0, adapters: {} });

let cache: { path: string; file: SecretsFile } | null = null;

/** A missing file is a fresh install; an unreadable one throws, so nothing regenerates over it. */
async function readDisk(): Promise<SecretsFile> {
  const parsed = await readJsonFile<Partial<SecretsFile> & { cursorApiKey?: string }>(paths.secrets());
  if (parsed === undefined) return empty();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${paths.secrets()} does not hold a JSON object; fix or remove it`);
  }
  const adapters = { ...(parsed.adapters ?? {}) };
  if (parsed.cursorApiKey && !adapters.cursor?.apiKey) adapters.cursor = { apiKey: parsed.cursorApiKey };
  const jwtEpoch = typeof parsed.jwtEpoch === "number" && Number.isInteger(parsed.jwtEpoch) ? parsed.jwtEpoch : 0;
  return { ...empty(), ...parsed, jwtEpoch, adapters, vapid: parsed.vapid };
}

/** Env vars that would let whoever reads them forge an operator session. */
const SEALED_ENV = ["GLASSYS_JWT_SECRET", "GLASSYS_OPERATOR_PASSWORD_HASH"] as const;
type SealedName = (typeof SEALED_ENV)[number];
const sealed = new Map<SealedName, string>();

/**
 * Move the session secrets out of process.env, once, at startup. Every agent the gateway starts
 * (an ACP child, a terminal, the Claude or OpenCode process, a Codex binary) inherits
 * process.env, and several SDKs take no env option, so this is the one place they can be kept
 * from an agent that runs `env`. Provider keys stay: the agents need them.
 */
export function sealSecretEnv(): void {
  for (const name of SEALED_ENV) {
    const value = process.env[name];
    if (value === undefined) continue;
    sealed.set(name, value);
    delete process.env[name];
  }
}

export function secretEnv(name: SealedName): string | undefined {
  return process.env[name] ?? sealed.get(name);
}

export const MIN_JWT_SECRET_BYTES = 32;
let warnedShortJwtSecret = false;

/** GLASSYS_JWT_SECRET when it is long enough to sign sessions with; a short one is ignored, loudly. */
export function envJwtSecret(): string {
  const value = secretEnv("GLASSYS_JWT_SECRET") || "";
  if (!value) return "";
  if (Buffer.byteLength(value, "utf8") >= MIN_JWT_SECRET_BYTES) return value;
  if (!warnedShortJwtSecret) {
    warnedShortJwtSecret = true;
    log("error", `GLASSYS_JWT_SECRET is shorter than ${MIN_JWT_SECRET_BYTES} bytes; ignoring it and using the secret in secrets.json`);
  }
  return "";
}

function applyEnv(file: SecretsFile): SecretsFile {
  const adapters = { ...file.adapters };
  for (const [id, names] of envByAdapter()) {
    for (const name of names) {
      const v = (process.env[name] || "").trim();
      if (v) {
        adapters[id] = { apiKey: v };
        break;
      }
    }
  }
  return {
    jwtSecret: envJwtSecret() || file.jwtSecret,
    operatorPasswordHash: secretEnv("GLASSYS_OPERATOR_PASSWORD_HASH") || file.operatorPasswordHash,
    jwtEpoch: file.jwtEpoch ?? 0,
    adapters,
    vapid: file.vapid,
  };
}

/** Empty credential env vars must not exist — CLIs would skip their login stores. */
export function clearBlankCredentialEnv(): void {
  const names = envByAdapter().flatMap(([, n]) => n);
  for (const name of names) {
    if (process.env[name] !== undefined && process.env[name]!.trim() === "") delete process.env[name];
  }
}

async function writeSecrets(next: SecretsFile): Promise<void> {
  await mkdir(dirname(paths.secrets()), { recursive: true });
  const disk: SecretsFile = {
    jwtSecret: next.jwtSecret,
    operatorPasswordHash: next.operatorPasswordHash,
    jwtEpoch: next.jwtEpoch ?? 0,
    adapters: next.adapters,
    ...(next.vapid ? { vapid: next.vapid } : {}),
  };
  await writeFileAtomic(paths.secrets(), JSON.stringify(disk, null, 2), { mode: 0o600 });
  cache = { path: paths.secrets(), file: next };
}

export async function loadSecrets(): Promise<SecretsFile> {
  const p = paths.secrets();
  if (cache?.path === p) return applyEnv(cache.file);
  return withSecretsLock(async () => {
    if (cache?.path === p) return applyEnv(cache.file);
    const file = await readDisk();
    if (!file.jwtSecret && !envJwtSecret()) {
      file.jwtSecret = randomBytes(32).toString("hex");
      await writeSecrets(file);
    } else {
      cache = { path: p, file };
    }
    return applyEnv(file);
  });
}

export async function patchSecrets(patch: {
  jwtSecret?: string;
  operatorPasswordHash?: string;
  jwtEpoch?: number;
  adapterApiKey?: { adapter: string; value: string };
  vapid?: VapidKeys;
}): Promise<SecretsFile> {
  return withSecretsLock(async () => {
    const disk = await readDisk();
    const next: SecretsFile = {
      jwtSecret: patch.jwtSecret ?? disk.jwtSecret,
      operatorPasswordHash: patch.operatorPasswordHash ?? disk.operatorPasswordHash,
      jwtEpoch: patch.jwtEpoch ?? disk.jwtEpoch ?? 0,
      adapters: { ...disk.adapters },
      vapid: patch.vapid ?? disk.vapid,
    };
    if (patch.adapterApiKey) {
      const { adapter, value } = patch.adapterApiKey;
      if (!value) delete next.adapters[adapter];
      else next.adapters[adapter] = { apiKey: value };
    }
    if (!next.jwtSecret) next.jwtSecret = randomBytes(32).toString("hex");
    await writeSecrets(next);
    return applyEnv(next);
  });
}

export function adapterApiKey(s: SecretsFile, adapterId: string): string {
  return (s.adapters[adapterId]?.apiKey || "").trim();
}

export function adapterKeyFromEnv(adapterId: string): boolean {
  return (envByAdapter().find(([id]) => id === adapterId)?.[1] ?? []).some((name) => Boolean((process.env[name] || "").trim()));
}

export const MIN_OPERATOR_PASSWORD = 8;
export const MAX_OPERATOR_PASSWORD = 256;

export function operatorPasswordError(password: string): string | null {
  if (password.length < MIN_OPERATOR_PASSWORD) return "password must be at least 8 characters";
  if (password.length > MAX_OPERATOR_PASSWORD) {
    return `password must be at most ${MAX_OPERATOR_PASSWORD} characters`;
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, 32)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = hash.split(":");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(keyHex, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function secretsFlags(s: SecretsFile): {
  operatorPassword: boolean;
  adapters: Record<string, { apiKey: boolean }>;
  cursorApiKey: boolean;
  vapidConfigured: boolean;
} {
  const adapters: Record<string, { apiKey: boolean }> = {};
  for (const [id, rec] of Object.entries(s.adapters)) {
    adapters[id] = { apiKey: rec.apiKey.trim().length > 0 };
  }
  return {
    operatorPassword: s.operatorPasswordHash.trim().length > 0,
    adapters,
    cursorApiKey: Boolean(s.adapters.cursor?.apiKey?.trim()),
    vapidConfigured: Boolean(s.vapid?.publicKey && s.vapid?.privateKey),
  };
}
