import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { listenBind, listenPort } from "./listen.js";

export { listenBind, listenPort };

export function originMatchesRequestHost(origin: string, hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  try {
    const url = new URL(origin);
    const host = hostHeader.split(",")[0]?.trim().toLowerCase() ?? "";
    if (!host) return false;
    return url.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

export function resolveAllowedOrigin(opts: {
  origin: string | undefined;
  requestHost?: string;
  bind: string;
  port: number;
  publicUrl: string;
  allowedOrigins: string[];
}): string | null {
  const origin = opts.origin;
  if (!origin) return null;
  const allowed = new Set(opts.allowedOrigins.filter(Boolean));
  if (opts.publicUrl) {
    try {
      allowed.add(new URL(opts.publicUrl).origin);
    } catch {
      /* ignore */
    }
  }
  if (opts.bind !== "0.0.0.0" && opts.bind !== "::") {
    allowed.add(`http://${opts.bind}:${opts.port}`);
  }
  allowed.add(`http://127.0.0.1:${opts.port}`);
  allowed.add(`http://localhost:${opts.port}`);
  if (allowed.has(origin)) return origin;

  if (opts.allowedOrigins.length === 0) {
    if (
      (opts.bind === "0.0.0.0" || opts.bind === "::") &&
      originMatchesRequestHost(origin, opts.requestHost)
    ) {
      return origin;
    }
    try {
      const host = new URL(origin).hostname;
      if (host === "localhost" || host === "127.0.0.1") return origin;
    } catch {
      return null;
    }
  }
  return null;
}

export async function allowOrigin(origin: string | undefined, requestHost?: string): Promise<string | null> {
  const cfg = await loadConfig();
  return resolveAllowedOrigin({
    origin,
    requestHost,
    bind: listenBind(cfg),
    port: listenPort(cfg),
    publicUrl: cfg.network.publicUrl,
    allowedOrigins: cfg.network.allowedOrigins,
  });
}

export async function setCors(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = await allowOrigin(req.headers.origin, req.headers.host);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
}

export async function originAllowed(origin: string | undefined, requestHost?: string): Promise<boolean> {
  if (!origin) return true;
  return (await allowOrigin(origin, requestHost)) !== null;
}

export function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const host = addr.replace(/^::ffff:/, "").toLowerCase();
  return host === "127.0.0.1" || host === "::1" || host === "localhost" || host === "[::1]";
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** First-user setup: loopback clients, loopback Origin, or an explicit allowlist / publicUrl. */
export function setupOriginAllowed(opts: {
  origin: string | undefined;
  remoteAddress?: string;
  publicUrl: string;
  allowedOrigins: string[];
}): boolean {
  if (isLoopbackAddress(opts.remoteAddress)) return true;
  if (opts.origin) {
    try {
      if (isLoopbackHostname(new URL(opts.origin).hostname)) return true;
    } catch {
      return false;
    }
    const allowed = new Set(opts.allowedOrigins.filter(Boolean));
    if (opts.publicUrl) {
      try {
        allowed.add(new URL(opts.publicUrl).origin);
      } catch {
        /* ignore */
      }
    }
    if (allowed.has(opts.origin)) return true;
  }
  return false;
}
