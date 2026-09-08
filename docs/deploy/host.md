# Host gateway

Run the Glassys gateway as a normal process on the machine the agent should operate. The PWA is served by the same process. You bring the reverse proxy.

This is how Glassys is installed: the agent needs the real workspace, host `git`, and the operator’s files.

## Run as a user service (recommended)

One line from an empty directory (Node.js **22.13+** and pnpm; Corepack: `corepack enable`):

```bash
git clone https://github.com/KN990x/Glassys.git glassys && cd glassys && pnpm install && pnpm run service:install
```

Already inside the repo: `pnpm install && pnpm run service:install`. That builds if needed and leaves the gateway running when you close the terminal.

```bash
cd glassys && pnpm run service:status
cd glassys && pnpm run service:uninstall
```

Uninstall stops the service and removes the unit/LaunchAgent. It does not delete the clone or `data/` (operator hash, transcript).

- **macOS:** LaunchAgent `~/Library/LaunchAgents/dev.kn990x.glassys.plist` (`KeepAlive`).
- **Linux:** systemd user unit `~/.config/systemd/user/glassys.service`. On a headless/SSH host, enable linger so logout does not stop it: `sudo loginctl enable-linger $USER` (the installer tries this and prints the command if it cannot). If you install from a graphical session, the unit copies `DISPLAY` / `WAYLAND_DISPLAY` / `DBUS_SESSION_BUS_ADDRESS` when they are set; linger after reboot still has no display.

Data defaults to `<repo>/data`. Override with `GLASSYS_DATA_DIR` when you run `service:install`. The installer does not copy API keys into the unit.

Open `http://127.0.0.1:8787` (or `GLASSYS_PORT` if you set it) and complete the onboarding wizard before using chat. Defaults: bind `127.0.0.1:8787`. Do not bind `0.0.0.0` unless you understand that auto-run + host cwd is operator access to the machine.

## Cursor SDK login (not cursor-cli)

Glassys does not reuse Cursor IDE or `cursor-cli` / `cursor-agent` sessions. Sign in with **Cursor SDK** in the wizard (the PWA shows a URL if no browser opens on the host) or set `CURSOR_API_KEY`. Store path: `~/.cursor/sdk/auth.json` for the user whose `HOME` the service uses. See the credential matrix in the README.

The login POST returns as soon as the SDK has a URL; it does not hold an HTTP connection until you finish in the browser. Long proxy idle timeouts still apply to agent **WebSocket** runs, not to this short POST.

## Foreground

Useful for a one-off debug session (closing the terminal stops the process):

```bash
pnpm run build
export GLASSYS_DATA_DIR=/var/lib/glassys
# optional per-adapter keys: CURSOR_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, CODEX_API_KEY, OPENCODE_API_KEY, GLASSYS_JWT_SECRET
node gateway/dist/index.js
```

## systemd system unit (dedicated Unix user)

For a machine-wide service under a dedicated account. Paths, user, and `WorkingDirectory` are yours to set. Nothing here is a hostname from a specific homelab. For the usual homelab/laptop install, prefer `pnpm run service:install` above.

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

`pnpm run service:install` writes the LaunchAgent. To do it by hand: `KeepAlive`, `ProgramArguments` pointing at `node` and `gateway/dist/index.js`, and `GLASSYS_DATA_DIR` in `EnvironmentVariables`.

## Proxy

Glassys is the app behind the proxy, not the proxy.

- **Production:** terminate TLS at Caddy, Traefik, Nginx Proxy Manager, or Cloudflare Tunnel. Forward HTTP and WebSocket (`/ws`) to `127.0.0.1:<port>` from `config.yaml` (`network.port`, or `GLASSYS_PORT`). See [caddy.md](caddy.md). Idle HTTP cutoffs around 100s will drop long agent runs; keep WebSocket idle timeouts high. Glassys pings every 15–30s (default 25).
- **Development:** Vite on `127.0.0.1:5173` only forwards `/api`, `/health`, and `/ws` to the gateway. That is not a substitute for a reverse proxy.

If the PWA is on another origin, add that origin to `network.allowedOrigins` in `config.yaml`.

## Health

`GET /health` → `{ "ok": true, "name": "glassys", "version": "<package version>", "protocolVersion": 1 }`.
