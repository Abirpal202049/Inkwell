# Inkwell — local-first collaborative docs

A local-first, collaborative document editor with offline synchronization,
deterministic CRDT conflict resolution, and granular version history.
Built for the House of Edtech Fullstack Assignment (v2.1).

## Repository layout

| Folder | Contents |
|---|---|
| [`frontend/`](frontend/) | Next.js 16 app (UI only — no server logic) |
| [`backend/`](backend/) | Standalone Node service: Express REST + Auth.js (Google/GitHub OAuth) + Yjs realtime WebSocket + Prisma |
| [`plan/`](plan/) | Full design & build plan — start at [`plan/00-overview.md`](plan/00-overview.md) |
| `docker-compose.yml` | Local Postgres for development |

## Local development

```bash
# 1. install (npm workspaces: frontend + backend)
npm install

# 2. start local Postgres (Docker)
npm run db:up

# 3. configure the backend
cp backend/.env.example backend/.env   # fill in OAuth secrets (see below)

# 4. create the database schema + RLS policies
npm run db:migrate
docker exec -i inkwell-postgres psql -U inkwell -d inkwell < backend/prisma/rls.sql

# 5. run both processes (two terminals)
npm run dev:backend    # Express + WebSocket on :4000
npm run dev            # Next.js on :3000 (proxies /api/* to :4000)
```

OAuth: create a Google OAuth client and a GitHub OAuth app, both with
callback `http://localhost:3000/api/auth/callback/<provider>`, and put the
IDs/secrets in `backend/.env`. Without them the app still runs — documents
work fully offline — but sign-in and sync stay disabled.

## Architecture in one paragraph

The browser's IndexedDB (a Yjs CRDT log) is the source of truth — every
edit applies locally with zero network involvement. A background sync
engine pushes update deltas through a durable outbox over WebSocket and
merges remote changes; CRDT semantics make the merge deterministic and
lossless regardless of how long a client was offline. Postgres stores an
append-only update log (compacted periodically), user-facing version
snapshots, and enforces tenant isolation with Row Level Security. Details:
[`plan/01-architecture.md`](plan/01-architecture.md).
