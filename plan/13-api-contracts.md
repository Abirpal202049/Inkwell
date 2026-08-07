# API Contracts & Wire Protocol (Blueprint-Level Detail)

This document pins down every request/response shape, WS frame type, error
code, and tuning constant so that during the build there are **zero
on-the-fly protocol decisions** — implement exactly what's written here.

## Global Conventions

- All REST responses are JSON with shape `{ ok: true, data: ... }` or
  `{ ok: false, error: { code: string, message: string } }`.
- All REST routes require an authenticated Auth.js session unless noted.
- All IDs are UUIDs (string). All timestamps are ISO-8601 UTC strings.
- Every payload is validated with zod **before** any DB or Yjs work; schema
  files live in `lib/schemas/` and are shared between client and server
  (single source of truth for both sides' types via `z.infer`).

## Error Codes (REST)

| HTTP | code | When |
|---|---|---|
| 400 | `INVALID_PAYLOAD` | zod validation failed (response includes flattened field errors in dev, generic in prod) |
| 401 | `UNAUTHENTICATED` | no/expired session |
| 403 | `FORBIDDEN` | authenticated but role insufficient |
| 404 | `NOT_FOUND` | doc/version doesn't exist **or** user is not a member (never leak existence of other tenants' docs — 404, not 403, for non-members) |
| 409 | `CONFLICT` | e.g. inviting an existing member |
| 413 | `PAYLOAD_TOO_LARGE` | body over limit |
| 429 | `RATE_LIMITED` | includes `Retry-After` header |
| 500 | `INTERNAL` | unexpected; logged with request ID, message never leaks internals |

## REST Endpoints

### Documents

```
GET  /api/documents
  → { ok, data: { documents: [{ id, title, role, shareMode,
       updatedAt, ownerName, memberCount }] } }
  Sorted by updatedAt desc. Paginated: ?cursor=<id>&limit=20 (max 50).

POST /api/documents
  body: { title?: string (1..300 chars, default "Untitled document") }
  → 201 { ok, data: { id } }
  Side effects: creates documents row, document_members row (owner),
  initial empty Y.Doc compaction row, initial auto-version snapshot.

GET  /api/documents/:docId
  → { ok, data: { id, title, role, shareMode, owner: {id,name,image},
       members: [{userId, name, image, role}], createdAt, updatedAt } }
  members array only included if caller role is owner (privacy).

PATCH /api/documents/:docId          (owner only)
  body: { title?: string, shareMode?: 'private'|'link-view'|'link-edit' }
  → { ok, data: { id, title, shareMode } }

DELETE /api/documents/:docId         (owner only)
  → { ok, data: { deleted: true } }   (soft-delete: sets deleted_at;
  hard purge after 30 days via scheduled job — allows "undo delete")
```

### Membership / Sharing

```
POST /api/documents/:docId/members   (owner only)
  body: { email: string (valid email, ≤320 chars), role: 'editor'|'viewer' }
  → 201 { ok, data: { userId, role } }
  If email has no account yet: create a pending_invites row keyed by
  lowercased email; on first sign-in with that email the invite is
  claimed and converted to a membership (matches Google Docs behavior of
  inviting people who don't have accounts yet).

PATCH /api/documents/:docId/members/:userId   (owner only)
  body: { role: 'editor'|'viewer' }
  Cannot change the owner's own row (owner transfer is out of scope; documented).

DELETE /api/documents/:docId/members/:userId  (owner, or self-removal)
```

### Versions

```
GET  /api/documents/:docId/versions
  → { ok, data: { versions: [{ id, label, isAuto, createdAt,
       createdBy: {name,image} }] } }   (metadata only, no state_bytes;
  paginated ?cursor&limit=50)

POST /api/documents/:docId/versions       (owner|editor)
  body: { label?: string (≤120 chars) }
  Server captures current authoritative state as the snapshot. If label
  omitted → AI-generated label (see 08-ai-features.md), fallback to
  "Version of <date>" if AI call fails/times out (2s budget).

GET  /api/documents/:docId/versions/:versionId
  → binary response (application/octet-stream) of state_bytes, with
  ETag = versionId for immutable caching (Cache-Control: immutable).
  Used by the read-only preview.

POST /api/documents/:docId/restore        (owner|editor)
  body: { versionId: string }
  → { ok, data: { newVersionId } }   (the auto-snapshot taken post-restore)
  Implemented per 05-version-history.md (restore-as-forward-edit).
```

### Realtime Token

```
POST /api/documents/:docId/token
  → { ok, data: { token: string, wsUrl: string, expiresIn: 60 } }
  token = JWT signed with COLLAB_JWT_SECRET (HS256), claims:
    { sub: userId, doc: docId, role: 'owner'|'editor'|'viewer',
      name, image, iat, exp (iat+60s), jti (uuid) }
  - TTL 60 seconds, single-use: collab server records jti in an in-memory
    LRU (10min retention) and rejects reuse — a leaked token is near-useless.
  - Role resolved fresh from DB at mint time, so role changes take effect
    on next (re)connect; additionally the collab server re-validates role
    via a lightweight DB check every 5 minutes per connection and
    downgrades/disconnects live sockets whose role was revoked.
```

## WebSocket Protocol (collab server)

Connect: `wss://<collab-host>/doc?token=<jwt>` — token validated before the
HTTP upgrade completes; invalid → upgrade rejected with 401, no socket ever
opens.

Two frame kinds on the wire:
- **Binary frames** — Yjs protocol messages (sync + awareness), using the
  standard `y-protocols` encoding. Kept binary for bandwidth.
- **Text frames** — JSON control messages, `{ t: <type>, ... }`.

### Binary message types (y-protocols standard)

| Type | Direction | Purpose |
|---|---|---|
| SyncStep1 (state vector) | C→S on connect | "here's what I have" |
| SyncStep2 (missing updates) | S→C reply | server's diff vs client |
| SyncStep1 | S→C on connect | server also requests client's missing ops (bidirectional sync) |
| Update | both, anytime | incremental Yjs update |
| Awareness | both | presence/cursor state |

### JSON control messages

```
C→S: { t: 'push', batchId: string(uuid), count: number }
       — announces a batch; followed by `count` binary Update frames.
S→C: { t: 'ack', batchId: string, seq: number }
       — all frames of batchId persisted; seq = new server watermark.
       Client deletes those outbox entries and sets lastSyncedSeq = seq.
S→C: { t: 'nack', batchId: string, code: string, retryable: boolean }
S→C: { t: 'role', role: 'viewer' }   — live downgrade notice; client
       flips editor to read-only immediately.
S→C: { t: 'error', code: string }    — pre-close notice.
both: WS-native ping/pong every 15s (server initiates; 2 missed pongs → close)
```

### WS close codes

| Code | Meaning | Client behavior |
|---|---|---|
| 4401 | token invalid/expired/reused | fetch fresh token, reconnect immediately (no backoff — this is expected on every reconnect since tokens are 60s) |
| 4403 | membership revoked | stop reconnecting; show "You no longer have access"; keep local data readable |
| 4413 | frame over size limit | drop offending outbox entry to a quarantine store, alert user, continue with rest of queue |
| 4429 | rate limited | backoff with server-provided hint |
| 1012 | server restarting | normal backoff reconnect |

### Ordering & idempotency rules (normative)

1. Server assigns `seq` per document inside a single Postgres transaction
   (`update documents set latest_seq = latest_seq + 1 ... returning`), so
   sequence assignment is race-free across multiple pushes.
2. `(document_id, batch_id)` is recorded in a `processed_batches` table
   (pruned after 7 days); a replayed batch gets a fresh `ack` with the
   original seq and **no** re-insert — exactly-once persistence from the
   client's point of view, at-least-once delivery underneath.
3. Broadcasts to other room members happen **after** the DB transaction
   commits, never before — a client can never see an update the server
   could still lose.

## Tuning Constants (single source: `lib/constants.ts`)

| Constant | Value | Rationale |
|---|---|---|
| `EDIT_STREAM_DEBOUNCE_MS` | 100 | batches keystrokes into one update frame; imperceptible latency, ~10x fewer frames |
| `WS_HEARTBEAT_MS` | 15_000 | detect dead connections within ~30s |
| `RECONNECT_BACKOFF_MS` | 1s → 2s → 4s → 8s → 16s → 30s cap, ±20% jitter | standard exponential, jitter prevents thundering herd after server restart |
| `OUTBOX_BATCH_MAX_BYTES` | 262_144 (256 KB) | bounds per-message memory on server |
| `WS_MAX_FRAME_BYTES` | 1_048_576 (1 MB) | `ws` maxPayload; hard transport cap |
| `DOC_MAX_BYTES` | 26_214_400 (25 MB) | semantic cap on materialized doc size |
| `AUTOSNAPSHOT_EVERY_UPDATES` | 50 | version timeline granularity |
| `AUTOSNAPSHOT_MIN_INTERVAL_MS` | 600_000 (10 min) | dedupes bursts |
| `COMPACT_AFTER_UPDATES` | 500 | fold tail into doc_compactions |
| `RATE_LIMIT_MSGS` | 120 per 10s per connection | ~1 update/100ms legit ceiling + headroom |
| `TOKEN_TTL_S` | 60 | single-use connect ticket |
| `PRESENCE_THROTTLE_MS` | 50 | remote cursor repaint budget |
| `AI_LABEL_TIMEOUT_MS` | 2_000 | AI version label is best-effort, never blocks snapshot |

## Environment Variables (complete list, mirrored in `.env.example`)

```
DATABASE_URL=                # Neon pooled connection string
DIRECT_DATABASE_URL=         # Neon direct (for migrations)
AUTH_SECRET=                 # Auth.js session JWT secret
AUTH_GOOGLE_ID= / AUTH_GOOGLE_SECRET=
AUTH_GITHUB_ID= / AUTH_GITHUB_SECRET=
COLLAB_JWT_SECRET=           # shared between Next.js app and collab server
NEXT_PUBLIC_COLLAB_WS_URL=   # wss://... of collab server
GROQ_API_KEY=                # (or GOOGLE_GENERATIVE_AI_API_KEY)
SENTRY_DSN=                  # optional
```
