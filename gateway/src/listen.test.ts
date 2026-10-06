import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listenPort, parseListenPort, resolveListenFromDataDir } from "./listen.js";

describe("listenPort", () => {
  const prev = process.env.GLASSYS_PORT;
  afterEach(() => {
    if (prev === undefined) delete process.env.GLASSYS_PORT;
    else process.env.GLASSYS_PORT = prev;
  });

  it("rejects non-integer and out-of-range ports", () => {
    expect(() => parseListenPort("abc")).toThrow(/Invalid listen port/);
    expect(() => parseListenPort(Number.NaN)).toThrow(/Invalid listen port/);
    expect(() => parseListenPort(0)).toThrow(/Invalid listen port/);
    expect(() => parseListenPort(70000)).toThrow(/Invalid listen port/);
    expect(parseListenPort(8787)).toBe(8787);
  });

  it("throws when GLASSYS_PORT is not a valid integer", () => {
    process.env.GLASSYS_PORT = "abc";
    expect(() => listenPort({ network: { bind: "127.0.0.1", port: 8787 } } as never)).toThrow(/Invalid listen port/);
  });
});

describe("resolveListenFromDataDir", () => {
  it("reads bind and port from config.yaml, with env winning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-listen-"));
    await writeFile(join(dir, "config.yaml"), "network:\n  bind: 172.18.0.1\n  port: 9100\n  publicUrl: https://g.example\n");
    expect(resolveListenFromDataDir(dir, {})).toEqual({ bind: "172.18.0.1", port: 9100, publicUrl: "https://g.example" });
    expect(resolveListenFromDataDir(dir, { GLASSYS_BIND: "127.0.0.1", GLASSYS_PORT: "9200" })).toMatchObject({
      bind: "127.0.0.1",
      port: 9200,
    });
  });

  it("falls back to defaults without a config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-listen-"));
    expect(resolveListenFromDataDir(dir, {})).toEqual({ bind: "127.0.0.1", port: 8787, publicUrl: "" });
  });
});
