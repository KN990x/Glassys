import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { paths } from "./paths.js";
import { createMutex } from "./lock.js";

const withSecretsLock = createMutex();

const scrypt = promisify(scryptCb);

export interface SecretsFile {
  jwtSecret: string;
  operatorPasswordHash: string;
  jwtEpoch: number;
  adapters: Record<string, { apiKey: string }>;
}

const ENV_BY_ADAPTER: Record<string, string[]> = {
  cursor: ["CURSOR_API_KEY"],
  claude: ["ANTHROPIC_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  codex: ["CODEX_API_KEY", "OPENAI_API_KEY"],
  opencode: ["OPENCODE_API_KEY"],
};

const empty = (): SecretsFile => ({ jwtSecret: "", operatorPasswordHash: "", jwtEpoch: 0, adapters: {} });

let cache: { path: string; file: SecretsFile } | null = null;

async function readDisk(): Promise<SecretsFile> {
  try {
    const raw = await readFile(paths.secrets(), "utf8");
    const parsed = JSON.parse(raw) as Partial<SecretsFile> & { cursorApiKey?: string };
    const adapters = { ...(parsed.adapters ?? {}) };
    if (parsed.cursorApiKey && !adapters.cursor?.apiKey) adapters.cursor = { apiKey: parsed.cursorApiKey };
    const jwtEpoch = typeof parsed.jwtEpoch === "number" && Number.isInteger(parsed.jwtEpoch) ? parsed.jwtEpoch : 0;
    return { ...empty(), ...parsed, jwtEpoch, adapters };
  } catch {
    return empty();
  }
}

function applyEnv(file: SecretsFile): SecretsFile {
  const adapters = { ...file.adapters };
  for (const [id, names] of Object.entries(ENV_BY_ADAPTER)) {
    for (const name of names) {
      const v = (process.env[name] || "").trim();
      if (v) {
        adapters[id] = { apiKey: v };
        break;
      }
    }
  }
  return {
    jwtSecret: process.env.GLASSYS_JWT_SECRET || file.jwtSecret,
    operatorPasswordHash: process.env.GLASSYS_OPERATOR_PASSWORD_HASH || file.operatorPasswordHash,
    jwtEpoch: file.jwtEpoch ?? 0,
    adapters,
  };
}

/** Empty credential env vars must not exist — CLIs would skip their login stores. */
export function clearBlankCredentialEnv(): void {
  const names = Object.values(ENV_BY_ADAPTER).flat();
  for (const name of names) {
    if (process.env[name] !== undefined && process.env[name]!.trim() === "") delete process.env[name];
  }
}

async function writeSecrets(next: SecretsFile): Promise<void> {
  await mkdir(dirname(paths.secrets()), { recursive: true });
  const tmp = `${paths.secrets()}.tmp`;
  const disk: SecretsFile = {
    jwtSecret: next.jwtSecret,
    operatorPasswordHash: next.operatorPasswordHash,
    jwtEpoch: next.jwtEpoch ?? 0,
    adapters: next.adapters,
  };
  await writeFile(tmp, JSON.stringify(disk, null, 2), { mode: 0o600 });
  await rename(tmp, paths.secrets());
  cache = { path: paths.secrets(), file: next };
}

export async function saveSecrets(next: SecretsFile): Promise<void> {
  return withSecretsLock(() => writeSecrets(next));
}

export async function loadSecrets(): Promise<SecretsFile> {
  const p = paths.secrets();
  if (cache?.path === p) return applyEnv(cache.file);
  return withSecretsLock(async () => {
    if (cache?.path === p) return applyEnv(cache.file);
    const file = await readDisk();
    if (!file.jwtSecret && !process.env.GLASSYS_JWT_SECRET) {
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
}): Promise<SecretsFile> {
  return withSecretsLock(async () => {
    const disk = await readDisk();
    const next: SecretsFile = {
      jwtSecret: patch.jwtSecret ?? disk.jwtSecret,
      operatorPasswordHash: patch.operatorPasswordHash ?? disk.operatorPasswordHash,
      jwtEpoch: patch.jwtEpoch ?? disk.jwtEpoch ?? 0,
      adapters: { ...disk.adapters },
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
  return (ENV_BY_ADAPTER[adapterId] ?? []).some((name) => Boolean((process.env[name] || "").trim()));
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
} {
  const adapters: Record<string, { apiKey: boolean }> = {};
  for (const [id, rec] of Object.entries(s.adapters)) {
    adapters[id] = { apiKey: rec.apiKey.trim().length > 0 };
  }
  return {
    operatorPassword: s.operatorPasswordHash.trim().length > 0,
    adapters,
    cursorApiKey: Boolean(s.adapters.cursor?.apiKey?.trim()),
  };
}
