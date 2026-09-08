import type { GlassysConfig } from "@glassys/protocol";

export function listenBind(cfg: Pick<GlassysConfig, "network">): string {
  return process.env.GLASSYS_BIND || cfg.network.bind;
}

export function parseListenPort(raw: string | number | undefined): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid listen port: ${raw === undefined || raw === "" ? "(empty)" : String(raw)}`);
  }
  return n;
}

export function listenPort(cfg: Pick<GlassysConfig, "network">): number {
  const env = process.env.GLASSYS_PORT?.trim();
  return parseListenPort(env ? env : cfg.network.port);
}
