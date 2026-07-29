# Gateway Demo

Runnable single-process deployment of `@browser-ui/gateway` with separate demo
source and viewer bearer credentials. Put it behind a TLS reverse proxy or an
authenticated tunnel before connecting a physical phone; do not expose plain
`ws://` publicly.

```sh
export BROWSER_UI_SOURCE_TOKEN="$(openssl rand -hex 32)"
export BROWSER_UI_VIEWER_TOKEN="$(openssl rand -hex 32)"
export BROWSER_UI_PUBLIC_ORIGIN="https://sessions.example.com"
pnpm --filter @browser-ui/gateway-demo dev
```

The credentials are deployment inputs, not session metadata. A real product
replaces these callbacks with its Better Auth, OAuth, Nostr, or workload
identity adapter.
