# Browser UI on Vercel Sandbox

A complete remote-browser example: Chrome and `agent-browser` run inside a
Vercel Sandbox, Browser UI streams the session over an authenticated gateway,
and a user can stop the agent and take control of the same browser.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdanielsims%2Fbrowser-ui%2Ftree%2Fmain%2Fexamples%2Fvercel-sandbox&project-name=browser-ui-sandbox&repository-name=browser-ui-sandbox&env=DEMO_ACCESS_CODE&envDescription=Set%20a%20private%20code%20that%20protects%20your%20Sandbox%20and%20AI%20usage)

## How it works

1. A Next.js route creates a Node 24 Vercel Sandbox.
2. The sandbox installs Chrome, `agent-browser`, and `@browser-ui/gateway`.
3. The gateway exposes one public `wss://` route with short-lived, single-use
   viewer tickets.
4. Chat instructions run through `agent-browser chat` using the deployment's
   short-lived Vercel OIDC identity.
5. Taking control stops the active agent command before acquiring the gateway's
   exclusive viewer lease.

The Sandbox receives only a session-scoped proxy token. Vercel OIDC and AI
Gateway credentials remain in the Next.js function that proxies model traffic.

Each deployment uses only the project-scoped OIDC identity generated for the
person who deploys it. Local `.env.local` credentials are gitignored and are
never included by the Deploy Button.

The public showcase is deploy-first. Sign in with Vercel proves a visitor's
identity, but its generally available scopes do not delegate Sandbox or AI
Gateway resource permissions. Those permissions remain private beta, so the
showcase never creates infrastructure on behalf of a visitor.

The Deploy Button requires a private `DEMO_ACCESS_CODE`. Session creation fails
closed without it, preventing anonymous visitors from spending the deployment
owner's Sandbox and AI Gateway budget.

## Local development

Link the example to a Vercel project so the Sandbox SDK can obtain an OIDC token:

```sh
cd examples/vercel-sandbox
vercel link
vercel env pull .env.local
```

Local Sandbox creation is blocked by default because it spends the linked
project's Vercel resources. Explicitly opt in only when you intend to incur that
usage:

```sh
ALLOW_LOCAL_SANDBOX_USAGE=true
```

Because AI credentials stay in Next.js, local chat also needs a public tunnel
back to the local app. Set `AI_GATEWAY_PROXY_ORIGIN` to that HTTPS origin. This
is not needed on a Vercel deployment.

Vercel OIDC authenticates both Sandbox and AI Gateway. An explicit AI Gateway
key is optional if you want to use one instead:

```sh
AI_GATEWAY_API_KEY=your_key
AI_GATEWAY_MODEL=openai/gpt-5.6-luna
```

The example defaults to GPT-5.6 Luna for its tool use, speed, and lower cost.
Set `AI_GATEWAY_MODEL` to any compatible AI Gateway model to override it.

Then run:

```sh
pnpm install
pnpm dev
```

The first sandbox takes a couple of minutes to install Chrome. Each session is
isolated, expires after 10 minutes without agent or human interaction, and is
deleted when the user ends it or closes the page when the browser permits
keepalive cleanup.

## Before making it public

This is deliberately a small template and does not authenticate application
users. Add your own authentication and rate limits before deploying it at a
public URL, otherwise strangers can spend your Sandbox and AI Gateway budget.
