FROM node:24-bookworm-slim AS node-runtime
FROM docker.io/cloudflare/sandbox:0.12.4

USER root
WORKDIR /opt/browser-ui

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules

RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
  && ln -sf /usr/local/lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
  && corepack enable \
  && corepack prepare pnpm@11.0.0 --activate \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    fonts-freefont-ttf \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo-gobject2 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libfontconfig1 \
    libfreetype6 \
    libgbm1 \
    libgdk-pixbuf-2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb-shm0 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    libxshmfence1 \
  && rm -rf /var/lib/apt/lists/*

COPY container/package.json container/pnpm-workspace.yaml ./
RUN pnpm install --prod --no-frozen-lockfile \
  && ./node_modules/.bin/agent-browser install \
  && pnpm store prune

COPY container/worker.mjs ./worker.mjs

ENV AGENT_BROWSER_ARGS="--no-sandbox,--disable-dev-shm-usage,--disable-gpu"
EXPOSE 8787
