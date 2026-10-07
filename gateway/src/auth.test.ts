import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";
import { requestIsSecure, sessionCookie, clearSessionCookie, parseCookies } from "./cookie.js";
import type { IncomingMessage } from "node:http";

function req(headers: Record<string, string>): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe("session cookie", () => {
  it("sets Max-Age from TTL hours", () => {
    const cookie = sessionCookie("tok", false, 2);
    expect(cookie).toContain("Max-Age=7200");
    expect(cookie).not.toContain("Secure");
  });

  it("adds Secure when requested", () => {
    expect(sessionCookie("tok", true, 1)).toContain("Secure");
  });

  it("clears Secure cookies with the Secure attribute", () => {
    expect(clearSessionCookie(true)).toContain("Secure");
    expect(clearSessionCookie(false)).not.toContain("Secure");
  });

  it("detects TLS from x-forwarded-proto", () => {
    expect(requestIsSecure(req({ "x-forwarded-proto": "https, http" }))).toBe(true);
    expect(requestIsSecure(req({ "x-forwarded-proto": "http" }))).toBe(false);
  });

  it("detects TLS from publicUrl only for requests to that host", () => {
    expect(requestIsSecure(req({ host: "glassys.example" }), "https://glassys.example")).toBe(true);
    expect(requestIsSecure(req({ host: "192.168.1.20:8787" }), "https://glassys.example")).toBe(false);
    expect(requestIsSecure(req({ host: "127.0.0.1:8787" }), "http://127.0.0.1:8787")).toBe(false);
  });

  it("does not throw on malformed percent-encoding in cookies", () => {
    const parsed = parseCookies("glassys_session=%E0%A4%A; other=ok");
    expect(parsed.other).toBe("ok");
    expect(parsed.glassys_session).toBe("%E0%A4%A");
  });
});

describe("verifySession", () => {
  afterEach(() => {
    delete process.env.GLASSYS_JWT_SECRET;
  });

  it("accepts operator JWTs and rejects other subjects", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-jwt-"));
    process.env.GLASSYS_DATA_DIR = dir;
    process.env.GLASSYS_JWT_SECRET = "unit-test-jwt-secret-unit-test-jwt";
    const { signSession, verifySession } = await import("./auth.js");
    const token = await signSession();
    expect(await verifySession(token)).toBe(true);
    const other = await new SignJWT({ sub: "intruder" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.GLASSYS_JWT_SECRET));
    expect(await verifySession(other)).toBe(false);
  });

  it("revokes one session on logout and leaves the others valid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-jwt-rev-"));
    process.env.GLASSYS_DATA_DIR = dir;
    process.env.GLASSYS_JWT_SECRET = "unit-test-jwt-secret-unit-test-jwt";
    const { signSession, verifySession, revokeSessionToken } = await import("./auth.js");
    const phone = await signSession();
    const laptop = await signSession();
    await revokeSessionToken(laptop);
    expect(await verifySession(laptop)).toBe(false);
    expect(await verifySession(phone)).toBe(true);
  });

  it("rejects a token signed with another algorithm", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-jwt-alg-"));
    process.env.GLASSYS_DATA_DIR = dir;
    process.env.GLASSYS_JWT_SECRET = "unit-test-jwt-secret-unit-test-jwt";
    const { verifySession } = await import("./auth.js");
    const hs512 = await new SignJWT({ sub: "operator", jwtEpoch: 0 })
      .setProtectedHeader({ alg: "HS512" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.GLASSYS_JWT_SECRET));
    expect(await verifySession(hs512)).toBe(false);
  });
});

describe("password rotation", () => {
  it("invalidates existing JWTs when the operator password changes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-jwt-rot-"));
    process.env.GLASSYS_DATA_DIR = dir;
    delete process.env.GLASSYS_JWT_SECRET;
    const { writeFile } = await import("node:fs/promises");
    const YAML = (await import("yaml")).default;
    const { defaultConfig } = await import("@glassys/protocol");
    const cfg = defaultConfig();
    cfg.agent.cwd = await mkdtemp(join(tmpdir(), "glassys-cwd-"));
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    const { loadSecrets, patchSecrets, hashPassword } = await import("./secrets.js");
    await loadSecrets();
    await patchSecrets({ operatorPasswordHash: await hashPassword("password1") });
    const { signSession, verifySession } = await import("./auth.js");
    const token = await signSession();
    expect(await verifySession(token)).toBe(true);
    const { applyPatch } = await import("./config.js");
    await applyPatch({ operatorPassword: "password2" });
    expect(await verifySession(token)).toBe(false);
  });

  it("invalidates JWTs on password change even when GLASSYS_JWT_SECRET is set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-jwt-env-"));
    process.env.GLASSYS_DATA_DIR = dir;
    process.env.GLASSYS_JWT_SECRET = "unit-test-jwt-secret-unit-test-jwt";
    const { writeFile } = await import("node:fs/promises");
    const YAML = (await import("yaml")).default;
    const { defaultConfig } = await import("@glassys/protocol");
    const cfg = defaultConfig();
    cfg.agent.cwd = await mkdtemp(join(tmpdir(), "glassys-cwd-"));
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    const { loadSecrets, patchSecrets, hashPassword } = await import("./secrets.js");
    await loadSecrets();
    await patchSecrets({ operatorPasswordHash: await hashPassword("password1") });
    const { signSession, verifySession } = await import("./auth.js");
    const token = await signSession();
    expect(await verifySession(token)).toBe(true);
    const { applyPatch } = await import("./config.js");
    await applyPatch({ operatorPassword: "password2" });
    expect(await verifySession(token)).toBe(false);
    delete process.env.GLASSYS_JWT_SECRET;
  });
});
