-- Row Level Security policies (plan/02-data-model.md, plan/06-auth-security.md).
-- Applied after `prisma migrate` via: psql $DIRECT_DATABASE_URL -f prisma/rls.sql
-- (or folded into a manual migration once the DB exists).
--
-- The app sets `SET LOCAL app.user_id = '<uuid>'` inside every transaction
-- (see src/db.ts withUserContext). These policies are defense-in-depth
-- beneath the app-level scoping — they hold even if application code has
-- a bug. NOTE: the app must connect as a NON-superuser, non-table-owner
-- role (or a role with FORCE ROW LEVEL SECURITY on these tables) for RLS
-- to actually apply.

alter table documents         enable row level security;
alter table document_members  enable row level security;
alter table doc_updates       enable row level security;
alter table document_versions enable row level security;
alter table comments          enable row level security;

alter table documents         force row level security;
alter table document_members  force row level security;
alter table doc_updates       force row level security;
alter table document_versions force row level security;
alter table comments          force row level security;

create or replace function app_user_id() returns uuid as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$ language sql stable;

create or replace function is_document_member(doc_id uuid) returns boolean as $$
  select exists (
    select 1 from document_members
    where document_id = doc_id and user_id = app_user_id()
  );
$$ language sql stable security definer;

create or replace function can_edit_document(doc_id uuid) returns boolean as $$
  select exists (
    select 1 from document_members
    where document_id = doc_id
      and user_id = app_user_id()
      and role in ('owner', 'editor')
  );
$$ language sql stable security definer;

-- documents: members can read; only the owner can update/delete.
drop policy if exists documents_select on documents;
create policy documents_select on documents
  for select using (is_document_member(id));

drop policy if exists documents_update on documents;
create policy documents_update on documents
  for update using (owner_id = app_user_id());

drop policy if exists documents_delete on documents;
create policy documents_delete on documents
  for delete using (owner_id = app_user_id());

drop policy if exists documents_insert on documents;
create policy documents_insert on documents
  for insert with check (owner_id = app_user_id());

-- document_members: members can see the roster; only the owner mutates it.
drop policy if exists members_select on document_members;
create policy members_select on document_members
  for select using (is_document_member(document_id));

drop policy if exists members_write on document_members;
create policy members_write on document_members
  for all using (
    exists (select 1 from documents d where d.id = document_id and d.owner_id = app_user_id())
  ) with check (
    exists (select 1 from documents d where d.id = document_id and d.owner_id = app_user_id())
  );

-- doc_updates: members read; ONLY owner/editor may insert — this is the
-- database-level guarantee that Viewers cannot push state (plan/06 §3).
drop policy if exists updates_select on doc_updates;
create policy updates_select on doc_updates
  for select using (is_document_member(document_id));

drop policy if exists updates_insert on doc_updates;
create policy updates_insert on doc_updates
  for insert with check (can_edit_document(document_id));

-- document_versions: members read; owner/editor create.
drop policy if exists versions_select on document_versions;
create policy versions_select on document_versions
  for select using (is_document_member(document_id));

drop policy if exists versions_insert on document_versions;
create policy versions_insert on document_versions
  for insert with check (can_edit_document(document_id));

-- comments: members read; any member (incl. viewer) may comment (plan/14 §6).
drop policy if exists comments_select on comments;
create policy comments_select on comments
  for select using (is_document_member(document_id));

drop policy if exists comments_insert on comments;
create policy comments_insert on comments
  for insert with check (is_document_member(document_id) and author_id = app_user_id());
