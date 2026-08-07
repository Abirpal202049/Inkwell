# Deterministic Conflict Resolution

## Choice: CRDT (Yjs), not Operational Transform, not Last-Write-Wins

| Approach | Verdict |
|---|---|
| Last-Write-Wins on full doc | **Rejected.** Explicitly what the assignment says not to build; guarantees silent data loss whenever two people type concurrently. |
| Operational Transform (OT, à la Google Docs pre-2023 / ShareDB) | **Rejected.** Requires a central server to sequence and transform every op, which conflicts with "local-first, must work fully offline with no server round-trip on edit." OT transform functions are also notoriously hard to prove correct for rich-text schemas. |
| CRDT (Yjs) | **Chosen.** Merges are mathematically guaranteed commutative, associative, and idempotent — any two replicas that have seen the same set of updates converge to the *identical* state regardless of the order those updates arrived in. This is precisely "deterministic conflict resolution" and it works with zero coordination, which is what offline-first requires. |

## How Yjs Achieves Determinism (the mechanism, explained)

- Every character insertion is assigned a globally unique, immutable ID:
  `(clientID, clock)` where `clientID` is a random ID generated per browser
  session and `clock` is a per-client monotonic counter (Lamport-style).
- Text is modeled as a sequence CRDT (YATA algorithm, a variant of the RGA
  family): each item stores a reference to its left/right origin neighbor at
  the moment of insertion. When two clients concurrently insert at the "same"
  position, their items both keep their original left-origin, and a
  **deterministic tie-break rule** (compare `clientID`) decides final
  left-to-right order — every replica applying the same set of items always
  computes the same order, regardless of arrival order.
- Deletions are tombstones, not physical removal, so a delete arriving before
  or after the corresponding insert (a common offline race — you deleted a
  paragraph offline while a collaborator was mid-edit inside it) is always
  resolvable and never crashes or corrupts.
- Rich structure (headings, bold, lists) is layered via nested shared types
  (`Y.XmlFragment`/`Y.XmlElement`) that follow the same convergence
  guarantees, so this isn't just plain-text merging — it holds for the full
  ProseMirror document tree.

## Why This Satisfies "No Data Loss"

Concurrent edits from two offline users are **both preserved** and
interleaved correctly when they reconnect — neither user's paragraph
"wins" over the other's; both exist in the final merged document, ordered by
the deterministic tie-break. This is fundamentally different from LWW, where
one user's entire change is discarded.

The one case CRDTs cannot make "intuitive" is two users editing the exact
same word simultaneously (e.g., both retyping the same sentence) — the merge
is still deterministic and lossless at the character level, but the result
can look interleaved/garbled to a human. We mitigate this at the UX layer,
not the algorithm layer:
- **Presence/cursors** (Yjs Awareness protocol) show collaborators' live
  cursor positions so users see they're both in the same spot and
  naturally avoid it — prevention over resolution.
- **Version history** (see [05-version-history.md](05-version-history.md))
  lets a user recover the pre-merge state of their own change if a merge
  result looks wrong, so "deterministic" doesn't mean "unrecoverable."

## Determinism Proof Sketch (what we'll document/demo)

To demonstrate this isn't hand-waved, the submission will include an
integration test (see [09-testing-strategy.md](09-testing-strategy.md)) that:
1. Forks the same starting `Y.Doc` state into N simulated clients.
2. Applies different, randomly-ordered, concurrent edit sequences to each.
3. Exchanges all updates between all clients in different random orders per
   test run.
4. Asserts `Y.encodeStateAsUpdate(clientA) === ... === Y.encodeStateAsUpdate(clientN)`
   (byte-identical final state) after all updates are applied, regardless of
   arrival order — a direct, automated proof of convergence/determinism, run
   via property-based testing (fast-check) across many random schedules.

## Server's Role in Conflict Resolution

The server does **not** perform merging logic itself — it is a dumb,
validated relay + durable log (`doc_updates`) plus periodic compaction. This
is intentional: merge logic living entirely in the CRDT means the same
guarantees hold whether two browser tabs are merging locally, or a client is
merging server state after being offline for a week. One algorithm, not two
divergent code paths to keep in sync (a common source of "works in the demo,
breaks in production" bugs).
