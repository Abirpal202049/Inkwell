-- Row Level Security policies (plan/02-data-model.md, plan/06-auth-security.md).
-- Applied after `prisma migrate` via:
--   docker exec -i inkwell-postgres psql -U inkwell -d inkwell < backend/prisma/rls.sql
--
-- The app sets `set_config('app.user_id', ..., true)` inside every
-- user-scoped transaction (src/db.ts withUserContext). These policies are
-- defense-in-depth beneath the app-level scoping.
--
-- IMPORTANT (how enforcement works): policies apply to any role that is
-- not the table owner. In production, connect as the dedicated
-- non-owner role created at the bottom of this file so RLS actually
-- bites; local dev connecting as the owner relies on app-level scoping
-- (identical queries, same WHERE clauses) — the policies are exercised
-- by CI/integration tests using the app role.
--
-- The helper functions are SECURITY DEFINER (run as the table owner) so
-- membership lookups inside policies bypass RLS — this is also what
-- prevents infinite policy recursion on document_members.

alter table documents                     enable row level security;
alter table document_members              enable row level security;
alter table doc_updates                   enable row level security;
alter table document_versions             enable row level security;
alter table document_version_contributors enable row level security;
alter table comments                      enable row level security;

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

create or replace function owns_document(doc_id uuid) returns boolean as $$
  select exists (
    select 1 from documents where id = doc_id and owner_id = app_user_id()
  );
$$ language sql stable security definer;

-- documents: members read; owner/editor may update (editors touch
-- latest_seq and the mirrored title); only the owner deletes.
drop policy if exists documents_select on documents;
create policy documents_select on documents
  for select using (is_document_member(id));

drop policy if exists documents_update on documents;
create policy documents_update on documents
  for update using (can_edit_document(id));

drop policy if exists documents_delete on documents;
create policy documents_delete on documents
  for delete using (owner_id = app_user_id());

drop policy if exists documents_insert on documents;
create policy documents_insert on documents
  for insert with check (owner_id = app_user_id());

-- document_members: members see the roster; only the owner mutates it.
-- (Helpers are security definer, so no policy recursion here.)
drop policy if exists members_select on document_members;
create policy members_select on document_members
  for select using (user_id = app_user_id() or is_document_member(document_id));

drop policy if exists members_write on document_members;
create policy members_write on document_members
  for all using (owns_document(document_id))
  with check (owns_document(document_id));

-- doc_updates: members read; ONLY owner/editor may insert — this is the
-- database-level guarantee that Viewers cannot push state (plan/06 §3).
drop policy if exists updates_select on doc_updates;
create policy updates_select on doc_updates
  for select using (is_document_member(document_id));

drop policy if exists updates_insert on doc_updates;
create policy updates_insert on doc_updates
  for insert with check (can_edit_document(document_id));

-- Retention pruning (plan/11) runs from the scheduler with NO user
-- context — only that system context may delete log rows; user-scoped
-- transactions never can.
drop policy if exists updates_delete on doc_updates;
create policy updates_delete on doc_updates
  for delete using (app_user_id() is null);

-- document_versions: members read; owner/editor create; only the owner
-- context deletes (the session-merge in runMaintenance, which runs
-- system-on-behalf-of-owner, folds a fresh auto snapshot into its
-- successor by delete + recreate).
drop policy if exists versions_select on document_versions;
create policy versions_select on document_versions
  for select using (is_document_member(document_id));

drop policy if exists versions_insert on document_versions;
create policy versions_insert on document_versions
  for insert with check (can_edit_document(document_id));

drop policy if exists versions_delete on document_versions;
create policy versions_delete on document_versions
  for delete using (owns_document(document_id));

-- document_version_contributors: the audit-trail attribution rows. Scoped
-- through the owning version's document. (Security definer helper below;
-- deletes ride the ON DELETE CASCADE from document_versions, which
-- referential integrity performs regardless of RLS.)
create or replace function version_document_id(v_id uuid) returns uuid as $$
  select document_id from document_versions where id = v_id;
$$ language sql stable security definer;

drop policy if exists version_contributors_select on document_version_contributors;
create policy version_contributors_select on document_version_contributors
  for select using (is_document_member(version_document_id(version_id)));

drop policy if exists version_contributors_insert on document_version_contributors;
create policy version_contributors_insert on document_version_contributors
  for insert with check (can_edit_document(version_document_id(version_id)));

-- comments: members read; any member (incl. viewer) may comment (plan/14 §6).
drop policy if exists comments_select on comments;
create policy comments_select on comments
  for select using (is_document_member(document_id));

drop policy if exists comments_insert on comments;
create policy comments_insert on comments
  for insert with check (is_document_member(document_id) and author_id = app_user_id());

-- ---------------------------------------------------------------------------
-- Production application role (non-owner => RLS applies). Create once per
-- environment, set a real password, and point DATABASE_URL at it:
--
--   create role inkwell_app login password '<strong-password>';
--   grant usage on schema public to inkwell_app;
--   grant select, insert, update, delete on all tables in schema public to inkwell_app;
--   grant usage on all sequences in schema public to inkwell_app;
--   alter default privileges in schema public
--     grant select, insert, update, delete on tables to inkwell_app;
-- ---------------------------------------------------------------------------
