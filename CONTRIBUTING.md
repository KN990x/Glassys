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

## Layout

| Path | Role |
| --- | --- |
| `protocol/` | UI protocol. No SDK types. |
| `adapters/contract/` | `Adapter` interface |
| `adapters/<id>/` | One package per CLI/SDK |
| `gateway/` | Auth, WebSocket, queue, static PWA |
| `web/` | Dumb PWA |
| `docs/deploy/` | Host (A), Compose (B), Caddy, Cloudflare |

`adapters/cursor` is the only package that may import `@cursor/sdk`.

## Rules

- English in code, comments, and `AGENTS.md`. The public `README.md` is bilingual (English then Spanish); keep both halves in sync.
- UI strings live in `web/src/locales/en.json` and `es.json` with the same keys (`pnpm lint` checks this).
- Do not hardcode hostnames, workspace paths, models, or reverse-proxy stacks.
- Do not commit `data/`, `.env`, `secrets.json`, or `config.yaml`. Ship `config.example.yaml` and `.env.example`.
- Bind, port, CORS, and edge auth are yaml/env only — not Settings.
- Honor `capabilities.resume` / `autoRun`. Do not advertise them if the runtime does not.
- Gemini is selectable only when `probe()` succeeds (`@google/gemini-cli-sdk` linked or published).

Read `AGENTS.md` before changing adapters or the protocol.

## Tests

`pnpm test` runs Vitest per package. Gateway tests cover onboarding, the FIFO queue, cancel, CORS, and identity. Adapter tests map streams to protocol events. Do not add live SDK e2e in CI.

## License

MIT. See [LICENSE](LICENSE).
