import { describe, expect, it } from "vitest";
import { fileResponseHeaders, isGatewayApiPath } from "./static.js";

describe("static serving", () => {
  it("does not treat /api or /ws as SPA paths", () => {
    expect(isGatewayApiPath("/api/models")).toBe(true);
    expect(isGatewayApiPath("/api/nope?x=1")).toBe(true);
    expect(isGatewayApiPath("/ws")).toBe(true);
    expect(isGatewayApiPath("/index.html")).toBe(false);
    expect(isGatewayApiPath("/")).toBe(false);
  });

  it("sets nosniff and frame deny on HTML", () => {
    const headers = fileResponseHeaders("/tmp/index.html");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    const csp = headers["Content-Security-Policy"] ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("object-src 'none'");
  });
});
