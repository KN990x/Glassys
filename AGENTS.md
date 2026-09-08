# Glassys — agent briefing

This is the canonical project briefing. Edit this file, not `CLAUDE.md`.

## What it is

Glassys is a **face** (PWA + Node gateway) over **local CLI coding agents**. It does not infer, it has no personality, and it is not the agent. It translates a runtime stream into a stable UI protocol and serves it in a browser or phone.

Analogy: Open WebUI is to Ollama what Glassys is to Cursor CLI, Claude Code, OpenCode, and similar tools.

- Self-hosted only. Every operator runs their own instance. Not a Glassys SaaS.
- Product language: English default, UI i18n-ready (`en` + `es`). Public `README.md` is bilingual (English then Spanish). `AGENTS.md`, code comments, and UI message keys: English.
- v1: **one profile / one agent / one thread / one run at a time** (FIFO queue).

## What it is not (non-negotiable)

- Not a wrapper around `cursor-agent -p --output-format stream-json`. Print mode suppresses thinking.
- Cursor transport: `@cursor/sdk` **local** runtime — `Agent.create` / `resume` / `send` + `onDelta` + always `wait()`. Do not use Cursor-via-ACP while the SDK exists.
- Not OpenClaw, not Open WebUI, not a PTY/xterm product. A raw terminal may exist later as debug, not as the UI.
- Not an editor. No Apply/Reject on buffers. The agent writes the disk (ACP host auto-applies `fs/*` / `terminal/*` when auto-run is on; auto-run off denies writes and `terminal/create`). Glassys shows the transcript (thinking, tools, diffs).
- Do not clone Cursor (or any vendor) branding or assets.

## Configure, don't fork

Anything that changes between operators lives in:

1. In-app Settings (source of truth for locale, theme, agent, display, session). Bind, port, public URL, allowed origins, and edge auth are **not** in the PWA — edit `config.yaml` or env.
2. Server secrets (env / secret store): per-adapter API keys (`secrets.adapters.<id>`), password hash, JWT secret. UI may show configured/rotate, never the full key again. Env: `CURSOR_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` / `GOOGLE_API_KEY`, `CODEX_API_KEY` / `OPENAI_API_KEY`, `OPENCODE_API_KEY`.
3. On-disk `config.yaml` (UI reads and writes agent/display/session; network and security only via this file). Gitignore secrets. Version `config.example.yaml`.

**Never hardcode** hostnames, IPs, workspace paths, models, users, or reverse-proxy stacks. First run is an onboarding wizard; the PWA must not enter chat until it is complete. Operator auth is always on, even behind Cloudflare Access or similar.

Default bind is `127.0.0.1`. Binding `0.0.0.0` is an explicit operator choice in `config.yaml` / `GLASSYS_BIND`. Auto-run + host cwd is operator-level access to that machine — keep sandbox / auto-run visible in Settings when the adapter supports them.

`agent.options` is opaque per adapter. Cursor: `settingSources`, `sandbox`, `autoRun`. Claude: `permissionMode`, `autoRun`. ACP: `command`, `args`, `registryId`. Changing adapter / cwd / options starts a new thread. Changing model is sticky on the next `send`.

## Layout

| Path | Role |
| --- | --- |
| `protocol/` | Versioned UI protocol. Gateway and web import this. **Never** SDK/CLI types or vendor catalogs. |
| `adapters/contract/` | `Adapter` interface: `create`, `resume`, `send`, `cancel`, `listModels`, `capabilities`. |
| `adapters/cursor/` | Only package that imports `@cursor/sdk`. Owns the Cursor fallback catalog. |
| `adapters/claude/` | Claude Agent SDK. |
| `adapters/opencode/` | OpenCode local server. |
| `adapters/gemini/` | Gemini CLI SDK (`probe` until `@google/gemini-cli-sdk` is linked; wizard must not complete with it). |
| `adapters/codex/` | Codex SDK (`runStreamed` / `resumeThread`), not print-mode `exec --json`. |
| `adapters/acp/` | Generic ACP JSON-RPC host (auto-apply when auto-run is on). |
| `gateway/` | Long-lived Node process: auth, WS, queue, persistence, static PWA, adapter registry. |
| `web/` | Dumb PWA: paint protocol, store display prefs, speak WS. Settings/wizard render from capabilities. |
| `data/` | Runtime state (`GLASSYS_DATA_DIR`). Not committed. |

Package manager: **pnpm** (same as the rest of the GitHub workspace). `packageManager` is pinned in the root `package.json`. Do not add a `package-lock.json` or use `npm install`.

## Protocol and transport

- Contract: `protocolVersion` major `1`. Client rejects incompatible majors.
- Runs go over **WebSocket with keepalive** (ping 15–30s, default 25). No SSE / long HTTP. Proxies and Cloudflare cut idle HTTP around ~100s; agent runs last minutes.
- Client: `hello`, `auth`, `user.message`, `run.cancel`, `config.get` / `config.set`, `ping`.
- Server: `thinking.*`, `text.delta`, `tool.*`, `run.*`, `session`, redacted `config`, `config.error`, plus `hello.ok` / `hello.incompatible`, `auth.ok` / `auth.error`, and `transcript.snapshot` for reconnect.
- Paint text from the first token. Never wait for `run.done` to start rendering.
- `GET /api/models?adapter=` returns `{ models, source: "live" | "fallback", error? }`. Never silently swap in Cursor’s static catalog for another adapter.
- Runtime must not call `adapter.resume` when `capabilities.resume` is false (keep the Glassys transcript; create on the next send).
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
- Changing model is a sticky next `send`. Changing cwd / sandbox / `settingSources` / adapter creates a new agent (new thread). Warn in the UI.
- Do not single-file-bundle `@cursor/sdk` on Node. Keep `node_modules`. Node `>=22.13`.
- Store: `JsonlLocalAgentStore` under `$GLASSYS_DATA_DIR/cursor-store`. Other adapters use `$GLASSYS_DATA_DIR/<id>-store`. Glassys transcript (`transcript.jsonl`) is what the PWA replays; the SDK store is for model resume.

## Deploy

Document two modes; the operator chooses:

- **A — host gateway** (recommended if the agent must operate the machine): systemd/launchd, PWA served by the gateway, operator's proxy.
- **B — Compose**: mounted workspace + data. Warn about UID, Docker socket, DinD. Host `127.0.0.1` is **not** reachable from a sidecar; use host-gateway, host network, or a shared network.

Recipes (Caddy, Cloudflare Tunnel + Access) are appendices. Glassys does not depend on Cloudflare. Do not pretend A and B are equivalent.

## Out of scope until asked

Marketing site, Glassys cloud accounts, multi-tenant, billing, plugin store, native iOS/Android (PWA is the client), PTY as UI, polishing Windows first (do not block it).
