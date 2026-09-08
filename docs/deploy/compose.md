# Mode B — Docker Compose

Use this to try Glassys or to point the agent at a **mounted** workspace. It is not equivalent to [host.md](host.md).

A coding agent needs the real project tree. Inside a container that means volume mounts, matching UIDs, and — if the agent should run Docker — a socket or DinD setup you must opt into. Glassys will not pretend those costs are free.

## Compose file

The repository `docker-compose.yml` builds locally (v1 does not require a published image). The image is a production slice: gateway `dist`, adapter `dist`, production `node_modules`, and the built PWA — not the TypeScript sources.

Typical env:

```bash
GLASSYS_WORKSPACE=/absolute/path/on/the/host
# Optional. Prefer CLI/SDK login on the host (mode A) over storing keys.
# CURSOR_API_KEY=cursor_...
# ANTHROPIC_API_KEY=
# GEMINI_API_KEY=
# GOOGLE_API_KEY=
# CODEX_API_KEY=
# OPENAI_API_KEY=
# OPENCODE_API_KEY=
```

To reuse a host Cursor SDK login store inside the container, mount it yourself (paths are yours). Glassys does not mount that store by default:

```yaml
volumes:
  - ${HOME}/.cursor/sdk:/root/.cursor/sdk:ro
```

Data persists in a named volume or `./data`. The wizard still asks for an **absolute path as seen inside the container** (often `/workspace` if you mount there). Do not copy a hostname from someone else’s server into the image.

## Networking trap

`127.0.0.1` on the **host** is not `127.0.0.1` inside a sidecar. If a proxy container must reach the gateway:

- put proxy and gateway on the same Compose network and use the service name, or
- use `extra_hosts: ["host.docker.internal:host-gateway"]` and bind the gateway to all interfaces **only if** you accept that exposure, or
- use host network mode on Linux.

In Compose, `GLASSYS_BIND=0.0.0.0` is set so the process listens on the container interface. The published mapping is still `127.0.0.1:8787:8787` on the host. The in-app default bind of localhost applies to **mode A**.

## What you still configure

Sandbox and auto-run belong in the in-app Settings. Bind, public URL, allowed origins, and Cloudflare Access belong in `config.yaml`, not in hardcoded compose labels for a single homelab.
