# Multi-tenant Copilot proxy (forked from voidsteed/copilot-proxy-api, MIT).
# Runs the single-process, per-request-token entrypoint (src/cpx/main.ts) under
# Bun. No build step: Bun runs the TypeScript directly. Uses the built-in
# bun:sqlite to read the shared control-plane DB.
FROM oven/bun:1.3.14-alpine
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV CPX_PROXY_PORT=4141
EXPOSE 4141

CMD ["bun", "run", "src/cpx/main.ts"]
