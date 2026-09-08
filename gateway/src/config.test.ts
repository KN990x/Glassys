import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { defaultConfig } from "@glassys/protocol";
import { stripOperatorRestricted } from "./config-patch.js";
import { HttpError } from "./errors.js";
import type { Adapter } from "@glassys/adapter-contract";

vi.mock("./adapters.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./adapters.js")>();
  return {
    ...actual,
    probeAdapter: vi.fn(async (adapter: Adapter) => actual.probeAdapter(adapter)),
  };
});

describe("config patch", () => {
  it("drops network and security from API patches", () => {
    const next = stripOperatorRestricted({
      space: { locale: "es" },
      network: { bind: "0.0.0.0", port: 9999 },
      security: { edgeAuth: "header" },
    });
    expect(next.space).toEqual({ locale: "es" });
    expect(next.network).toBeUndefined();
    expect(next.security).toBeUndefined();
  });

  it("rejects an unknown adapter id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-cfg-"));
    process.env.GLASSYS_DATA_DIR = dir;
    const cfg = defaultConfig();
    cfg.agent.cwd = dir;
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    const { applyPatch } = await import("./config.js");
    await expect(applyPatch({ agent: { adapter: "nope" } })).rejects.toBeInstanceOf(HttpError);
    await expect(applyPatch({ agent: { adapter: "nope" } })).rejects.toThrow(/Unknown adapter/);
  });

  it("rejects a non-object agent patch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-cfg-"));
    process.env.GLASSYS_DATA_DIR = dir;
    const cfg = defaultConfig();
    cfg.agent.cwd = dir;
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    const { applyPatch } = await import("./config.js");
    await expect(applyPatch({ agent: "cursor" as unknown as { adapter: string } })).rejects.toThrow(/agent must be an object/);
  });

  it("does not copy __proto__ from a patch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-cfg-"));
    process.env.GLASSYS_DATA_DIR = dir;
    const cfg = defaultConfig();
    cfg.agent.cwd = dir;
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    const { applyPatch } = await import("./config.js");
    const patch = JSON.parse('{"space":{"__proto__":{"polluted":true},"locale":"es"}}') as {
      space: { locale: string };
    };
    const { config } = await applyPatch(patch);
    expect(config.space.locale).toBe("es");
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect((config.space as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("rejects a password longer than 256 characters", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-cfg-"));
    process.env.GLASSYS_DATA_DIR = dir;
    const cfg = defaultConfig();
    cfg.agent.cwd = dir;
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    const { applyPatch } = await import("./config.js");
    await expect(applyPatch({ operatorPassword: "x".repeat(257) })).rejects.toThrow(/at most 256/);
  });

  it("rejects switching adapter when probe fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-cfg-"));
    process.env.GLASSYS_DATA_DIR = dir;
    const cfg = defaultConfig();
    cfg.agent.cwd = dir;
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    const { probeAdapter } = await import("./adapters.js");
    vi.mocked(probeAdapter).mockResolvedValue({ ok: false, error: "Gemini CLI SDK is not available" });
    try {
      const { applyPatch } = await import("./config.js");
      await expect(applyPatch({ agent: { adapter: "claude" } })).rejects.toBeInstanceOf(HttpError);
      await expect(applyPatch({ agent: { adapter: "claude" } })).rejects.toThrow(/Gemini CLI SDK/);
    } finally {
      vi.mocked(probeAdapter).mockRestore();
    }
  });
});
