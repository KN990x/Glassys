import { SignJWT, jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";
import type { IncomingMessage } from "node:http";
import { loadConfig } from "./config.js";
import { loadSecrets, verifyPassword } from "./secrets.js";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  parseCookies,
  requestIsSecure,
  sessionCookie,
} from "./cookie.js";

export { clearSessionCookie, parseCookies, requestIsSecure, sessionCookie };

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(teamHost: string): ReturnType<typeof createRemoteJWKSet> {
  const url = `https://${teamHost}/cdn-cgi/access/certs`;
  let jwks = jwksCache.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksCache.set(url, jwks);
  }
  return jwks;
}

/** Prefer a valid Bearer token; fall back to the session cookie if Bearer is missing or expired. */
export async function verifyRequestSession(req: IncomingMessage): Promise<boolean> {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ") && (await verifySession(auth.slice(7)))) return true;
  return verifySession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
}

export async function signSession(): Promise<string> {
  const { jwtSecret, jwtEpoch } = await loadSecrets();
  const cfg = await loadConfig();
  const ttlHours = cfg.security.sessionTtlHours || 168;
  return new SignJWT({ sub: "operator", jwtEpoch: jwtEpoch ?? 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlHours}h`)
    .sign(new TextEncoder().encode(jwtSecret));
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { jwtSecret, jwtEpoch } = await loadSecrets();
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret));
    const epoch = typeof payload.jwtEpoch === "number" ? payload.jwtEpoch : 0;
    return payload.sub === "operator" && epoch === (jwtEpoch ?? 0);
  } catch {
    return false;
  }
}

export async function loginWithPassword(password: string): Promise<string | null> {
  const { operatorPasswordHash } = await loadSecrets();
  if (!operatorPasswordHash) return null;
  const ok = await verifyPassword(password, operatorPasswordHash);
  if (!ok) return null;
  return signSession();
}

export async function buildSessionCookie(token: string, req: IncomingMessage): Promise<string> {
  const cfg = await loadConfig();
  return sessionCookie(token, requestIsSecure(req, cfg.network.publicUrl), cfg.security.sessionTtlHours || 168);
}

export async function verifyEdge(req: IncomingMessage): Promise<{ ok: boolean; reason?: string }> {
  const cfg = await loadConfig();
  if (cfg.security.edgeAuth === "none") return { ok: true };

  if (cfg.security.edgeAuth === "header") {
    const name = cfg.security.identityHeader || "x-forwarded-user";
    const raw = req.headers[name.toLowerCase()];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value || !String(value).trim()) return { ok: false, reason: `missing identity header ${name}` };
    return { ok: true };
  }

  if (cfg.security.edgeAuth === "cloudflare-access") {
    const assertion =
      (req.headers["cf-access-jwt-assertion"] as string | undefined) ||
      parseCookies(req.headers.cookie)["CF_Authorization"];
    if (!assertion) return { ok: false, reason: "missing Cf-Access-Jwt-Assertion" };
    const team = cfg.security.cloudflare.teamDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const audience = cfg.security.cloudflare.audience;
    if (!team || !audience) return { ok: false, reason: "cloudflare teamDomain/audience not configured" };
    const teamHost = team.includes(".") ? team : `${team}.cloudflareaccess.com`;
    try {
      const jwks = jwksFor(teamHost);
      await jwtVerify(assertion, jwks, {
        audience,
        issuer: `https://${teamHost}`,
      });
      return { ok: true };
    } catch {
      return { ok: false, reason: "invalid Cloudflare Access token" };
    }
  }

  return { ok: false, reason: `unknown edgeAuth ${cfg.security.edgeAuth}` };
}

export type { JWTPayload };
