import { afterEach, describe, expect, it } from "vitest";
import { listenBind, listenPort, resolveAllowedOrigin, setupOriginAllowed } from "./cors.js";

describe("listen address", () => {
  const prevBind = process.env.GLASSYS_BIND;
  const prevPort = process.env.GLASSYS_PORT;

  afterEach(() => {
    if (prevBind === undefined) delete process.env.GLASSYS_BIND;
    else process.env.GLASSYS_BIND = prevBind;
    if (prevPort === undefined) delete process.env.GLASSYS_PORT;
    else process.env.GLASSYS_PORT = prevPort;
  });

  it("prefers env over yaml", () => {
    process.env.GLASSYS_BIND = "0.0.0.0";
    process.env.GLASSYS_PORT = "9000";
    const cfg = { network: { bind: "127.0.0.1", port: 8787 } };
    expect(listenBind(cfg as never)).toBe("0.0.0.0");
    expect(listenPort(cfg as never)).toBe(9000);
  });
});

describe("resolveAllowedOrigin", () => {
  const base = {
    port: 8787,
    publicUrl: "",
    allowedOrigins: [] as string[],
    requestHost: undefined as string | undefined,
  };

  it("allows localhost any port when allowlist is empty", () => {
    expect(
      resolveAllowedOrigin({ ...base, origin: "http://127.0.0.1:5173", bind: "127.0.0.1" }),
    ).toBe("http://127.0.0.1:5173");
  });

  it("allows LAN origin when bind is 0.0.0.0 and Host matches", () => {
    expect(
      resolveAllowedOrigin({
        ...base,
        origin: "http://192.168.1.10:8787",
        requestHost: "192.168.1.10:8787",
        bind: "0.0.0.0",
      }),
    ).toBe("http://192.168.1.10:8787");
  });

  it("rejects LAN origin when bind is localhost-only", () => {
    expect(
      resolveAllowedOrigin({
        ...base,
        origin: "http://192.168.1.10:8787",
        requestHost: "192.168.1.10:8787",
        bind: "127.0.0.1",
      }),
    ).toBeNull();
  });

  it("respects an explicit allowlist and does not auto-add Host", () => {
    expect(
      resolveAllowedOrigin({
        ...base,
        origin: "http://192.168.1.10:8787",
        requestHost: "192.168.1.10:8787",
        bind: "0.0.0.0",
        allowedOrigins: ["https://glassys.example"],
      }),
    ).toBeNull();
  });
});

describe("setupOriginAllowed", () => {
  it("allows loopback clients even without Origin", () => {
    expect(setupOriginAllowed({ origin: undefined, remoteAddress: "127.0.0.1", publicUrl: "", allowedOrigins: [] })).toBe(
      true,
    );
    expect(setupOriginAllowed({ origin: undefined, remoteAddress: "::1", publicUrl: "", allowedOrigins: [] })).toBe(
      true,
    );
  });

  it("allows a loopback Origin from a Docker-style remote address", () => {
    expect(
      setupOriginAllowed({
        origin: "http://127.0.0.1:8787",
        remoteAddress: "172.17.0.1",
        publicUrl: "",
        allowedOrigins: [],
      }),
    ).toBe(true);
  });

  it("rejects LAN setup unless the origin is allowlisted", () => {
    expect(
      setupOriginAllowed({
        origin: "http://192.168.1.10:8787",
        remoteAddress: "192.168.1.10",
        publicUrl: "",
        allowedOrigins: [],
      }),
    ).toBe(false);
    expect(
      setupOriginAllowed({
        origin: "https://glassys.example",
        remoteAddress: "192.168.1.10",
        publicUrl: "https://glassys.example",
        allowedOrigins: [],
      }),
    ).toBe(true);
  });
});
