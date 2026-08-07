# Version History & Time Travel

## Requirements Recap

- Capture specific snapshots of a document.
- View a timeline of past versions.
- Restore to a previous state **safely**, without corrupting the current
  shared document state for other active collaborators.

## Snapshot Model

Two kinds of snapshots, both stored in `document_versions` (see
[02-data-model.md](02-data-model.md)):

1. **Manual snapshots** — user clicks "Save version" and supplies a label
   ("Draft before rewrite"). Stored immediately, `is_auto = false`.
2. **Automatic snapshots** — the server creates one whenever meaningful
   drift accumulates (e.g., every 50 accepted `doc_updates`, or every 10
   minutes of active editing, whichever comes first), `is_auto = true`, so
   users get a usable timeline even if they never manually save a version.
   Auto-snapshots older than N days are pruned (keep hourly-granularity
   beyond a week, daily beyond a month) to bound storage growth — see
   [11-scalability-tradeoffs.md](11-scalability-tradeoffs.md).

Each snapshot stores `state_bytes = Y.encodeStateAsUpdate(doc)` at that
point in time — a **complete, self-contained** copy of the document, not a
diff — so restoring or previewing a version never requires replaying the
entire update log from the beginning.

## Time Travel UI Flow

1. `/documents/[docId]/history` renders a timeline (newest first) of
   `document_versions`, showing label/timestamp/author, auto vs manual
   badge.
2. Clicking a version **previews it read-only** in a side-by-side or
   overlay diff view — this loads `state_bytes` into a *throwaway* `Y.Doc`
   instance (never the live editing doc), rendered through the same
   ProseMirror renderer in read-only mode. Purely additive/non-destructive.
3. A diff summary (added/removed paragraphs) is computed by comparing the
   snapshot's plain-text projection against the current document's, using a
   standard text-diff (e.g. `diff-match-patch`) — this is a display aid
   only, not part of the merge algorithm.

## Restore — The Safety-Critical Operation

**The core risk the assignment calls out:** naively "restoring" by
overwriting the live document with old content would look like any other
editor's change to every other collaborator's CRDT — but if implemented as
"replace state wholesale," it destroys the causal history other clients need
to keep merging correctly, and can resurrect deleted content in a way that
conflicts with concurrent edits made after the restore point.

**Design: Restore is implemented as a new forward edit, not a rewind.**

```
restoreToVersion(documentId, versionId):
  1. Load target snapshot's Y.Doc (`targetDoc`) from state_bytes.
  2. Load the CURRENT live Y.Doc (`liveDoc`) — the real, up-to-the-second
     shared state, including any edits made by others since the snapshot.
  3. Compute a content-level diff: targetDoc's content vs liveDoc's content.
  4. Apply that diff as a normal sequence of CRDT operations ON TOP OF
     liveDoc (via the live Y.Doc's own transaction), rather than replacing
     liveDoc's internal state wholesale.
  5. This produces a brand-new `doc_updates` entry, broadcast through the
     exact same sync path as any other edit.
  6. A new automatic version snapshot is taken immediately after
     ("Restored to version from <timestamp>"), so the restore itself is
     also undoable/inspectable.
```

Why this is safe for other active collaborators:
- Because the restore is expressed as CRDT operations merged into the *live*
  document (not a state replacement), it composes correctly with whatever
  any other currently-connected editor is doing at that exact moment — the
  same convergence guarantees from
  [04-conflict-resolution.md](04-conflict-resolution.md) apply. Nobody's
  in-flight keystroke is silently discarded by the restore.
- It never rewrites `doc_updates` history — it only appends. The full
  causal log (and therefore every prior version) remains intact and
  reconstructible; restore is non-destructive by construction.
- Server-side, the restore endpoint requires `role IN ('owner','editor')`
  and is itself just another payload through the same validated sync
  endpoint (see [06-auth-security.md](06-auth-security.md)) — no special
  privileged code path that could bypass validation.

## Storage/Compute Tradeoff

Full-state snapshots are simple and make preview/restore O(1) instead of
O(replay whole log), at the cost of storage. Given documents are text
(cheap to store, even at hundreds of versions) this tradeoff clearly favors
snapshot-simplicity — replaying potentially tens of thousands of `doc_updates`
rows to reconstruct a version on every preview click would be the actual
performance risk. Storage growth is bounded by pruning old auto-snapshots
(above) and by the same compaction strategy used for the live log.
