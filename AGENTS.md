# Glassys — agent briefing

This is the canonical project briefing. Edit this file, not `CLAUDE.md`.

## What it is

Glassys is a self-hosted **chat face** (PWA + Node gateway) for the coding agent that already runs on the host. It does not infer, it has no personality, and it is not the agent. The job is **systems work** on that machine (files, services, git), not application development. Coding agents are the runtime; Glassys is not an IDE. Adapters talk to each vendor’s **local SDK** (or ACP). The gateway translates that stream into a stable UI protocol and serves it in a browser or phone.

Analogy: Open WebUI is to Ollama what Glassys is to Cursor, Claude Code, OpenCode, and similar tools — the UI, not the runtime.

**Agent / adapter** is the product on the host. **Transport** is SDK or ACP (never print-mode). **CLI** is the vendor’s terminal app: optional unless an adapter probes for a binary (`codex`, `opencode`); its login does not authenticate Glassys.

- Self-hosted only. Every operator runs their own instance. Not a Glassys SaaS.
- Product language: English default, UI i18n-ready (`en` + `es`). Public `README.md` is bilingual (English then Spanish). `AGENTS.md`, code comments, and UI message keys: English.
- v1: **one profile / one live thread / one run at a time** (FIFO queue). Archived threads are frozen transcripts (`data/threads/<id>/`). Changing adapter / cwd / options archives the current thread and opens an empty one. An explicit new thread with the same cwd also creates a new agent. Switching restores that thread’s config and `agentId` (resume if the adapter allows).

## What it is not (non-negotiable)

- Not a wrapper around `cursor-agent -p --output-format stream-json`. Print mode suppresses thinking.
- Cursor transport: `@cursor/sdk` **local** runtime — `Agent.create` / `resume` / `send` + `onDelta` + always `wait()`. Do not use Cursor-via-ACP while the SDK exists.
- Not OpenClaw, not Open WebUI, not a PTY/xterm product. A raw terminal may exist later as debug, not as the UI.
- Not an editor. No Apply/Reject on buffers. The agent writes the disk (ACP host auto-applies `fs/*` / `terminal/*` when auto-run is on; auto-run off denies writes and `terminal/create`). Glassys shows the transcript (thinking, tools, diffs).
- Not a development IDE. Operators use it for systems work on the host; coding agents are the runtime.
- Do not clone Cursor (or any vendor) branding or assets.

## Configure, don't fork

Anything that changes between operators lives in:

1. In-app Settings (source of truth for locale, theme, agent, display, session). Bind, port, public URL, allowed origins, and edge auth are **not** in the PWA — edit `config.yaml` or env.
2. Server secrets (env / secret store): per-adapter API keys (`secrets.adapters.<id>`), password hash, JWT secret. UI may show configured/rotate, never the full key again. Env: `CURSOR_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` / `GOOGLE_API_KEY`, `CODEX_API_KEY` / `OPENAI_API_KEY`, `OPENCODE_API_KEY`.
3. On-disk `config.yaml` (UI reads and writes agent/display/session; network and security only via this file). Gitignore secrets. Version `config.example.yaml`.

**Never hardcode** hostnames, IPs, workspace paths, models, users, or reverse-proxy stacks. First run is an onboarding wizard; the PWA must not enter chat until it is complete. Operator auth is always on, even behind Cloudflare Access or similar.

Default bind is `127.0.0.1`. Binding `0.0.0.0` is an explicit operator choice in `config.yaml` / `GLASSYS_BIND`. Auto-run + host cwd is operator-level access to that machine — keep sandbox / auto-run visible in Settings when the adapter supports them.

`agent.options` is opaque per adapter. Cursor: `settingSources`, `sandbox`, `autoRun`. Claude: `permissionMode`, `autoRun`. ACP: `command`, `args`, `registryId`. Changing adapter / cwd / options archives the live thread and starts a new one. Changing model is sticky on the next `send`.

## Layout

| Path | Role |
| --- | --- |
| `protocol/` | Versioned UI protocol. Gateway and web import this. **Never** SDK/ACP types or vendor catalogs. |
| `adapters/contract/` | `Adapter` interface: `create`, `resume`, `listModels`, `capabilities`. `send` lives on the session; `cancel` on the run. |
| `adapters/cursor/` | Only package that imports `@cursor/sdk`. Owns the Cursor fallback catalog. |
| `adapters/claude/` | Claude Agent SDK. |
| `adapters/opencode/` | OpenCode local server. |
| `adapters/gemini/` | Gemini CLI SDK (`probe` until `@google/gemini-cli-sdk` is linked; wizard must not complete with it). |
| `adapters/codex/` | Codex SDK (`runStreamed` / `resumeThread`), not print-mode `exec --json`. |
| `adapters/acp/` | Generic ACP JSON-RPC host (auto-apply when auto-run is on). |
| `gateway/` | Long-lived Node process: auth, WS, queue, persistence, static PWA, adapter registry. |
| `web/` | Dumb PWA: paint protocol, store display prefs, speak WS. Settings/wizard render from capabilities. All styling comes from the tokens at the top of `web/src/styles.css` (spacing, type, radii, elevation, motion) — no loose `rem`/`px` in component rules. Icons come from `web/src/components/Icon.tsx`, never inline SVG. Desktop is a persistent rail; below 1024px it is a bottom tab bar plus a thread sheet. |
| `data/` | Runtime state (`GLASSYS_DATA_DIR`). Not committed. |

Package manager: **pnpm** (same as the rest of the GitHub workspace). `packageManager` is pinned in the root `package.json`. Do not add a `package-lock.json` or use `npm install`.

## Protocol and transport

- Contract: `protocolVersion` major `1`. Client rejects incompatible majors.
- Runs go over **WebSocket with keepalive** (ping 15–30s, default 25). No SSE / long HTTP. Proxies and Cloudflare cut idle HTTP around ~100s; agent runs last minutes.
- Client: `hello`, `auth`, `user.message` (optional `id`, `attachments`), `run.cancel`, `queue.cancel`, `thread.new` / `thread.switch`, `config.get` / `config.set`, `ping`. The PWA creates and switches threads over HTTP (`POST /api/threads`, `POST /api/threads/:id/switch`, `DELETE /api/threads/:id`). WS `thread.new` / `thread.switch` stay for non-PWA clients; both paths hit the same runtime and broadcast `transcript.snapshot` and `threads.snapshot`.
- Server: `thinking.*`, `text.delta`, `tool.*` (`tool.end` with `denied: true` when Auto-review or auto-run off blocked a call), `run.*` (including optional `run.usage`), `user.retracted`, `session` (`threadId`, `runStartedAt`), `queue.snapshot` (live, not persisted), `threads.snapshot` after new/switch/delete/archive, redacted `config`, `config.error`, plus `hello.ok` / `hello.incompatible`, `auth.ok` / `auth.error`, and `transcript.snapshot` for reconnect.
- Paint text from the first token. Never wait for `run.done` to start rendering.
- `GET /api/models?adapter=` returns `{ models, source: "live" | "fallback", error? }`. Never silently swap in Cursor’s static catalog for another adapter.
- Runtime must not call `adapter.resume` when `capabilities.resume` is false (keep the Glassys transcript; create on the next send).
- `session.resumeOnStart` only governs **gateway process start** (`initRuntime`). Switching threads or the next `send` always resumes when the adapter can and a usable `agentId` exists. `resumeOnStart: false` must not create a new vendor session after `switchLiveThread`.
- Image attachments are copied into `$cwd/.glassys-uploads/<id>-<name>` (that directory is gitignored) so a sandboxed agent can read them. Adapters that accept native image parts also send bytes. If the operator sent attachment ids and **none** resolve, the run errors (`Attachments could not be read`).
- `GET /api/adapters` includes `available: { ok } | { ok: false, error }`. Do not `config.set` an adapter with `ok: false`, and do not complete onboarding with one.

## Cursor adapter traps

- Local runtime only. Always pass `local: { cwd }`. Do not accidentally get cloud.
- Always `wait()`. Always dispose on shutdown (`close` / asyncDispose).
- Distinguish `CursorAgentError` (never started) from `result.status === "error"` (ran and failed).
- Log `agentId` + `run.id`. Never log API keys or bulky file contents.
- Headless SDK **does not pause for human tool approval**. `autoRun: false` maps to `local.autoReview: true` (classifier **denies**, it does not prompt). Sandbox maps to `local.sandboxOptions.enabled`.
- Persist Glassys `agentId` and resume with the same optional `apiKey` (omit when empty so the SDK can use `CURSOR_API_KEY` or `~/.cursor/sdk/auth.json`), `model`, `model.params`, `cwd`, `settingSources`, sandbox, and store. Inline MCP does not survive resume; v1 uses workspace/user files + `settingSources` (default `project` + `user`).
- Model is required for local. List via `Cursor.models.list()` without requiring a Glassys-stored key. Default selection is Cursor’s flagship `grok-4.6` with effort `xhigh` (Extra high). Live catalog supplies other models and variants. Empty/failed list → Cursor static fallback (Grok first, then Composer, Auto) **and** surface `source: "fallback"` in the PWA.
- Cursor credentials: do **not** require an API key. Resolution is explicit `apiKey` → `CURSOR_API_KEY` → `Cursor.auth.login()` store. Cursor IDE app login is a different store.
- Changing model is a sticky next `send`. Changing cwd / sandbox / `settingSources` / adapter archives the live Glassys transcript and creates a new agent (new thread). Warn in the UI. An explicit new thread with the same cwd does the same.
- Do not single-file-bundle `@cursor/sdk` on Node. Keep `node_modules`. Node `>=22.13`.
- Store: `JsonlLocalAgentStore` under `$GLASSYS_DATA_DIR/cursor-store`. Other adapters use `$GLASSYS_DATA_DIR/<id>-store`. The live Glassys transcript is `$GLASSYS_DATA_DIR/threads/<threadId>/transcript.jsonl` (legacy `transcript.jsonl` is migrated on first run). The PWA replays that file; the SDK store is for model resume.

## GitHub CI after push

After any `git push` to GitHub (`main` or a PR branch), **do not end the session until workflow `ci` is green**. Watch it (`gh run watch --exit-status`, or `gh pr checks --watch` on a PR). If it fails, read the failing job log, fix, commit, push, and wait again. Do this without being asked. Never skip hooks, never force-push to `main`, and never change the workflow just to make a failure pass.

## Deploy

Host gateway only. The documented installer (`scripts/install.sh` or `git clone … && cd glassys && pnpm install && pnpm run service:install`) writes a user systemd unit or LaunchAgent; PWA served by the gateway; operator's proxy. Uninstall: `cd glassys && pnpm run service:uninstall`. Foreground `pnpm start` is for debugging.

Recipes (Caddy, Cloudflare Tunnel + Access) are appendices. Glassys does not depend on Cloudflare.

## Out of scope until asked

Marketing site, Glassys cloud accounts, multi-tenant, billing, plugin store, native iOS/Android (PWA is the client), PTY as UI, Docker / Compose, polishing Windows first (do not block it).
