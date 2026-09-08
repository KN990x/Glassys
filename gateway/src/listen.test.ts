import { afterEach, describe, expect, it } from "vitest";
import { listenPort, parseListenPort } from "./listen.js";

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
