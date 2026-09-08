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
- Cursor SDK login on that host (`Sign in with Cursor SDK` / `Cursor.auth.login()`), **or** optional `CURSOR_API_KEY` for CI or an override. **cursor-cli, cursor-agent, and Cursor IDE login are a different store** and do not authenticate Glassys. The wizard shows a login URL if the host has no display (Linux systemd, SSH, phone).
- Other adapters: the matching CLI/SDK on the host (`claude`, `opencode`, `gemini`, `codex`) and optional `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `CODEX_API_KEY`. The Gemini adapter talks to `@google/gemini-cli-sdk` when it is installed or linked; that package is not on npm yet, so Gemini stays visible in the wizard but **not selectable** until it is.

### Cursor credentials vs cursor-cli

Glassys talks to `@cursor/sdk` (`Agent.create` / `resume` / `send`). Credential order: optional API key in Glassys secrets → `CURSOR_API_KEY` → `~/.cursor/sdk/auth.json` (only keys minted by `Cursor.auth.login()`).

| Already on the machine | What to do |
| --- | --- |
| Only Cursor IDE or `cursor-cli` / `cursor-agent` signed in | Sign in with **Cursor SDK** in the wizard, or paste a key from [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations). The CLI can stay installed; it is not reused. |
| Linux desktop, gateway in the foreground (`pnpm start`) | “Sign in with Cursor SDK” may open a browser. If it does not, open the URL the PWA shows. |
| `systemd --user` (`pnpm run service:install`) | The unit has `HOME` but often no `DISPLAY`. Use the URL in the PWA, or set `CURSOR_API_KEY` on the service. Linger does not give a display. |
| SSH / headless / PWA on a phone | Open the URL in the browser you are looking at. Do not wait for a browser on the server. |
| Existing `~/.cursor/sdk/auth.json` | Works if the service `HOME` is that user and no bad `CURSOR_API_KEY` overrides it. |
| systemd `User=glassys` | That account’s `$HOME` is a different `auth.json`. Log in as that user or use env/secrets. |
| SDK key expired (~90 days) | Sign in with the SDK again or rotate the dashboard key. |
| CLI and Glassys on the same `cwd` | Independent credentials. Do not run two auto-run agents on the same files at once. |

`settingSources` (default project + user) can load **rules** from `~/.cursor`; it does not copy IDE tokens.

## Quick start

Install on the machine the agent should operate (git, your files).

```bash
git clone https://github.com/KN990x/Glassys.git glassys && cd glassys && pnpm install && pnpm run service:install
```

Needs Node.js **22.13+** and pnpm (Corepack: `corepack enable`). That one line clones, installs, builds if needed, and starts a **user service** (launchd on macOS, systemd --user on Linux). Closing the terminal does not stop Glassys. Open `http://127.0.0.1:8787` (or `GLASSYS_PORT`) and complete the wizard (operator password, adapter, absolute workspace path, **Cursor SDK** sign-in on the host — not cursor-cli). An API key is optional. The PWA will not enter chat until onboarding is done.

If you are already inside the repo: `pnpm install && pnpm run service:install`.

```bash
# status
cd glassys && pnpm run service:status

# uninstall (stops the service; does not delete the clone or data/)
cd glassys && pnpm run service:uninstall
```

Foreground (blocks the terminal): `pnpm run build && pnpm start`. Default bind is **localhost**. Put Caddy, Traefik, Nginx Proxy Manager, or Cloudflare Tunnel in front if you need a public URL. See [docs/deploy/host.md](docs/deploy/host.md).

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

Secrets (optional per-adapter API keys, operator password hash, JWT secret) live in environment variables or `$GLASSYS_DATA_DIR/secrets.json` (gitignored). The UI can show **configured / rotate**, never the full key again. Host installs should prefer Cursor SDK login (`~/.cursor/sdk/auth.json`) over storing a key. cursor-cli / IDE login is a different store.

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
| `docs/deploy/` | Host, Caddy, Cloudflare appendix |

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
- Login del SDK de Cursor en ese host (`Sign in with Cursor SDK` / `Cursor.auth.login()`), **o** `CURSOR_API_KEY` opcional para CI o un override. **cursor-cli, cursor-agent y el login del IDE son otro almacén** y no autentican Glassys. El asistente muestra una URL de login si el host no tiene display (systemd en Linux, SSH, teléfono).
- Otros adaptadores: el CLI/SDK correspondiente en el host (`claude`, `opencode`, `gemini`, `codex`) y opcionalmente `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `CODEX_API_KEY`. El adaptador Gemini habla con `@google/gemini-cli-sdk` cuando está instalado o enlazado; ese paquete aún no está en npm, así que Gemini se ve en el asistente pero **no se puede elegir** hasta entonces.

### Credenciales de Cursor vs cursor-cli

Glassys habla con `@cursor/sdk` (`Agent.create` / `resume` / `send`). Orden: API key opcional en secrets de Glassys → `CURSOR_API_KEY` → `~/.cursor/sdk/auth.json` (solo keys acuñadas por `Cursor.auth.login()`).

| Ya está en la máquina | Qué hacer |
| --- | --- |
| Solo IDE o `cursor-cli` / `cursor-agent` con sesión | Inicia sesión con el **SDK de Cursor** en el asistente, o pega una key de [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations). El CLI puede seguir instalado; no se reutiliza. |
| Desktop Linux, gateway en primer plano (`pnpm start`) | “Sign in with Cursor SDK” puede abrir el navegador. Si no, abre la URL que muestra la PWA. |
| `systemd --user` (`pnpm run service:install`) | La unidad tiene `HOME` pero a menudo no `DISPLAY`. Usa la URL en la PWA, o `CURSOR_API_KEY` en el servicio. Linger no da un display. |
| SSH / headless / PWA en el teléfono | Abre la URL en el navegador que estás mirando. No esperes un navegador en el servidor. |
| Ya existe `~/.cursor/sdk/auth.json` | Vale si el `HOME` del servicio es ese usuario y no hay un `CURSOR_API_KEY` malo que lo pise. |
| systemd `User=glassys` | Otro `$HOME` → otro `auth.json`. Entra como ese usuario o usa env/secrets. |
| Key del SDK caducada (~90 días) | Vuelve a iniciar sesión con el SDK o rota la key del dashboard. |
| CLI y Glassys sobre el mismo `cwd` | Credenciales independientes. No lances dos agentes auto-run a la vez sobre los mismos archivos. |

`settingSources` (por defecto project + user) puede cargar **reglas** de `~/.cursor`; no copia tokens del IDE.

## Arranque rápido

Instálalo en la máquina que el agente debe operar (git, tus archivos).

```bash
git clone https://github.com/KN990x/Glassys.git glassys && cd glassys && pnpm install && pnpm run service:install
```

Hace falta Node.js **22.13+** y pnpm (Corepack: `corepack enable`). Esa línea clona, instala, construye si hace falta y arranca un **servicio de usuario** (launchd en macOS, systemd --user en Linux). Cerrar la terminal no para Glassys. Abre `http://127.0.0.1:8787` (o `GLASSYS_PORT`) y completa el asistente (contraseña de operador, adaptador, ruta absoluta del workspace, login del **SDK de Cursor** en el host — no cursor-cli). La API key es opcional. La PWA no entra al chat hasta terminar el onboarding.

Si ya estás dentro del repo: `pnpm install && pnpm run service:install`.

```bash
# estado
cd glassys && pnpm run service:status

# desinstalar (para el servicio; no borra el clone ni data/)
cd glassys && pnpm run service:uninstall
```

En primer plano (bloquea la terminal): `pnpm run build && pnpm start`. El bind por defecto es **localhost**. Pon Caddy, Traefik, Nginx Proxy Manager o Cloudflare Tunnel delante si necesitas una URL pública. Véase [docs/deploy/host.md](docs/deploy/host.md).

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

Los secretos (API keys opcionales por adaptador, hash de la contraseña, secreto JWT) viven en variables de entorno o `$GLASSYS_DATA_DIR/secrets.json` (gitignored). La UI puede mostrar **configurado / rotar**, nunca la clave completa otra vez. En el host, preferible el login del SDK de Cursor (`~/.cursor/sdk/auth.json`) a guardar una key. El login de cursor-cli / IDE es otro almacén.

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
| `docs/deploy/` | Host, Caddy, apéndice Cloudflare |

## Licencia

MIT. Véase [LICENSE](LICENSE).
