# Contributing

Glassys is a pnpm workspace. Node **22.13+** (see `.nvmrc`). Use the pnpm version pinned in `packageManager` (Corepack is enough: `corepack enable`).

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Day to day:

```bash
pnpm run dev
```

- PWA: Vite at `http://127.0.0.1:5173` (proxies `/api`, `/health`, `/ws` to the gateway)
- Gateway: `http://127.0.0.1:8787`

That Vite proxy is not a homelab reverse proxy. Production serves the PWA from the gateway.

Host install one-liner (README / `docs/deploy/host.md`): `curl -fsSL …/scripts/install.sh | bash` (or `git clone … && cd glassys && pnpm install && pnpm run service:install`). Uninstall: `cd glassys && pnpm run service:uninstall`. Do not hardcode a hostname or a specific user’s home in that script. Do not publish the monorepo to npm.

## Layout

| Path | Role |
| --- | --- |
| `protocol/` | UI protocol. No SDK types. |
| `adapters/contract/` | `Adapter` interface |
| `adapters/<id>/` | One package per adapter |
| `gateway/` | Auth, WebSocket, queue, static PWA |
| `web/` | Dumb PWA |
| `docs/deploy/` | Host, Caddy, Cloudflare |

`adapters/cursor` is the only package that may import `@cursor/sdk`.

## Rules

- English in code and comments. The public `README.md` is bilingual (English then Spanish); keep both halves in sync.
- UI strings live in `web/src/locales/en.json` and `es.json` with the same keys (`pnpm lint` checks this).
- Do not hardcode hostnames, workspace paths, models, or reverse-proxy stacks.
- Do not commit `data/`, `.env`, `secrets.json`, or `config.yaml`. Ship `config.example.yaml` and `.env.example`.
- Bind, port, CORS, and edge auth are yaml/env only — not Settings.
- Honor `capabilities.resume` / `autoRun`. Do not advertise them if the runtime does not.
- Gemini is selectable only when `probe()` succeeds (`@google/gemini-cli-sdk` linked or published).

Before changing adapters or the protocol:

- `protocol/` is versioned (`protocolVersion` major `1`). Changes are additive; the client rejects an incompatible major.
- Each adapter imports only its own vendor SDK, through its local runtime (SDK or ACP), never print-mode CLI output.
- Runs travel over the WebSocket with keepalive, never SSE or long HTTP. Paint text from the first token.
- Host views (`GET /api/host/*`) only read. An action in them drafts a prompt for the agent; do not add an endpoint that changes the host.

## Tests

`pnpm test` runs Vitest per package. Gateway tests cover onboarding, the FIFO queue, cancel, CORS, and identity. Adapter tests map streams to protocol events. Do not add live SDK e2e in CI.

## License

MIT. See [LICENSE](LICENSE).
