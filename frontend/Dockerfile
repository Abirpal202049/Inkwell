# syntax=docker/dockerfile:1
# Frontend image — Next.js standalone output (next.config.ts sets
# output: "standalone" + outputFileTracingRoot at the monorepo root).
# Build context is the REPO ROOT (see docker-compose.prod.yml).
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN npm ci --workspace frontend

COPY frontend frontend

# NEXT_PUBLIC_* is inlined into the client bundle at build time — this must
# be the PUBLIC WebSocket URL (wss://<domain>/doc), passed by compose/CI.
ARG NEXT_PUBLIC_COLLAB_WS_URL
ENV NEXT_PUBLIC_COLLAB_WS_URL=$NEXT_PUBLIC_COLLAB_WS_URL
# Server-side rewrite target for /api/* — the backend service on the
# compose network. Serialized into the standalone server at build time.
ARG BACKEND_URL=http://backend:4000
ENV BACKEND_URL=$BACKEND_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build --workspace frontend

FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# With outputFileTracingRoot at the repo root, the standalone folder mirrors
# the monorepo layout: server.js lives under frontend/.
COPY --from=builder --chown=node:node /app/frontend/.next/standalone ./
COPY --from=builder --chown=node:node /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder --chown=node:node /app/frontend/public ./frontend/public

EXPOSE 3000
USER node
CMD ["node", "frontend/server.js"]
