import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { defaultConfig } from "@glassys/protocol";
import type { IncomingMessage } from "node:http";

const jwtVerify = vi.hoisted(() => vi.fn());

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    createRemoteJWKSet: () => ({}),
    jwtVerify,
  };
});

function req(headers: Record<string, string | string[] | undefined>): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe("verifyEdge", () => {
  afterEach(() => {
    jwtVerify.mockReset();
    delete process.env.GLASSYS_DATA_DIR;
  });

  async function writeCfg(over: (cfg: ReturnType<typeof defaultConfig>) => void) {
    const dir = await mkdtemp(join(tmpdir(), "glassys-edge-"));
    process.env.GLASSYS_DATA_DIR = dir;
    const cfg = defaultConfig();
    cfg.agent.cwd = dir;
    over(cfg);
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    const { verifyEdge } = await import("./auth.js");
    return verifyEdge;
  }

  it("accepts a configured identity header and rejects when it is missing", async () => {
    const verifyEdge = await writeCfg((cfg) => {
      cfg.security.edgeAuth = "header";
      cfg.security.identityHeader = "x-forwarded-user";
    });
    expect(await verifyEdge(req({}))).toEqual({ ok: false, reason: "missing identity header x-forwarded-user" });
    expect(await verifyEdge(req({ "x-forwarded-user": "ops" }))).toEqual({ ok: true });
  });

  it("requires a Cloudflare Access JWT and verifies it via JWKS", async () => {
    const verifyEdge = await writeCfg((cfg) => {
      cfg.security.edgeAuth = "cloudflare-access";
      cfg.security.cloudflare.teamDomain = "team.cloudflareaccess.com";
      cfg.security.cloudflare.audience = "aud-1";
    });
    expect(await verifyEdge(req({}))).toMatchObject({ ok: false, reason: "missing Cf-Access-Jwt-Assertion" });
    jwtVerify.mockResolvedValueOnce({ payload: { sub: "ok" } });
    expect(await verifyEdge(req({ "cf-access-jwt-assertion": "good" }))).toEqual({ ok: true });
    jwtVerify.mockRejectedValueOnce(new Error("bad"));
    expect(await verifyEdge(req({ "cf-access-jwt-assertion": "bad" }))).toEqual({
      ok: false,
      reason: "invalid Cloudflare Access token",
    });
  });
});
