import { SignJWT, jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";
import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { MAX_OPERATOR_PASSWORD, loadSecrets, verifyPassword } from "./secrets.js";
import { isSessionRevoked, revokeSession } from "./revoked.js";
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

/** The valid session token a request carries: a Bearer header first, then the session cookie. */
export async function requestSessionToken(req: IncomingMessage): Promise<string | null> {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const bearer = auth.slice(7);
    if (await verifySession(bearer)) return bearer;
  }
  const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  return (await verifySession(cookie)) ? cookie! : null;
}

export async function verifyRequestSession(req: IncomingMessage): Promise<boolean> {
  return (await requestSessionToken(req)) !== null;
}

export async function signSession(): Promise<string> {
  const { jwtSecret, jwtEpoch } = await loadSecrets();
  const cfg = await loadConfig();
  const ttlHours = cfg.security.sessionTtlHours || 168;
  return new SignJWT({ sub: "operator", jwtEpoch: jwtEpoch ?? 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${ttlHours}h`)
    .sign(new TextEncoder().encode(jwtSecret));
}

export async function sessionClaims(token: string | undefined): Promise<JWTPayload | null> {
  if (!token) return null;
  try {
    const { jwtSecret, jwtEpoch } = await loadSecrets();
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret), { algorithms: ["HS256"] });
    const epoch = typeof payload.jwtEpoch === "number" ? payload.jwtEpoch : 0;
    if (payload.sub !== "operator" || epoch !== (jwtEpoch ?? 0)) return null;
    if (await isSessionRevoked(payload.jti)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  return (await sessionClaims(token)) !== null;
}

/** Revoke this one session (logout on one device); the operator's other devices stay signed in. */
export async function revokeSessionToken(token: string): Promise<void> {
  const claims = await sessionClaims(token);
  if (!claims?.jti || typeof claims.exp !== "number") return;
  await revokeSession(claims.jti, claims.exp);
}

/** scrypt is deliberately slow; a burst of logins must not take every core. */
const MAX_CONCURRENT_VERIFY = 2;
let verifying = 0;
const verifyWaiters: Array<() => void> = [];

async function withVerifySlot<T>(fn: () => Promise<T>): Promise<T> {
  if (verifying >= MAX_CONCURRENT_VERIFY) await new Promise<void>((resolve) => verifyWaiters.push(resolve));
  verifying += 1;
  try {
    return await fn();
  } finally {
    verifying -= 1;
    verifyWaiters.shift()?.();
  }
}

/** Whether `password` is the operator password (false when none is set yet). */
export async function verifyOperatorPassword(password: string): Promise<boolean> {
  if (!password || password.length > MAX_OPERATOR_PASSWORD) return false;
  const { operatorPasswordHash } = await loadSecrets();
  if (!operatorPasswordHash) return false;
  return withVerifySlot(() => verifyPassword(password, operatorPasswordHash));
}

export async function loginWithPassword(password: string): Promise<string | null> {
  if (!password || password.length > MAX_OPERATOR_PASSWORD) return null;
  const { operatorPasswordHash } = await loadSecrets();
  if (!operatorPasswordHash) return null;
  const ok = await withVerifySlot(() => verifyPassword(password, operatorPasswordHash));
  if (!ok) return null;
  return signSession();
}

export async function buildSessionCookie(token: string, req: IncomingMessage): Promise<string> {
  const cfg = await loadConfig();
  return sessionCookie(token, requestIsSecure(req, cfg.network.publicUrl), cfg.security.sessionTtlHours || 168);
}

export async function buildClearSessionCookie(req: IncomingMessage): Promise<string> {
  const cfg = await loadConfig();
  return clearSessionCookie(requestIsSecure(req, cfg.network.publicUrl));
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
