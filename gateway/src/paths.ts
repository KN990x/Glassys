import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function defaultDataDir(): string {
  return process.env.GLASSYS_DATA_DIR || join(process.cwd(), "data");
}

export const paths = {
  data: () => defaultDataDir(),
  config: () => join(defaultDataDir(), "config.yaml"),
  secrets: () => join(defaultDataDir(), "secrets.json"),
  state: () => join(defaultDataDir(), "state.json"),
  transcript: () => join(defaultDataDir(), "transcript.jsonl"),
  adapterStore: (id: string) =>
    id === "cursor" ? join(defaultDataDir(), "cursor-store") : join(defaultDataDir(), `${id}-store`),
};

export function webDir(): string {
  if (process.env.GLASSYS_WEB_DIR) return process.env.GLASSYS_WEB_DIR;
  const fromMeta = join(fileURLToPath(new URL(".", import.meta.url)), "../../web/dist");
  const fromCwd = join(process.cwd(), "web/dist");
  if (existsSync(fromCwd)) return fromCwd;
  if (existsSync(fromMeta)) return fromMeta;
  return fromCwd;
}

export function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>): void {
  const line = { ts: new Date().toISOString(), level, msg, ...redactLogExtra(extra) };
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  fn(JSON.stringify(line));
}

const SECRETISH =
  /(?:sk-[A-Za-z0-9_-]{8,}|cursor_[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/g;

function redactString(value: string): string {
  return value.replace(SECRETISH, "[redacted]");
}

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  return k.includes("key") || k.includes("secret") || k.includes("password") || k.includes("token");
}

export function redactLogExtra(extra?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!extra) return extra;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (isSecretKey(k)) {
      out[k] = typeof v === "string" && v.length > 0 ? "[redacted]" : v;
    } else if (typeof v === "string") {
      out[k] = redactString(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
