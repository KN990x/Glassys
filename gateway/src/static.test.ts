import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptsEncoding, fileResponseHeaders, isGatewayApiPath, pickEncoded } from "./static.js";

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

  it("caches hashed assets for a year and revalidates the shell", () => {
    const root = "/srv/web";
    expect(fileResponseHeaders("/srv/web/assets/index-abc123.js", root)["Cache-Control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(fileResponseHeaders("/srv/web/sw.js", root)["Cache-Control"]).toBe("no-cache");
    expect(fileResponseHeaders("/srv/web/manifest.webmanifest", root)["Cache-Control"]).toBe("no-cache");
    expect(fileResponseHeaders("/srv/web/index.html", root)["Cache-Control"]).toBe("no-cache");
    expect(fileResponseHeaders("/srv/web/icon.svg", root)["Cache-Control"]).toBe("public, max-age=3600");
  });

  it("reads Accept-Encoding with q-values", () => {
    expect(acceptsEncoding("gzip, deflate, br", "br")).toBe(true);
    expect(acceptsEncoding("gzip;q=1, br;q=0", "br")).toBe(false);
    expect(acceptsEncoding("*", "gzip")).toBe(true);
    expect(acceptsEncoding(undefined, "gzip")).toBe(false);
  });

  it("serves the precompressed file the client accepts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-static-"));
    try {
      const file = join(dir, "app.js");
      await writeFile(file, "x");
      await writeFile(`${file}.gz`, "gz");
      expect(pickEncoded(file, "gzip, br")).toEqual({ path: `${file}.gz`, encoding: "gzip" });
      await writeFile(`${file}.br`, "br");
      expect(pickEncoded(file, "gzip, br")).toEqual({ path: `${file}.br`, encoding: "br" });
      expect(pickEncoded(file, "identity")).toEqual({ path: file });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
