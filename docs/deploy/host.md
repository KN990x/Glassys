# Mode A — host gateway

Run the Glassys gateway as a normal process on the machine the agent should operate. The PWA is served by the same process. You bring the reverse proxy.

This is the recommended mode when the agent needs the real workspace, host `git`, and often the host Docker CLI.

## Run

pnpm 11.14+:

```bash
pnpm install
pnpm run build
export GLASSYS_DATA_DIR=/var/lib/glassys
# optional per-adapter keys: CURSOR_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, CODEX_API_KEY, OPENCODE_API_KEY, GLASSYS_JWT_SECRET
node gateway/dist/index.js
```

Defaults: bind `127.0.0.1:8787`. Do not bind `0.0.0.0` unless you understand that auto-run + host cwd is operator access to the machine.

Complete the onboarding wizard in the browser before using chat.

## systemd example

Paths, user, and `WorkingDirectory` are yours to set. Nothing here is a hostname from a specific homelab.

```ini
[Unit]
Description=Glassys gateway
After=network.target

[Service]
Type=simple
User=glassys
WorkingDirectory=/opt/glassys
Environment=GLASSYS_DATA_DIR=/var/lib/glassys
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/glassys/gateway/dist/index.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

`Restart=always` brings the process back after a crash and after `POST /api/admin/restart` (exit 0). Bind, port, and edge auth are yaml/env only; change those files and bounce the unit (systemctl restart / launchctl). The PWA cannot change them.

## launchd (macOS)

Use `KeepAlive` and a `ProgramArguments` array pointing at `node` and `gateway/dist/index.js`. Set `GLASSYS_DATA_DIR` in `EnvironmentVariables`.

## Proxy

Glassys is the app behind the proxy, not the proxy.

- **Production:** terminate TLS at Caddy, Traefik, Nginx Proxy Manager, or Cloudflare Tunnel. Forward HTTP and WebSocket (`/ws`) to `127.0.0.1:<port>` from `config.yaml` (`network.port`, or `GLASSYS_PORT`). See [caddy.md](caddy.md). Idle HTTP cutoffs around 100s will drop long agent runs; keep WebSocket idle timeouts high. Glassys pings every 15–30s (default 25).
- **Development:** Vite on `127.0.0.1:5173` only forwards `/api`, `/health`, and `/ws` to the gateway. That is not a substitute for a reverse proxy.

If the PWA is on another origin, add that origin to `network.allowedOrigins` in `config.yaml`.

## Health

`GET /health` → `{ "ok": true, "name": "glassys", "version": "<package version>", "protocolVersion": 1 }`.
