-- Local PostgreSQL test setup only. Never run this in a Supabase project.
create role anon nologin;
create role authenticated nologin;
create schema auth;
grant usage on schema public to authenticated, anon;
create table auth.users (
  id uuid primary key, email text, encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
-- Supabase grants SELECT on newly created views/tables by default. RLS and
-- explicit write revocations in the migrations still enforce access.
alter default privileges in schema public grant select on tables to authenticated;
