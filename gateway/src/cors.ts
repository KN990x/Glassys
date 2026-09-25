import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { listenBind, listenPort } from "./listen.js";

export { listenBind, listenPort };

export const CORS_ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

/** Vite dev server port (`web/vite.config.ts`). Its proxy forwards the browser's Origin unchanged. */
export const VITE_DEV_PORT = 5173;

// `pnpm run dev` runs the gateway from TypeScript source through tsx; the installed service always runs gateway/dist.
const RUNNING_FROM_SOURCE = import.meta.url.endsWith(".ts");

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

type OriginPolicy = {
  origin: string | undefined;
  requestHost?: string;
  bind: string;
  port: number;
  publicUrl: string;
  allowedOrigins: string[];
  dev?: boolean;
};

/** The allowlist entry equal to `origin`. The value comes from config, never from the request. */
export function allowlistedOrigin(opts: OriginPolicy): string | null {
  if (!opts.origin) return null;
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
  // Only the gateway's own port on loopback: the session cookie is SameSite=Lax and ports do not
  // separate sites, so any other local port (another dev server, a local app) would ride on it.
  if (opts.dev) {
    allowed.add(`http://127.0.0.1:${VITE_DEV_PORT}`);
    allowed.add(`http://localhost:${VITE_DEV_PORT}`);
  }
  for (const entry of allowed) {
    if (entry === opts.origin) return entry;
  }
  return null;
}

/** Whether a browser request from `origin` may talk to the gateway (HTTP mutations, WebSocket). */
export function resolveAllowedOrigin(opts: OriginPolicy): string | null {
  const listed = allowlistedOrigin(opts);
  if (listed) return listed;
  // 0.0.0.0 bind with no allowlist: an Origin equal to the Host header is the PWA this gateway
  // served itself. Accepted, but same-origin, so it never needs a CORS header.
  if (
    opts.origin &&
    opts.allowedOrigins.length === 0 &&
    (opts.bind === "0.0.0.0" || opts.bind === "::") &&
    originMatchesRequestHost(opts.origin, opts.requestHost)
  ) {
    return opts.origin;
  }
  return null;
}

async function originPolicy(origin: string | undefined, requestHost?: string): Promise<OriginPolicy> {
  const cfg = await loadConfig();
  return {
    origin,
    requestHost,
    bind: listenBind(cfg),
    port: listenPort(cfg),
    publicUrl: cfg.network.publicUrl,
    allowedOrigins: cfg.network.allowedOrigins,
    dev: RUNNING_FROM_SOURCE,
  };
}

export async function allowOrigin(origin: string | undefined, requestHost?: string): Promise<string | null> {
  return resolveAllowedOrigin(await originPolicy(origin, requestHost));
}

export async function setCors(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = allowlistedOrigin(await originPolicy(req.headers.origin, req.headers.host));
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
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
