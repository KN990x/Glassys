# Host gateway

Run the Glassys gateway as a normal process on the machine the agent should operate (systems work: git, files, services). The PWA is served by the same process. You bring the reverse proxy.

This is how Glassys is installed: the agent needs the real workspace, host `git`, and the operator’s files.

## Run as a user service (recommended)

One line from an empty directory (Node.js **22.13+** and pnpm; Corepack: `corepack enable`):

```bash
curl -fsSL https://raw.githubusercontent.com/KN990x/Glassys/main/scripts/install.sh | bash
```

That script clones if needed, runs `pnpm install`, builds if `gateway/dist` is missing, then `pnpm run service:install`. The clone+pnpm form still works:

```bash
git clone https://github.com/KN990x/Glassys.git glassys && cd glassys && pnpm install && pnpm run service:install
```

Already inside the repo: `bash scripts/install.sh` or `pnpm install && pnpm run service:install`. That builds if needed and leaves the gateway running when you close the terminal.

```bash
cd glassys && pnpm run service:status
cd glassys && pnpm run service:upgrade
cd glassys && pnpm run service:uninstall
```

`service:upgrade` is `git pull --ff-only && pnpm install && pnpm build &&` restart of the user unit (not Docker, not Windows). Stay in the clone you installed from. From the PWA, **Upgrade** runs the same path only when the user service is installed (`GLASSYS_SERVICE=1` in the unit/plist). If `git pull --ff-only` fails, the PWA upgrade **stops** and does not install or build. Foreground `pnpm start` can Restart but cannot Upgrade (HTTP 409); use `pnpm run service:upgrade` in the clone.

Web Push needs HTTPS or localhost. A loopback bind on the LAN is not enough: put a tunnel or reverse proxy in front, then subscribe from Settings. iOS only delivers push to an installed PWA.

Uninstall stops the service and removes the unit/LaunchAgent. It does not delete the clone or `data/` (operator hash, transcript).

- **macOS:** LaunchAgent `~/Library/LaunchAgents/dev.kn990x.glassys.plist` (`KeepAlive`).
- **Linux:** systemd user unit `~/.config/systemd/user/glassys.service`. On a headless/SSH host, enable linger so logout does not stop it: `sudo loginctl enable-linger $USER` (the installer tries this and prints the command if it cannot). If you install from a graphical session, the unit copies `DISPLAY` / `WAYLAND_DISPLAY` / `DBUS_SESSION_BUS_ADDRESS` when they are set; linger after reboot still has no display. Logs: `journalctl --user -u glassys`. The installer does **not** duplicate that journal into `data/glassys.log`.

The user-service unit runs as **your login user** with `WorkingDirectory` set to the clone. That is not the same as the example system unit below (`User=glassys`, `/opt/glassys`). Do not mix those paths.

Data defaults to `<repo>/data`. Override with `GLASSYS_DATA_DIR` when you run `service:install`. The installer copies `GLASSYS_PORT` / `GLASSYS_BIND` into the unit when those env vars are set at install time, then checks `GET /health` on loopback and, if that fails, on the bind address. It does not copy API keys into the unit.

Schedules (`data/schedules.json`) and Web Push subscriptions (`data/push-subscriptions.json`) are runtime state, not yaml. Cron jobs do not catch up after downtime; one-shot `at` jobs that are already due do fire. `GET /api/push/vapid` mints VAPID keys on first use (subject is `https://…` when `publicUrl` is https, otherwise `mailto:operator@localhost`).

Open `http://127.0.0.1:8787` (or `GLASSYS_PORT` if you set it) and complete the onboarding wizard before using chat. Defaults: bind `127.0.0.1:8787`. Do not bind `0.0.0.0` unless you understand that auto-run + host cwd is operator access to the machine.

## Cursor SDK login (not cursor-cli)

Glassys talks to `@cursor/sdk` (`Agent.create` / `resume` / `send`). It does not reuse Cursor IDE or `cursor-cli` / `cursor-agent` sessions. Sign in with **Cursor SDK** in the wizard (the PWA shows a URL if no browser opens on the host) or set `CURSOR_API_KEY`. Store path: `~/.cursor/sdk/auth.json` for the user whose `HOME` the service uses.

Keep `cursor-cli` installed if you use it in a terminal. Sign in with the SDK (or paste a key from [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations)). Do not run two auto-run agents on the same `cwd` at once.

Credential order: optional API key in Glassys secrets → `CURSOR_API_KEY` → `~/.cursor/sdk/auth.json` (only keys minted by `Cursor.auth.login()`). `settingSources` (default project + user) can load **rules** from `~/.cursor`; it does not copy IDE tokens.

| Already on the machine | What to do |
| --- | --- |
| Only Cursor IDE or `cursor-cli` / `cursor-agent` signed in | Sign in with **Cursor SDK** in the wizard, or paste a dashboard key. The CLI can stay installed; it is not reused. |
| Linux desktop, gateway in the foreground (`pnpm start`) | “Sign in with Cursor SDK” may open a browser. If it does not, open the URL the PWA shows. |
| `systemd --user` (`pnpm run service:install`) | The unit has `HOME` but often no `DISPLAY`. Use the URL in the PWA, or set `CURSOR_API_KEY` on the service. Linger does not give a display. |
| SSH / headless / PWA on a phone | Open the URL in the browser you are looking at. Do not wait for a browser on the server. |
| Existing `~/.cursor/sdk/auth.json` | Works if the service `HOME` is that user and no bad `CURSOR_API_KEY` overrides it. |
| systemd `User=glassys` | That account’s `$HOME` is a different `auth.json`. Log in as that user or use env/secrets. |
| SDK key expired (~90 days) | Sign in with the SDK again or rotate the dashboard key. |
| CLI and Glassys on the same `cwd` | Independent credentials. Do not run two auto-run agents on the same files at once. |

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

- **Production:** terminate TLS at Caddy or Cloudflare Tunnel. Forward HTTP and WebSocket (`/ws`) to `127.0.0.1:<port>` from `config.yaml` (`network.port`, or `GLASSYS_PORT`). See [caddy.md](caddy.md) and [cloudflare.md](cloudflare.md). Idle HTTP cutoffs around 100s will drop long agent runs; keep WebSocket idle timeouts high. Glassys pings every 15–30s (default 25).
- **Development:** Vite on `127.0.0.1:5173` only forwards `/api`, `/health`, and `/ws` to the gateway. That is not a substitute for a reverse proxy.

If the PWA is on another origin, add that origin to `network.allowedOrigins` in `config.yaml`.

## Health

`GET /health` → `{ "ok": true, "name": "glassys", "version": "<package version>", "protocolVersion": 1 }`.
