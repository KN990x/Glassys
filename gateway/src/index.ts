#!/usr/bin/env node
import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { listenBind, listenPort } from "./listen.js";
import { handleHttp } from "./http.js";
import { log, webDir } from "./paths.js";
import { initRuntime, shutdownRuntime } from "./runtime.js";
import { setRestartHandler } from "./restart.js";
import { loadSecrets, clearBlankCredentialEnv, secretsFlags } from "./secrets.js";
import { serveStatic } from "./static.js";
import { attachWs, closeWs } from "./ws.js";

async function main(): Promise<void> {
  clearBlankCredentialEnv();
  await loadSecrets();
  const cfg = await loadConfig();
  await initRuntime();

  const server = createServer(async (req, res) => {
    try {
      const handled = await handleHttp(req, res);
      if (handled || res.writableEnded) return;
      const path = (req.url || "/").split("?")[0] || "/";
      if (path.startsWith("/api") || path === "/ws" || path.startsWith("/ws/")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      if (serveStatic(req, res)) return;
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (err) {
      log("error", "http error", { error: String(err) });
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      if (!res.writableEnded) res.end(JSON.stringify({ error: "internal error" }));
    }
  });

  const wss = attachWs(server);

  server.on("error", (err) => {
    log("error", "http server", { error: String(err) });
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("info", "shutting down");
    await shutdownRuntime();
    await closeWs(wss);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      setTimeout(resolve, 2000);
    });
    process.exit(exitCode);
  };
  setRestartHandler(() => shutdown(0));
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));

  const bind = listenBind(cfg);
  const port = listenPort(cfg);
  if (bind === "0.0.0.0" || bind === "::") {
    const flags = secretsFlags(await loadSecrets());
    if (!flags.operatorPassword) {
      log("warn", "listening on all interfaces before operator setup");
    }
  }
  server.listen(port, bind, () => {
    log("info", "glassys listening", {
      bind,
      port,
      web: webDir(),
    });
  });
}

main().catch((err) => {
  log("error", "fatal", { error: String(err) });
  process.exit(1);
});
