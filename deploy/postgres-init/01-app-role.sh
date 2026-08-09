#!/bin/bash
# Runs ONCE, on first Postgres boot with an empty data volume
# (docker-entrypoint-initdb.d). Creates the non-owner application role the
# backend connects as — RLS policies (backend/prisma/rls.sql) don't bind to
# the table owner, so connecting as `inkwell` would silently bypass them.
#
# The `alter default privileges` statements run as `inkwell` (the future
# table owner), so tables created later by prisma migrate are granted to
# inkwell_app automatically.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	create role inkwell_app login password '${APP_DB_PASSWORD}';
	grant usage on schema public to inkwell_app;
	grant select, insert, update, delete on all tables in schema public to inkwell_app;
	grant usage, select on all sequences in schema public to inkwell_app;
	alter default privileges in schema public
	  grant select, insert, update, delete on tables to inkwell_app;
	alter default privileges in schema public
	  grant usage, select on sequences to inkwell_app;
EOSQL
