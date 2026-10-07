# Example Caddyfile

This is a recipe, not a required proxy. Replace the host name and upstream port from **your** `config.yaml`.

```caddy
your.example.com {
	encode gzip
	reverse_proxy 127.0.0.1:8787
}
```

Caddy 2 handles WebSocket upgrades on the same `reverse_proxy`. Keep idle timeouts high enough for long agent runs (minutes). Glassys also sends WebSocket pings every 25s by default so frontals that kill idle HTTP around 100s do not drop the session.

If you terminate TLS elsewhere, proxy to the gateway as HTTP on localhost. Do not bind Glassys to `0.0.0.0` unless the proxy is the only public face and you understand the risk.

With Caddy on the same host, every request reaches Glassys from `127.0.0.1`. Set `network.trustProxy: true` in `config.yaml` (or `GLASSYS_TRUST_PROXY=1`) so the gateway takes the visitor's address from `X-Forwarded-For`: login limits then apply per visitor, and one bad actor cannot lock the operator out. Leave it off if the gateway is also reachable without Caddy.

Until the operator password is set, setup through Caddy asks for the one-time setup code the installer printed (also in the gateway log). Finish setup before you publish the hostname, or have the code at hand.

