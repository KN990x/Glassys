import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const webDir = dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(readFileSync(join(webDir, "../package.json"), "utf8")).version as string;
const gatewayPort = process.env.GLASSYS_PORT || "8787";
const gateway = `http://127.0.0.1:${gatewayPort}`;

function swCacheVersion(): Plugin {
  return {
    name: "sw-cache-version",
    apply: "build",
    closeBundle() {
      const sw = join(webDir, "dist/sw.js");
      if (!existsSync(sw)) return;
      const next = readFileSync(sw, "utf8").replace(/glassys-v[\w.-]+/g, `glassys-v${version}`);
      writeFileSync(sw, next);
    },
  };
}

export default defineConfig({
  plugins: [react(), swCacheVersion()],
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
