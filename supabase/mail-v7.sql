-- Run AFTER crm-mail-v6-1-roles.sql and crm-mail-v6-2.sql. Rerunnable.
begin;
grant usage on schema public to service_role;
alter table public.profiles add column if not exists deleted_at timestamptz;
alter table public.profiles add column if not exists auth_deleted_at timestamptz;

-- Keep the profile as an audit tombstone: financial records reference its ID.
create or replace function public.trg_profile_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and current_setting('app.staff_deleting', true) is distinct from 'yes' then
    new.deleted_at := old.deleted_at; new.auth_deleted_at := old.auth_deleted_at;
  end if;
  if old.deleted_at is not null then
    new.active := false; new.deleted_at := old.deleted_at;
  elsif auth.uid() is not null and not public.has_role('admin') then
    new.role := old.role; new.active := old.active; new.branch_code := old.branch_code;
    new.deleted_at := old.deleted_at; new.auth_deleted_at := old.auth_deleted_at;
  end if;
  new.id := old.id; new.email := old.email;
  return new;
end $$;

create table if not exists public.mail_accounts (
  user_id uuid primary key references public.profiles(id),
  email text not null unique,
  password_cipher text not null,
  uid_validity text,
  last_uid bigint,
  lease_until timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists public.mail_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.mail_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);
-- Durable send reservation: retries never blindly send a second email.
create table if not exists public.mail_deliveries (
  id uuid primary key,
  user_id uuid not null references public.profiles(id),
  status text not null default 'sending' check (status in ('sending','sent','uncertain')),
  message_id text,
  sent_copy boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.mail_accounts enable row level security;
alter table public.mail_drafts enable row level security;
alter table public.mail_push_subscriptions enable row level security;
alter table public.mail_deliveries enable row level security;
revoke all on public.mail_accounts, public.mail_drafts, public.mail_push_subscriptions, public.mail_deliveries from public, anon, authenticated;
grant all on public.mail_accounts, public.mail_drafts, public.mail_push_subscriptions, public.mail_deliveries to service_role;
grant select, update on public.profiles to service_role;

create or replace function public.mail_claim_poll(p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.mail_accounts set lease_until = now() + interval '90 seconds'
    where user_id = p_user and (lease_until is null or lease_until < now());
  return found;
end $$;
revoke all on function public.mail_claim_poll(uuid) from public, anon, authenticated;
grant execute on function public.mail_claim_poll(uuid) to service_role;

create or replace function public.mail_user_allowed(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_user and p.active and p.deleted_at is null and (
    p.role = 'admin' or exists (select 1 from public.role_permissions r where r.role = p.role and r.permission = 'mail.use')
    or exists (select 1 from public.permission_grants g where g.user_id = p.id and g.permission = 'mail.use'
      and g.revoked_at is null and (g.expires_at is null or g.expires_at > now()))
  ));
$$;
revoke all on function public.mail_user_allowed(uuid) from public, anon, authenticated;
grant execute on function public.mail_user_allowed(uuid) to service_role;

create or replace function public.admin_prepare_delete_staff(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare u public.profiles;
begin
  -- Serialize administrator removal, including two administrators deleting each other.
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
  delete from public.mail_accounts where user_id = p_user;
  delete from public.mail_push_subscriptions where user_id = p_user;
  delete from public.mail_drafts where user_id = p_user;
  perform public.log_audit('staff.delete', 'profile', p_user::text,
    jsonb_build_object('reason', trim(p_reason), 'email', u.email, 'retained_history', true));
end $$;
revoke all on function public.admin_prepare_delete_staff(uuid,text) from public, anon;
grant execute on function public.admin_prepare_delete_staff(uuid,text) to authenticated;

-- Old JWTs must not read historical internal mail directly after deletion.
create or replace function public.mail_is_participant(p_thread uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_perm('mail.use') and (
    exists (select 1 from public.mail_messages m where m.thread_id = p_thread and m.sender_id = auth.uid())
    or exists (select 1 from public.mail_messages m join public.mail_recipients r on r.message_id = m.id
      where m.thread_id = p_thread and r.user_id = auth.uid())
  );
$$;
drop policy if exists own_read on public.mail_recipients;
create policy own_read on public.mail_recipients for select to authenticated using (
  public.has_perm('mail.use') and (user_id = auth.uid() or exists (
    select 1 from public.mail_messages m where m.id = message_id and m.sender_id = auth.uid()
  ))
);
drop policy if exists own_read on public.mail_thread_state;
create policy own_read on public.mail_thread_state for select to authenticated
  using (public.has_perm('mail.use') and user_id = auth.uid());

-- v4's broad function grant re-exposed these owner-only accounting helpers.
-- Keep financial RPCs working internally while refusing stale/deleted JWTs.
do $$
declare signature text;
begin
  foreach signature in array array[
    'acc_post(text,date,text,text,text,jsonb,uuid,uuid,uuid,text)',
    'acc_reverse(uuid,text,date)', 'acc_reverse_source(text,text,text)',
    'acc_post_receipt(uuid)', 'acc_void_receipt(uuid)', 'acc_apply_deposits(uuid,uuid)',
    'acc_post_invoice_line(bigint)', 'acc_post_costs(text,date,text,text,text,jsonb,jsonb,uuid,text,numeric,text)',
    'acc_seed_coa(text)', 'acc_add_money_account(text,text,text,text,text,text,text)'
  ] loop
    if to_regprocedure('public.' || signature) is not null then
      execute 'revoke all on function public.' || signature || ' from public, anon, authenticated';
    end if;
  end loop;
end $$;
commit;
notify pgrst, 'reload schema';
