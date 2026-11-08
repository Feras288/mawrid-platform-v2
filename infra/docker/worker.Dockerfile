# syntax=docker/dockerfile:1.7
# Worker (BullMQ jobs, outbox, PDF via Chromium) + one-shot `node dist/migrate.js`. Context: repo root.
FROM node:24-bookworm-slim AS base
ENV CI=true
RUN npm install -g pnpm@11.18.0
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --config.fetch-timeout=300000 --config.fetch-retries=5 --config.network-concurrency=8
RUN pnpm --filter @platform/worker build \
 && pnpm --filter @platform/worker deploy --prod --legacy --config.node-linker=hoisted /out

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production DB_ASSETS_DIR=/app/db PLAYWRIGHT_BROWSERS_PATH=/ms-playwright WORKER_HEALTH_PORT=3101
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/worker/dist ./dist
COPY --from=build /repo/packages/db/migrations ./db/migrations
COPY --from=build /repo/packages/db/sql ./db/sql
# Headless Chromium + system libraries for PDF rendering (Arabic fonts are embedded from @fontsource)
RUN node node_modules/playwright-core/cli.js install --with-deps chromium \
 && chown -R node:node /ms-playwright /app
USER node
EXPOSE 3101
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3101/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
