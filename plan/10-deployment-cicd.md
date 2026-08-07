# Deployment & CI/CD

## Hosting Topology

| Component | Platform | Why |
|---|---|---|
| Next.js app (frontend only) | Vercel | Native Next.js 16 support, preview deployments per PR; `/api/*` rewrite proxies to the backend |
| Backend (Express REST + `@auth/express` + `ws` realtime, one process) | Fly.io (or Render) | Needs a long-lived process for persistent WebSocket connections — not compatible with Vercel's serverless model (see [01-architecture.md](01-architecture.md)) |
| PostgreSQL | Neon | Serverless Postgres with branch-per-PR support — lets CI spin up an isolated real database per pull request for RLS/integration tests instead of mocking the DB |

Local development runs Postgres via the root `docker-compose.yml`
(`npm run db:up`) so the full stack — migrations, RLS, sync — works
offline with zero cloud dependencies; Neon is production/CI only.
Note: the Vercel project's Root Directory must be set to `frontend/`.
| AI provider | Groq/Gemini API | Managed, no hosting needed |

## Environments

- **Preview:** every PR gets a Vercel preview URL + a Neon database branch
  (schema-migrated automatically) + a preview-tagged deploy of the collab
  server, so reviewers can click through a fully working, isolated instance
  of the exact PR — not just the frontend.
- **Staging:** `main` branch auto-deploys here after CI passes.
- **Production:** promoted manually from staging via a tagged release.

## CI/CD Pipeline (GitHub Actions)

```
on: pull_request, push to main

jobs:
  lint-typecheck:
    - eslint, tsc --noEmit

  unit-integration-tests:
    - spin up Neon PR branch (or ephemeral Postgres via testcontainers)
    - run Prisma/Drizzle migrations
    - vitest run (unit + integration, incl. RLS + sync engine suites)

  e2e-tests:
    needs: [lint-typecheck, unit-integration-tests]
    - build app, start against the PR's Neon branch + a temp collab server instance
    - playwright test (multi-tab, offline-simulation scenarios)

  deploy-preview:
    needs: [e2e-tests]
    - vercel deploy (preview)
    - fly deploy --app collab-preview-<pr-number>

  deploy-production: # on push to main only, after all above pass
    - prisma migrate deploy   # gated, reviewed migration step
    - vercel deploy --prod
    - fly deploy --app collab-prod
```

Branch protection on `main`: required status checks =
`lint-typecheck`, `unit-integration-tests`, `e2e-tests` before merge.

## Secrets & Config

- `DATABASE_URL`, `NEXTAUTH_SECRET`, OAuth client secrets, AI provider API
  key, collab-server shared signing secret (for WS token verification) —
  all managed via Vercel/Fly environment variable stores, never committed;
  `.env.example` checked into the repo documents required keys without
  values.

## Observability (real-world consideration)

- Structured logging on the collab server (request/connection lifecycle,
  validation rejections, rate-limit hits) shipped to a log drain.
- Basic uptime/health check endpoint (`/healthz`) on the collab server for
  Fly's process supervisor.
- Error tracking (Sentry) on both the Next.js app and collab server,
  configured to specifically tag sync-engine errors distinctly from generic
  UI errors, since that's the subsystem most likely to have subtle
  production-only bugs (real network conditions the dev environment can't
  fully replicate).
