-- Minimal Supabase-compatible objects needed to syntax/integration-test local
-- migrations against stock PostgreSQL. Production Supabase already owns these.

create role anon nologin;
create role authenticated nologin;

create schema auth;
create table auth.users (
  id uuid primary key
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create publication supabase_realtime;
