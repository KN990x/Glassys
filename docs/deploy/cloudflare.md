# Appendix: Cloudflare Tunnel + Access

Glassys does **not** depend on Cloudflare. Use this only if you already want Tunnel and/or Access in front of a self-hosted gateway.

## Tunnel

Point a tunnel at the gateway bind (usually `http://127.0.0.1:8787` on the host). Enable WebSocket. Do not use SSE; Glassys already uses WebSocket with keepalive because Cloudflare and other proxies cut long HTTP around ~100s.

## Access

1. Put Access in front of the hostname.
2. In `config.yaml`, set `security.edgeAuth` to `cloudflare-access`.
3. Set `security.cloudflare.teamDomain` (the `<team>.cloudflareaccess.com` name) and `security.cloudflare.audience` (the Access APP AUD).
4. Glassys still requires its **own** operator password. Access is extra, not a replacement.

The gateway reads `Cf-Access-Jwt-Assertion` (and `CF_Authorization` cookie) and verifies it against the team JWKS.

If Access is off, Glassys does not call Cloudflare.
