#!/usr/bin/env node
import { createServer } from "node:http";
import { reconcileUpgradeStatus } from "./admin-update.js";
import { initBuildInfo } from "./build-info.js";
import { loadConfig } from "./config.js";
import { listenBind, listenPort } from "./listen.js";
import { handleHttp } from "./http.js";
import { log, secureDataDir, webDir } from "./paths.js";
import { initRuntime, shutdownRuntime } from "./runtime.js";
import { setRestartHandler } from "./restart.js";
import { loadSecrets, clearBlankCredentialEnv, secretsFlags } from "./secrets.js";
import { serveStatic } from "./static.js";
import { attachWs, closeWs } from "./ws.js";

async function main(): Promise<void> {
  clearBlankCredentialEnv();
  await secureDataDir();
  await initBuildInfo();
  await reconcileUpgradeStatus().catch((err) => log("warn", "could not reconcile the upgrade status", { error: String(err) }));
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

  const bind = listenBind(cfg);
  const port = listenPort(cfg);
  /*
   * A bind on a bridge or VPN address (Docker, WireGuard) does not exist until that network is
   * up, and at boot the service manager can start us first. Wait for the address here instead
   * of exiting: a crash loop would trip systemd's start limit and leave the unit failed.
   */
  const LISTEN_RETRY_MS = [1000, 2000, 5000];
  const LISTEN_GIVE_UP_MS = 120_000;
  const firstListenAt = Date.now();
  let listenAttempt = 0;
  let listening = false;
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (!listening && err.code === "EADDRNOTAVAIL" && Date.now() - firstListenAt < LISTEN_GIVE_UP_MS) {
      const wait = LISTEN_RETRY_MS[Math.min(listenAttempt, LISTEN_RETRY_MS.length - 1)]!;
      listenAttempt += 1;
      log("warn", "bind address not available yet; retrying", { bind, port, attempt: listenAttempt, waitMs: wait });
      setTimeout(() => server.listen(port, bind), wait);
      return;
    }
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
  /* One adapter promise nobody awaited must not take the live run and every socket down with it. */
  process.on("unhandledRejection", (reason) => {
    log("error", "unhandled rejection", { error: String(reason) });
  });
  /* State after a throw is unknown: stop cleanly and let the service manager restart the gateway. */
  process.on("uncaughtException", (err) => {
    log("error", "uncaught exception", { error: String(err) });
    void shutdown(1);
  });

  if (bind === "0.0.0.0" || bind === "::") {
    const flags = secretsFlags(await loadSecrets());
    if (!flags.operatorPassword) {
      log("warn", "listening on all interfaces before operator setup");
    }
  }
  server.once("listening", () => {
    listening = true;
    log("info", "glassys listening", {
      bind,
      port,
      web: webDir(),
    });
  });
  server.listen(port, bind);
}

main().catch((err) => {
  log("error", "fatal", { error: String(err) });
  process.exit(1);
});
