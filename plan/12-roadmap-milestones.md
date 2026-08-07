# Build Roadmap & Milestones

Phased so that each milestone produces something demoable, and the hardest
distributed-systems work (sync + conflict resolution) lands early rather
than being bolted on at the end under time pressure.

## Phase 0 — Project Setup
- Next.js 16 (TS) scaffold, Tailwind + shadcn/ui installed.
- Repo structure per [01-architecture.md](01-architecture.md).
- Neon Postgres provisioned; Prisma/Drizzle configured; base schema from
  [02-data-model.md](02-data-model.md) migrated.
- Auth.js wired up with **Google + GitHub OAuth** (both from day one —
  account-linking-by-verified-email behavior per
  [06-auth-security.md](06-auth-security.md) is easier to get right before
  any users exist than to retrofit).
- `lib/constants.ts` created with every tuning constant from
  [13-api-contracts.md](13-api-contracts.md) — no magic numbers in code.
- GitHub Actions skeleton (lint/typecheck) + Vercel project linked.
- **Deliverable:** empty authenticated app deployed to a Vercel preview.

## Phase 1 — Local-First Editor Core (single user, no sync yet)
- Tiptap + Yjs (`Y.Doc`) wired locally, `y-indexeddb` persistence; editor
  feature set exactly per [14-google-docs-parity.md](14-google-docs-parity.md)
  §7 (toolbar scope pinned — no scope creep here).
- **Per-user undo via `Y.UndoManager` + tracked origins from the start**
  (14 §1) — retrofitting origins onto existing transactions is painful.
- Title stored in `Y.Map('meta')`, inline title input (14 §3).
- Documents dashboard (`/documents`) with tabs + "+ New" (14 §4),
  IndexedDB metadata cache for offline rendering.
- Docs-like page layout (centered sheet) per [07-ui-ux.md](07-ui-ux.md).
- Connection status badge stubbed (shows "Offline" always, since no sync
  yet) to establish the UI contract early.
- **Deliverable:** a document survives an offline reload with full content
  intact — the local-first foundation, demoable standalone.

## Phase 2 — Sync Engine & Realtime Collaboration
- Collab WS server stood up (Fly.io), Yjs sync protocol implemented
  server-side, `doc_updates` persistence.
- Outbox queue, Web Worker sync engine, reconnect/backoff state machine per
  [03-sync-engine.md](03-sync-engine.md); wire protocol, ack/idempotency
  and close-code handling implemented **exactly** per
  [13-api-contracts.md](13-api-contracts.md).
- Multi-tab leader election via `BroadcastChannel`.
- Presence/Awareness: named cursors with deterministic per-user colors,
  name flags with 2s fade, avatar stack (14 §2).
- Title mirroring into `documents.title` on the collab server (14 §3).
- **Deliverable:** two browser windows editing the same doc live; kill one's
  network, keep editing offline, restore network, watch it merge cleanly.
  This is the centerpiece demo of the whole assignment.

## Phase 3 — Conflict Resolution Verification
- Property-based convergence test suite (fast-check) per
  [04-conflict-resolution.md](04-conflict-resolution.md).
- Deliberate chaos testing: simulate reordered/duplicated/dropped update
  delivery in integration tests.
- **Deliverable:** automated proof (in CI) that N clients converge to
  byte-identical state under any update ordering — this is the artifact
  that substantiates "deterministic conflict resolution" as more than a
  claim.

## Phase 4 — Version History & Time Travel
- Auto + manual snapshotting, `document_versions` table, compaction job.
- History timeline UI, read-only preview, diff view.
- Non-destructive restore-as-forward-edit implementation per
  [05-version-history.md](05-version-history.md).
- **Deliverable:** restore to an old version while a second collaborator is
  actively typing in another tab; verify both survive correctly.

## Phase 5 — Roles, Sharing & Security Hardening
- `document_members` + Docs-style share dialog (invite by email, per-person
  role dropdowns, pending invites for unregistered emails).
- **Link sharing** (`share_mode`: private / link-view / link-edit) with
  link-granted memberships per [14-google-docs-parity.md](14-google-docs-parity.md) §5.
- RLS policies applied and tested against real Postgres.
- WS-layer + RLS-layer Viewer write rejection.
- Payload validation (zod), frame/body size caps, rate limiting, semantic
  size checks per [06-auth-security.md](06-auth-security.md).
- **Deliverable:** a scripted "attack" test (oversized payload, viewer
  attempting a write, cross-tenant document access) demonstrably rejected
  at every layer.

## Phase 6 — AI Add-Ons
- Inline AI writing assistant, summarization, AI-generated version labels
  per [08-ai-features.md](08-ai-features.md).
- **Deliverable:** AI features working, clearly scoped as additive
  (disabled gracefully offline).

## Phase 7 — Polish, Accessibility, Testing Completion
- Full a11y pass (keyboard nav, `aria-live`, contrast) per
  [07-ui-ux.md](07-ui-ux.md).
- Remaining E2E scenarios from the test matrix in
  [09-testing-strategy.md](09-testing-strategy.md).
- Performance pass: rapid-typing jank check, large-outbox drain check.

## Phase 8 — Deployment, CI/CD Finalization, Submission
- Production deploy (Vercel + Fly + Neon) per
  [10-deployment-cicd.md](10-deployment-cicd.md).
- Branch protection + required CI checks enabled.
- README covering architecture, tradeoffs (link back into this `plan/`
  folder), setup instructions.
- Footer with name, GitHub profile, LinkedIn profile (submission
  requirement).
- Final smoke test on the live deployment: full offline→online→conflict→
  restore flow, exactly as it will be evaluated.
- **Deliverable:** GitHub repo + live deployment link submitted.

## Stretch (post-Phase-7, only if ahead of schedule)
- **Comments** (anchored via `Y.RelativePosition`, schema already in place —
  14 §6). Highest-value stretch: it's Docs' second signature feature.
- Tables in the editor (Tiptap extension, low risk).
- Export to Markdown.

## Cut Lines (if time runs short, cut bottom-up, never top-down)

1. Stretch list above + AI stretch features (semantic merge summary, NL
   search) — cut first.
2. Horizontal WS scaling / Redis backplane — stays as documented design
   only ([11-scalability-tradeoffs.md](11-scalability-tradeoffs.md)), never
   was in scope to build.
3. Full a11y polish beyond core keyboard nav — reduce, don't eliminate.
4. E2E scenario count — keep the sync-engine-critical ones
   (offline/reconnect/restore-while-editing), trim edge-case duplicates.

**Never cut:** offline editing, the sync/merge engine itself, deterministic
convergence tests, role-based write enforcement, RLS. These are the
assignment's explicit non-negotiables.
