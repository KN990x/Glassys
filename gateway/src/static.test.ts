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
    expect(headers["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
  });
});
