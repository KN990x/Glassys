# syntax=docker/dockerfile:1
FROM node:22.23-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.14.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY protocol/package.json protocol/
COPY adapters/contract/package.json adapters/contract/
COPY adapters/cursor/package.json adapters/cursor/
COPY adapters/claude/package.json adapters/claude/
COPY adapters/opencode/package.json adapters/opencode/
COPY adapters/gemini/package.json adapters/gemini/
COPY adapters/codex/package.json adapters/codex/
COPY adapters/acp/package.json adapters/acp/
COPY gateway/package.json gateway/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build
RUN pnpm --filter @glassys/gateway deploy --prod --legacy /out

FROM node:22.23-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV GLASSYS_DATA_DIR=/data
ENV GLASSYS_WEB_DIR=/app/web/dist
ENV GLASSYS_BIND=0.0.0.0
COPY --from=build /out /app
COPY --from=build /app/web/dist /app/web/dist
RUN mkdir -p /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
