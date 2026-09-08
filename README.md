<p align="center">
  <img src="./docs/assets/logo.svg" alt="Glassys" width="120"/>
</p>

<div align="center">

<h3>
  <a href="#english">English</a> | <a href="#español">Español</a>
</h3>

</div>

<p align="center">
  <a href="https://github.com/KN990x/Glassys/stargazers">
    <img src="https://img.shields.io/github/stars/KN990x/Glassys?style=social" alt="GitHub stars"/>
  </a>
  &nbsp;
  <a href="https://github.com/KN990x/Glassys/issues">
    <img src="https://img.shields.io/github/issues/KN990x/Glassys" alt="GitHub issues"/>
  </a>
  &nbsp;
  <a href="./LICENSE">
    <img src="https://img.shields.io/github/license/KN990x/Glassys" alt="License"/>
  </a>
  &nbsp;
  <img src="https://img.shields.io/github/last-commit/KN990x/Glassys" alt="Last commit"/>
</p>

<p align="center">
  <a href="https://github.com/KN990x/Glassys/actions/workflows/ci.yml">
    <img src="https://github.com/KN990x/Glassys/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"/>
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/frontend-React%20%2B%20Vite-61DAFB?logo=react&logoColor=white" alt="React + Vite"/>
  &nbsp;
  <img src="https://img.shields.io/badge/backend-Node.js-339933?logo=nodedotjs&logoColor=white" alt="Node.js"/>
  &nbsp;
  <img src="https://img.shields.io/badge/pkg-pnpm-F69220?logo=pnpm&logoColor=white" alt="pnpm"/>
  &nbsp;
  <img src="https://img.shields.io/badge/infra-Docker-2496ED?logo=docker&logoColor=white" alt="Docker"/>
</p>

<p align="center">
  <img src="./docs/assets/chat.png" alt="Glassys chat: thinking, tools, and streamed text" width="100%">
</p>

<a id="english"></a>

# Glassys

Glassys is a **face** — a PWA with IDE-chat UX — over **local CLI coding agents**. It is not the agent. It does not infer and has no personality. It translates a runtime stream into a stable UI protocol and serves it in the browser or on a phone.

Analogy: Open WebUI is to Ollama what Glassys is to Cursor CLI, Claude Code, OpenCode, and similar tools.

- **Audience:** anyone who already runs a coding agent from a CLI/SDK and wants the same chat feel on a phone or another machine, with a persistent thread.
- **UI language:** English by default; Spanish (`es`) is available in Settings.
- **Distribution:** self-hosted. Every operator runs their own instance. Not a Glassys SaaS.
- **Adapters:** Cursor (`@cursor/sdk` local, not `cursor-agent --print`), Claude Code, OpenCode, Gemini CLI, Codex CLI, plus a generic ACP host. Same UI protocol. Cursor, Claude, and OpenCode list models from the live CLI catalog; Gemini, Codex, and ACP use a documented static fallback.
- **v1:** one profile / one agent / one thread / one run at a time (FIFO queue).

## What it is not

- Not a wrapper of `cursor-agent -p --output-format stream-json` (print mode suppresses thinking).
- Not OpenClaw, Open WebUI, or a PTY/xterm product.
- Not an editor: no Apply/Reject. The agent writes the disk; Glassys shows thinking, tools, and diffs.
- Not a Cloudflare product. Tunnel and Access are optional recipes.

## Requirements

- Node.js **22.13+** (`.nvmrc`)
- **pnpm** 11.14+ (this repo is a pnpm workspace; do not use npm)
- A git workspace on the machine that will run the agent
- Cursor SDK login on that host (`Sign in with Cursor` / `Cursor.auth.login()`), **or** optional `CURSOR_API_KEY` for Docker/CI
- Other adapters: the matching CLI/SDK on the host (`claude`, `opencode`, `gemini`, `codex`) and optional `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `CODEX_API_KEY`. The Gemini adapter talks to `@google/gemini-cli-sdk` when it is installed or linked; that package is not on npm yet, so Gemini stays visible in the wizard but **not selectable** until it is.

## Quick start (host gateway — mode A)

Recommended if the agent should operate the real machine (Docker, git, your files).

```bash
git clone https://github.com/KN990x/Glassys.git glassys
cd glassys
pnpm install
pnpm run build
export GLASSYS_DATA_DIR="$PWD/data"
node gateway/dist/index.js
```

Open `http://127.0.0.1:8787`, complete the wizard (operator password, adapter, absolute workspace path, CLI sign-in on the host). An API key is optional. The PWA will not enter chat until onboarding is done.

Default bind is **localhost**. Put Caddy, Traefik, Nginx Proxy Manager, or Cloudflare Tunnel in front if you need a public URL. See [docs/deploy/host.md](docs/deploy/host.md).

## Compose (mode B)

For trying Glassys or a mounted workspace. This is **not** the same as mode A: Docker-in-Docker, UID mapping, and the Docker socket are your problem to understand. Host `127.0.0.1` is not reachable from a sidecar container. v1 builds the image locally (no published GHCR image yet).

```bash
cp .env.example .env
# set GLASSYS_WORKSPACE (absolute host path). CURSOR_API_KEY is optional; see docs/deploy/compose.md to mount a host SDK login store.
docker compose up --build
```

Details: [docs/deploy/compose.md](docs/deploy/compose.md).

## Development

```bash
pnpm install
pnpm run dev
```

- PWA: Vite on `http://127.0.0.1:5173` (dev-only proxy: `/api`, `/health`, `/ws` → gateway `:8787`)
- Gateway: `http://127.0.0.1:8787`

That Vite proxy is **not** a homelab reverse proxy. In production the PWA is served by the gateway.

```bash
pnpm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Configuration

Non-secrets live in `$GLASSYS_DATA_DIR/config.yaml` (created from defaults on first run). See [config.example.yaml](config.example.yaml). In-app Settings writes locale, theme, agent, display, and session. Bind, port, allowed origins, and edge auth are yaml (or env) only.

Secrets (optional per-adapter API keys, operator password hash, JWT secret) live in environment variables or `$GLASSYS_DATA_DIR/secrets.json` (gitignored). The UI can show **configured / rotate**, never the full key again. Host installs should prefer CLI/SDK login over storing a key.

## Security

Glassys with auto-run and a host workspace is **operator access to that machine**. Read [SECURITY.md](SECURITY.md).

- Built-in operator auth is always on, even behind Access.
- Optional Cloudflare Access JWT (or a documented identity header).
- Sandbox and auto-run are visible in Settings. Cursor’s headless SDK cannot pause for a human OK; “auto-run off” uses Auto-review, which **denies** risky calls. ACP with auto-run off denies file writes and terminals.
- Default bind is `127.0.0.1`. CORS / origin allowlist comes from config.
- Runs use **WebSocket + keepalive** (default 25s), not SSE. Proxies often cut idle HTTP around 100s; agent runs last minutes.

## Layout

| Path | Role |
| --- | --- |
| `protocol/` | Versioned UI protocol |
| `gateway/` | Auth, WebSocket, queue, static PWA, adapter registry |
| `adapters/contract/` | Adapter interface |
| `adapters/cursor/` | Only package that imports `@cursor/sdk` |
| `adapters/claude/` | Claude Agent SDK |
| `adapters/opencode/` | OpenCode |
| `adapters/gemini/` | Gemini CLI |
| `adapters/codex/` | Codex CLI |
| `adapters/acp/` | Generic ACP host |
| `web/` | Dumb PWA |
| `docs/deploy/` | Mode A, mode B, Caddy, Cloudflare appendix |

## License

MIT. See [LICENSE](LICENSE).

---

<a id="español"></a>

# Glassys

Glassys es una **cara** — una PWA con UX de chat de IDE — sobre **agentes de código CLI locales**. No es el agente. No infiere y no tiene personalidad. Traduce un stream de runtime a un protocolo de UI estable y lo sirve en el navegador o en el teléfono.

Analogía: Open WebUI es a Ollama lo que Glassys es a Cursor CLI, Claude Code, OpenCode y herramientas similares.

- **Audiencia:** quien ya ejecuta un agente de código desde un CLI/SDK y quiere el mismo chat en el teléfono u otra máquina, con un hilo persistente.
- **Idioma de la UI:** inglés por defecto; español (`es`) en Ajustes.
- **Distribución:** self-hosted. Cada operador monta la suya. No hay SaaS de Glassys.
- **Adaptadores:** Cursor (`@cursor/sdk` local, no `cursor-agent --print`), Claude Code, OpenCode, Gemini CLI, Codex CLI, más un host ACP genérico. El mismo protocolo de UI. Cursor, Claude y OpenCode listan modelos del catálogo vivo del CLI; Gemini, Codex y ACP usan un fallback estático documentado.
- **v1:** un perfil / un agente / un hilo / un run a la vez (cola FIFO).

## Qué no es

- No es un wrapper de `cursor-agent -p --output-format stream-json` (el print mode oculta el thinking).
- No es OpenClaw, Open WebUI ni un producto PTY/xterm.
- No es un editor: no hay Apply/Reject. El agente escribe el disco; Glassys muestra thinking, tools y diffs.
- No es un producto de Cloudflare. Tunnel y Access son recetas opcionales.

## Requisitos

- Node.js **22.13+** (`.nvmrc`)
- **pnpm** 11.14+ (este repo es un workspace pnpm; no uses npm)
- Un workspace git en la máquina que ejecutará el agente
- Login del SDK de Cursor en ese host (`Sign in with Cursor` / `Cursor.auth.login()`), **o** `CURSOR_API_KEY` opcional para Docker/CI
- Otros adaptadores: el CLI/SDK correspondiente en el host (`claude`, `opencode`, `gemini`, `codex`) y opcionalmente `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `CODEX_API_KEY`. El adaptador Gemini habla con `@google/gemini-cli-sdk` cuando está instalado o enlazado; ese paquete aún no está en npm, así que Gemini se ve en el asistente pero **no se puede elegir** hasta entonces.

## Arranque rápido (gateway en el host — modo A)

Recomendado si el agente debe operar la máquina real (Docker, git, tus archivos).

```bash
git clone https://github.com/KN990x/Glassys.git glassys
cd glassys
pnpm install
pnpm run build
export GLASSYS_DATA_DIR="$PWD/data"
node gateway/dist/index.js
```

Abre `http://127.0.0.1:8787`, completa el asistente (contraseña de operador, adaptador, ruta absoluta del workspace, login del CLI en el host). La API key es opcional. La PWA no entra al chat hasta terminar el onboarding.

El bind por defecto es **localhost**. Pon Caddy, Traefik, Nginx Proxy Manager o Cloudflare Tunnel delante si necesitas una URL pública. Véase [docs/deploy/host.md](docs/deploy/host.md).

## Compose (modo B)

Para probar Glassys o un workspace montado. **No** es lo mismo que el modo A: Docker-in-Docker, mapeo de UID y el socket de Docker son tu problema. El `127.0.0.1` del host no es alcanzable desde un sidecar. En v1 la imagen se construye en local (aún no hay imagen en GHCR).

```bash
cp .env.example .env
# define GLASSYS_WORKSPACE (ruta absoluta en el host). CURSOR_API_KEY es opcional; véase docs/deploy/compose.md para montar el login del SDK del host.
docker compose up --build
```

Detalles: [docs/deploy/compose.md](docs/deploy/compose.md).

## Desarrollo

```bash
pnpm install
pnpm run dev
```

- PWA: Vite en `http://127.0.0.1:5173` (proxy solo de desarrollo: `/api`, `/health`, `/ws` → gateway `:8787`)
- Gateway: `http://127.0.0.1:8787`

Ese proxy de Vite **no** es un reverse proxy de homelab. En producción la PWA la sirve el gateway.

```bash
pnpm test
```

Véase [CONTRIBUTING.md](CONTRIBUTING.md).

## Configuración

Lo que no es secreto vive en `$GLASSYS_DATA_DIR/config.yaml` (se crea con valores por defecto en el primer arranque). Véase [config.example.yaml](config.example.yaml). Ajustes escribe locale, tema, agente, display y sesión. Bind, puerto, orígenes permitidos y edge auth son solo yaml (o env).

Los secretos (API keys opcionales por adaptador, hash de la contraseña, secreto JWT) viven en variables de entorno o `$GLASSYS_DATA_DIR/secrets.json` (gitignored). La UI puede mostrar **configurado / rotar**, nunca la clave completa otra vez. En el host, preferible el login del CLI/SDK a guardar una key.

## Seguridad

Glassys con auto-run y un workspace del host es **acceso de operador a esa máquina**. Lee [SECURITY.md](SECURITY.md).

- La autenticación de operador va siempre, también detrás de Access.
- JWT opcional de Cloudflare Access (o un header de identidad documentado).
- Sandbox y auto-run se ven en Ajustes. El SDK headless de Cursor no puede pausar para un OK humano; “auto-run off” usa Auto-review, que **deniega** llamadas arriesgadas. ACP con auto-run off deniega escrituras y terminales.
- El bind por defecto es `127.0.0.1`. CORS / allowlist de orígenes sale de la config.
- Los runs van por **WebSocket + keepalive** (25s por defecto), no SSE. Los proxies suelen cortar HTTP idle ~100s; un run del agente dura minutos.

## Estructura

| Path | Rol |
| --- | --- |
| `protocol/` | Protocolo de UI versionado |
| `gateway/` | Auth, WebSocket, cola, PWA estática, registro de adaptadores |
| `adapters/contract/` | Interfaz de adaptador |
| `adapters/cursor/` | Único paquete que importa `@cursor/sdk` |
| `adapters/claude/` | Claude Agent SDK |
| `adapters/opencode/` | OpenCode |
| `adapters/gemini/` | Gemini CLI |
| `adapters/codex/` | Codex CLI |
| `adapters/acp/` | Host ACP genérico |
| `web/` | PWA tonta |
| `docs/deploy/` | Modo A, modo B, Caddy, apéndice Cloudflare |

## Licencia

MIT. Véase [LICENSE](LICENSE).
