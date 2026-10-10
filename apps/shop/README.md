# Mise — live recipe shopping

A single-input customer experience: type a dish, watch an on-device agent shop
the ingredients in a real, logged-in Woolworths session streamed into
`@browser-ui/react`'s `<AgentBrowser>` viewport, and take over whenever you like.

## Run

```sh
# from the browser-ui repo root
pnpm dev:shop
# then open http://localhost:3000
```

`pnpm dev:shop` builds `@browser-ui/core` and `@browser-ui/react`, then starts
the Next app. The shopping engine lives in the sibling `jev-browser-use` checkout
(`SHOP_JEV_DIR` overrides its path) and requires the logged-in Chrome profile at
`jev-browser-use/.profiles/woolworths`.

| Variable                   | Default                       | Purpose                            |
| -------------------------- | ----------------------------- | ---------------------------------- |
| `SHOP_JEV_DIR`             | `../../../jev-browser-use`    | Path to the shopping engine.       |
| `SHOP_BUN_BIN`             | `bun`                         | Bun binary used to run the engine. |
| `SHOP_AGENT_BROWSER_ENTRY` | resolved from `agent-browser` | Override the streaming CLI entry.  |

## How the live path works

Woolworths blocks headless automation, so the real browser must be a headed,
logged-in session on this machine.

1. `POST /api/shop` spawns the engine
   (`bun run src/tests/10-woolworths-shop.ts <recipe>`) with `SESSION_GATE=1` and
   a free `CDP_PORT`.
2. The engine launches a Playwright persistent Chrome on the Woolworths profile
   with `--remote-debugging-port=<CDP_PORT>`, opens Woolworths, prints `##READY`,
   and waits on stdin. Playwright keeps owning the browser through its normal
   pipe; the port exists only for a second local observer.
3. The server connects `agent-browser --session … connect <CDP_PORT>`, gets the
   stream port, and returns `ws://127.0.0.1:<streamPort>` to the client.
4. The server writes `GO` to the engine, then parses its stdout into progress
   events (SSE at `/api/shop/events`) that drive the operating label.
5. `<AgentBrowser>` connects to the raw agent-browser stream and renders frames;
   "Take control" freezes the agent (`SIGSTOP`) and enables human input, "End
   session" terminates the engine and closes the browser.

Everything is local and development-only (production routes return 404). The
browser owns the machine's real Woolworths cookies; nothing is sent off-device.

### Verification mode

`SESSION_DRY=1` (set on the **engine**, or on the dev server so it is inherited)
makes a gated run drive the real browser but never touch the cart. Useful for
proving the stream plumbing without mutating a real trolley.

## Files

- `src/app/page.tsx` — the single-input experience and session states.
- `src/app/api/shop/route.ts` — start / inspect / end a session.
- `src/app/api/shop/events/route.ts` — SSE progress stream.
- `src/app/api/shop/control/route.ts` — take control / resume / end.
- `src/server/session.ts` — the orchestrator (spawn, CDP attach, cleanup).
- `src/server/progress.ts` — stdout → structured progress.
