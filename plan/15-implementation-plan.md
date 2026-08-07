# Implementation Plan (execution checklist)

This is the concrete, file-level build order. Design docs 00–14 are the
"why"; this is the "what, in what order." Check items off as they land.
Repo root = the Next.js app; `plan/` = docs; `collab-server/` = WS process.

## Stage A — Scaffold (no external services needed)

- [ ] `git init`, `.gitignore`, first commit of `plan/`.
- [ ] `create-next-app` (TypeScript, Tailwind v4, App Router, ESLint,
      `@/*` import alias). Move into repo root beside `plan/`.
- [ ] Deps (client core): `yjs`, `y-indexeddb`, `y-prosemirror`,
      `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-*`
      (underline, link, highlight, text-align, placeholder, task-list),
      `zod`, `nanoid`, `lucide-react` (icons), `clsx`, `tailwind-merge`.
- [ ] `lib/constants.ts` — every constant from
      [13-api-contracts.md](13-api-contracts.md), verbatim names.
- [ ] App shell: root layout (fonts, dark-ready), shared `<SiteFooter>`
      with name/GitHub/LinkedIn (submission requirement — present from the
      first commit so it's never forgotten).

## Stage B — Phase 1: Local-first editor core (fully offline, no server)

Everything in this stage must work with the network cable pulled and no
env vars set.

- [ ] `lib/crdt/doc-manager.ts` — create/open/destroy `Y.Doc` +
      `IndexeddbPersistence` per docId; enforces single instance per docId
      per tab; `destroy()` on unmount ([11-scalability-tradeoffs.md](11-scalability-tradeoffs.md)).
- [ ] `lib/crdt/origins.ts` — `localOrigin`, `restoreOrigin`, `aiOrigin`
      sentinels ([14-google-docs-parity.md](14-google-docs-parity.md) §1).
- [ ] `lib/local/meta-store.ts` — IndexedDB `document-meta` store (list of
      known docs for the offline dashboard): id, title, updatedAt, role.
- [ ] `components/editor/Editor.tsx` — Tiptap editor bound via
      `y-prosemirror` Collaboration; `Y.UndoManager` with
      `trackedOrigins: new Set([localOrigin])`, captureTimeout 500.
- [ ] `components/editor/Toolbar.tsx` — pinned feature set (14 §7),
      `aria-pressed`, role="toolbar".
- [ ] `components/editor/TitleInput.tsx` — reads/writes
      `Y.Map('meta').title`; mirrors to meta-store for dashboard.
- [ ] `components/ConnectionBadge.tsx` — state machine display; Stage B
      renders permanent "Offline — saved on this device".
- [ ] `components/editor/StatusFooter.tsx` — word/char count (300ms
      debounce) + `<SiteFooter>` links.
- [ ] `/documents` dashboard — local meta-store list, "+ New document"
      (client-generated UUID), relative times, empty state.
- [ ] `/documents/[docId]` editor page wiring it all together.
- [ ] Manual test: create doc → type → hard reload offline → content and
      title intact; Ctrl+Z groups bursts; two tabs same doc converge
      (BroadcastChannel comes later, but y-indexeddb already cross-syncs).

## Stage C — Phase 0 backend groundwork (needs Neon + OAuth secrets)

- [ ] Prisma schema per [02-data-model.md](02-data-model.md) (incl. Auth.js
      adapter tables), migrations.
- [ ] Auth.js v5: Google + GitHub, JWT sessions, signin page, middleware
      guarding `/documents/*` ([06-auth-security.md](06-auth-security.md)).
- [ ] RLS policies SQL migration + `withUserContext()` transaction helper
      (`SET LOCAL app.user_id`).
- [ ] REST routes per [13-api-contracts.md](13-api-contracts.md):
      documents CRUD, members, versions, restore, token. zod schemas in
      `lib/schemas/`.
- [ ] **Blocked on user-provided env:** `DATABASE_URL`, Google/GitHub
      OAuth client IDs/secrets. Code lands first with `.env.example`;
      wiring verified once secrets exist.

## Stage D — Phase 2: Sync engine + collab server

- [ ] `collab-server/` Node process (`ws`): token auth on upgrade, rooms,
      y-protocols sync + awareness, JSON control frames, ack/idempotency
      via `processed_batches`, persistence to `doc_updates`, validation
      + size caps + rate limiting ([06](06-auth-security.md), [13](13-api-contracts.md)).
- [ ] `workers/sync-worker.ts` — outbox drain, backoff state machine,
      heartbeat; `lib/sync/` protocol client.
- [ ] BroadcastChannel leader election.
- [ ] Presence cursors (named, deterministic colors), avatar stack.
- [ ] Title mirror to Postgres on server.

## Stage E — Phases 3–5: verification, versions, sharing

- [ ] fast-check convergence property tests; sync test matrix
      ([09-testing-strategy.md](09-testing-strategy.md)).
- [ ] Snapshots (auto + manual), history UI, restore-as-forward-edit.
- [ ] Share dialog, pending invites, link sharing, live role downgrade.

## Stage F — Phases 6–8: AI, polish, deploy

- [ ] AI slash command + summarize + auto version labels (AI SDK + Groq).
- [ ] A11y pass, Playwright e2e, GitHub Actions, Vercel + Fly deploy,
      README.

## Working agreements

- Constants only from `lib/constants.ts`; wire shapes only from
  `lib/schemas/` — both trace to [13-api-contracts.md](13-api-contracts.md).
- Every Y.Doc write goes through `doc.transact(fn, origin)` with an
  explicit origin — never a bare mutation (undo correctness depends on it).
- Commit per checklist item or coherent group; imperative messages.
