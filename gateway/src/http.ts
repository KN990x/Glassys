import { readFileSync } from "node:fs";
import { hostname, userInfo } from "node:os";
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
  adapterLoginCancel,
  cursorAuthStatus,
  cursorLogin,
  cwdErrorInPatch,
  deleteLiveThread,
  discoverAdapter,
  exportLiveThread,
  listAdapterInfo,
  listLiveThreads,
  listModels,
  renameLiveThread,
  startNewLiveThread,
  switchLiveThread,
} from "./runtime.js";
import { loadState } from "./state.js";
import { listWorkspaces } from "./workspaces.js";
import { MAX_UPLOAD_BYTES, readUploadBody, saveUpload } from "./uploads.js";
import { liveThreadId } from "./threads.js";
import { readGitContext } from "./host-git.js";

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

async function readBuffer(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new PayloadTooLargeError();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage, limit = 1_000_000): Promise<unknown> {
  const buf = await readBuffer(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString("utf8"));
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
const LOGIN_FAIL_TTL_MS = 15 * 60 * 1000;
const failedLoginsByIp = new Map<string, { count: number; at: number }>();

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

function clientIp(req: IncomingMessage): string {
  const addr = req.socket.remoteAddress || "unknown";
  return addr.replace(/^::ffff:/, "");
}

function pruneFailedLogins(now = Date.now()): void {
  for (const [ip, rec] of failedLoginsByIp) {
    if (now - rec.at > LOGIN_FAIL_TTL_MS) failedLoginsByIp.delete(ip);
  }
}

async function loginBackoff(ip: string): Promise<void> {
  pruneFailedLogins();
  const failed = failedLoginsByIp.get(ip)?.count ?? 0;
  if (failed <= 0) return;
  const ms = Math.min(2000, 150 * 2 ** Math.min(failed - 1, 4));
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
    const ip = clientIp(req);
    await loginBackoff(ip);
    const body = (await readJson(req)) as { password?: string };
    const token = await loginWithPassword(body.password || "");
    if (!token) {
      const prev = failedLoginsByIp.get(ip);
      failedLoginsByIp.set(ip, { count: (prev?.count ?? 0) + 1, at: Date.now() });
      send(res, 401, { error: "invalid password" });
      return true;
    }
    failedLoginsByIp.delete(ip);
    res.setHeader("Set-Cookie", await buildSessionCookie(token, req));
    send(res, 200, { token });
    return true;
  }

  if (method === "POST" && path === "/api/auth/logout") {
    const ok = await verifyRequestSession(req);
    if (ok) {
      const cfg = await loadConfig();
      res.setHeader("Set-Cookie", clearSessionCookie(requestIsSecure(req, cfg.network.publicUrl)));
    }
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
      const result = await adapterLogin(body.adapter || "cursor");
      send(res, 200, { ok: true, configured: true, url: result.url });
    } catch (err) {
      if (err instanceof UnknownAdapterError) {
        send(res, 400, { error: err.message });
        return true;
      }
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (method === "POST" && path === "/api/auth/adapter-login/cancel") {
    if (!(await requireAuth(req, res))) return true;
    await adapterLoginCancel();
    send(res, 200, { ok: true });
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
      const result = await cursorLogin();
      send(res, 200, { ok: true, configured: true, url: result.url });
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

  if (method === "GET" && path === "/api/threads") {
    if (!(await requireAuth(req, res))) return true;
    send(res, 200, { threads: await listLiveThreads(), currentId: liveThreadId() });
    return true;
  }

  if (method === "POST" && path === "/api/threads") {
    if (!(await requireAuth(req, res))) return true;
    try {
      await startNewLiveThread();
      send(res, 200, { threads: await listLiveThreads(), currentId: liveThreadId() });
    } catch (err) {
      if (err instanceof HttpError) {
        send(res, err.status, { error: err.message });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (method === "POST" && path.startsWith("/api/threads/") && path.endsWith("/switch")) {
    if (!(await requireAuth(req, res))) return true;
    const id = decodeURIComponent(path.slice("/api/threads/".length, -"/switch".length));
    try {
      await switchLiveThread(id);
      send(res, 200, { threads: await listLiveThreads(), currentId: liveThreadId() });
    } catch (err) {
      if (err instanceof HttpError) {
        send(res, err.status, { error: err.message });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (method === "PATCH" && path.startsWith("/api/threads/") && !path.endsWith("/switch") && !path.endsWith("/export")) {
    if (!(await requireAuth(req, res))) return true;
    const id = decodeURIComponent(path.slice("/api/threads/".length));
    const body = (await readJson(req)) as { title?: string };
    try {
      await renameLiveThread(id, typeof body.title === "string" ? body.title : "");
      send(res, 200, { threads: await listLiveThreads(), currentId: liveThreadId() });
    } catch (err) {
      if (err instanceof HttpError) {
        send(res, err.status, { error: err.message });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (method === "GET" && path.startsWith("/api/threads/") && path.endsWith("/export")) {
    if (!(await requireAuth(req, res))) return true;
    const id = decodeURIComponent(path.slice("/api/threads/".length, -"/export".length));
    try {
      const file = await exportLiveThread(id);
      res.writeHead(200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.filename}"`,
      });
      res.end(file.markdown);
    } catch (err) {
      if (err instanceof HttpError) {
        send(res, err.status, { error: err.message });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (method === "DELETE" && path.startsWith("/api/threads/")) {
    if (!(await requireAuth(req, res))) return true;
    const id = decodeURIComponent(path.slice("/api/threads/".length));
    try {
      await deleteLiveThread(id);
      send(res, 200, { threads: await listLiveThreads(), currentId: liveThreadId() });
    } catch (err) {
      if (err instanceof HttpError) {
        send(res, err.status, { error: err.message });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (method === "GET" && path === "/api/reachability") {
    if (!(await requireAuth(req, res))) return true;
    const cfg = await loadConfig();
    const bind = cfg.network.bind;
    const git = await readGitContext(cfg.agent.cwd);
    send(res, 200, {
      bind,
      port: cfg.network.port,
      publicUrl: cfg.network.publicUrl,
      loopback: bind === "127.0.0.1" || bind === "::1" || bind === "localhost",
      hostname: hostname(),
      user: userInfo().username,
      ...(git ? { git } : {}),
    });
    return true;
  }

  if (method === "GET" && path === "/api/workspaces") {
    if (!(await requireAuth(req, res))) return true;
    const state = await loadState();
    const root = url.searchParams.get("root");
    try {
      send(res, 200, {
        recents: state.recentCwds || [],
        workspaces: root ? await listWorkspaces(root) : [],
      });
    } catch (err) {
      if (err instanceof HttpError) {
        send(res, err.status, { error: err.message });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (method === "POST" && path === "/api/uploads") {
    if (!(await requireAuth(req, res))) return true;
    const mime = String(req.headers["content-type"] || "").split(";")[0]?.trim() || "";
    const name =
      (typeof url.searchParams.get("name") === "string" && url.searchParams.get("name")) || "image";
    try {
      const body = await readBuffer(req, MAX_UPLOAD_BYTES + 1);
      send(res, 200, await saveUpload(body, mime, name));
    } catch (err) {
      if (err instanceof HttpError) {
        send(res, err.status, { error: err.message });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (method === "GET" && path.startsWith("/api/uploads/")) {
    if (!(await requireAuth(req, res))) return true;
    const id = decodeURIComponent(path.slice("/api/uploads/".length));
    const file = await readUploadBody(id);
    if (!file) {
      send(res, 404, { error: "not found" });
      return true;
    }
    res.writeHead(200, {
      "Content-Type": file.mime,
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${file.name}"`,
    });
    res.end(file.body);
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
