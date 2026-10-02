import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlib, gzipSync } from "node:zlib";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const webDir = dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(readFileSync(join(webDir, "../package.json"), "utf8")).version as string;
const gatewayPort = process.env.GLASSYS_PORT || "8787";
const gateway = `http://127.0.0.1:${gatewayPort}`;

const COMPRESSIBLE = new Set([".html", ".js", ".css", ".svg", ".json", ".webmanifest"]);
const MIN_COMPRESS_BYTES = 1024;

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

/* closeBundle hooks run in parallel across plugins, so the SW rewrite and the
   compression that must follow it live in one hook. */
function finishBuild(): Plugin {
  return {
    name: "glassys-finish-build",
    apply: "build",
    closeBundle() {
      const dist = join(webDir, "dist");
      const files = listFiles(dist).filter((f) => !f.endsWith(".br") && !f.endsWith(".gz"));
      const sw = join(dist, "sw.js");
      if (existsSync(sw)) {
        const hash = createHash("sha256");
        for (const file of files.filter((f) => f !== sw).sort()) {
          hash.update(relative(dist, file));
          hash.update(readFileSync(file));
        }
        const cache = `glassys-v${version}-${hash.digest("hex").slice(0, 10)}`;
        writeFileSync(sw, readFileSync(sw, "utf8").replace(/glassys-v[\w.-]+/g, cache));
      }
      for (const file of files) {
        if (!COMPRESSIBLE.has(extname(file)) || statSync(file).size < MIN_COMPRESS_BYTES) continue;
        const body = readFileSync(file);
        writeFileSync(`${file}.br`, brotliCompressSync(body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11 } }));
        writeFileSync(`${file}.gz`, gzipSync(body, { level: 9 }));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), finishBuild()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: gateway, changeOrigin: true },
      "/health": { target: gateway },
      "/ws": { target: `ws://127.0.0.1:${gatewayPort}`, ws: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
