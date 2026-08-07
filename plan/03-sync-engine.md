# Local-First Storage & Background Sync Engine

## Goals (from assignment)

- Zero network requests block the UI — open/edit/close must work fully offline.
- Regaining connection must push local changes and pull remote changes
  **without overwriting or destroying offline work**.
- Must survive: tab close mid-sync, browser crash, laptop sleep, flaky/
  flapping connectivity, two tabs open on the same doc.

## Local-First Storage

- The **Y.Doc CRDT instance is the primary source of truth** on the client,
  not a plain JSON blob. Every keystroke becomes a Yjs operation applied
  locally instantly (optimistic, no network round-trip).
- `y-indexeddb` binds to the same `Y.Doc` and persists every update
  transactionally to IndexedDB, so a full reload/offline-restart rehydrates
  exact state, including edits never sent to the server.
- The editor (Tiptap/ProseMirror via `y-prosemirror`) only ever reads/writes
  the local `Y.Doc`. This structurally guarantees "zero network requests
  block the UI" — there is no code path from keystroke to network at all.

## Outbox Queue (the durable sync unit)

Every local Yjs update is additionally appended to an `outbox` IndexedDB
store as an immutable record `{id, documentId, updateBytes, createdAt}`.
This is intentionally **separate** from the Yjs update log itself, because:

- The Yjs log is the *document*; the outbox is *work still owed to the
  server*. Once the server ACKs a batch of outbox entries, they're deleted
  from the outbox — but the corresponding Yjs updates remain part of the
  document forever (merged into the CRDT state). This separation is what
  lets us safely retry without double-applying or losing edits.
- Because CRDT updates are **idempotent and commutative**, re-sending an
  outbox entry the server already received (e.g., after an ACK was lost) is
  always safe — the server just merges it again and no-ops.

## Sync Protocol (push/pull, run in a Web Worker)

```
1. Connectivity Monitor
   - `navigator.onLine` + heartbeat ping (WS ping/pong every 15s) — onLine
     alone is unreliable (false positives on captive portals), so we treat
     "connected" as: browser reports online AND the WS heartbeat has
     succeeded within the last 30s.
   - State machine: OFFLINE -> CONNECTING -> SYNCING -> SYNCED, with
     exponential backoff (1s, 2s, 4s... capped at 30s, +jitter) on failed
     reconnect attempts.

2. On transition to CONNECTING:
   a. Authenticate the WS with a short-lived token (fetched via REST,
      scoped to one documentId + role).
   b. PULL: send `{ type: 'sync-step1', stateVector: Y.encodeStateVector(doc) }`.
      Server responds with only the updates the client is missing
      (`Y.encodeStateAsUpdate(serverDoc, clientStateVector)`) — this is the
      standard Yjs sync protocol and is bandwidth-efficient even after long
      offline periods.
   c. Client applies the received update to its local Y.Doc. Because Yjs
      merges are commutative/associative, this can never conflict with or
      overwrite unsynced local edits sitting in the outbox — it just merges.
   d. PUSH: drain the outbox in ordered batches (capped at e.g. 256KB per
      batch to bound message size), send over the WS, await per-batch ACK.
   e. On ACK, delete acked entries from outbox and advance `lastSyncedSeq`.
   f. On live connection, subsequent local edits stream to the server
      immediately (debounced ~100ms) rather than waiting for the next
      reconnect cycle.

3. On transition to OFFLINE (WS close/error, or `navigator.onLine` false):
   - Stop sending. Outbox keeps accumulating. UI shows "Offline — changes
     saved locally" via the connection-status indicator (see 07-ui-ux.md).
   - No data is held only in memory: every edit is already in IndexedDB
     before this branch is even reached, so a crash right here loses nothing.
```

## Race Conditions Considered & Mitigations

| Race | Risk | Mitigation |
|---|---|---|
| Two tabs open on same doc | Duplicate outbox sends, double-counted seq | `BroadcastChannel` elects a single "sync leader" tab; followers relay through it. Y.Doc itself is safe to have multiple in-memory copies since CRDT merges are commutative. |
| Reconnect fires mid-batch-send | Partial batch ACKed, then connection drops | Batches are sent with a client-generated idempotency key; server dedupes by `(documentId, idempotencyKey)` before insert, so a resent partial batch never double-applies. |
| Server pushes an update from Editor B while Client A is mid-PUSH | A's push interleaves with B's broadcast | Order doesn't matter — CRDT merge is order-independent. A applies B's update to its local doc immediately regardless of push/pull ordering; final state converges either way. |
| Client's clock is wrong / skewed | Snapshot ordering by wall-clock timestamp corrupted | Server assigns `seq` via `bigserial`/transaction, never trusts client timestamps for ordering — timestamps are metadata only, never used for conflict resolution. |
| Long offline period, then reconnect with huge outbox | UI freezes while draining IndexedDB | All outbox reads/writes happen in the Web Worker; drains are chunked (yield every N records) so the main thread and editor stay responsive. |
| Server restarts / WS process redeployed mid-session | In-flight updates lost, client thinks it's synced | Client only advances `lastSyncedSeq` on explicit ACK; a dropped connection without ACK simply triggers the reconnect+outbox-drain flow again — nothing is presumed synced without confirmation. |
| Tab closed exactly between IndexedDB write and outbox flush | N/A by design | Because every edit synchronously writes to IndexedDB before the debounce timer even starts, there is no window where an edit exists only in memory. |

## Why Not "Just Retry a REST POST With the Whole Document"

Sending the whole document JSON on every save is the naive approach the
assignment explicitly warns against ("basic CRUD"). It has two fatal flaws
this design avoids:
1. **Data loss on concurrent edits** — last-write-wins overwrites a
   collaborator's changes. Our outbox sends *operations*, not full state, so
   nothing is ever overwritten.
2. **Unbounded payload growth** — sending full state on every keystroke does
   not scale. We send small deltas, and separately compact server-side
   storage (see [11-scalability-tradeoffs.md](11-scalability-tradeoffs.md)).
