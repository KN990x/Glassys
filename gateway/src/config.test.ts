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

  it("does not persist a locale patch when the password is invalid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-cfg-"));
    process.env.GLASSYS_DATA_DIR = dir;
    const cfg = defaultConfig();
    cfg.agent.cwd = dir;
    const originalLocale = cfg.space.locale;
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    const { applyPatch, loadConfig } = await import("./config.js");
    await expect(applyPatch({ space: { locale: "es" }, operatorPassword: "x".repeat(257) })).rejects.toThrow(/at most 256/);
    expect((await loadConfig()).space.locale).toBe(originalLocale);
  });

  it("rejects completing onboarding for ACP without a command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-cfg-"));
    process.env.GLASSYS_DATA_DIR = dir;
    const cfg = defaultConfig();
    cfg.agent.cwd = dir;
    cfg.agent.adapter = "acp";
    cfg.agent.options = { command: "" };
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    const { applyPatch } = await import("./config.js");
    await expect(applyPatch({ onboarding: { completed: true } })).rejects.toThrow(/command/);
  });

  it("rejects saving ACP without a command after onboarding", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-cfg-"));
    process.env.GLASSYS_DATA_DIR = dir;
    const cfg = defaultConfig();
    cfg.agent.cwd = dir;
    cfg.agent.adapter = "acp";
    cfg.agent.options = { command: "npx" };
    cfg.onboarding.completed = true;
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    const { applyPatch } = await import("./config.js");
    await expect(applyPatch({ agent: { options: { command: "" } } })).rejects.toThrow(/command/);
  });

  it("ignores leftover options from another adapter in the fingerprint", async () => {
    const { agentFingerprint } = await import("./config.js");
    const a = defaultConfig();
    a.agent.adapter = "claude";
    a.agent.cwd = "/tmp/ws";
    a.agent.options = { permissionMode: "dontAsk", autoRun: false, sandbox: true };
    const b = defaultConfig();
    b.agent.adapter = "claude";
    b.agent.cwd = "/tmp/ws";
    b.agent.options = { permissionMode: "dontAsk", autoRun: false };
    expect(agentFingerprint(a)).toBe(agentFingerprint(b));
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

  it("probes Gemini for real when switching to it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-cfg-"));
    process.env.GLASSYS_DATA_DIR = dir;
    const cfg = defaultConfig();
    cfg.agent.cwd = dir;
    cfg.agent.adapter = "cursor";
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    const { applyPatch } = await import("./config.js");
    await expect(applyPatch({ agent: { adapter: "gemini" } })).rejects.toThrow(/Gemini CLI SDK/);
  });

  it("does not probe when saving the already selected adapter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-cfg-"));
    process.env.GLASSYS_DATA_DIR = dir;
    const cfg = defaultConfig();
    cfg.agent.cwd = dir;
    cfg.agent.adapter = "cursor";
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    const { probeAdapter } = await import("./adapters.js");
    vi.mocked(probeAdapter).mockClear();
    vi.mocked(probeAdapter).mockResolvedValue({ ok: false, error: "Gemini CLI SDK is not available" });
    try {
      const { applyPatch } = await import("./config.js");
      const { config } = await applyPatch({ agent: { adapter: "cursor" }, space: { locale: "es" } });
      expect(config.space.locale).toBe("es");
      expect(probeAdapter).not.toHaveBeenCalled();
    } finally {
      vi.mocked(probeAdapter).mockRestore();
    }
  });

  it("probes ACP with command options when saving ACP config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-cfg-"));
    process.env.GLASSYS_DATA_DIR = dir;
    const cfg = defaultConfig();
    cfg.agent.cwd = dir;
    cfg.agent.adapter = "acp";
    cfg.agent.options = { command: "true" };
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    const { probeAdapter } = await import("./adapters.js");
    const seen: Array<Record<string, unknown> | undefined> = [];
    vi.mocked(probeAdapter).mockImplementation(async (_adapter, options) => {
      seen.push(options);
      return { ok: true };
    });
    try {
      const { applyPatch } = await import("./config.js");
      await applyPatch({ agent: { options: { command: "true", args: [] } } });
      expect(seen.some((o) => o && o.command === "true")).toBe(true);
    } finally {
      vi.mocked(probeAdapter).mockRestore();
    }
  });
});
