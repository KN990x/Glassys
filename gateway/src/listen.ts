import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { defaultConfig, type GlassysConfig } from "@glassys/protocol";

export function listenBind(cfg: Pick<GlassysConfig, "network">, env: NodeJS.ProcessEnv = process.env): string {
  return env.GLASSYS_BIND || cfg.network.bind;
}

export function parseListenPort(raw: string | number | undefined): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid listen port: ${raw === undefined || raw === "" ? "(empty)" : String(raw)}`);
  }
  return n;
}

export function listenPort(cfg: Pick<GlassysConfig, "network">, env: NodeJS.ProcessEnv = process.env): number {
  const fromEnv = env.GLASSYS_PORT?.trim();
  return parseListenPort(fromEnv ? fromEnv : cfg.network.port);
}

/**
 * Where the gateway will listen, read the way the gateway reads it (env over `config.yaml` over
 * defaults) without loading the rest of the config. The service installer probes /health with
 * this, so a bind set only in `config.yaml` is not reported as a dead gateway.
 */
export function resolveListenFromDataDir(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): { bind: string; port: number; publicUrl: string } {
  const defaults = defaultConfig().network;
  let network: Partial<GlassysConfig["network"]> = {};
  try {
    const parsed = YAML.parse(readFileSync(join(dataDir, "config.yaml"), "utf8")) as unknown;
    const raw = parsed && typeof parsed === "object" ? (parsed as { network?: unknown }).network : undefined;
    if (raw && typeof raw === "object") network = raw as Partial<GlassysConfig["network"]>;
  } catch {
    /* No config yet (first install) or unreadable: the gateway falls back to defaults too. */
  }
  const cfg = {
    network: {
      ...defaults,
      ...(typeof network.bind === "string" && network.bind.trim() ? { bind: network.bind.trim() } : {}),
      ...(network.port !== undefined ? { port: network.port } : {}),
      ...(typeof network.publicUrl === "string" ? { publicUrl: network.publicUrl.trim() } : {}),
    },
  };
  return { bind: listenBind(cfg, env), port: listenPort(cfg, env), publicUrl: cfg.network.publicUrl };
}
