# Security Policy

## Supported versions

Security fixes go to `main`. There are no backports to older tags until there is a tagged release.

| Version | Supported |
| --- | --- |
| `main` | yes |
| Anything else | no |

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's private vulnerability reporting: [Security tab → Report a vulnerability](https://github.com/KN990x/Glassys/security/advisories/new).

Include:

- Affected commit or version
- What an attacker gains, and what access they need to start
- Steps to reproduce against a local install
- Config that matters, with placeholders instead of real keys, passwords, or hostnames

This is a hobby project. Expect a few days for a first reply. A fix ships on `main` (and in a tagged release when those exist), with credit unless you prefer to stay anonymous.

## Scope

Glassys is a **single-operator, self-hosted** gateway. These are design decisions, not vulnerabilities:

- **One operator account.** Created in the setup wizard (scrypt hash in `$GLASSYS_DATA_DIR/secrets.json`, mode `0600`). There are no roles.
- **The setup wizard is reachable until it is completed.** Whoever can hit the bind first claims the instance. Complete setup immediately. Do not publish the port before that. A report that the wizard can be re-run after a password exists *is* in scope.
- **No password recovery.** Deleting the operator hash from `secrets.json` (or the data volume) reopens setup. That already requires filesystem access to the host.
- **Operator auth is always on**, including behind Cloudflare Access or another identity proxy. Edge auth is extra, not a replacement.
- **`edgeAuth: header` is only as strong as the proxy in front.** If the proxy does not strip the identity header, a client can send it. Misconfiguration of that mode is a deployment issue; a report that Glassys accepts the header when the proxy failed to strip it *is* in scope only if Glassys is what failed to document the requirement.
- **Plain HTTP on localhost is the default.** `Secure` cookies follow `x-forwarded-proto` / `publicUrl` when you terminate TLS. Exposing `0.0.0.0` without TLS is a deployment choice.
- **Auto-run plus a host workspace is operator access to that machine.** Sandbox / auto-run toggles are visible in Settings when the adapter supports them. Cursor’s headless SDK cannot pause for a human OK; auto-run off uses Auto-review (deny), not a prompt. ACP with auto-run off denies file writes and terminal create.
- **The JWT in `sessionStorage` is reachable to XSS in the PWA.** Treat XSS in `web/` as in scope. Do not treat “the token is also in sessionStorage” by itself as a finding.
- **`GET /api/auth/status` and `GET /health` are unauthenticated** (whether setup is done; name/version/protocol). That is intentional.

Reports that require the operator password, adapter API keys, or a shell on the host are out of scope.

## Deployment reminders

- Never commit `.env`, `secrets.json`, or `$GLASSYS_DATA_DIR`.
- Prefer Cursor SDK login (`~/.cursor/sdk/auth.json`) or the matching CLI on the host over storing an API key. Cursor IDE / cursor-cli login is a different store.
- Default bind is `127.0.0.1`. Binding `0.0.0.0` is explicit in `config.yaml` / `GLASSYS_BIND`.
- Put a TLS reverse proxy in front if the PWA is reachable off the LAN. Keep WebSocket idle timeouts high (`/ws`); agent runs last minutes.
- Rotate the operator password from Settings. That bumps `jwtEpoch` and signs other sessions out.
