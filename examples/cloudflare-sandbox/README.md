# Browser UI on Cloudflare Sandbox

Run a real `agent-browser` session in an isolated Cloudflare Sandbox, stream it
through Browser UI, and use Workers AI for the browser agent.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fdanielsims%2Fbrowser-ui%2Ftree%2Fcloudflare-sandbox-preview%2Fexamples%2Fcloudflare-sandbox)

The template provisions:

- a Cloudflare Worker with static assets and a Workers AI binding;
- a Durable Object-backed Sandbox using a `standard-1` container;
- automatic placement near the request that starts the Sandbox;
- an ephemeral authenticated tunnel for the Browser UI WebSocket.

Cloudflare Sandbox requires a Workers Paid plan. The first container deployment
can take a few minutes while Cloudflare builds and provisions the image.

## Access protection

The Deploy to Cloudflare flow asks for `DEMO_ACCESS_CODE`. This is a
deployment-specific secret, not a Cloudflare credential. Visitors must enter it
before the Worker starts a Sandbox or spends Workers AI usage.

Generate a strong value with a password manager or:

```bash
openssl rand -base64 24
```

## Local development

Docker must be running because Wrangler builds and runs the Sandbox container
through Cloudflare's remote development mode. Your Cloudflare account must have
a `workers.dev` subdomain configured.

```bash
cp .dev.vars.example .dev.vars
pnpm install
pnpm dev
```

The local page remains in deploy-first showcase mode by default. To run the
container locally, add this to `.dev.vars`:

```dotenv
ALLOW_LOCAL_SANDBOX_USAGE=true
```

The `.dev.vars` file is ignored by Git and is never included by the deploy
button.

To review the deploy-first interface without connecting to Cloudflare or
starting a Sandbox:

```bash
pnpm showcase
```

Then open
[`http://localhost:3322/?preview=deploy-first`](http://localhost:3322/?preview=deploy-first).

## Deploy from the CLI

Authenticate Wrangler, then run:

```bash
pnpm deploy
```

The one-click button instead copies this isolated example into the visitor's
Git provider, configures the secret, and deploys it through Cloudflare Builds.
