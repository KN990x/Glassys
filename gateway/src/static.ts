import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join, relative, resolve, sep } from "node:path";
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
  ".txt": "text/plain; charset=utf-8",
};

/* Inline styles stay allowed: React sets a few `style` attributes (progress, meters). Scripts never inline. */
export const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

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

/* Vite names everything under /assets/ by content hash, so a changed file is a new URL. */
function cacheControl(filePath: string, root?: string): string {
  const ext = extname(filePath);
  const name = basename(filePath);
  if (ext === ".html" || ext === ".webmanifest" || name === "sw.js") return "no-cache";
  if (root) {
    const rel = relative(root, filePath).split(sep);
    if (rel.length > 1 && rel[0] === "assets") return "public, max-age=31536000, immutable";
  }
  return "public, max-age=3600";
}

export function fileResponseHeaders(filePath: string, root?: string): Record<string, string> {
  const ext = extname(filePath);
  const type = MIME[ext] || "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Cache-Control": cacheControl(filePath, root),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  };
  if (ext === ".html") headers["Content-Security-Policy"] = HTML_CSP;
  return headers;
}

const ENCODINGS = [
  { name: "br", suffix: ".br" },
  { name: "gzip", suffix: ".gz" },
] as const;

export function acceptsEncoding(header: string | undefined, name: string): boolean {
  if (!header) return false;
  for (const part of header.split(",")) {
    const [token, ...params] = part.trim().toLowerCase().split(";");
    if (token !== name && token !== "*") continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    if (!q || Number(q.slice(2)) > 0) return true;
  }
  return false;
}

/** The build writes .br and .gz beside compressible files; pick one the client takes. */
export function pickEncoded(file: string, acceptEncoding: string | undefined): { path: string; encoding?: string } {
  for (const enc of ENCODINGS) {
    if (!acceptsEncoding(acceptEncoding, enc.name)) continue;
    const candidate = `${file}${enc.suffix}`;
    if (existsSync(candidate)) return { path: candidate, encoding: enc.name };
  }
  return { path: file };
}

export function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
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
  const headers = fileResponseHeaders(file, root);
  const encodingHeader = req.headers["accept-encoding"];
  const picked = pickEncoded(file, Array.isArray(encodingHeader) ? encodingHeader.join(",") : encodingHeader);
  headers["Vary"] = "Accept-Encoding";
  if (picked.encoding) headers["Content-Encoding"] = picked.encoding;
  headers["Content-Length"] = String(statSync(picked.path).size);
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  const stream = createReadStream(picked.path);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    if (!res.writableEnded) res.end();
  });
  stream.pipe(res);
  return true;
}
