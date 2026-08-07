# Data Model

## PostgreSQL Schema (server source of truth)

```sql
-- Users (managed largely by Auth.js). The standard Auth.js adapter also
-- creates an `accounts` table (one row per linked OAuth provider — Google
-- and GitHub both link to the same users row by verified email, see
-- 06-auth-security.md). Emails stored lowercased.
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  name          text,
  image         text,
  created_at    timestamptz not null default now()
);

-- Documents (metadata only — content lives in doc_updates / snapshots).
-- NOTE: title's source of truth is INSIDE the Y.Doc (Y.Map('meta')) so
-- renames work offline; this column is a server-maintained mirror kept
-- fresh by the collab server (debounced 500ms) purely for cheap dashboard
-- list queries. See 14-google-docs-parity.md §3.
create table documents (
  id            uuid primary key default gen_random_uuid(),
  title         text not null default 'Untitled document',
  owner_id      uuid not null references users(id),
  -- link sharing (Google-Docs-style "Anyone with the link"):
  --   private   = members only
  --   link-view = any signed-in user with the link becomes a Viewer
  --   link-edit = any signed-in user with the link becomes an Editor
  share_mode    text not null default 'private'
                check (share_mode in ('private', 'link-view', 'link-edit')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,                  -- soft delete; purge after 30d
  -- monotonically increasing counter, used as the CRDT "state vector" cursor
  -- for cheap "give me everything after N" queries
  latest_seq    bigint not null default 0
);

-- Roles: Owner | Editor | Viewer, per user per document
create table document_members (
  document_id   uuid not null references documents(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  role          text not null check (role in ('owner', 'editor', 'viewer')),
  -- 'invite' = directly invited; 'link' = joined via share link.
  -- Downgrading share_mode to private deletes only granted_via='link' rows.
  granted_via   text not null default 'invite'
                check (granted_via in ('invite', 'link')),
  invited_at    timestamptz not null default now(),
  primary key (document_id, user_id)
);

-- Invites to emails that have no account yet; claimed (converted to a
-- document_members row) on first sign-in with that verified email.
-- Emails stored lowercased.
create table pending_invites (
  document_id   uuid not null references documents(id) on delete cascade,
  email         text not null,
  role          text not null check (role in ('editor', 'viewer')),
  invited_by    uuid references users(id),
  created_at    timestamptz not null default now(),
  primary key (document_id, email)
);

-- Idempotency ledger for sync batches (see 13-api-contracts.md).
-- A replayed batch is re-acked from here, never re-inserted. Pruned after 7d.
create table processed_batches (
  document_id   uuid not null references documents(id) on delete cascade,
  batch_id      uuid not null,
  acked_seq     bigint not null,
  created_at    timestamptz not null default now(),
  primary key (document_id, batch_id)
);

-- Append-only log of Yjs binary update deltas (the CRDT operation log).
-- This is the durable, replayable source of truth for real-time content.
create table doc_updates (
  id            bigserial primary key,
  document_id   uuid not null references documents(id) on delete cascade,
  seq           bigint not null,              -- per-document monotonic sequence
  update_bytes  bytea not null,               -- Yjs update (binary CRDT diff)
  author_id     uuid references users(id),
  byte_size     int not null,                 -- denormalized for fast quota checks
  created_at    timestamptz not null default now(),
  unique (document_id, seq)
);
create index on doc_updates (document_id, seq);

-- Compacted state: periodically we squash doc_updates into a single blob so
-- doc_updates doesn't grow unbounded (see 11-scalability-tradeoffs.md).
create table doc_compactions (
  document_id   uuid primary key references documents(id) on delete cascade,
  state_bytes   bytea not null,               -- Y.encodeStateAsUpdate() snapshot
  up_to_seq     bigint not null,              -- doc_updates with seq <= this are folded in
  compacted_at  timestamptz not null default now()
);

-- Named / auto version snapshots for Time Travel (human-meaningful checkpoints,
-- distinct from doc_compactions which is an internal storage optimization).
create table document_versions (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references documents(id) on delete cascade,
  label         text,                          -- e.g. "Before rewrite", nullable = auto
  state_bytes   bytea not null,                -- full Y.doc snapshot at this point
  created_by    uuid references users(id),
  created_at    timestamptz not null default now(),
  is_auto       boolean not null default false -- auto-snapshot vs user-triggered
);
create index on document_versions (document_id, created_at desc);

-- Comments (STRETCH feature — schema fixed now so nothing fights it later;
-- see 14-google-docs-parity.md §6). Anchors are serialized Y.RelativePosition
-- values, which survive concurrent edits; never absolute offsets.
create table comments (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references documents(id) on delete cascade,
  author_id     uuid not null references users(id),
  body          text not null check (char_length(body) <= 4000),
  anchor        bytea not null,               -- Y.RelativePosition (start)
  head          bytea not null,               -- Y.RelativePosition (end)
  parent_id     uuid references comments(id), -- one-level threading
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index on comments (document_id, created_at);

-- Presence/session table for realtime auth token issuance & auditing
create table collab_sessions (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references documents(id) on delete cascade,
  user_id       uuid not null references users(id),
  token_hash    text not null,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);
```

### Row Level Security (RLS)

```sql
alter table documents enable row level security;
alter table document_members enable row level security;
alter table doc_updates enable row level security;
alter table document_versions enable row level security;

-- Helper: is the current session user a member of this document?
create or replace function is_document_member(doc_id uuid) returns boolean as $$
  select exists (
    select 1 from document_members
    where document_id = doc_id and user_id = current_setting('app.user_id')::uuid
  );
$$ language sql stable;

create policy select_own_documents on documents
  for select using (is_document_member(id));

create policy select_own_updates on doc_updates
  for select using (is_document_member(document_id));

create policy insert_updates_if_editor on doc_updates
  for insert with check (
    exists (
      select 1 from document_members
      where document_id = doc_updates.document_id
        and user_id = current_setting('app.user_id')::uuid
        and role in ('owner', 'editor')
    )
  );

create policy select_versions on document_versions
  for select using (is_document_member(document_id));
```

`current_setting('app.user_id')` is set per-request/per-connection via
`SET LOCAL app.user_id = $1` inside a transaction, populated from the
verified session — this is the strict tenant-isolation mechanism required by
the assignment. Application code (Prisma/Drizzle) additionally scopes every
query by `document_id` + membership as defense in depth, in case RLS is ever
misconfigured (belt-and-suspenders, not a substitute).

## Client-Side Schema (IndexedDB, via `y-indexeddb` + custom stores)

```
Database: inkwell-db
  ObjectStore: yjs-updates          # managed by y-indexeddb (per-doc CRDT log)
  ObjectStore: outbox
    { id, documentId, updateBytes, createdAt, attempts, lastError }
  ObjectStore: document-meta
    { documentId, title, lastSyncedSeq, lastSyncedAt, role, dirty }
  ObjectStore: version-cache
    { versionId, documentId, label, createdAt, isAuto }  # metadata only,
                                                          # full snapshot fetched on demand
```

- `outbox` is the durable queue of local edits not yet acknowledged by the
  server — this is what survives a browser crash mid-sync (see
  [03-sync-engine.md](03-sync-engine.md)).
- `lastSyncedSeq` is the client's watermark into the server's `doc_updates`
  log, used to request "everything since seq N" on reconnect.
