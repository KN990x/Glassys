import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { PROTOCOL_VERSION, type ConfigPatch } from "@glassys/protocol";
import { loadConfig, redacted } from "./config.js";
import {
  buildSessionCookie,
  clearSessionCookie,
  loginWithPassword,
  signSession,
  verifyEdge,
  verifyRequestSession,
  requestIsSecure,
} from "./auth.js";
import { hashPassword, loadSecrets, operatorPasswordError, patchSecrets, secretsFlags } from "./secrets.js";
import { setCors, setupOriginAllowed } from "./cors.js";
import { UnknownAdapterError } from "./adapters.js";
import { requestRestart } from "./restart.js";
import { HttpError } from "./errors.js";
import {
  applyConfigPatch,
  adapterAuthStatus,
  adapterLogin,
  cursorAuthStatus,
  cursorLogin,
  cwdErrorInPatch,
  discoverAdapter,
  listAdapterInfo,
  listModels,
} from "./runtime.js";

const GATEWAY_VERSION = (() => {
  try {
    const pkg = join(dirname(fileURLToPath(import.meta.url)), "../package.json");
    const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { version?: string };
    return parsed.version || "0.1.0";
  } catch {
    return "0.1.0";
  }
})();

class PayloadTooLargeError extends HttpError {
  constructor() {
    super(413, "payload too large");
  }
}

async function readJson(req: IncomingMessage, limit = 1_000_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new PayloadTooLargeError();
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid json");
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(raw);
}

async function requireEdge(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const edge = await verifyEdge(req);
  if (!edge.ok) {
    send(res, 401, { error: edge.reason || "edge auth failed" });
    return false;
  }
  return true;
}

async function requireAuth(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (!(await requireEdge(req, res))) return false;
  const ok = await verifyRequestSession(req);
  if (!ok) {
    send(res, 401, { error: "unauthorized" });
    return false;
  }
  return true;
}

let setupLock: Promise<void> = Promise.resolve();
let failedLogins = 0;

async function withSetupLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void = () => undefined;
  const prev = setupLock;
  setupLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function loginBackoff(): Promise<void> {
  if (failedLogins <= 0) return;
  const ms = Math.min(2000, 150 * 2 ** Math.min(failedLogins - 1, 4));
  await new Promise((r) => setTimeout(r, ms));
}

async function handleHttpInner(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  await setCors(req, res);
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;
  const method = req.method || "GET";

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (method === "GET" && path === "/health") {
    send(res, 200, { ok: true, name: "glassys", version: GATEWAY_VERSION, protocolVersion: PROTOCOL_VERSION });
    return true;
  }

  if (method === "GET" && path === "/api/auth/status") {
    const flags = secretsFlags(await loadSecrets());
    const cfg = await loadConfig();
    send(res, 200, {
      setupComplete: flags.operatorPassword,
      onboarded: cfg.onboarding.completed,
    });
    return true;
  }

  if (method === "POST" && path === "/api/auth/setup") {
    if (!(await requireEdge(req, res))) return true;
    const cfg = await loadConfig();
    if (
      !setupOriginAllowed({
        origin: typeof req.headers.origin === "string" ? req.headers.origin : undefined,
        remoteAddress: req.socket.remoteAddress,
        publicUrl: cfg.network.publicUrl,
        allowedOrigins: cfg.network.allowedOrigins,
      })
    ) {
      send(res, 403, { error: "setup is only allowed from localhost or an allowed origin" });
      return true;
    }
    return withSetupLock(async () => {
      const flags = secretsFlags(await loadSecrets());
      if (flags.operatorPassword) {
        send(res, 409, { error: "operator already configured" });
        return true;
      }
      const body = (await readJson(req)) as { password?: string };
      const password = body.password || "";
      const passwordErr = operatorPasswordError(password);
      if (passwordErr) {
        send(res, 400, { error: passwordErr });
        return true;
      }
      const again = secretsFlags(await loadSecrets());
      if (again.operatorPassword) {
        send(res, 409, { error: "operator already configured" });
        return true;
      }
      await patchSecrets({ operatorPasswordHash: await hashPassword(password) });
      const token = await signSession();
      res.setHeader("Set-Cookie", await buildSessionCookie(token, req));
      send(res, 200, { token, setupComplete: true });
      return true;
    });
  }

  if (method === "POST" && path === "/api/auth/login") {
    if (!(await requireEdge(req, res))) return true;
    await loginBackoff();
    const body = (await readJson(req)) as { password?: string };
    const token = await loginWithPassword(body.password || "");
    if (!token) {
      failedLogins += 1;
      send(res, 401, { error: "invalid password" });
      return true;
    }
    failedLogins = 0;
    res.setHeader("Set-Cookie", await buildSessionCookie(token, req));
    send(res, 200, { token });
    return true;
  }

  if (method === "POST" && path === "/api/auth/logout") {
    const cfg = await loadConfig();
    res.setHeader("Set-Cookie", clearSessionCookie(requestIsSecure(req, cfg.network.publicUrl)));
    send(res, 200, { ok: true });
    return true;
  }

  if (method === "GET" && path === "/api/auth/me") {
    if (!(await requireAuth(req, res))) return true;
    const cfg = await loadConfig();
    const flags = secretsFlags(await loadSecrets());
    send(res, 200, {
      sub: "operator",
      onboarded: cfg.onboarding.completed,
      setupComplete: flags.operatorPassword,
    });
    return true;
  }

  if (method === "GET" && path === "/api/config") {
    if (!(await requireAuth(req, res))) return true;
    send(res, 200, await redacted());
    return true;
  }

  if (method === "PUT" && path === "/api/config") {
    if (!(await requireAuth(req, res))) return true;
    const patch = (await readJson(req)) as ConfigPatch;
    const cwdError = await cwdErrorInPatch(patch);
    if (cwdError) {
      send(res, 400, { error: cwdError });
      return true;
    }
    try {
      const { restart } = await applyConfigPatch(patch);
      send(res, 200, await redacted(undefined, restart));
    } catch (err) {
      if (err instanceof HttpError) {
        send(res, err.status, { error: err.message });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (method === "GET" && path === "/api/models") {
    if (!(await requireAuth(req, res))) return true;
    const adapter = url.searchParams.get("adapter") || undefined;
    try {
      send(res, 200, await listModels(adapter));
    } catch (err) {
      if (err instanceof UnknownAdapterError) {
        send(res, 400, { error: err.message });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (method === "GET" && path === "/api/adapters") {
    if (!(await requireAuth(req, res))) return true;
    send(res, 200, { adapters: await listAdapterInfo() });
    return true;
  }

  if (method === "GET" && path.startsWith("/api/adapters/") && path.endsWith("/discover")) {
    if (!(await requireAuth(req, res))) return true;
    const id = path.slice("/api/adapters/".length, -"/discover".length);
    try {
      send(res, 200, { agents: await discoverAdapter(id) });
    } catch (err) {
      if (err instanceof UnknownAdapterError) {
        send(res, 400, { error: err.message });
        return true;
      }
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (method === "GET" && path === "/api/auth/adapter-status") {
    if (!(await requireAuth(req, res))) return true;
    const adapter = url.searchParams.get("adapter") || "cursor";
    try {
      send(res, 200, await adapterAuthStatus(adapter));
    } catch (err) {
      send(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (method === "POST" && path === "/api/auth/adapter-login") {
    if (!(await requireAuth(req, res))) return true;
    const body = (await readJson(req)) as { adapter?: string };
    try {
      await adapterLogin(body.adapter || "cursor");
      send(res, 200, { ok: true, configured: true });
    } catch (err) {
      if (err instanceof UnknownAdapterError) {
        send(res, 400, { error: err.message });
        return true;
      }
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (method === "GET" && path === "/api/auth/cursor-status") {
    // Alias of GET /api/auth/adapter-status?adapter=cursor
    if (!(await requireAuth(req, res))) return true;
    send(res, 200, await cursorAuthStatus());
    return true;
  }

  if (method === "POST" && path === "/api/auth/cursor-login") {
    // Alias of POST /api/auth/adapter-login { adapter: "cursor" }
    if (!(await requireAuth(req, res))) return true;
    try {
      await cursorLogin();
      send(res, 200, { ok: true, configured: true });
    } catch (err) {
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (method === "POST" && path === "/api/admin/restart") {
    if (!(await requireAuth(req, res))) return true;
    send(res, 202, { ok: true, restarting: true });
    setTimeout(() => void requestRestart(), 50);
    return true;
  }

  return false;
}

export async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  try {
    return await handleHttpInner(req, res);
  } catch (err) {
    if (err instanceof HttpError) {
      if (!res.headersSent) send(res, err.status, { error: err.message });
      else if (!res.writableEnded) res.end();
      return true;
    }
    throw err;
  }
}
