-- Run AFTER website-intake-v8.sql. Rerunnable. Fixes from the Supabase advisors.
begin;

-- 1. Internal helpers that write accounting/invoice rows without a permission
--    check of their own. They are only called from other SECURITY DEFINER
--    functions, so staff must not be able to call them directly over the API.
--    (mail-v7 revoked an older 10-argument acc_post; the live one has 9.)
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'acc_post', 'write_freight_line', 'acc_check_cost_account', 'acc_owner_company',
      'acc_deposit_applied', 'rls_auto_enable')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- 2. Pin search_path on functions that were created without one.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.proname in (
      'money_round', 'require_fx', 'assignable_roles', 'unit_is_whole', 'acc_today', 'status_label',
      'grantable_permissions', 'storage_state', 'norm_phone', 'rpc_mode', 'lead_validate', 'yymm',
      'in_rpc', 'doc_token_from_text')
  loop
    execute format('alter function %s set search_path = public', f);
  end loop;
end $$;

-- 3. Two identical indexes on shipments(status); keep one.
drop index if exists public.bookings_status_idx;

-- 4. Index every foreign key in public that has no index starting with its
--    columns, so deletes on parents and joins on children do not scan.
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and n.nspname = 'public'
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)
  loop
    execute format('create index if not exists %I on %s (%s)', left(r.conname, 56) || '_idx', r.tbl, r.cols);
  end loop;
end $$;

commit;
notify pgrst, 'reload schema';
