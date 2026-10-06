-- =====================================================================
--  HORSE CARGO — v6 · step 1 of 2  (run on its own, BEFORE crm-mail-v6-2.sql)
--  Adds the new operational staff roles. Postgres cannot use a new enum
--  value in the same transaction that creates it, so this file is separate.
--  Existing roles are NOT removed: anyone who holds one keeps it.
-- =====================================================================
alter type public.app_role add value if not exists 'hr';
alter type public.app_role add value if not exists 'logistics';
alter type public.app_role add value if not exists 'sales_marketing';
alter type public.app_role add value if not exists 'sourcing';
alter type public.app_role add value if not exists 'customer_care';
