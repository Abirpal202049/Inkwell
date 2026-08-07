# Inkwell backend — build from the REPO ROOT so the shared frontend/lib
# files are in context:
#   docker build -f backend/Dockerfile -t inkwell-backend .
FROM node:22-alpine

WORKDIR /repo

# Workspace manifests first for layer caching.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace backend --include-workspace-root=false --ignore-scripts

# Shared client/server contract files (constants + zod schemas).
COPY frontend/lib/constants.ts frontend/lib/constants.ts
COPY frontend/lib/schemas frontend/lib/schemas

COPY backend backend
RUN cd backend && npx prisma generate

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

WORKDIR /repo/backend
CMD ["npx", "tsx", "src/server.ts"]
