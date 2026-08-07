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

**Two transports, one job split:**
- **WebSocket channel** carries only Yjs binary update deltas (small, frequent,
  append-only) — this is what makes real-time collaboration fast and cheap.
- **REST (Next.js Route Handlers)** carries auth, document metadata, named
  version snapshots, restore operations, and the initial full-document sync
  when a client first opens a doc or has been offline a long time. This keeps
  heavy/rare operations off the hot realtime path.

**Why a separate collab server process instead of doing WS in Next.js
route handlers:** Next.js serverless functions (on Vercel) are not designed
for long-lived WebSocket connections. We run a small dedicated Node process
(Hocuspocus, a Yjs-aware WS server, or a hand-rolled `ws` server) on a
platform that supports persistent connections (Fly.io/Render/a VM). This is
called out explicitly as a real-world deployment tradeoff in
[11-scalability-tradeoffs.md](11-scalability-tradeoffs.md).

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
5. **Server API Layer (Next.js Route Handlers + Server Actions)** — auth,
   document CRUD (metadata only), membership/roles, version snapshot CRUD.
6. **Collab/WS Server** — authenticates the socket (short-lived token minted
   by a Route Handler), joins a "room" per document, relays/persists Yjs
   updates, enforces payload validation before touching the DB.
7. **Database Layer (Postgres)** — durable log of Yjs updates + compacted
   snapshots + version history + RLS-enforced tenant isolation.

## Directory Structure (Next.js 16 App Router)

```
/app
  /(marketing)/page.tsx                     # landing + sign-in CTA + required footer
  /signin/page.tsx                          # Google + GitHub OAuth buttons
  /(app)/documents/page.tsx                 # dashboard (Recent/Owned/Shared tabs)
  /(app)/documents/[docId]/page.tsx         # editor page
  /(app)/documents/[docId]/history/page.tsx # version timeline
  /api/auth/[...nextauth]/route.ts
  /api/documents/route.ts                   # list/create
  /api/documents/[docId]/route.ts           # metadata, share_mode (PATCH), delete
  /api/documents/[docId]/members/...        # invites, role changes, removal
  /api/documents/[docId]/versions/...       # list/create/fetch versions
  /api/documents/[docId]/restore/route.ts   # restore to version
  /api/documents/[docId]/token/route.ts     # mint short-lived WS auth token
  /api/ai/[...]/route.ts                    # AI add-on endpoints
  # full request/response contracts for every route: plan/13-api-contracts.md
/collab-server                              # standalone Node WS process
  server.ts
  auth.ts
  validation.ts
  persistence.ts
/lib
  /crdt (Y.Doc setup, awareness)
  /sync (outbox, protocol, worker entry)
  /db (Prisma/Drizzle client, RLS helpers)
  /auth (Auth.js config, role guards)
/components (editor, history-timeline, presence, connection-badge, ...)
/workers/sync-worker.ts
/plan  ← this folder
```
