-- Run AFTER security-v9.sql. Rerunnable.
-- v10: a staff member may hold several roles, and email runs through shared
-- department mailboxes (sales@, accounting@ ...) instead of one personal box each.
begin;

-- ───────── 1. Extra roles ─────────
-- profiles.role stays the primary role (Admin is only ever primary). Extra roles
-- add their permissions to the same person, e.g. Manager + HR + Accounting.
create table if not exists public.staff_roles (
  user_id    uuid not null references public.profiles(id),
  role       public.app_role not null,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role),
  check (role <> 'admin')
);
create index if not exists staff_roles_role_idx on public.staff_roles (role);
create index if not exists staff_roles_granted_by_idx on public.staff_roles (granted_by);
alter table public.staff_roles enable row level security;
revoke all on public.staff_roles from public, anon, authenticated;
grant select on public.staff_roles to authenticated;
grant all on public.staff_roles to service_role;
drop policy if exists staff_roles_read on public.staff_roles;
create policy staff_roles_read on public.staff_roles for select to authenticated
  using (user_id = (select auth.uid()) or public.has_perm('staff.read'));

create or replace function public.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and (
    p.role = 'admin' or p.role = any(roles)
    or exists (select 1 from public.staff_roles s where s.user_id = p.id and s.role = any(roles))));
$$;

create or replace function public.has_perm(p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'admin')
  or exists (select 1 from public.profiles p join public.role_permissions rp on rp.role = p.role
             where p.id = auth.uid() and p.active and rp.permission = p_perm)
  or exists (select 1 from public.profiles p join public.staff_roles s on s.user_id = p.id
             join public.role_permissions rp on rp.role = s.role
             where p.id = auth.uid() and p.active and rp.permission = p_perm)
  or exists (select 1 from public.permission_grants g join public.profiles p on p.id = g.user_id and p.active
             where g.user_id = auth.uid() and g.permission = p_perm and g.revoked_at is null
               and (g.expires_at is null or g.expires_at > now()));
$$;

create or replace function public.my_permissions() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(distinct x.permission), '[]'::jsonb) from (
    select rp.permission from public.profiles p join public.role_permissions rp on rp.role = p.role
     where p.id = auth.uid() and p.active
    union
    select rp.permission from public.profiles p join public.staff_roles s on s.user_id = p.id
      join public.role_permissions rp on rp.role = s.role
     where p.id = auth.uid() and p.active
    union
    select g.permission from public.permission_grants g join public.profiles p on p.id = g.user_id and p.active
     where g.user_id = auth.uid() and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
  ) x;
$$;

create or replace function public.admin_set_staff_roles(p_user uuid, p_roles text[]) returns void
language plpgsql security definer set search_path = public as $$
declare u public.profiles; r text; clean text[];
begin
  perform public.require_role('admin');
  select * into u from public.profiles where id = p_user for update;
  if u.id is null or u.deleted_at is not null then raise exception 'NOT_FOUND: user'; end if;
  select coalesce(array_agg(distinct x), '{}') into clean
    from unnest(coalesce(p_roles, '{}')) x where x <> u.role::text;
  foreach r in array clean loop
    if r = 'admin' or not (r = any (public.assignable_roles())) then
      raise exception 'REFUSED: % cannot be an additional role', r;
    end if;
  end loop;
  delete from public.staff_roles where user_id = p_user and not (role::text = any (clean));
  insert into public.staff_roles(user_id, role, granted_by)
    select p_user, x::public.app_role, auth.uid() from unnest(clean) x
    on conflict do nothing;
  perform public.log_audit('staff.roles', 'profile', p_user::text, jsonb_build_object('extra_roles', clean));
end $$;
revoke all on function public.admin_set_staff_roles(uuid, text[]) from public, anon;
grant execute on function public.admin_set_staff_roles(uuid, text[]) to authenticated;

-- ───────── 2. Department mailboxes ─────────
create table if not exists public.mail_mailboxes (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique,
  name            text not null,              -- department name shown in From and the signature
  password_cipher text,                       -- null until the administrator connects it
  uid_validity    text,
  last_uid        bigint,
  lease_until     timestamptz,
  connected_by    uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create table if not exists public.mail_mailbox_members (
  mailbox_id uuid not null references public.mail_mailboxes(id) on delete cascade,
  user_id    uuid not null references public.profiles(id),
  added_by   uuid references public.profiles(id),
  added_at   timestamptz not null default now(),
  primary key (mailbox_id, user_id)
);
create index if not exists mail_mailbox_members_user_idx on public.mail_mailbox_members (user_id);
create index if not exists mail_mailbox_members_added_by_idx on public.mail_mailbox_members (added_by);
create index if not exists mail_mailboxes_connected_by_idx on public.mail_mailboxes (connected_by);
alter table public.mail_mailboxes enable row level security;
alter table public.mail_mailbox_members enable row level security;
revoke all on public.mail_mailboxes, public.mail_mailbox_members from public, anon, authenticated;
grant all on public.mail_mailboxes, public.mail_mailbox_members to service_role;

-- Who sent each department email, for the audit trail.
alter table public.mail_deliveries add column if not exists mailbox_id uuid references public.mail_mailboxes(id);
create index if not exists mail_deliveries_mailbox_idx on public.mail_deliveries (mailbox_id);

-- Administrators use every mailbox; other staff only the ones they belong to.
create or replace function public.mail_can_use_mailbox(p_user uuid, p_mailbox uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.mail_user_allowed(p_user) and exists (
    select 1 from public.profiles p where p.id = p_user and (p.role = 'admin' or exists (
      select 1 from public.mail_mailbox_members m where m.mailbox_id = p_mailbox and m.user_id = p_user)));
$$;
revoke all on function public.mail_can_use_mailbox(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mail_can_use_mailbox(uuid, uuid) to service_role;

create or replace function public.mail_user_allowed(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_user and p.active and p.deleted_at is null and (
    p.role = 'admin'
    or exists (select 1 from public.role_permissions r where r.role = p.role and r.permission = 'mail.use')
    or exists (select 1 from public.staff_roles s join public.role_permissions r on r.role = s.role
               where s.user_id = p.id and r.permission = 'mail.use')
    or exists (select 1 from public.permission_grants g where g.user_id = p.id and g.permission = 'mail.use'
      and g.revoked_at is null and (g.expires_at is null or g.expires_at > now()))
  ));
$$;

create or replace function public.mail_claim_mailbox(p_mailbox uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.mail_mailboxes set lease_until = now() + interval '90 seconds'
    where id = p_mailbox and password_cipher is not null and (lease_until is null or lease_until < now());
  return found;
end $$;
revoke all on function public.mail_claim_mailbox(uuid) from public, anon, authenticated;
grant execute on function public.mail_claim_mailbox(uuid) to service_role;

create or replace function public.admin_set_mailbox_members(p_mailbox uuid, p_users uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role('admin');
  if not exists (select 1 from public.mail_mailboxes where id = p_mailbox) then
    raise exception 'NOT_FOUND: mailbox'; end if;
  if exists (select 1 from unnest(coalesce(p_users, '{}')) u
             where not exists (select 1 from public.profiles p where p.id = u and p.active and p.deleted_at is null)) then
    raise exception 'REFUSED: only active staff can use a mailbox'; end if;
  delete from public.mail_mailbox_members where mailbox_id = p_mailbox and not (user_id = any (coalesce(p_users, '{}')));
  insert into public.mail_mailbox_members(mailbox_id, user_id, added_by)
    select p_mailbox, u, auth.uid() from unnest(coalesce(p_users, '{}')) u on conflict do nothing;
  perform public.log_audit('mail.mailbox_members', 'mail_mailbox', p_mailbox::text,
    jsonb_build_object('members', coalesce(p_users, '{}')));
end $$;
revoke all on function public.admin_set_mailbox_members(uuid, uuid[]) from public, anon;
grant execute on function public.admin_set_mailbox_members(uuid, uuid[]) to authenticated;

-- Mailboxes and members for the administrator's settings screen (never the password).
create or replace function public.admin_mailboxes() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.has_role('admin') then null else coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'email', b.email, 'name', b.name, 'connected', b.password_cipher is not null,
    'members', coalesce((select jsonb_agg(m.user_id) from public.mail_mailbox_members m where m.mailbox_id = b.id), '[]'::jsonb))
    order by b.name), '[]'::jsonb) end
  from public.mail_mailboxes b;
$$;
revoke all on function public.admin_mailboxes() from public, anon;
grant execute on function public.admin_mailboxes() to authenticated;

-- Each staff member's mailboxes, for the staff profile screen.
create or replace function public.staff_mailboxes(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(m.mailbox_id), '[]'::jsonb) from public.mail_mailbox_members m
   where m.user_id = p_user and (p_user = auth.uid() or public.has_role('admin'));
$$;
revoke all on function public.staff_mailboxes(uuid) from public, anon;
grant execute on function public.staff_mailboxes(uuid) to authenticated;

create or replace function public.admin_set_staff_mailboxes(p_user uuid, p_mailboxes uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role('admin');
  if not exists (select 1 from public.profiles where id = p_user and active and deleted_at is null) then
    raise exception 'REFUSED: only active staff can use a mailbox'; end if;
  delete from public.mail_mailbox_members where user_id = p_user and not (mailbox_id = any (coalesce(p_mailboxes, '{}')));
  insert into public.mail_mailbox_members(mailbox_id, user_id, added_by)
    select b.id, p_user, auth.uid() from public.mail_mailboxes b where b.id = any (coalesce(p_mailboxes, '{}'))
    on conflict do nothing;
  perform public.log_audit('staff.mailboxes', 'profile', p_user::text,
    jsonb_build_object('mailboxes', coalesce(p_mailboxes, '{}')));
end $$;
revoke all on function public.admin_set_staff_mailboxes(uuid, uuid[]) from public, anon;
grant execute on function public.admin_set_staff_mailboxes(uuid, uuid[]) to authenticated;

-- The company's department mailboxes (created in cPanel). Passwords are added in the app.
insert into public.mail_mailboxes(email, name) values
  ('ceo@horsecargoltd.com', 'CEO Office'),
  ('administration@horsecargoltd.com', 'Administration'),
  ('accounting@horsecargoltd.com', 'Accounting'),
  ('sales@horsecargoltd.com', 'Sales'),
  ('marketing@horsecargoltd.com', 'Marketing'),
  ('sourcing@horsecargoltd.com', 'Sourcing'),
  ('stores@horsecargoltd.com', 'Stores and Dispatch')
on conflict (email) do nothing;

-- ───────── 3. Deleting a staff member also removes roles and mailbox access ─────────
create or replace function public.admin_prepare_delete_staff(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare u public.profiles;
begin
  perform pg_advisory_xact_lock(7349271);
  perform public.require_role('admin');
  if p_user = auth.uid() then raise exception 'REFUSED: you cannot delete yourself'; end if;
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'REFUSED: enter a reason'; end if;
  select * into u from public.profiles where id = p_user for update;
  if u.id is null then raise exception 'NOT_FOUND: user'; end if;
  if u.deleted_at is not null then return; end if;
  if u.role = 'admin' and not exists (
    select 1 from public.profiles where role = 'admin' and active and deleted_at is null and id <> p_user
  ) then raise exception 'REFUSED: keep at least one active administrator'; end if;
  perform set_config('app.staff_deleting', 'yes', true);
  update public.profiles set active = false, deleted_at = now() where id = p_user;
  update public.permission_grants set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = 'staff deleted'
    where user_id = p_user and revoked_at is null;
  delete from public.staff_roles where user_id = p_user;
  delete from public.mail_mailbox_members where user_id = p_user;
  delete from public.mail_accounts where user_id = p_user;
  delete from public.mail_push_subscriptions where user_id = p_user;
  delete from public.mail_drafts where user_id = p_user;
  perform public.log_audit('staff.delete', 'profile', p_user::text,
    jsonb_build_object('reason', trim(p_reason), 'email', u.email, 'retained_history', true));
end $$;
revoke all on function public.admin_prepare_delete_staff(uuid,text) from public, anon;
grant execute on function public.admin_prepare_delete_staff(uuid,text) to authenticated;

commit;
notify pgrst, 'reload schema';
