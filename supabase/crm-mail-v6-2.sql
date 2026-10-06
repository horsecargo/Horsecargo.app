-- =====================================================================
--  HORSE CARGO — v6 · step 2 of 2
--  Staff roles & editable permissions · unified document QR registry and
--  staff Scan resolver · Leads · Sourcing · Staff Mail · registers and
--  global search.
--
--  Run AFTER crm-mail-v6-1-roles.sql (which must be committed first) and
--  after documents-packing-v5.sql. Additive and rerunnable: no data is
--  deleted, no existing role is removed, and permissions an administrator
--  edits later are NOT overwritten by running this file again.
-- =====================================================================
begin;
set local client_min_messages = warning;

create table if not exists public.app_migrations (
  key        text primary key,
  applied_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 1. ROLES
-- ---------------------------------------------------------------------
-- The eight operational roles. 'admin' stays for system administration only.
-- Counter, Warehouse, Cashier, Release officer, Finance manager and Viewer are
-- retired from NEW assignment: whoever holds one keeps it and its permissions.
create or replace function public.assignable_roles() returns text[]
language sql immutable as $$
  select array['admin','manager','operations','hr','accountant','logistics',
               'sales_marketing','sourcing','customer_care']::text[]
$$;

-- people who sign up without an invitation start inactive on the least
-- privileged operational role (previously the retired 'counter')
alter table public.staff_invites alter column role set default 'customer_care';
do $$ declare src text;
begin
  src := pg_get_functiondef('public.handle_new_user()'::regprocedure);
  if position('else ''counter''::public.app_role end' in src) > 0 then
    execute replace(src, 'else ''counter''::public.app_role end', 'else ''customer_care''::public.app_role end');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. PERMISSION CATALOGUE (what the administrator can switch per role)
-- ---------------------------------------------------------------------
create table if not exists public.permission_catalog (
  permission text primary key,
  module     text not null,
  sort       int  not null default 0,
  label_en   text not null,
  label_sw   text not null
);

insert into public.permission_catalog(permission, module, sort, label_en, label_sw) values
 ('customer.read','customers',10,'View customers','Kuona wateja'),
 ('customer.write','customers',11,'Create / edit customers','Kuunda / kuhariri wateja'),
 ('lead.create','leads',20,'Record leads','Kurekodi leads'),
 ('lead.read','leads',21,'See all leads (team view)','Kuona leads zote'),
 ('lead.assign','leads',22,'Assign / reassign leads','Kugawa leads'),
 ('lead.convert','leads',23,'Convert lead to customer','Kubadili lead kuwa mteja'),
 ('sourcing.read','sourcing',30,'See all sourcing requests','Kuona maombi yote ya sourcing'),
 ('sourcing.write','sourcing',31,'Create / update sourcing','Kuunda / kusasisha sourcing'),
 ('shipment.read','shipments',40,'View shipments','Kuona shipments'),
 ('shipment.create','shipments',41,'Create shipments','Kuunda shipments'),
 ('shipment.edit','shipments',42,'Edit shipments','Kuhariri shipments'),
 ('shipment.status','shipments',43,'Change shipment status','Kubadili hali ya shipment'),
 ('shipment.cancel','shipments',44,'Cancel shipments','Kughairi shipments'),
 ('tracking.note','shipments',45,'Add tracking notes','Kuongeza maelezo ya ufuatiliaji'),
 ('deliver','shipments',46,'Hand over cargo','Kukabidhi mzigo'),
 ('rate.override','shipments',47,'Override freight rate','Kubadili bei ya usafirishaji'),
 ('grn.read','grn',50,'View GRNs','Kuona GRN'),
 ('grn.record','grn',51,'Record GRN','Kurekodi GRN'),
 ('label.read','labels',55,'Print cargo labels','Kuchapisha lebo za mizigo'),
 ('invoice.read','invoice',60,'View invoices','Kuona ankara'),
 ('charge.add','invoice',61,'Add extra charges','Kuongeza gharama za ziada'),
 ('charge.discount','invoice',62,'Give discounts','Kutoa punguzo'),
 ('charge.remove','invoice',63,'Remove charges','Kuondoa gharama'),
 ('currency.set','invoice',64,'Set invoice currency','Kuweka sarafu ya ankara'),
 ('payment.read','payments',70,'View payments','Kuona malipo'),
 ('payment.record','payments',71,'Record payments','Kurekodi malipo'),
 ('payment.void','payments',72,'Void payments','Kubatilisha malipo'),
 ('storage.read','storage',80,'View storage','Kuona ghala'),
 ('storage.pack','storage',81,'Pack goods / packing lists','Kufunga mizigo / orodha za upakiaji'),
 ('storage.correct','storage',82,'Reverse packing entries','Kurekebisha ufungaji'),
 ('packing.read','packing',85,'View packing lists','Kuona orodha za upakiaji'),
 ('scan.use','scan',90,'Scan & identify documents','Kuskani na kutambua nyaraka'),
 ('doc.approve','scan',91,'Approve receipts / delivery notes','Kuidhinisha risiti / hati za makabidhiano'),
 ('doc.revoke','scan',92,'Revoke & replace document QR codes','Kubatilisha na kubadilisha QR za nyaraka'),
 ('mail.use','mail',100,'Use Staff Mail','Kutumia Barua za Wafanyakazi'),
 ('reports.read','reports',110,'View reports','Kuona ripoti'),
 ('audit.read','reports',111,'View audit log','Kuona kumbukumbu za ukaguzi'),
 ('acc.read','accounting',120,'View accounting','Kuona uhasibu'),
 ('acc.write','accounting',121,'Post accounting entries','Kuingiza maingizo ya uhasibu'),
 ('acc.approve','accounting',122,'Approve accounting entries','Kuidhinisha maingizo ya uhasibu'),
 ('staff.read','staff',130,'View staff directory','Kuona orodha ya wafanyakazi'),
 ('rates.write','settings',140,'Edit rate card','Kuhariri viwango'),
 ('settings.write','settings',141,'Edit settings','Kuhariri mipangilio')
on conflict (permission) do update set module = excluded.module, sort = excluded.sort,
  label_en = excluded.label_en, label_sw = excluded.label_sw;

-- Default permissions for the new roles, and the new module permissions for the
-- existing roles. Seeded ONCE: later edits by the administrator are kept.
do $$
begin
  if not exists (select 1 from public.app_migrations where key = 'v6.role_permissions') then
    insert into public.role_permissions(role, permission)
    select r::public.app_role, p from (values
      -- Manager: full operational access
      ('manager','shipment.read'),('manager','customer.read'),('manager','grn.read'),('manager','label.read'),
      ('manager','invoice.read'),('manager','payment.read'),('manager','packing.read'),('manager','scan.use'),
      ('manager','staff.read'),('manager','lead.create'),('manager','lead.read'),('manager','lead.assign'),
      ('manager','lead.convert'),('manager','sourcing.read'),('manager','sourcing.write'),('manager','mail.use'),
      ('manager','doc.revoke'),
      -- Operations
      ('operations','shipment.read'),('operations','grn.read'),('operations','label.read'),('operations','packing.read'),
      ('operations','scan.use'),('operations','customer.read'),('operations','customer.write'),
      ('operations','lead.create'),('operations','mail.use'),
      -- HR
      ('hr','staff.read'),('hr','mail.use'),('hr','lead.create'),
      -- Accounting (enum value 'accountant')
      ('accountant','invoice.read'),('accountant','payment.read'),('accountant','customer.read'),('accountant','customer.write'),
      ('accountant','grn.read'),('accountant','shipment.read'),('accountant','mail.use'),('accountant','lead.create'),
      -- Logistics
      ('logistics','shipment.read'),('logistics','shipment.create'),('logistics','shipment.edit'),('logistics','shipment.status'),
      ('logistics','tracking.note'),('logistics','deliver'),('logistics','grn.read'),('logistics','grn.record'),
      ('logistics','label.read'),('logistics','storage.read'),('logistics','storage.pack'),('logistics','packing.read'),
      ('logistics','scan.use'),('logistics','mail.use'),('logistics','lead.create'),
      -- Sales & Marketing
      ('sales_marketing','lead.create'),('sales_marketing','lead.read'),('sales_marketing','lead.convert'),
      ('sales_marketing','customer.read'),('sales_marketing','customer.write'),('sales_marketing','shipment.read'),
      ('sales_marketing','sourcing.read'),('sales_marketing','mail.use'),
      -- Sourcing
      ('sourcing','sourcing.read'),('sourcing','sourcing.write'),('sourcing','lead.create'),('sourcing','lead.read'),
      ('sourcing','customer.read'),('sourcing','mail.use'),
      -- Customer Care
      ('customer_care','customer.read'),('customer_care','customer.write'),('customer_care','lead.create'),
      ('customer_care','lead.read'),('customer_care','lead.convert'),('customer_care','shipment.read'),
      ('customer_care','scan.use'),('customer_care','mail.use')
    ) v(r, p)
    union all
    -- retired roles keep seeing every module they could see before, and can use the new staff tools
    select r::public.app_role, p
    from unnest(array['counter','warehouse','cashier','release_officer','finance_manager','viewer']) r
    cross join unnest(array['shipment.read','customer.read','grn.read','label.read','invoice.read','payment.read',
                            'packing.read','scan.use','lead.create','mail.use']) p
    union all
    select 'counter'::public.app_role, 'lead.read'
    on conflict do nothing;
    insert into public.app_migrations(key) values ('v6.role_permissions');
  end if;
end $$;

-- The administrator edits the matrix; the server keeps the guard rails.
create or replace function public.admin_set_role_permission(p_role text, p_permission text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role('admin');
  if p_role is null or p_role = 'admin' then raise exception 'REFUSED: the administrator always has every permission'; end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'app_role' and e.enumlabel = p_role) then
    raise exception 'REFUSED: unknown role';
  end if;
  if not exists (select 1 from public.permission_catalog where permission = p_permission) then
    raise exception 'REFUSED: unknown permission';
  end if;
  if p_enabled then
    insert into public.role_permissions(role, permission) values (p_role::public.app_role, p_permission)
    on conflict do nothing;
  else
    delete from public.role_permissions where role = p_role::public.app_role and permission = p_permission;
  end if;
  perform public.log_audit('role.permission', 'role', p_role,
          jsonb_build_object('permission', p_permission, 'enabled', p_enabled));
end $$;

-- customer writes follow the permission matrix instead of a fixed role list
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert to authenticated
  with check (public.has_perm('customer.write'));
drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers for update to authenticated
  using (public.has_perm('customer.write')) with check (public.has_perm('customer.write'));
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.has_perm('audit.read'));

-- ---------------------------------------------------------------------
-- 3. DOCUMENT QR REGISTRY — one opaque token per document, every type
-- ---------------------------------------------------------------------
alter table public.documents drop constraint if exists documents_doc_type_check;
alter table public.documents add constraint documents_doc_type_check
  check (doc_type in ('invoice','receipt','grn','release','waybill','packing_list','label'));

-- a replaced (revoked) token keeps resolving — to "revoked", never to the document
create table if not exists public.document_revoked_tokens (
  token       text primary key,
  document_id uuid not null references public.documents(id),
  revoked_at  timestamptz not null default now(),
  revoked_by  uuid references public.profiles(id),
  reason      text
);

create or replace function public.doc_meta(p_type text, p_doc_id text)
returns table(doc_ref text, issued_at timestamptz, shipment_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_type = 'invoice' then
    return query select i.ref, i.issued_at, i.shipment_id from public.invoices i where i.id = p_doc_id::uuid;
  elsif p_type = 'receipt' then
    return query select r.ref, r.received_at, r.shipment_id from public.receipts r where r.id = p_doc_id::uuid;
  elsif p_type = 'grn' then
    return query select g.ref, g.received_at, g.shipment_id from public.grns g where g.id = p_doc_id::uuid;
  elsif p_type = 'release' then
    return query select r.ref, r.released_at, r.shipment_id from public.releases r where r.id = p_doc_id::uuid;
  elsif p_type = 'waybill' then
    return query select s.ref, s.created_at, s.id from public.shipments s where s.id = p_doc_id::uuid;
  elsif p_type = 'packing_list' then
    return query select l.ref, l.created_at, null::uuid from public.packing_lists l where l.id = p_doc_id::uuid;
  elsif p_type = 'label' then
    return query select s.ref, coalesce((select g.received_at from public.grns g where g.shipment_id = s.id), s.created_at), s.id
                   from public.shipments s where s.id = p_doc_id::uuid;
  end if;
end $$;

-- internal: make sure a document has its registry row and token (no approvals for these)
create or replace function public.doc_issue(p_type text, p_doc_id text) returns public.documents
language plpgsql security definer set search_path = public as $$
declare d public.documents; m record;
begin
  if p_type not in ('invoice','receipt','grn','release','packing_list','label') then
    raise exception 'REFUSED: unsupported document';
  end if;
  select * into m from public.doc_meta(p_type, p_doc_id);
  if m.doc_ref is null then raise exception 'NOT_FOUND: document'; end if;
  insert into public.documents(doc_type, doc_id, shipment_id, doc_ref, issued_at, status)
  values (p_type, p_doc_id, m.shipment_id, m.doc_ref, m.issued_at,
          case when p_type in ('invoice','grn','packing_list','label') then 'issued' else 'pending' end)
  on conflict (doc_type, doc_id) do update set doc_ref = excluded.doc_ref, issued_at = excluded.issued_at,
    status = case when excluded.doc_type in ('invoice','grn','packing_list','label') then 'issued' else documents.status end
  returning * into d;
  return d;
end $$;

-- the app calls this when it shows/prints a document (same return shape as v5, plus document_id)
create or replace function public.doc_register(p_type text, p_doc_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.documents; exempt boolean;
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: staff only'; end if;
  d := public.doc_issue(p_type, p_doc_id);
  exempt := d.doc_type in ('invoice','grn','packing_list','label');
  return jsonb_build_object('token', d.token, 'status', d.status, 'version', d.version,
    'ref', d.doc_ref, 'type', d.doc_type, 'document_id', d.id,
    'approval_required', not exempt,
    'approved_by', case when not exempt then (select full_name from public.profiles where id = d.approved_by) end,
    'approved_at', case when not exempt then d.approved_at end);
end $$;

-- new document types never use approvals
do $$ declare src text;
begin
  src := pg_get_functiondef('public.approve_document(text,boolean,text)'::regprocedure);
  if position('''packing_list''' in src) = 0 then
    if position('if d.doc_type in (''invoice'',''grn'',''waybill'')' in src) = 0 then
      raise exception 'Unexpected approve_document definition';
    end if;
    execute replace(src, 'if d.doc_type in (''invoice'',''grn'',''waybill'')',
                         'if d.doc_type in (''invoice'',''grn'',''waybill'',''packing_list'',''label'')');
  end if;
end $$;

-- tokens are issued the moment the record exists — not when someone first prints it
create or replace function public.trg_doc_autoissue() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_table_name = 'grns' then
      perform public.doc_issue('grn', new.id::text);
      perform public.doc_issue('label', new.shipment_id::text);
    elsif tg_table_name = 'invoices' then
      perform public.doc_issue('invoice', new.id::text);
    elsif tg_table_name = 'packing_lists' then
      perform public.doc_issue('packing_list', new.id::text);
    end if;
  exception when others then
    raise warning 'document token not issued for % %: %', tg_table_name, new.id, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists doc_autoissue on public.grns;
create trigger doc_autoissue after insert on public.grns for each row execute function public.trg_doc_autoissue();
drop trigger if exists doc_autoissue on public.invoices;
create trigger doc_autoissue after insert on public.invoices for each row execute function public.trg_doc_autoissue();
drop trigger if exists doc_autoissue on public.packing_lists;
create trigger doc_autoissue after insert on public.packing_lists for each row execute function public.trg_doc_autoissue();

-- backfill existing records (no-op on rerun)
do $$ declare r record;
begin
  for r in select g.id, g.shipment_id from public.grns g loop
    perform public.doc_issue('grn', r.id::text);
    perform public.doc_issue('label', r.shipment_id::text);
  end loop;
  for r in select i.id from public.invoices i loop perform public.doc_issue('invoice', r.id::text); end loop;
  for r in select l.id from public.packing_lists l loop perform public.doc_issue('packing_list', r.id::text); end loop;
end $$;

-- pull a token out of whatever a QR / scanner / keyboard produced
create or replace function public.doc_token_from_text(p_code text) returns text
language sql immutable as $$
  select lower(coalesce(
    substring(coalesce(p_code,'') from '[?&]d=([0-9A-Fa-f]{36})(?:[^0-9A-Fa-f]|$)'),
    substring(trim(coalesce(p_code,'')) from '^([0-9A-Fa-f]{36})$')))
$$;

-- revoke a printed QR and issue a fresh one (e.g. a copy went to the wrong person)
create or replace function public.rotate_document_token(p_document uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.documents; v_new text;
begin
  perform public.require_perm('doc.revoke');
  if coalesce(trim(p_reason),'') = '' then raise exception 'REFUSED: a reason is required'; end if;
  select * into d from public.documents where id = p_document for update;
  if d.id is null then raise exception 'NOT_FOUND: document'; end if;
  insert into public.document_revoked_tokens(token, document_id, revoked_by, reason)
  values (d.token, d.id, auth.uid(), trim(p_reason));
  v_new := encode(gen_random_bytes(18), 'hex');
  update public.documents set token = v_new where id = d.id;
  perform public.log_audit('document.qr_revoke', 'document', d.id::text,
          jsonb_build_object('type', d.doc_type, 'ref', d.doc_ref, 'reason', trim(p_reason)));
  return jsonb_build_object('document_id', d.id, 'ref', d.doc_ref);
end $$;

-- PUBLIC verification (anon). Minimal facts only: never money, never contacts.
create or replace function public.verify_document(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tok text; d public.documents; s public.shipments; r public.document_revoked_tokens;
        exempt boolean; invalid boolean; st text;
begin
  tok := coalesce(public.doc_token_from_text(p_token), trim(coalesce(p_token,'')));
  select * into d from public.documents where token = tok;
  if d.id is null then
    select * into r from public.document_revoked_tokens where token = lower(tok);
    if r.token is null then return jsonb_build_object('found', false); end if;
    select * into d from public.documents where id = r.document_id;
    return jsonb_build_object('found', true, 'company', (select company_name from public.settings where id = 1),
      'document_type', d.doc_type, 'document_no', d.doc_ref, 'status', 'revoked', 'revoked_at', r.revoked_at,
      'checked_at', now());
  end if;
  select * into s from public.shipments where id = d.shipment_id;
  exempt := d.doc_type in ('invoice','grn','packing_list','label');
  invalid := coalesce(s.status::text = 'cancelled', false)
    or (d.doc_type = 'invoice' and exists (select 1 from public.invoices where id::text = d.doc_id and status <> 'issued'))
    or (d.doc_type = 'receipt' and exists (select 1 from public.receipts where id::text = d.doc_id and void));
  st := case when invalid then 'void'
             when d.doc_type = 'packing_list' and exists (select 1 from public.packing_lists where id::text = d.doc_id and status = 'draft') then 'draft'
             when exempt then 'issued' else d.status end;
  return jsonb_build_object('found', true, 'company', (select company_name from public.settings where id = 1),
    'document_type', d.doc_type, 'document_no', d.doc_ref, 'shipment_ref', s.ref, 'issued_at', d.issued_at,
    'version', d.version, 'status', st,
    'approval_required', not exempt, 'retired', d.doc_type = 'waybill',
    'approved_by', case when not exempt then (select full_name from public.profiles where id = d.approved_by) end,
    'approved_at', case when not exempt then d.approved_at end,
    'superseded', not exempt and d.approved_version is not null and d.approved_version <> d.version,
    'shipment_status', s.status, 'checked_at', now());
end $$;

-- STAFF scan resolver: what this record is, the facts relevant to it, and where to open it.
create or replace function public.doc_scan_payload(d public.documents) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.v_shipments; g public.grns; i public.invoices; pl public.v_packing_lists; rc public.v_receipts;
        rl public.releases; st text; who text; route text; extra jsonb := '{}'::jsonb;
        see_money boolean := public.has_perm('invoice.read');
        see_cust  boolean := public.has_perm('customer.read') or public.has_perm('shipment.read');
begin
  if d.shipment_id is not null then select * into s from public.v_shipments where id = d.shipment_id; end if;
  st := case when d.doc_type in ('invoice','grn','packing_list','label') then 'issued' else d.status end;
  if d.doc_type = 'grn' then
    select * into g from public.grns where id::text = d.doc_id;
    who := (select full_name from public.profiles where id = g.received_by);
    extra := jsonb_build_object('pieces', g.pieces, 'cbm', g.total_cbm, 'kg', g.total_kg, 'branch', g.branch_code);
    route := '#/doc/grn/' || d.shipment_id;
  elsif d.doc_type = 'invoice' then
    select * into i from public.invoices where id::text = d.doc_id;
    if i.status <> 'issued' then st := 'void'; end if;
    who := (select full_name from public.profiles where id = i.created_by);
    extra := jsonb_build_object('grn_number', s.grn_ref) ||
      case when see_money then jsonb_build_object('invoice_total', i.total_txn, 'currency', i.currency,
                                                  'paid', s.paid_txn, 'balance', s.balance_txn, 'payment_status', s.payment_status)
           else '{}'::jsonb end;
    route := '#/doc/invoice/' || d.shipment_id;
  elsif d.doc_type = 'packing_list' then
    select * into pl from public.v_packing_lists where id::text = d.doc_id;
    who := pl.prepared_by;
    if pl.status = 'draft' then st := 'draft'; end if;
    extra := jsonb_build_object('boxes', pl.total_boxes, 'total_qty', pl.total_qty, 'list_status', pl.status,
      'packing_date', pl.packing_date, 'finalized_at', pl.finalized_at,
      'shipments', (select coalesce(jsonb_agg(distinct s2.ref), '[]'::jsonb)
                      from public.packing_entries e join public.packing_list_boxes b on b.id = e.packing_list_box_id
                      join public.shipments s2 on s2.id = e.shipment_id where b.packing_list_id = pl.id));
    route := '#/packing-list/' || pl.id;
  elsif d.doc_type = 'label' then
    extra := jsonb_build_object('pieces', coalesce(s.pieces, s.est_pieces), 'destination', s.destination_branch,
      'mode', s.mode, 'grn_number', s.grn_ref, 'receiver', case when see_cust then s.receiver_name end);
    route := '#/shipment/' || d.shipment_id;
  elsif d.doc_type = 'receipt' then
    select * into rc from public.v_receipts where id::text = d.doc_id;
    if rc.void then st := 'void'; end if;
    who := rc.received_by_name;
    if public.has_perm('payment.read') then
      extra := jsonb_build_object('amount', rc.amount, 'currency', rc.currency, 'method', rc.method);
    end if;
    route := '#/doc/receipt/' || d.doc_id;
  elsif d.doc_type = 'release' then
    select * into rl from public.releases where id::text = d.doc_id;
    who := (select full_name from public.profiles where id = rl.released_by);
    extra := jsonb_build_object('released_to', case when see_cust then rl.released_to_name end);
    route := '#/doc/release/' || d.shipment_id;
  elsif d.doc_type = 'waybill' then
    st := 'retired';
    route := '#/shipment/' || d.shipment_id;
  end if;
  if s.status::text = 'cancelled' then st := 'void'; end if;
  return jsonb_build_object('recognized', true, 'valid', st not in ('void','revoked','rejected'),
    'status', st, 'document_type', d.doc_type, 'document_id', d.id, 'record_id', d.doc_id,
    'document_number', d.doc_ref, 'issued_at', d.issued_at, 'version', d.version, 'prepared_by', who,
    'shipment_id', d.shipment_id, 'shipment_ref', s.ref, 'shipment_status', s.status,
    'customer', case when see_cust then s.customer_name end,
    'retired', d.doc_type = 'waybill', 'route', route) || extra;
end $$;

create or replace function public.scan_document(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare raw text := left(trim(coalesce(p_code,'')), 2000); tok text; d public.documents;
        r public.document_revoked_tokens; s public.shipments; res jsonb;
begin
  perform public.require_perm('scan.use');
  if raw = '' then return jsonb_build_object('recognized', false); end if;
  tok := public.doc_token_from_text(raw);
  if tok is not null then
    select * into d from public.documents where token = tok;
    if d.id is null then
      select * into r from public.document_revoked_tokens where token = tok;
      if r.token is null then return jsonb_build_object('recognized', false); end if;
      select * into d from public.documents where id = r.document_id;
      res := public.doc_scan_payload(d) || jsonb_build_object('valid', false, 'status', 'revoked',
               'revoked_at', r.revoked_at, 'revoke_reason', r.reason);
    end if;
  else
    -- typed document number (manual fallback)
    select * into d from public.documents
     where upper(doc_ref) = upper(raw) and doc_type not in ('label','waybill')
     order by created_at desc limit 1;
    if d.id is null then
      -- older cargo labels carried the plain shipment number; tracking links carry ?ref=
      select * into s from public.shipments
       where upper(ref) = upper(raw) or upper(ref) = upper(substring(raw from '[?&]ref=([^&#]+)')) limit 1;
      if s.id is null then return jsonb_build_object('recognized', false); end if;
      select * into d from public.documents where doc_type = 'label' and doc_id = s.id::text;
      if d.id is null then
        res := jsonb_build_object('recognized', true, 'valid', s.status::text <> 'cancelled',
          'status', case when s.status::text = 'cancelled' then 'void' else 'issued' end,
          'document_type', 'shipment', 'document_number', s.ref, 'shipment_id', s.id, 'shipment_ref', s.ref,
          'shipment_status', s.status, 'issued_at', s.created_at, 'legacy', true,
          'customer', case when public.has_perm('customer.read') or public.has_perm('shipment.read')
                           then (select name from public.customers where id = s.customer_id) end,
          'route', '#/shipment/' || s.id);
        perform public.log_audit('document.scan', 'shipment', s.id::text, jsonb_build_object('type', 'shipment', 'ref', s.ref));
        return res;
      end if;
      res := public.doc_scan_payload(d) || jsonb_build_object('legacy', true);
    end if;
  end if;
  res := coalesce(res, public.doc_scan_payload(d));
  perform public.log_audit('document.scan', 'document', d.id::text,
          jsonb_build_object('type', d.doc_type, 'ref', d.doc_ref, 'status', res->>'status'));
  return res;
end $$;

-- ---------------------------------------------------------------------
-- 4. NUMBERING  (PREFIX-YYYYMMDD-NNN, atomic counter + unique index)
-- ---------------------------------------------------------------------
create or replace function public.daily_number(p_prefix text) returns text
language plpgsql security definer set search_path = public as $$
declare d text := to_char(public.hc_today(), 'YYYYMMDD'); n text;
begin
  n := public.next_counter(p_prefix || '-' || d)::text;
  return p_prefix || '-' || d || '-' || lpad(n, greatest(3, length(n)), '0');
end $$;

create or replace function public.active_staff(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_user and active)
$$;

-- ---------------------------------------------------------------------
-- 5. LEADS
-- ---------------------------------------------------------------------
create table if not exists public.leads (
  id             uuid primary key default gen_random_uuid(),
  lead_number    text not null unique,
  lead_date      date not null default public.hc_today(),
  customer_name  text not null check (length(trim(customer_name)) > 0),
  contact_person text,
  phone          text,
  email          text,
  country        text,
  service        text,
  source         text,
  description    text,
  status         text not null default 'new'
                 check (status in ('new','contacted','follow_up','qualified','quotation_sent','converted','lost')),
  assigned_to    uuid references public.profiles(id),
  follow_up_date date,
  notes          text,
  customer_id    uuid references public.customers(id),
  converted_at   timestamptz,
  converted_by   uuid references public.profiles(id),
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  client_token   text unique
);
create index if not exists leads_status_idx   on public.leads(status);
create index if not exists leads_assigned_idx on public.leads(assigned_to);
create index if not exists leads_created_idx  on public.leads(created_by);

create table if not exists public.lead_events (
  id          bigserial primary key,
  lead_id     uuid not null references public.leads(id),
  kind        text not null check (kind in ('created','updated','status','assigned','note','converted','sourcing')),
  from_status text,
  to_status   text,
  note        text,
  details     jsonb,
  actor       uuid references public.profiles(id),
  at          timestamptz not null default now()
);
create index if not exists lead_events_lead_idx on public.lead_events(lead_id, at);

-- who may see / work a lead: the team (lead.read), whoever recorded it, whoever it is assigned to
create or replace function public.lead_access(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() and (public.has_perm('lead.read') or exists (
    select 1 from public.leads l where l.id = p_lead and (l.created_by = auth.uid() or l.assigned_to = auth.uid())))
$$;

create or replace function public.lead_validate(l public.leads) returns void
language plpgsql immutable as $$
begin
  if coalesce(trim(l.customer_name),'') = '' then raise exception 'REFUSED: enter the customer or company name'; end if;
  if coalesce(trim(l.phone),'') = '' and coalesce(trim(l.email),'') = '' then
    raise exception 'REFUSED: enter a phone number or an email';
  end if;
  if coalesce(trim(l.service),'') = '' and coalesce(trim(l.description),'') = '' then
    raise exception 'REFUSED: say what the customer needs (service or requirement)';
  end if;
  if coalesce(trim(l.email),'') <> '' and trim(l.email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'REFUSED: the email address is not valid';
  end if;
end $$;

create or replace function public.create_lead(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.leads; tok text; v_assigned uuid;
begin
  perform public.require_perm('lead.create');
  tok := nullif(trim(p->>'client_token'), '');
  if tok is not null then
    perform pg_advisory_xact_lock(hashtextextended('lead:' || tok, 0));
    select * into l from public.leads where client_token = tok;
    if l.id is not null then return to_jsonb(l); end if;      -- retry / double click: same lead
  end if;
  v_assigned := nullif(p->>'assigned_to', '')::uuid;
  if v_assigned is not null then
    if v_assigned <> auth.uid() and not public.has_perm('lead.assign') then
      raise exception 'NOT_ALLOWED: only a manager can assign a lead to someone else';
    end if;
    if not public.active_staff(v_assigned) then raise exception 'REFUSED: assign the lead to an active staff member'; end if;
  end if;
  l.customer_name  := trim(p->>'customer_name');
  l.contact_person := nullif(trim(p->>'contact_person'), '');
  l.phone          := nullif(trim(p->>'phone'), '');
  l.email          := nullif(lower(trim(p->>'email')), '');
  l.service        := nullif(trim(p->>'service'), '');
  l.description    := nullif(trim(p->>'description'), '');
  perform public.lead_validate(l);
  insert into public.leads(lead_number, customer_name, contact_person, phone, email, country, service, source,
                           description, assigned_to, follow_up_date, notes, created_by, client_token)
  values (public.daily_number('LEAD'), l.customer_name, l.contact_person, l.phone, l.email,
          nullif(trim(p->>'country'), ''), l.service, nullif(trim(p->>'source'), ''), l.description,
          v_assigned, nullif(p->>'follow_up_date', '')::date, nullif(trim(p->>'notes'), ''), auth.uid(), tok)
  returning * into l;
  insert into public.lead_events(lead_id, kind, to_status, actor) values (l.id, 'created', 'new', auth.uid());
  if v_assigned is not null then
    insert into public.lead_events(lead_id, kind, details, actor)
    values (l.id, 'assigned', jsonb_build_object('to', v_assigned), auth.uid());
  end if;
  perform public.log_audit('lead.create', 'lead', l.id::text,
          jsonb_build_object('number', l.lead_number, 'name', l.customer_name, 'assigned_to', v_assigned));
  return to_jsonb(l);
end $$;

create or replace function public.update_lead(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.leads; v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if v_id is null or not public.lead_access(v_id) then raise exception 'NOT_ALLOWED: you cannot edit this lead'; end if;
  select * into l from public.leads where id = v_id for update;
  if l.id is null then raise exception 'NOT_FOUND: lead'; end if;
  if p ? 'customer_name'  then l.customer_name  := trim(p->>'customer_name'); end if;
  if p ? 'contact_person' then l.contact_person := nullif(trim(p->>'contact_person'), ''); end if;
  if p ? 'phone'          then l.phone          := nullif(trim(p->>'phone'), ''); end if;
  if p ? 'email'          then l.email          := nullif(lower(trim(p->>'email')), ''); end if;
  if p ? 'country'        then l.country        := nullif(trim(p->>'country'), ''); end if;
  if p ? 'service'        then l.service        := nullif(trim(p->>'service'), ''); end if;
  if p ? 'source'         then l.source         := nullif(trim(p->>'source'), ''); end if;
  if p ? 'description'    then l.description    := nullif(trim(p->>'description'), ''); end if;
  if p ? 'follow_up_date' then l.follow_up_date := nullif(p->>'follow_up_date', '')::date; end if;
  if p ? 'notes'          then l.notes          := nullif(trim(p->>'notes'), ''); end if;
  perform public.lead_validate(l);
  update public.leads set customer_name = l.customer_name, contact_person = l.contact_person, phone = l.phone,
         email = l.email, country = l.country, service = l.service, source = l.source, description = l.description,
         follow_up_date = l.follow_up_date, notes = l.notes, updated_at = now()
   where id = l.id returning * into l;
  insert into public.lead_events(lead_id, kind, actor) values (l.id, 'updated', auth.uid());
  return to_jsonb(l);
end $$;

create or replace function public.set_lead_status(p_lead uuid, p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  if not public.lead_access(p_lead) then raise exception 'NOT_ALLOWED: you cannot update this lead'; end if;
  if p_status is null or p_status not in ('new','contacted','follow_up','qualified','quotation_sent','lost') then
    raise exception 'REFUSED: %', case when p_status = 'converted' then 'use "Convert to customer" to convert a lead' else 'unknown status' end;
  end if;
  select * into l from public.leads where id = p_lead for update;
  if l.status = 'converted' then raise exception 'REFUSED: this lead is already converted to a customer'; end if;
  if l.status = p_status then return to_jsonb(l); end if;
  update public.leads set status = p_status, updated_at = now() where id = l.id;
  insert into public.lead_events(lead_id, kind, from_status, to_status, note, actor)
  values (l.id, 'status', l.status, p_status, nullif(trim(p_note), ''), auth.uid());
  perform public.log_audit('lead.status', 'lead', l.id::text,
          jsonb_build_object('number', l.lead_number, 'from', l.status, 'to', p_status));
  select * into l from public.leads where id = p_lead;
  return to_jsonb(l);
end $$;

create or replace function public.add_lead_follow_up(p_lead uuid, p_note text, p_follow_up date default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.lead_access(p_lead) then raise exception 'NOT_ALLOWED: you cannot update this lead'; end if;
  if coalesce(trim(p_note), '') = '' and p_follow_up is null then raise exception 'REFUSED: write a note or pick a follow-up date'; end if;
  perform 1 from public.leads where id = p_lead for update;
  if p_follow_up is not null then update public.leads set follow_up_date = p_follow_up, updated_at = now() where id = p_lead;
  else update public.leads set updated_at = now() where id = p_lead; end if;
  insert into public.lead_events(lead_id, kind, note, details, actor)
  values (p_lead, 'note', nullif(trim(p_note), ''),
          case when p_follow_up is not null then jsonb_build_object('follow_up_date', p_follow_up) end, auth.uid());
end $$;

create or replace function public.assign_lead(p_lead uuid, p_user uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  perform public.require_perm('lead.assign');
  select * into l from public.leads where id = p_lead for update;
  if l.id is null then raise exception 'NOT_FOUND: lead'; end if;
  if p_user is not null and not public.active_staff(p_user) then raise exception 'REFUSED: choose an active staff member'; end if;
  if l.assigned_to is not distinct from p_user then return; end if;
  update public.leads set assigned_to = p_user, updated_at = now() where id = l.id;
  insert into public.lead_events(lead_id, kind, note, details, actor)
  values (l.id, 'assigned', nullif(trim(p_note), ''), jsonb_build_object('from', l.assigned_to, 'to', p_user), auth.uid());
  perform public.log_audit('lead.assign', 'lead', l.id::text,
          jsonb_build_object('number', l.lead_number, 'from', l.assigned_to, 'to', p_user));
end $$;

-- existing customers this lead could already be (same phone or same email)
create or replace function public.lead_customer_matches(p_lead uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.leads; ph text; res jsonb;
begin
  if not public.lead_access(p_lead) then raise exception 'NOT_ALLOWED: you cannot see this lead'; end if;
  select * into l from public.leads where id = p_lead;
  ph := public.norm_phone(l.phone, l.country);
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'company', c.company,
           'phone', c.phone, 'email', c.email,
           'match', case when ph is not null and (c.phone = ph or c.phone2 = ph) then 'phone' else 'email' end)
           order by c.created_at), '[]'::jsonb) into res
    from public.customers c
   where c.active and ((ph is not null and (c.phone = ph or public.norm_phone(c.phone2, c.country) = ph))
      or (l.email is not null and lower(c.email) = lower(l.email)));
  return res;
end $$;

-- Convert to Customer. Never makes a second customer with the same phone; an
-- email-only match must be confirmed by choosing it or explicitly creating new.
create or replace function public.convert_lead(p_lead uuid, p_customer uuid default null, p_create_new boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; c public.customers; matches jsonb; ph text; v_branch text;
begin
  perform public.require_perm('lead.convert');
  if not public.lead_access(p_lead) then raise exception 'NOT_ALLOWED: you cannot see this lead'; end if;
  select * into l from public.leads where id = p_lead for update;
  if l.id is null then raise exception 'NOT_FOUND: lead'; end if;
  if l.status = 'converted' and l.customer_id is not null then
    return jsonb_build_object('status', 'converted', 'customer_id', l.customer_id, 'already', true);
  end if;
  if p_customer is not null then
    select * into c from public.customers where id = p_customer and active;
    if c.id is null then raise exception 'NOT_FOUND: customer'; end if;
  else
    matches := public.lead_customer_matches(p_lead);
    if jsonb_array_length(matches) > 0 then
      if not p_create_new or exists (select 1 from jsonb_array_elements(matches) m where m->>'match' = 'phone') then
        return jsonb_build_object('status', 'matches', 'matches', matches);
      end if;
    end if;
    ph := public.norm_phone(l.phone, l.country);
    if ph is null then raise exception 'REFUSED: add the customer''s phone number to the lead before converting'; end if;
    -- serialise conversions of the same phone number
    perform pg_advisory_xact_lock(hashtextextended('customer-phone:' || ph, 0));
    select * into c from public.customers where phone = ph and active limit 1;
    if c.id is null then
      select branch_code into v_branch from public.profiles where id = auth.uid();
      insert into public.customers(name, company, phone, email, country, branch_code, notes, created_by)
      values (l.customer_name, null, l.phone, l.email, l.country, v_branch,
              concat_ws(E'\n', case when l.contact_person is not null then 'Contact person: ' || l.contact_person end,
                        'Converted from lead ' || l.lead_number), auth.uid())
      returning * into c;
    end if;
  end if;
  update public.leads set status = 'converted', customer_id = c.id, converted_at = now(), converted_by = auth.uid(),
         updated_at = now() where id = l.id;
  insert into public.lead_events(lead_id, kind, from_status, to_status, details, actor)
  values (l.id, 'converted', l.status, 'converted', jsonb_build_object('customer_id', c.id, 'customer_code', c.code), auth.uid());
  perform public.log_audit('lead.convert', 'lead', l.id::text,
          jsonb_build_object('number', l.lead_number, 'customer', c.code, 'existing_customer', p_customer is not null));
  return jsonb_build_object('status', 'converted', 'customer_id', c.id, 'customer_code', c.code);
end $$;

-- ---------------------------------------------------------------------
-- 6. SOURCING
-- ---------------------------------------------------------------------
create table if not exists public.sourcing_requests (
  id               uuid primary key default gen_random_uuid(),
  sourcing_number  text not null unique,
  request_date     date not null default public.hc_today(),
  lead_id          uuid references public.leads(id),
  customer_id      uuid references public.customers(id),
  requester_name   text,                 -- only when there is neither a lead nor a customer
  product          text not null check (length(trim(product)) > 0),
  description      text,
  quantity         numeric check (quantity is null or quantity > 0),
  unit             text,
  supplier         text,
  supplier_contact text,
  estimated_cost   numeric check (estimated_cost is null or estimated_cost >= 0),
  currency         text not null default 'USD' check (currency in ('USD','AED','TZS','CNY')),
  quoted_price     numeric check (quoted_price is null or quoted_price >= 0),
  status           text not null default 'new'
                   check (status in ('new','searching','supplier_found','quotation_sent','customer_approved','purchased','cancelled','completed')),
  assigned_to      uuid references public.profiles(id),
  notes            text,
  completed_at     timestamptz,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  client_token     text unique
);
create index if not exists sourcing_lead_idx   on public.sourcing_requests(lead_id);
create index if not exists sourcing_status_idx on public.sourcing_requests(status);

create table if not exists public.sourcing_events (
  id          bigserial primary key,
  sourcing_id uuid not null references public.sourcing_requests(id),
  kind        text not null check (kind in ('created','updated','status','assigned')),
  from_status text,
  to_status   text,
  note        text,
  details     jsonb,
  actor       uuid references public.profiles(id),
  at          timestamptz not null default now()
);
create index if not exists sourcing_events_idx on public.sourcing_events(sourcing_id, at);

create or replace function public.sourcing_access(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() and (public.has_perm('sourcing.read') or public.has_perm('sourcing.write') or exists (
    select 1 from public.sourcing_requests r where r.id = p_id and (r.created_by = auth.uid() or r.assigned_to = auth.uid())))
$$;

create or replace function public.create_sourcing(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.sourcing_requests; tok text; v_lead uuid; v_cust uuid; v_assigned uuid; l public.leads;
begin
  perform public.require_perm('sourcing.write');
  tok := nullif(trim(p->>'client_token'), '');
  if tok is not null then
    perform pg_advisory_xact_lock(hashtextextended('sourcing:' || tok, 0));
    select * into r from public.sourcing_requests where client_token = tok;
    if r.id is not null then return to_jsonb(r); end if;
  end if;
  v_lead := nullif(p->>'lead_id', '')::uuid;
  v_cust := nullif(p->>'customer_id', '')::uuid;
  if v_lead is not null then
    select * into l from public.leads where id = v_lead;
    if l.id is null then raise exception 'NOT_FOUND: lead'; end if;
    v_cust := coalesce(v_cust, l.customer_id);        -- a converted lead already points at its customer
  end if;
  if v_cust is not null and not exists (select 1 from public.customers where id = v_cust) then
    raise exception 'NOT_FOUND: customer';
  end if;
  if v_lead is null and v_cust is null and coalesce(trim(p->>'requester_name'), '') = '' then
    raise exception 'REFUSED: choose the lead or customer this request is for';
  end if;
  if coalesce(trim(p->>'product'), '') = '' then raise exception 'REFUSED: enter the product / item requested'; end if;
  v_assigned := nullif(p->>'assigned_to', '')::uuid;
  if v_assigned is not null and not public.active_staff(v_assigned) then raise exception 'REFUSED: choose an active staff member'; end if;
  insert into public.sourcing_requests(sourcing_number, lead_id, customer_id, requester_name, product, description,
    quantity, unit, supplier, supplier_contact, estimated_cost, currency, quoted_price, assigned_to, notes, created_by, client_token)
  values (public.daily_number('SRC'), v_lead, v_cust,
    case when v_lead is null and v_cust is null then trim(p->>'requester_name') end,
    trim(p->>'product'), nullif(trim(p->>'description'), ''), nullif(p->>'quantity', '')::numeric,
    nullif(trim(p->>'unit'), ''), nullif(trim(p->>'supplier'), ''), nullif(trim(p->>'supplier_contact'), ''),
    nullif(p->>'estimated_cost', '')::numeric, coalesce(nullif(p->>'currency', ''), 'USD'),
    nullif(p->>'quoted_price', '')::numeric, v_assigned, nullif(trim(p->>'notes'), ''), auth.uid(), tok)
  returning * into r;
  insert into public.sourcing_events(sourcing_id, kind, to_status, actor) values (r.id, 'created', 'new', auth.uid());
  if v_lead is not null then
    insert into public.lead_events(lead_id, kind, details, actor)
    values (v_lead, 'sourcing', jsonb_build_object('sourcing_id', r.id, 'sourcing_number', r.sourcing_number), auth.uid());
  end if;
  perform public.log_audit('sourcing.create', 'sourcing', r.id::text,
          jsonb_build_object('number', r.sourcing_number, 'lead', v_lead, 'product', r.product));
  return to_jsonb(r);
end $$;

create or replace function public.update_sourcing(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.sourcing_requests; old_assigned uuid; v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if v_id is null then raise exception 'NOT_FOUND: sourcing request'; end if;
  select * into r from public.sourcing_requests where id = v_id for update;
  if r.id is null then raise exception 'NOT_FOUND: sourcing request'; end if;
  if not (public.has_perm('sourcing.write') or r.assigned_to = auth.uid()) then
    raise exception 'NOT_ALLOWED: you cannot edit this sourcing request';
  end if;
  if r.status in ('completed','cancelled') then raise exception 'REFUSED: this request is closed'; end if;
  old_assigned := r.assigned_to;
  if p ? 'product'          then r.product := trim(p->>'product'); end if;
  if p ? 'description'      then r.description := nullif(trim(p->>'description'), ''); end if;
  if p ? 'quantity'         then r.quantity := nullif(p->>'quantity', '')::numeric; end if;
  if p ? 'unit'             then r.unit := nullif(trim(p->>'unit'), ''); end if;
  if p ? 'supplier'         then r.supplier := nullif(trim(p->>'supplier'), ''); end if;
  if p ? 'supplier_contact' then r.supplier_contact := nullif(trim(p->>'supplier_contact'), ''); end if;
  if p ? 'estimated_cost'   then r.estimated_cost := nullif(p->>'estimated_cost', '')::numeric; end if;
  if p ? 'currency'         then r.currency := coalesce(nullif(p->>'currency', ''), 'USD'); end if;
  if p ? 'quoted_price'     then r.quoted_price := nullif(p->>'quoted_price', '')::numeric; end if;
  if p ? 'notes'            then r.notes := nullif(trim(p->>'notes'), ''); end if;
  if p ? 'assigned_to' then
    if not public.has_perm('sourcing.write') then raise exception 'NOT_ALLOWED: you cannot reassign this request'; end if;
    r.assigned_to := nullif(p->>'assigned_to', '')::uuid;
    if r.assigned_to is not null and not public.active_staff(r.assigned_to) then raise exception 'REFUSED: choose an active staff member'; end if;
  end if;
  if coalesce(r.product, '') = '' then raise exception 'REFUSED: enter the product / item requested'; end if;
  update public.sourcing_requests set product = r.product, description = r.description, quantity = r.quantity, unit = r.unit,
         supplier = r.supplier, supplier_contact = r.supplier_contact, estimated_cost = r.estimated_cost,
         currency = r.currency, quoted_price = r.quoted_price, notes = r.notes, assigned_to = r.assigned_to,
         updated_at = now()
   where id = r.id returning * into r;
  if r.assigned_to is distinct from old_assigned then
    insert into public.sourcing_events(sourcing_id, kind, details, actor)
    values (r.id, 'assigned', jsonb_build_object('from', old_assigned, 'to', r.assigned_to), auth.uid());
    perform public.log_audit('sourcing.assign', 'sourcing', r.id::text,
            jsonb_build_object('number', r.sourcing_number, 'to', r.assigned_to));
  else
    insert into public.sourcing_events(sourcing_id, kind, actor) values (r.id, 'updated', auth.uid());
  end if;
  return to_jsonb(r);
end $$;

create or replace function public.set_sourcing_status(p_id uuid, p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.sourcing_requests;
begin
  select * into r from public.sourcing_requests where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND: sourcing request'; end if;
  if not (public.has_perm('sourcing.write') or r.assigned_to = auth.uid()) then
    raise exception 'NOT_ALLOWED: you cannot update this sourcing request';
  end if;
  if p_status is null or p_status not in ('new','searching','supplier_found','quotation_sent','customer_approved','purchased','cancelled','completed') then
    raise exception 'REFUSED: unknown status';
  end if;
  if r.status in ('completed','cancelled') then raise exception 'REFUSED: this request is closed'; end if;
  if r.status = p_status then return to_jsonb(r); end if;
  if p_status = 'cancelled' and coalesce(trim(p_note), '') = '' then raise exception 'REFUSED: a reason is required to cancel'; end if;
  update public.sourcing_requests set status = p_status, updated_at = now(),
         completed_at = case when p_status = 'completed' then now() else completed_at end
   where id = r.id;
  insert into public.sourcing_events(sourcing_id, kind, from_status, to_status, note, actor)
  values (r.id, 'status', r.status, p_status, nullif(trim(p_note), ''), auth.uid());
  perform public.log_audit('sourcing.status', 'sourcing', r.id::text,
          jsonb_build_object('number', r.sourcing_number, 'from', r.status, 'to', p_status));
  select * into r from public.sourcing_requests where id = p_id;
  return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------------
-- 7. STAFF MAIL (internal; an SMTP bridge can later read mail_messages)
-- ---------------------------------------------------------------------
create table if not exists public.mail_threads (
  id              uuid primary key default gen_random_uuid(),
  subject         text not null,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create table if not exists public.mail_messages (
  id           uuid primary key default gen_random_uuid(),
  thread_id    uuid not null references public.mail_threads(id),
  sender_id    uuid not null references public.profiles(id),
  body         text not null,
  created_at   timestamptz not null default now(),
  client_token text unique
);
create index if not exists mail_messages_thread_idx on public.mail_messages(thread_id, created_at);
create index if not exists mail_messages_sender_idx on public.mail_messages(sender_id);
create table if not exists public.mail_recipients (
  message_id uuid not null references public.mail_messages(id),
  user_id    uuid not null references public.profiles(id),
  kind       text not null default 'to' check (kind in ('to','cc')),
  read_at    timestamptz,
  primary key (message_id, user_id)
);
create index if not exists mail_recipients_user_idx on public.mail_recipients(user_id) where read_at is null;
create index if not exists mail_recipients_user_all_idx on public.mail_recipients(user_id);
create table if not exists public.mail_thread_state (
  thread_id   uuid not null references public.mail_threads(id),
  user_id     uuid not null references public.profiles(id),
  archived_at timestamptz,
  trashed_at  timestamptz,
  primary key (thread_id, user_id)
);

create or replace function public.mail_is_participant(p_thread uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mail_messages m where m.thread_id = p_thread and m.sender_id = auth.uid())
      or exists (select 1 from public.mail_messages m join public.mail_recipients r on r.message_id = m.id
                  where m.thread_id = p_thread and r.user_id = auth.uid())
$$;

create or replace function public.mail_directory(p_q text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.has_perm('mail.use') then '[]'::jsonb else
    coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.full_name, ''), p.email),
                'email', p.email, 'role', p.role, 'branch', p.branch_code) order by p.full_name)
       from public.profiles p
      where p.active and p.id <> auth.uid()
        and (coalesce(trim(p_q), '') = '' or p.full_name ilike '%' || trim(p_q) || '%' or p.email ilike '%' || trim(p_q) || '%')), '[]'::jsonb) end
$$;

create or replace function public.mail_send(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_thread uuid := nullif(p->>'thread_id', '')::uuid; v_subject text; v_body text; tok text;
        m public.mail_messages; v_to uuid[]; v_cc uuid[]; v_all uuid[];
begin
  perform public.require_perm('mail.use');
  tok := nullif(trim(p->>'client_token'), '');
  if tok is not null then
    perform pg_advisory_xact_lock(hashtextextended('mail:' || tok, 0));
    select * into m from public.mail_messages where client_token = tok;
    if m.id is not null then
      if m.sender_id <> auth.uid() then raise exception 'REFUSED: duplicate submission token'; end if;
      return jsonb_build_object('id', m.id, 'thread_id', m.thread_id, 'duplicate', true);
    end if;
  end if;
  v_body := trim(coalesce(p->>'body', ''));
  if v_body = '' then raise exception 'REFUSED: write a message'; end if;
  if length(v_body) > 20000 then raise exception 'REFUSED: the message is too long'; end if;
  select coalesce(array_agg(distinct x::uuid), '{}') into v_to
    from jsonb_array_elements_text(coalesce(p->'to', '[]'::jsonb)) x where x::uuid <> auth.uid();
  select coalesce(array_agg(distinct x::uuid), '{}') into v_cc
    from jsonb_array_elements_text(coalesce(p->'cc', '[]'::jsonb)) x where x::uuid <> auth.uid() and not (x::uuid = any(v_to));
  if cardinality(v_to) = 0 then v_to := v_cc; v_cc := '{}'; end if;
  if cardinality(v_to) = 0 then raise exception 'REFUSED: choose at least one recipient'; end if;
  v_all := v_to || v_cc;
  if (select count(*) from public.profiles where id = any(v_all) and active) <> cardinality(v_all) then
    raise exception 'REFUSED: messages can only be sent to active staff';
  end if;
  if v_thread is null then
    v_subject := trim(coalesce(p->>'subject', ''));
    if v_subject = '' then raise exception 'REFUSED: add a subject'; end if;
    insert into public.mail_threads(subject, created_by) values (left(v_subject, 200), auth.uid()) returning id into v_thread;
  else
    perform 1 from public.mail_threads where id = v_thread for update;
    if not found or not public.mail_is_participant(v_thread) then raise exception 'NOT_ALLOWED: you are not part of this conversation'; end if;
  end if;
  insert into public.mail_messages(thread_id, sender_id, body, client_token)
  values (v_thread, auth.uid(), v_body, tok) returning * into m;
  insert into public.mail_recipients(message_id, user_id, kind)
  select m.id, u, 'to' from unnest(v_to) u
  union all select m.id, u, 'cc' from unnest(v_cc) u;
  update public.mail_threads set last_message_at = m.created_at where id = v_thread;
  -- a new message brings the conversation back to the recipients' inbox
  update public.mail_thread_state set archived_at = null, trashed_at = null
   where thread_id = v_thread and user_id = any(v_all);
  perform public.log_audit('mail.send', 'mail_thread', v_thread::text,
          jsonb_build_object('message', m.id, 'recipients', cardinality(v_all)));
  return jsonb_build_object('id', m.id, 'thread_id', v_thread);
end $$;

create or replace function public.mail_list(p_folder text default 'inbox', p_q text default null,
                                            p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); res jsonb; total int; q text := nullif(trim(coalesce(p_q, '')), '');
begin
  if not public.has_perm('mail.use') then raise exception 'NOT_ALLOWED: your role cannot use staff mail'; end if;
  if p_folder not in ('inbox','sent','archived','trash') then raise exception 'REFUSED: unknown folder'; end if;
  with mine as (
    select t.id, t.subject, t.last_message_at,
           exists (select 1 from public.mail_messages m join public.mail_recipients r on r.message_id = m.id
                    where m.thread_id = t.id and r.user_id = me) as received,
           exists (select 1 from public.mail_messages m where m.thread_id = t.id and m.sender_id = me) as sent,
           st.archived_at, st.trashed_at
      from public.mail_threads t
      left join public.mail_thread_state st on st.thread_id = t.id and st.user_id = me
     where t.id in (select m.thread_id from public.mail_messages m where m.sender_id = me
                    union select m.thread_id from public.mail_messages m join public.mail_recipients r on r.message_id = m.id where r.user_id = me)
  ), pick as (
    select * from mine
     where case p_folder
             when 'inbox' then received and archived_at is null and trashed_at is null
             when 'sent' then sent and trashed_at is null
             when 'archived' then archived_at is not null and trashed_at is null
             else trashed_at is not null end
       and (q is null or subject ilike '%' || q || '%'
            or exists (select 1 from public.mail_messages m left join public.profiles sp on sp.id = m.sender_id
                        where m.thread_id = mine.id and (m.body ilike '%' || q || '%' or sp.full_name ilike '%' || q || '%')))
  )
  select (select count(*) from pick),
         coalesce(jsonb_agg(x order by x.last_at desc), '[]'::jsonb)
    into total, res
    from (
      select pick.id, pick.subject, pick.last_message_at as last_at,
             (select count(*) from public.mail_messages m where m.thread_id = pick.id) as message_count,
             (select count(*) from public.mail_messages m join public.mail_recipients r on r.message_id = m.id
               where m.thread_id = pick.id and r.user_id = me and r.read_at is null) as unread,
             lm.sender_id as last_sender_id, coalesce(nullif(sp.full_name, ''), sp.email) as last_sender,
             left(regexp_replace(lm.body, '\s+', ' ', 'g'), 140) as snippet,
             (select jsonb_agg(distinct coalesce(nullif(pp.full_name, ''), pp.email)) from (
                select m.sender_id as uid from public.mail_messages m where m.thread_id = pick.id
                union select r.user_id from public.mail_messages m join public.mail_recipients r on r.message_id = m.id where m.thread_id = pick.id
              ) u join public.profiles pp on pp.id = u.uid where u.uid <> me) as participants
        from pick
        join lateral (select * from public.mail_messages m where m.thread_id = pick.id order by m.created_at desc limit 1) lm on true
        left join public.profiles sp on sp.id = lm.sender_id
       order by pick.last_message_at desc
       limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))
    ) x;
  return jsonb_build_object('total', total, 'rows', res);
end $$;

-- open a conversation; marks my unread messages in it as read
create or replace function public.mail_thread(p_thread uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t public.mail_threads; res jsonb; st public.mail_thread_state;
begin
  if not public.has_perm('mail.use') then raise exception 'NOT_ALLOWED: your role cannot use staff mail'; end if;
  if not public.mail_is_participant(p_thread) then raise exception 'NOT_ALLOWED: you are not part of this conversation'; end if;
  select * into t from public.mail_threads where id = p_thread;
  select * into st from public.mail_thread_state where thread_id = p_thread and user_id = me;
  update public.mail_recipients r set read_at = now()
   where r.user_id = me and r.read_at is null
     and r.message_id in (select id from public.mail_messages where thread_id = p_thread);
  select jsonb_build_object('id', t.id, 'subject', t.subject, 'created_at', t.created_at,
           'archived', st.archived_at is not null, 'trashed', st.trashed_at is not null,
           'messages', coalesce(jsonb_agg(jsonb_build_object(
              'id', m.id, 'sender_id', m.sender_id, 'sender', coalesce(nullif(sp.full_name, ''), sp.email),
              'sender_role', sp.role, 'body', m.body, 'created_at', m.created_at, 'mine', m.sender_id = me,
              'recipients', (select jsonb_agg(jsonb_build_object('id', r.user_id, 'name', coalesce(nullif(rp.full_name, ''), rp.email),
                                 'kind', r.kind,
                                 -- read receipts are shown to the sender only
                                 'read_at', case when m.sender_id = me or r.user_id = me then r.read_at end)
                                 order by r.kind desc, rp.full_name)
                               from public.mail_recipients r join public.profiles rp on rp.id = r.user_id where r.message_id = m.id)
           ) order by m.created_at), '[]'::jsonb))
    into res
    from public.mail_messages m join public.profiles sp on sp.id = m.sender_id
   where m.thread_id = p_thread;
  return res;
end $$;

create or replace function public.mail_set_state(p_thread uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('mail.use') then raise exception 'NOT_ALLOWED: your role cannot use staff mail'; end if;
  if not public.mail_is_participant(p_thread) then raise exception 'NOT_ALLOWED: you are not part of this conversation'; end if;
  if p_action not in ('archive','unarchive','trash','restore','unread') then raise exception 'REFUSED: unknown action'; end if;
  if p_action = 'unread' then
    update public.mail_recipients set read_at = null
     where user_id = auth.uid() and message_id = (
       select m.id from public.mail_messages m join public.mail_recipients r on r.message_id = m.id
        where m.thread_id = p_thread and r.user_id = auth.uid() order by m.created_at desc limit 1);
    return;
  end if;
  insert into public.mail_thread_state(thread_id, user_id) values (p_thread, auth.uid()) on conflict do nothing;
  update public.mail_thread_state set
    archived_at = case p_action when 'archive' then now() when 'unarchive' then null when 'restore' then null else archived_at end,
    trashed_at  = case p_action when 'trash' then now() when 'restore' then null else trashed_at end
   where thread_id = p_thread and user_id = auth.uid();
end $$;

create or replace function public.mail_unread_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.mail_recipients r
    join public.mail_messages m on m.id = r.message_id
    left join public.mail_thread_state st on st.thread_id = m.thread_id and st.user_id = r.user_id
   where r.user_id = auth.uid() and r.read_at is null and st.trashed_at is null and public.is_staff()
$$;

-- ---------------------------------------------------------------------
-- 8. REGISTERS (list pages) & GLOBAL SEARCH
-- ---------------------------------------------------------------------
create or replace view public.v_grn_register with (security_invoker = true) as
select g.id, g.ref, g.shipment_id, s.ref as shipment_ref, c.name as customer_name, s.receiver_name,
       g.branch_code, g.pieces, g.total_cbm, g.total_kg, g.chargeable_kg, g.received_at,
       p.full_name as received_by_name, s.status as shipment_status, s.mode, s.destination_branch
from public.grns g
join public.shipments s on s.id = g.shipment_id
left join public.customers c on c.id = s.customer_id
left join public.profiles p on p.id = g.received_by;

create or replace view public.v_label_register with (security_invoker = true) as
select s.id as shipment_id, s.ref as shipment_ref, c.name as customer_name, s.receiver_name, s.receiver_phone,
       s.mode, s.origin_branch, s.destination_branch, coalesce(s.pieces, g.pieces, s.est_pieces) as pieces,
       g.ref as grn_ref, g.received_at, s.status as shipment_status
from public.shipments s
join public.grns g on g.shipment_id = s.id
left join public.customers c on c.id = s.customer_id;

create or replace view public.v_invoice_register with (security_invoker = true) as
select i.id, i.ref, i.shipment_id, vs.ref as shipment_ref, vs.customer_name, vs.customer_phone, i.issued_at,
       i.currency, i.total, i.total_txn, vs.paid_txn, vs.balance_txn, vs.payment_status, i.status,
       vs.status as shipment_status, vs.grn_ref
from public.invoices i
join public.v_shipments vs on vs.id = i.shipment_id;

create or replace view public.v_leads with (security_invoker = true) as
select l.*, cb.full_name as created_by_name, asg.full_name as assigned_to_name, c.code as customer_code,
       (select count(*) from public.sourcing_requests r where r.lead_id = l.id) as sourcing_count
from public.leads l
left join public.profiles cb on cb.id = l.created_by
left join public.profiles asg on asg.id = l.assigned_to
left join public.customers c on c.id = l.customer_id;

create or replace view public.v_lead_events with (security_invoker = true) as
select e.*, p.full_name as actor_name,
       (select full_name from public.profiles where id = (e.details->>'to')::uuid) as to_name
from public.lead_events e left join public.profiles p on p.id = e.actor;

create or replace view public.v_sourcing with (security_invoker = true) as
select r.*, coalesce(c.name, l.customer_name, r.requester_name) as customer_display,
       c.code as customer_code, l.lead_number, coalesce(c.phone, l.phone) as contact_phone,
       cb.full_name as created_by_name, asg.full_name as assigned_to_name
from public.sourcing_requests r
left join public.customers c on c.id = r.customer_id
left join public.leads l on l.id = r.lead_id
left join public.profiles cb on cb.id = r.created_by
left join public.profiles asg on asg.id = r.assigned_to;

create or replace view public.v_sourcing_events with (security_invoker = true) as
select e.*, p.full_name as actor_name,
       (select full_name from public.profiles where id = (e.details->>'to')::uuid) as to_name
from public.sourcing_events e left join public.profiles p on p.id = e.actor;

create or replace function public.global_search(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := trim(coalesce(p_q, '')); pat text; dig text; res jsonb := '[]'::jsonb;
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: staff only'; end if;
  if length(q) < 2 then return res; end if;
  pat := '%' || q || '%';
  -- phone digits without the national leading 0, so 0754… finds +255754…
  dig := ltrim(regexp_replace(q, '[^0-9]', '', 'g'), '0');
  if length(dig) < 4 then dig := null; end if;
  if public.has_perm('shipment.read') then
    res := res || coalesce((select jsonb_agg(x) from (select 'shipment' as type, s.id, s.ref as title,
        concat_ws(' · ', s.customer_name, s.receiver_name) as subtitle, '#/shipment/' || s.id as route
      from public.v_shipments s
      where s.ref ilike pat or s.customer_name ilike pat or s.receiver_name ilike pat
         or (dig is not null and (regexp_replace(coalesce(s.customer_phone, ''), '[^0-9]', '', 'g') like '%' || dig || '%'
                               or regexp_replace(coalesce(s.receiver_phone, ''), '[^0-9]', '', 'g') like '%' || dig || '%'))
      order by s.created_at desc limit 8) x), '[]'::jsonb);
  end if;
  if public.has_perm('grn.read') then
    res := res || coalesce((select jsonb_agg(x) from (select 'grn' as type, g.id, g.ref as title,
        concat_ws(' · ', g.shipment_ref, g.customer_name) as subtitle, '#/doc/grn/' || g.shipment_id as route
      from public.v_grn_register g where g.ref ilike pat order by g.received_at desc limit 6) x), '[]'::jsonb);
  end if;
  if public.has_perm('invoice.read') then
    res := res || coalesce((select jsonb_agg(x) from (select 'invoice' as type, i.id, i.ref as title,
        concat_ws(' · ', i.shipment_ref, i.customer_name) as subtitle, '#/doc/invoice/' || i.shipment_id as route
      from public.v_invoice_register i where i.ref ilike pat and i.status = 'issued' order by i.issued_at desc limit 6) x), '[]'::jsonb);
  end if;
  if public.has_perm('packing.read') then
    res := res || coalesce((select jsonb_agg(x) from (select 'packing_list' as type, l.id, l.ref as title,
        concat_ws(' · ', to_char(l.packing_date, 'DD Mon YYYY'), l.status) as subtitle, '#/packing-list/' || l.id as route
      from public.packing_lists l where l.ref ilike pat order by l.created_at desc limit 6) x), '[]'::jsonb);
  end if;
  res := res || coalesce((select jsonb_agg(x) from (select 'lead' as type, l.id, l.lead_number as title,
      concat_ws(' · ', l.customer_name, l.phone, l.status) as subtitle, '#/lead/' || l.id as route
    from public.leads l
    where (public.has_perm('lead.read') or l.created_by = auth.uid() or l.assigned_to = auth.uid())
      and (l.lead_number ilike pat or l.customer_name ilike pat or l.contact_person ilike pat or l.email ilike pat
           or (dig is not null and regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') like '%' || dig || '%'))
    order by l.created_at desc limit 6) x), '[]'::jsonb);
  res := res || coalesce((select jsonb_agg(x) from (select 'sourcing' as type, r.id, r.sourcing_number as title,
      concat_ws(' · ', r.product, r.customer_display, r.status) as subtitle, '#/sourcing/' || r.id as route
    from public.v_sourcing r
    where (public.has_perm('sourcing.read') or public.has_perm('sourcing.write') or r.created_by = auth.uid() or r.assigned_to = auth.uid())
      and (r.sourcing_number ilike pat or r.product ilike pat or r.supplier ilike pat or r.customer_display ilike pat)
    order by r.created_at desc limit 6) x), '[]'::jsonb);
  if public.has_perm('customer.read') then
    res := res || coalesce((select jsonb_agg(x) from (select 'customer' as type, c.id, c.name as title,
        concat_ws(' · ', c.code, c.phone, c.company) as subtitle, '#/customer/' || c.id as route
      from public.customers c
      where c.name ilike pat or c.code ilike pat or c.company ilike pat or c.email ilike pat
         or (dig is not null and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like '%' || dig || '%')
      order by c.created_at desc limit 8) x), '[]'::jsonb);
  end if;
  return res;
end $$;

-- Dashboard: money totals only for roles that handle money; activity only for shipment readers.
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'dashboard_stats_all') then
    alter function public.dashboard_stats() rename to dashboard_stats_all;
  end if;
end $$;
create or replace function public.dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED'; end if;
  res := public.dashboard_stats_all();
  if not (public.has_perm('payment.read') or public.has_perm('invoice.read') or public.has_perm('reports.read')) then
    res := res - 'collected_today_usd' - 'collected_month_usd' - 'outstanding_usd';
  end if;
  if not public.has_perm('shipment.read') then res := res - 'recent_events'; end if;
  return res;
end $$;
revoke all on function public.dashboard_stats_all() from public, anon, authenticated;
revoke all on function public.dashboard_stats() from public, anon;
grant execute on function public.dashboard_stats() to authenticated;

-- ---------------------------------------------------------------------
-- 9. ROW-LEVEL SECURITY & GRANTS
-- ---------------------------------------------------------------------
alter table public.permission_catalog      enable row level security;
alter table public.app_migrations          enable row level security;
alter table public.document_revoked_tokens enable row level security;
alter table public.leads                   enable row level security;
alter table public.lead_events             enable row level security;
alter table public.sourcing_requests       enable row level security;
alter table public.sourcing_events         enable row level security;
alter table public.mail_threads            enable row level security;
alter table public.mail_messages           enable row level security;
alter table public.mail_recipients         enable row level security;
alter table public.mail_thread_state       enable row level security;

drop policy if exists staff_read on public.permission_catalog;
create policy staff_read on public.permission_catalog for select to authenticated using (public.is_staff());
drop policy if exists manager_read on public.document_revoked_tokens;
create policy manager_read on public.document_revoked_tokens for select to authenticated using (public.has_perm('doc.revoke'));

drop policy if exists lead_read on public.leads;
create policy lead_read on public.leads for select to authenticated
  using (public.is_staff() and (public.has_perm('lead.read') or created_by = auth.uid() or assigned_to = auth.uid()));
drop policy if exists lead_read on public.lead_events;
create policy lead_read on public.lead_events for select to authenticated using (public.lead_access(lead_id));

drop policy if exists sourcing_read on public.sourcing_requests;
create policy sourcing_read on public.sourcing_requests for select to authenticated
  using (public.is_staff() and (public.has_perm('sourcing.read') or public.has_perm('sourcing.write')
                                or created_by = auth.uid() or assigned_to = auth.uid()));
drop policy if exists sourcing_read on public.sourcing_events;
create policy sourcing_read on public.sourcing_events for select to authenticated using (public.sourcing_access(sourcing_id));

drop policy if exists participant_read on public.mail_threads;
create policy participant_read on public.mail_threads for select to authenticated using (public.mail_is_participant(id));
drop policy if exists participant_read on public.mail_messages;
create policy participant_read on public.mail_messages for select to authenticated using (public.mail_is_participant(thread_id));
drop policy if exists own_read on public.mail_recipients;
create policy own_read on public.mail_recipients for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.mail_messages m where m.id = message_id and m.sender_id = auth.uid()));
drop policy if exists own_read on public.mail_thread_state;
create policy own_read on public.mail_thread_state for select to authenticated using (user_id = auth.uid());

-- every write goes through the functions above
revoke all on public.permission_catalog, public.app_migrations, public.document_revoked_tokens,
              public.leads, public.lead_events, public.sourcing_requests, public.sourcing_events,
              public.mail_threads, public.mail_messages, public.mail_recipients, public.mail_thread_state,
              public.v_grn_register, public.v_label_register, public.v_invoice_register, public.v_leads,
              public.v_lead_events, public.v_sourcing, public.v_sourcing_events
       from anon, authenticated;
grant select on public.permission_catalog, public.document_revoked_tokens,
               public.leads, public.lead_events, public.sourcing_requests, public.sourcing_events,
               public.mail_threads, public.mail_messages, public.mail_recipients, public.mail_thread_state,
               public.v_grn_register, public.v_label_register, public.v_invoice_register, public.v_leads,
               public.v_lead_events, public.v_sourcing, public.v_sourcing_events
       to authenticated;
revoke insert, update, delete on public.role_permissions from authenticated, anon;
grant usage, select on all sequences in schema public to authenticated;

-- callable by signed-in staff (each checks permissions itself)
revoke all on function
  public.admin_set_role_permission(text,text,boolean), public.doc_register(text,text),
  public.rotate_document_token(uuid,text), public.scan_document(text), public.verify_document(text),
  public.create_lead(jsonb), public.update_lead(jsonb), public.set_lead_status(uuid,text,text),
  public.add_lead_follow_up(uuid,text,date), public.assign_lead(uuid,uuid,text),
  public.lead_customer_matches(uuid), public.convert_lead(uuid,uuid,boolean),
  public.create_sourcing(jsonb), public.update_sourcing(jsonb), public.set_sourcing_status(uuid,text,text),
  public.mail_directory(text), public.mail_send(jsonb), public.mail_list(text,text,int,int),
  public.mail_thread(uuid), public.mail_set_state(uuid,text), public.mail_unread_count(),
  public.global_search(text), public.assignable_roles(), public.lead_access(uuid), public.sourcing_access(uuid),
  public.mail_is_participant(uuid), public.doc_token_from_text(text)
from public, anon;
grant execute on function
  public.admin_set_role_permission(text,text,boolean), public.doc_register(text,text),
  public.rotate_document_token(uuid,text), public.scan_document(text), public.verify_document(text),
  public.create_lead(jsonb), public.update_lead(jsonb), public.set_lead_status(uuid,text,text),
  public.add_lead_follow_up(uuid,text,date), public.assign_lead(uuid,uuid,text),
  public.lead_customer_matches(uuid), public.convert_lead(uuid,uuid,boolean),
  public.create_sourcing(jsonb), public.update_sourcing(jsonb), public.set_sourcing_status(uuid,text,text),
  public.mail_directory(text), public.mail_send(jsonb), public.mail_list(text,text,int,int),
  public.mail_thread(uuid), public.mail_set_state(uuid,text), public.mail_unread_count(),
  public.global_search(text), public.assignable_roles(), public.lead_access(uuid), public.sourcing_access(uuid),
  public.mail_is_participant(uuid), public.doc_token_from_text(text)
to authenticated;
-- public verification page (no login) — minimal facts only
grant execute on function public.verify_document(text), public.doc_token_from_text(text) to anon;

-- internal helpers: nobody calls these directly
revoke all on function public.doc_issue(text,text), public.doc_scan_payload(public.documents),
  public.trg_doc_autoissue(), public.daily_number(text), public.active_staff(uuid), public.lead_validate(public.leads)
from public, anon, authenticated;

commit;
