import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import { webDir } from "./paths.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

function pathnameOf(url: string): string {
  return url.split("?")[0] || "/";
}

export function isGatewayApiPath(url: string): boolean {
  const path = pathnameOf(url);
  return path === "/ws" || path.startsWith("/ws/") || path.startsWith("/api");
}

function safeJoin(root: string, reqPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(reqPath.split("?")[0] || "/");
  } catch {
    return null;
  }
  const rel = decoded.replace(/^\/+/, "");
  const full = resolve(join(root, rel));
  const relToRoot = relative(root, full);
  if (relToRoot.startsWith("..") || relToRoot.startsWith(`..${sep}`)) return null;
  return full;
}

export function fileResponseHeaders(filePath: string): Record<string, string> {
  const ext = extname(filePath);
  const type = MIME[ext] || "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  };
  if (ext === ".html") headers["Content-Security-Policy"] = "frame-ancestors 'none'";
  return headers;
}

export function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  const path = pathnameOf(req.url || "/");
  if (isGatewayApiPath(req.url || "/")) return false;

  const root = webDir();
  if (!existsSync(root)) return false;
  const url = req.url || "/";
  const target = safeJoin(root, url) ?? join(root, "index.html");
  let file = target;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    file = join(root, "index.html");
  }
  if (!existsSync(file)) return false;
  res.writeHead(200, fileResponseHeaders(file));
  const stream = createReadStream(file);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    if (!res.writableEnded) res.end();
  });
  stream.pipe(res);
  return true;
}
