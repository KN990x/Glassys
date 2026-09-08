# Manual check after a clean install (Linux or macOS, Node 22.13+).

1. `git clone https://github.com/KN990x/Glassys.git glassys && cd glassys && pnpm install && pnpm run service:install` (already in the repo: `pnpm install && pnpm run service:install`; foreground: `pnpm run build && GLASSYS_DATA_DIR=./data node gateway/dist/index.js`)
2. Open the PWA on localhost. Complete operator password + adapter + absolute cwd. For Cursor, sign in with the **Cursor SDK** (URL in the PWA if no host browser) or set an API key. Being logged into cursor-cli / the IDE is not enough. The wizard will not finish Cursor without one of those.
3. First message: thinking, tools, diffs, and text stream from the first token. Cursor default is Grok 4.6 Extra high when that catalog is live; otherwise the PWA shows a short fallback warning **below** the model picker (not overlapping it).
4. Second message in the same thread (resume / same agentId).
5. Cancel an in-flight run. Running tool cards close. A queued follow-up message should still run afterward.
6. Leave a run going past 100s; the WebSocket must stay up (keepalive).
7. Change model in the composer; next message still works (same thread). Change cwd or adapter; UI warns that a new thread starts.
8. Restart the gateway process; reopen the PWA; the thread snapshot and agent resume still work.
9. `pnpm test` (protocol, adapters, gateway, web) is green.
10. Bind `0.0.0.0` with an empty origin allowlist: a PWA Origin whose host matches the request `Host` header must connect. Changing cwd or adapter clears the chat transcript in the UI. WebSocket clients with **no Origin** (non-browser) are allowed.

Cursor is the golden path for steps 4, 7, and 8. Other adapters must not advertise `source: "live"` unless they listed models from the runtime, and must not advertise `resume` / `autoRun` unless the runtime honors them. Gemini, Codex, and ACP use a static catalog (`liveCatalog: false`); that is not a failure. Gemini’s SDK (`@google/gemini-cli-sdk`) is not published on npm yet — `GET /api/adapters` marks it `available.ok: false`, the wizard/Settings radio is disabled, and `config.set` rejects selecting it or completing onboarding with it. Link the SDK on the host to make Gemini selectable.

Keepalive is clamped to 15–30 seconds (default 25) and is read per WebSocket connection. After a reconnect during a run, the PWA must not stay stuck on Working: the handshake ends with a current `session` after `transcript.snapshot`. The runtime does not call `adapter.resume` when `capabilities.resume` is false. ACP does not advertise resume until the child agent is known to support it. ACP `autoRun: false` denies `fs/write_text_file` and `terminal/create`.
