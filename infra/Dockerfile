# syntax=docker/dockerfile:1
# HTTP server image. Build from the repo root: docker build -f infra/Dockerfile .
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/http-server/package.json packages/http-server/
COPY packages/stdio/package.json packages/stdio/
RUN npm ci --ignore-scripts
COPY packages packages
COPY scripts/copy-assets.mjs scripts/
RUN npx tsc -b packages/core packages/http-server && node scripts/copy-assets.mjs \
 && npm prune --omit=dev --ignore-scripts

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/packages/core/package.json packages/core/
COPY --from=build --chown=node:node /app/packages/core/dist packages/core/dist
COPY --from=build --chown=node:node /app/packages/http-server/package.json packages/http-server/
COPY --from=build --chown=node:node /app/packages/http-server/dist packages/http-server/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "packages/http-server/dist/index.js"]
