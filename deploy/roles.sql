-- Roles for the self-hosted setup. Run as the postgres superuser, in the
-- app database, AFTER schema_complete.sql (or after the data restore).
-- Replace :'authpw' by passing:  psql -v authpw='THE-PASSWORD' -f roles.sql
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end $$;
alter role authenticator with password :'authpw';
grant anon to authenticator;
grant service_role to authenticator;
grant usage on schema public to service_role, anon;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
-- Same lock-down as Supabase: RLS on, no policies, only service_role (which bypasses) gets in.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
notify pgrst, 'reload schema';
