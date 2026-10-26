import { mkdtemp } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { clearSetupCode, ensureSetupCode, isDirectLocalRequest, setupCodeMatches } from "./setup-token.js";

function req(remoteAddress: string, headers: Record<string, string> = {}): IncomingMessage {
  return { socket: { remoteAddress }, headers } as unknown as IncomingMessage;
}

describe("setup code", () => {
  beforeEach(async () => {
    process.env.GLASSYS_DATA_DIR = await mkdtemp(join(tmpdir(), "glassys-setup-"));
  });

  it("keeps one code until setup clears it, and matches it however it is typed", async () => {
    const code = await ensureSetupCode();
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
    expect(await ensureSetupCode()).toBe(code);
    expect(await setupCodeMatches(code.toLowerCase().replace("-", " "))).toBe(true);
    expect(await setupCodeMatches(code.slice(0, 5))).toBe(false);
    expect(await setupCodeMatches("")).toBe(false);
    expect(await setupCodeMatches(42)).toBe(false);
    await clearSetupCode();
    expect(await setupCodeMatches(code)).toBe(false);
  });
});

describe("isDirectLocalRequest", () => {
  it("trusts a loopback socket with no proxy headers and no foreign origin", () => {
    expect(isDirectLocalRequest(req("127.0.0.1"))).toBe(true);
    expect(isDirectLocalRequest(req("::1", { origin: "http://localhost:8787" }))).toBe(true);
  });

  it("does not trust a proxied, remote or cross-site request", () => {
    expect(isDirectLocalRequest(req("127.0.0.1", { "x-forwarded-for": "203.0.113.4" }))).toBe(false);
    expect(isDirectLocalRequest(req("127.0.0.1", { "cf-connecting-ip": "203.0.113.4" }))).toBe(false);
    expect(isDirectLocalRequest(req("192.168.1.20"))).toBe(false);
    expect(isDirectLocalRequest(req("127.0.0.1", { origin: "https://evil.example" }))).toBe(false);
  });
});
