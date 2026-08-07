# Architecture

## High-Level Diagram

```
┌───────────────────────────────────────────────────────────────────┐
│ Browser (Client)                                                   │
│                                                                      │
│  ┌────────────┐   ┌──────────────┐   ┌────────────────────────┐  │
│  │ React UI    │   │ Y.Doc (CRDT) │   │ IndexedDB               │  │
│  │ (Tiptap     │◄─►│ in-memory    │◄─►│  - doc updates (Yjs)    │  │
│  │ editor)     │   │ document     │   │  - outbox queue          │  │
│  └────────────┘   └──────┬───────┘   │  - version snapshots     │  │
│                           │            │  - metadata cache        │  │
│                           │            └────────────────────────┘  │
│                    ┌──────▼───────┐                                 │
│                    │ Sync Engine   │  (Web Worker)                  │
│                    │ - outbox      │                                │
│                    │ - retry/backoff│                               │
│                    │ - conn monitor │                               │
│                    └──────┬───────┘                                 │
└───────────────────────────┼─────────────────────────────────────────┘
                             │ WebSocket (binary Yjs updates)
                             │ + REST (auth, snapshots, history)
┌────────────────────────────▼─────────────────────────────────────────┐
│ Server                                                                 │
│  ┌───────────────┐   ┌────────────────┐   ┌─────────────────────┐   │
│  │ Next.js 16     │   │ Collab/WS      │   │ Validation Layer     │   │
│  │ Route Handlers │   │ Server (Node)  │──►│ - size limits         │   │
│  │ - auth (Auth.js)│   │ - room per doc │   │ - schema check (zod) │   │
│  │ - REST APIs    │   │ - broadcast    │   │ - rate limiting       │   │
│  │ - snapshot API │   │ - persistence  │   └──────────┬───────────┘   │
│  └───────────────┘   └────────────────┘              │               │
│                                 │                       ▼               │
│                         ┌───────▼───────────────────────────────┐    │
│                         │ PostgreSQL (RLS enabled)                │    │
│                         │  - documents, doc_updates (Yjs log)     │    │
│                         │  - snapshots/versions, users, memberships│   │
│                         └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Why This Shape

**Backend is a standalone service, NOT Next.js** (decision: Aug 2026).
Next.js serves only the frontend. All server logic lives in `backend/` —
a single Node.js/TypeScript process running:
- **Express 5** — REST API (documents, members, versions, restore, tokens)
- **`@auth/express`** — Auth.js core mounted on Express; Google + GitHub
  OAuth and JWT session cookies, no Next.js involvement
- **`ws`** — the realtime WebSocket, attached to the same HTTP server
  (`server.on('upgrade', ...)`), so REST + WS share one port, one deploy,
  one Prisma client

The Next.js app reaches the backend through a rewrite in `next.config.ts`
(`/api/:path*` → `${BACKEND_URL}/api/:path*`). This is pure reverse
proxying — no backend logic in Next — and it keeps the Auth.js session
cookie first-party (same origin as the frontend), avoiding third-party
cookie/CORS pain entirely. The WebSocket connects directly to the backend
host (browsers don't send the cookie for WS anyway — WS auth uses the
short-lived token from [13-api-contracts.md](13-api-contracts.md)).

**Two transports, one job split:**
- **WebSocket channel** carries only Yjs binary update deltas (small, frequent,
  append-only) — this is what makes real-time collaboration fast and cheap.
- **REST (Express)** carries auth, document metadata, named version
  snapshots, restore operations, and the initial full-document sync when a
  client first opens a doc or has been offline a long time. This keeps
  heavy/rare operations off the hot realtime path.

**Why one backend process for both REST and WS:** Vercel serverless can't
hold long-lived WebSocket connections, so a persistent Node process is
required regardless; putting REST in the same process (instead of
splitting REST onto Vercel) means one deploy target, one place secrets
live, no duplicated auth/validation code, and REST handlers can share
in-memory room state with the WS layer (e.g., broadcasting a role change
to live sockets without a message bus). Horizontal scaling implications
are covered in [11-scalability-tradeoffs.md](11-scalability-tradeoffs.md).

**Why a Web Worker for the sync engine:** Keeps IndexedDB reads/writes,
diffing, and retry/backoff logic off the main thread so rapid typing never
janks — directly addresses the evaluation criterion "preventing client-side
lag during rapid typing."

## Layers & Responsibilities

1. **Editor Layer (React + Tiptap)** — pure presentation; binds to the Yjs
   document via `y-prosemirror`. Never touches network or IndexedDB directly.
2. **CRDT Layer (Y.Doc)** — the actual document state and source of truth on
   the client. All edits are Yjs operations, giving us offline-safe, mergeable
   history for free (see [04-conflict-resolution.md](04-conflict-resolution.md)).
3. **Persistence Layer (IndexedDB)** — `y-indexeddb` persists the CRDT log so
   a full reload/offline restart doesn't lose local state; a custom
   `outbox` object store tracks which updates still need to reach the server.
4. **Sync Engine (Worker)** — owns connectivity detection, the push/pull
   protocol, retry/backoff, and reconciliation. Detailed in
   [03-sync-engine.md](03-sync-engine.md).
5. **Server API Layer (Express on the backend)** — auth (`@auth/express`),
   document CRUD (metadata only), membership/roles, version snapshot CRUD.
6. **Collab/WS Layer (same backend process)** — authenticates the socket
   (short-lived token minted by the REST layer), joins a "room" per
   document, relays/persists Yjs updates, enforces payload validation
   before touching the DB.
7. **Database Layer (Postgres)** — durable log of Yjs updates + compacted
   snapshots + version history + RLS-enforced tenant isolation.

## Directory Structure (Next.js 16 App Router)

```
/app                                        # Next.js = FRONTEND ONLY
  page.tsx                                  # landing + sign-in CTA + required footer
  /signin/page.tsx                          # Google + GitHub OAuth buttons
  /documents/page.tsx                       # dashboard (Recent/Owned/Shared tabs)
  /documents/[docId]/page.tsx               # editor page
  /documents/[docId]/history/page.tsx       # version timeline
  # NO /app/api — next.config.ts rewrites /api/* to the backend
/backend                                    # standalone Node service (own package.json)
  /src
    server.ts                               # http server: Express app + ws upgrade
    auth.ts                                 # @auth/express config (Google + GitHub)
    /routes                                 # documents, members, versions, restore, token, ai
    /realtime                               # rooms, y-protocols sync, awareness
    validation.ts                           # zod schemas + size caps
    persistence.ts                          # doc_updates append, compaction, snapshots
    db.ts                                   # Prisma client + RLS SET LOCAL helper
  /prisma/schema.prisma
/lib                                        # frontend libs
  /crdt (Y.Doc setup, awareness)
  /sync (outbox, protocol, worker entry)
  /schemas (zod payloads — shared with backend via workspace import)
/components (editor, history-timeline, presence, connection-badge, ...)
/workers/sync-worker.ts
/plan  ← this folder
# Repo is an npm workspace: root (frontend) + backend/ share lib/schemas
# and lib/constants so client and server always agree on the wire format.
```
