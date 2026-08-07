# Local-First Collaborative Document Editor — Project Plan

**Assignment:** House of Edtech — Fullstack Developer Assignment 2 (v2.1, April 2026)

This `plan/` folder is the full design & build plan for the assignment: a local-first,
collaborative document editor with offline sync, deterministic conflict resolution,
and granular version control.

## Documents in this folder

| File | Contents |
|---|---|
| [00-overview.md](00-overview.md) | This file — goals, scope, non-goals, evaluation mapping |
| [01-architecture.md](01-architecture.md) | System architecture, tech stack, component diagram |
| [02-data-model.md](02-data-model.md) | Postgres schema, client-side (IndexedDB) schema, RLS |
| [03-sync-engine.md](03-sync-engine.md) | Local-first storage, outbox queue, sync protocol, race conditions |
| [04-conflict-resolution.md](04-conflict-resolution.md) | CRDT choice, merge algorithm, determinism proof sketch |
| [05-version-history.md](05-version-history.md) | Snapshotting, time travel, restore-without-corruption design |
| [06-auth-security.md](06-auth-security.md) | AuthN/AuthZ, roles, payload validation, DoS/OOM mitigation |
| [07-ui-ux.md](07-ui-ux.md) | Component architecture, state management, accessibility, connection status |
| [08-ai-features.md](08-ai-features.md) | AI add-on features (AI-SDK based) |
| [09-testing-strategy.md](09-testing-strategy.md) | Unit/integration/e2e plan, sync-engine test matrix |
| [10-deployment-cicd.md](10-deployment-cicd.md) | Vercel/Neon deployment, CI/CD pipeline |
| [11-scalability-tradeoffs.md](11-scalability-tradeoffs.md) | Document growth, memory management, real-world considerations |
| [12-roadmap-milestones.md](12-roadmap-milestones.md) | Phased build plan with milestones and deliverables |
| [13-api-contracts.md](13-api-contracts.md) | **Normative** REST + WebSocket wire contracts, error codes, tuning constants, env vars |
| [14-google-docs-parity.md](14-google-docs-parity.md) | Google Docs feature-by-feature design decisions (per-user undo, cursors, sharing, comments, dashboard) |

> **How to use this folder while building:** 13 and 14 are the
> blueprint-level docs — when implementing, follow their contracts and
> constants literally rather than re-deciding. 00–12 explain *why* those
> decisions were made.

## Product Concept

**"Inkwell"** — a local-first collaborative rich-text document editor
modeled directly on Google Docs (dashboard, live named cursors, share
dialog with link sharing, per-user undo, version history — parity mapping
in [14-google-docs-parity.md](14-google-docs-parity.md)), whose value
proposition over Docs is: *it never blocks on the network, it never
silently loses your edits, and you can always see and roll back to exactly
what happened.*

The differentiator from a toy CRUD app is the engineering underneath:
- A client-side CRDT-backed document store that is the source of truth.
- A durable outbox/inbox sync queue that survives reloads and crashes.
- A deterministic merge algorithm (no "last write wins" data loss).
- A version history that snapshots without freezing collaboration.
- Server-side validation and resource limits that make the sync endpoint
  abuse-resistant (OOM-safe) and tenant-isolated (RLS).

## Explicit Non-Goals (per assignment instructions)

- Not a to-do list / task manager / basic CRUD app.
- Not "just" a rich text editor wrapper — the offline sync + merge engine is
  the core deliverable, editor UI is secondary.
- Not attempting full OT (Operational Transform) — we use CRDTs, justified in
  [04-conflict-resolution.md](04-conflict-resolution.md).

## Evaluation Criteria → Where It's Addressed

| Criterion | Plan doc |
|---|---|
| Offline-sync correctness, deterministic merge, no data loss | 03, 04 |
| Version history / time travel | 05 |
| Data validation, auth, authorization | 06 |
| UI friendliness, responsiveness, connection status, a11y | 07 |
| Code quality / state sync complexity / anti-lag optimization | 01, 03, 11 |
| Testing coverage on sync engine | 09 |
| Deployment + CI/CD | 10 |
| Real-world scalability considerations | 11 |

## Tech Stack Summary

- **Framework:** Next.js 16 (App Router, TypeScript, Server Actions + Route Handlers)
- **UI:** React 19, Tailwind CSS, shadcn/ui + Radix primitives
- **Editor core:** Tiptap/ProseMirror (rich text) driven by a Yjs CRDT document
- **CRDT:** Yjs (`Y.Doc`) — deterministic, battle-tested, supports awareness (presence)
- **Client persistence:** IndexedDB via `y-indexeddb` + a custom outbox table
- **Realtime transport:** WebSocket (custom Next.js-adjacent Node server or
  Hocuspocus) with HTTP fallback for sync payload exchange
- **Database:** PostgreSQL (Neon/Supabase) via Prisma or Drizzle ORM
- **Auth:** Auth.js (NextAuth) with JWT sessions — **Google + GitHub OAuth
  only, no passwords** (see [06-auth-security.md](06-auth-security.md))
- **AI:** Vercel AI SDK + one provider (Groq or Gemini) for add-on features
- **Testing:** Vitest (unit/integration), Playwright (e2e), fast-check (property-based sync tests)
- **Deployment:** Vercel (web) + a small persistent Node process for the WS
  collab server (Fly.io/Render), Neon Postgres, GitHub Actions CI/CD
