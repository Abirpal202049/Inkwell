# Real-World Considerations, Scalability & Tradeoffs

Explicit evaluation criterion: "Demonstrated understanding of potential
architectural challenges and proposed solutions (e.g., handling document
state size over time)."

## Problem: `doc_updates` Grows Unbounded

A long-lived, actively-edited document accumulates an ever-growing append
log — over months, this could be millions of rows for a single document,
slowing both "load latest state" and storage costs.

**Mitigation — periodic compaction (already reflected in the schema,
[02-data-model.md](02-data-model.md)):**
- A scheduled job (or lazily, on first load if drift exceeds a threshold)
  folds all `doc_updates` up to `seq = N` into a single
  `doc_compactions.state_bytes` blob via `Y.encodeStateAsUpdate`.
- Clients loading a document fetch `doc_compactions` (one row) +
  any `doc_updates` after `up_to_seq` (a small tail) instead of the entire
  history — bounds load time regardless of document age.
- Rows folded into a compaction are **not deleted** immediately; retained
  for a grace window (e.g. 30 days) to support audit/debugging, then
  archived to cold storage (S3) or dropped, decoupling "hot" query
  performance from "cold" historical retention.
- This is a distinct mechanism from `document_versions` (human-facing
  history, [05-version-history.md](05-version-history.md)) — compaction is
  a pure storage optimization invisible to users; versions are
  user-meaningful checkpoints. Conflating them would either bloat the
  user-facing timeline with noise or make compaction unsafe to run freely.

## Problem: Document Grows Very Large In Content (not just history)

- ProseMirror/ Tiptap rendering of a very large single document (think a
  200-page doc) can itself become a client-side performance problem
  independent of sync.
- **Mitigation (documented as a known future direction, not fully built for
  this assignment given scope):** viewport-based virtualization of the
  editor's rendered nodes, or splitting very large documents into
  lazily-loaded sections backed by separate `Y.XmlFragment`s under one
  logical document. Called out here explicitly so the tradeoff is visible
  rather than silently ignored.

## Problem: Many Concurrent Documents / Multi-Tenant Scale

- **WS server horizontal scaling:** a single collab server process holding
  all "rooms" in memory doesn't scale past one machine. Real deployment
  would shard rooms across multiple collab server instances with a
  consistent-hashing router (e.g., by `documentId`) or use a pub/sub
  backplane (Redis) so any instance can serve any room while staying in
  sync with others handling the same document from different edges. Noted
  as the scaling path; the assignment's expected scope runs a single collab
  server instance, which is sufficient to demonstrate the architecture
  correctly.
- **Database connection pooling:** Neon's pooled connection string (pgbouncer
  transaction mode) used from serverless Route Handlers to avoid exhausting
  Postgres connections under bursty serverless invocation patterns.

## Problem: Client-Side Memory Growth (the assignment explicitly names
"browser-based memory management")

- A `Y.Doc` kept open indefinitely across many editing sessions in one tab
  (e.g., a poorly-behaved SPA never unmounting) can accumulate deleted-item
  tombstones and Awareness state from disconnected peers.
- **Mitigations:**
  - `Y.Doc` instances are properly destroyed (`doc.destroy()`) and
    IndexedDB providers unbound (`provider.destroy()`) on route
    unmount/document close — prevents leaked listeners/observers, a common
    real bug class in Yjs apps.
  - Yjs's garbage collection option (`gc: true`, default) is enabled so
    fully-acknowledged tombstones (deletions no longer needed for merge
    correctness because all peers have converged) are periodically
    compacted out of the in-memory structure, not retained forever.
  - Awareness (presence) states for disconnected clients are expired via
    Yjs Awareness's built-in timeout, preventing a slowly-growing "ghost
    cursor" list across a long session with many visitors.
  - The Web Worker boundary (see [03-sync-engine.md](03-sync-engine.md))
    also limits the *impact* of any memory growth in the sync/outbox layer
    to a separate thread's heap, isolated from the main UI thread.

## Problem: Handling Network Partition / Extended Offline (days, not seconds)

- The sync protocol's `stateVector`-diff approach (see
  [03-sync-engine.md](03-sync-engine.md)) already degrades gracefully here
  — bandwidth on reconnect scales with *actual changes missed*, not with
  elapsed offline time, so "offline for a week" and "offline for a minute"
  cost the same to resync (modulo how much editing happened).
- Explicit UX acknowledgement: after a very long offline period, the
  reconnect flow shows a brief "Reconciling N days of changes…" state
  rather than silently taking a long time, so the user isn't left guessing.

## Explicit Tradeoffs Chosen (for transparency in write-up/demo)

| Decision | Tradeoff accepted |
|---|---|
| CRDT (Yjs) over OT | Slightly larger client bundle & per-op metadata overhead, in exchange for offline-safety and formally provable convergence |
| Separate collab WS process vs. all-in-Next.js | Extra deploy target/operational surface, in exchange for actually-supportable persistent connections |
| Full-state version snapshots vs. diff-only | Higher storage cost, in exchange for O(1) restore/preview and simpler, more auditable restore logic |
| RLS + app-level scoping (both) | Some duplicated authorization logic, in exchange for defense-in-depth tenant isolation |
| Single collab server instance for this submission | Doesn't horizontally scale as-is; documented path to Redis-backed sharding if required |
