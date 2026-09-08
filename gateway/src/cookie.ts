import type { IncomingMessage } from "node:http";

export const SESSION_COOKIE = "glassys_session";

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      out[part.slice(0, idx).trim()] = decodeURIComponent(raw);
    } catch {
      out[part.slice(0, idx).trim()] = raw;
    }
  }
  return out;
}

export function sessionCookie(token: string, secure: boolean, ttlHours = 168): string {
  const maxAge = Math.max(60, Math.floor(ttlHours * 3600));
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(secure = false): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function forwardedProto(req: IncomingMessage): string {
  const raw = req.headers["x-forwarded-proto"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return String(value || "")
    .split(",")[0]
    ?.trim()
    .toLowerCase() ?? "";
}

export function requestIsSecure(req: IncomingMessage, publicUrl?: string): boolean {
  if (forwardedProto(req) === "https") return true;
  if (publicUrl) {
    try {
      if (new URL(publicUrl).protocol === "https:") return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}
