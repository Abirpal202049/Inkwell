# Testing Strategy

Explicit evaluation criterion: "Coverage and effectiveness of unit,
integration, and end-to-end tests, **specifically around the local-first
sync engine**." Testing effort is weighted accordingly — the sync engine
gets the deepest coverage of any subsystem.

## Tooling

- **Unit/Integration:** Vitest + Testing Library (React components), plus
  `fake-indexeddb` to run IndexedDB-dependent sync engine code in Node
  without a browser.
- **Property-based testing:** `fast-check`, specifically for CRDT
  convergence proofs (see [04-conflict-resolution.md](04-conflict-resolution.md)).
- **E2E:** Playwright, including genuine multi-tab and network-throttling
  scenarios (Playwright's `context.setOffline(true)` is central to this
  plan — it's what lets us actually simulate "go offline mid-edit" instead
  of mocking it away).
- **API/contract tests:** Vitest against a real Postgres test database
  (via `testcontainers` or a disposable Neon branch) to exercise RLS
  policies for real, not mocked.

## Sync Engine Test Matrix (the core deliverable)

| Scenario | Type | Assertion |
|---|---|---|
| Two clients edit concurrently while both offline, then both reconnect | Integration | Final documents on both clients and server are byte-identical (state convergence); no paragraph from either user is lost |
| N clients apply random concurrent op sequences in random delivery order | Property-based (fast-check) | `Y.encodeStateAsUpdate` identical across all N replicas for every random seed run |
| Client goes offline mid-batch-send | Integration (mock WS drop) | Outbox entries remain until a real ACK is received; no entry is deleted on a dropped/partial send |
| Client crashes (simulated: kill Y.Doc + IndexedDB handle) mid-typing | Integration (fake-indexeddb) | On "restart" (fresh Y.Doc + reopen IndexedDB), all pre-crash edits are present |
| Two browser tabs open on the same document | E2E (Playwright, 2 contexts) | Only one "sync leader" sends to the server (via BroadcastChannel spy); both tabs show each other's edits live |
| Reconnect after long offline period with large outbox | Integration | Main thread frame budget never exceeded (assert via performance marks) during drain; UI stays responsive (a scripted keystroke during drain is applied within X ms) |
| Malformed/oversized sync payload sent to server | Integration (API test) | Server responds 400/413, does not persist, does not crash, memory does not grow unbounded (heap snapshot diff) |
| Viewer role attempts to push an update | Integration + E2E | WS layer drops it; RLS policy independently rejects a direct-DB-bypass attempt; UI never renders an editable surface for Viewer |
| Restore to an old version while another user is actively typing | E2E (2 contexts) | Both users' final states converge; the actively-typing user's concurrent keystrokes are not discarded by the restore |
| Version snapshot survives document growth/compaction | Integration | Old version's `state_bytes` still reconstructs correct historical content after a compaction run |
| Rapid typing performance | E2E (Playwright, scripted fast keystrokes) | No dropped/out-of-order characters in final content; frame timing stays under jank threshold |
| Per-user undo with a collaborator typing concurrently | E2E (2 contexts) | User A's Ctrl+Z reverts only A's last edit; B's concurrent text is untouched (Y.UndoManager tracked-origins behavior, 14-google-docs-parity.md §1) |
| Link sharing lifecycle | Integration | link-edit grants Editor on first open; downgrading share_mode to private removes link-granted members but keeps invited ones; RLS blocks the removed user |
| Replayed sync batch (duplicate batchId) | Integration | Server re-acks with original seq, inserts nothing (processed_batches idempotency, 13-api-contracts.md) |

## Unit Test Coverage (supporting layers)

- Zod schemas for every API payload (valid/invalid fixtures).
- Role→permission matrix (table in [06-auth-security.md](06-auth-security.md))
  tested exhaustively as a parametrized unit test.
- Outbox reducer/state machine (OFFLINE/CONNECTING/SYNCING/SYNCED
  transitions) tested in isolation with a mocked transport.
- Version restore diff/apply logic tested against fixed before/after
  document fixtures.

## CI Gate

All unit + integration tests run on every PR; the Playwright E2E suite
(including offline-simulation scenarios) runs on every PR against a preview
deployment; merges to `main` are blocked on both suites passing (see
[10-deployment-cicd.md](10-deployment-cicd.md)).
