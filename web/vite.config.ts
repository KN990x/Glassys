import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const gatewayPort = process.env.GLASSYS_PORT || "8787";
const gateway = `http://127.0.0.1:${gatewayPort}`;

export default defineConfig({
  plugins: [react()],
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
    sourcemap: true,
  },
});
