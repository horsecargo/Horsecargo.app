-- Horse Cargo v5. Run AFTER staff-storage-v4.sql, before deploying the v5 UI.
-- Additive and rerunnable. Historical documents and packing entries are retained.
begin;

-- lpad(text,4) truncates values above 9999. Widen the suffix automatically.
create or replace function public.document_counter(p_key text) returns text
language plpgsql security definer set search_path=public as $$
declare n text;
begin
  n := public.next_counter(p_key)::text;
  return lpad(n,greatest(4,length(n)),'0');
end $$;
revoke all on function public.document_counter(text) from public,anon,authenticated;
do $$ declare sig text; src text;
begin
  foreach sig in array array['create_shipment(jsonb)','record_grn(uuid,jsonb,text,text,text[],boolean)','record_packing(jsonb)'] loop
    src := pg_get_functiondef(('public.'||sig)::regprocedure);
    src := replace(src,'lpad(public.next_counter(''INV-'' || public.yymm())::text, 4, ''0'')',
      'public.document_counter(''INV-'' || public.yymm())');
    src := replace(src,'lpad(public.next_counter(''GRN-'' || s.origin_branch || ''-'' || public.yymm())::text, 4, ''0'')',
      'public.document_counter(''GRN-'' || s.origin_branch || ''-'' || public.yymm())');
    src := replace(src,'lpad(public.next_counter(''PK-'' || public.yymm())::text, 4, ''0'')',
      'public.document_counter(''PK-'' || public.yymm())');
    execute src;
  end loop;
end $$;

-- Issued GRNs/invoices need no human decision. Keep previous approvals as history.
alter table public.documents drop constraint if exists documents_status_check;
alter table public.documents add constraint documents_status_check
  check (status in ('pending','approved','rejected','issued'));
update public.documents set status = 'issued'
  where doc_type in ('invoice','grn') and status <> 'issued';

create or replace function public.doc_register(p_type text, p_doc_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.documents; m record;
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: staff only'; end if;
  if p_type not in ('invoice','receipt','grn','release') then raise exception 'REFUSED: unsupported document'; end if;
  select * into m from public.doc_meta(p_type, p_doc_id);
  if m.doc_ref is null then raise exception 'NOT_FOUND: document'; end if;
  insert into public.documents(doc_type, doc_id, shipment_id, doc_ref, issued_at, status)
  values (p_type, p_doc_id, m.shipment_id, m.doc_ref, m.issued_at,
          case when p_type in ('invoice','grn') then 'issued' else 'pending' end)
  on conflict (doc_type, doc_id) do update set doc_ref = excluded.doc_ref, issued_at = excluded.issued_at,
    status = case when excluded.doc_type in ('invoice','grn') then 'issued' else documents.status end
  returning * into d;
  return jsonb_build_object('token', d.token, 'status', d.status, 'version', d.version,
    'ref', d.doc_ref, 'type', d.doc_type,
    'approval_required', d.doc_type not in ('invoice','grn'),
    'approved_by', case when d.doc_type not in ('invoice','grn') then
      (select full_name from public.profiles where id = d.approved_by) end,
    'approved_at', case when d.doc_type not in ('invoice','grn') then d.approved_at end);
end $$;

create or replace function public.doc_touch(p_type text, p_doc_id text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d public.documents;
begin
  -- Retired confirmation records remain verifiable, but leave the active workflow.
  if p_type = 'waybill' then return; end if;
  select * into d from public.documents where doc_type = p_type and doc_id = p_doc_id for update;
  if d.id is null then return; end if;
  if p_type in ('invoice','grn') then
    update public.documents set version = version + 1, status = 'issued' where id = d.id;
    return;
  end if;
  if d.status = 'pending' then return; end if;
  insert into public.document_approvals(document_id, version, action, note, acted_by)
  values (d.id, d.version, 'superseded', coalesce(p_reason,'document changed after approval'), auth.uid());
  update public.documents set version = version + 1, status = 'pending', decision_note = null where id = d.id;
  perform public.log_audit('document.superseded','document',d.id::text,
    jsonb_build_object('ref',d.doc_ref,'type',d.doc_type,'version',d.version+1));
end $$;

-- Preserve existing approval permission checks for receipts and delivery notes.
do $$ declare src text; needle text := 'if d.id is null then raise exception ''NOT_FOUND: document''; end if;';
begin
  src := pg_get_functiondef('public.approve_document(text,boolean,text)'::regprocedure);
  if position('v5: approval exclusions' in src) = 0 then
    if position(needle in src) = 0 then raise exception 'Unexpected approve_document definition'; end if;
    execute replace(src, needle, needle || E'\n  -- v5: approval exclusions\n  if d.doc_type in (''invoice'',''grn'',''waybill'') then raise exception ''REFUSED: this document does not use approvals''; end if;');
  end if;
end $$;

create or replace function public.verify_document(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d public.documents; s public.shipments; exempt boolean; invalid boolean;
begin
  select * into d from public.documents where token = trim(p_token);
  if d.id is null then return jsonb_build_object('found',false); end if;
  select * into s from public.shipments where id = d.shipment_id;
  exempt := d.doc_type in ('invoice','grn');
  invalid := s.status = 'cancelled'
    or (d.doc_type = 'invoice' and exists (select 1 from public.invoices where id::text=d.doc_id and status <> 'issued'))
    or (d.doc_type = 'receipt' and exists (select 1 from public.receipts where id::text=d.doc_id and void));
  return jsonb_build_object('found',true,'company',(select company_name from public.settings where id=1),
    'document_type',d.doc_type,'document_no',d.doc_ref,'shipment_ref',s.ref,'issued_at',d.issued_at,
    'version',d.version,'status',case when invalid then 'void' when exempt then 'issued' else d.status end,
    'approval_required',not exempt,'retired',d.doc_type='waybill',
    'approved_by',case when not exempt then (select full_name from public.profiles where id=d.approved_by) end,
    'approved_at',case when not exempt then d.approved_at end,
    'superseded',not exempt and d.approved_version is not null and d.approved_version <> d.version,
    'shipment_status',s.status,'checked_at',now());
end $$;

create or replace view public.v_documents with (security_invoker = true) as
select d.*, s.ref as shipment_ref, p.full_name as approved_by_name
from public.documents d left join public.shipments s on s.id=d.shipment_id
left join public.profiles p on p.id=d.approved_by where d.doc_type <> 'waybill';

-- Boxes group the EXISTING packing entries/lines; no second stock ledger.
create table if not exists public.packing_lists (
  id uuid primary key default gen_random_uuid(), ref text not null unique,
  packing_date date not null default (now() at time zone 'Asia/Dubai')::date,
  status text not null default 'draft' check (status in ('draft','finalized')),
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), finalized_at timestamptz,
  next_box_no integer not null default 0 check (next_box_no >= 0), client_token text unique
);
create table if not exists public.packing_list_boxes (
  id uuid primary key default gen_random_uuid(),
  packing_list_id uuid not null references public.packing_lists(id),
  box_no integer not null check (box_no > 0), created_at timestamptz not null default now(),
  client_token text unique, unique (packing_list_id, box_no)
);
alter table public.packing_entries add column if not exists packing_list_box_id uuid
  references public.packing_list_boxes(id);
create unique index if not exists packing_entry_box_shipment_idx
  on public.packing_entries(packing_list_box_id,shipment_id) where packing_list_box_id is not null;

-- Internal list lock serializes edits/finalization. All mutations use storage.pack.
create or replace function public.packing_list_lock(p_list uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.packing_lists;
begin
  perform public.require_perm('storage.pack');
  select * into l from public.packing_lists where id=p_list for update;
  if l.id is null then raise exception 'NOT_FOUND: packing list'; end if;
  if l.status <> 'draft' then raise exception 'REFUSED: packing list is finalized'; end if;
end $$;

create or replace function public.create_packing_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.packing_lists; r text;
begin
  perform public.require_perm('storage.pack');
  if coalesce(trim(p_token),'')='' then raise exception 'REFUSED: submission token required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('packing-list:'||p_token,0));
  select * into l from public.packing_lists where client_token=p_token;
  if l.id is not null then return to_jsonb(l); end if;
  r := 'HC-PL-'||public.yymm()||'-'||public.document_counter('PL-'||public.yymm());
  insert into public.packing_lists(ref,created_by,client_token) values(r,auth.uid(),p_token) returning * into l;
  perform public.log_audit('packing_list.create','packing_list',l.id::text,jsonb_build_object('ref',r));
  return to_jsonb(l);
end $$;

create or replace function public.add_packing_box(p_list uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.packing_list_boxes; n integer;
begin
  perform public.packing_list_lock(p_list);
  if coalesce(trim(p_token),'')='' then raise exception 'REFUSED: submission token required'; end if;
  select * into b from public.packing_list_boxes where client_token=p_token;
  if b.id is not null then
    if b.packing_list_id <> p_list then raise exception 'REFUSED: token belongs to another list'; end if;
    return to_jsonb(b);
  end if;
  update public.packing_lists set next_box_no=next_box_no+1,updated_at=now() where id=p_list returning next_box_no into n;
  insert into public.packing_list_boxes(packing_list_id,box_no,client_token) values(p_list,n,p_token) returning * into b;
  perform public.log_audit('packing_list.box_add','packing_list',p_list::text,jsonb_build_object('box_no',n));
  return to_jsonb(b);
end $$;

-- Absolute quantity makes retrying a save safe. Draft lines reserve stock immediately,
-- so old partial packing and other lists cannot pack the same quantity again.
create or replace function public.set_packing_box_item(p_box uuid, p_item bigint, p_qty numeric) returns void
language plpgsql security definer set search_path = public as $$
declare b public.packing_list_boxes; st public.storage_stock; it public.shipment_items;
  s public.shipments; e public.packing_entries; old_qty numeric := 0; delta numeric; r text;
begin
  select * into b from public.packing_list_boxes where id=p_box;
  perform public.packing_list_lock(b.packing_list_id);
  -- Recheck after waiting for the list lock (an empty box may have been removed).
  if not exists(select 1 from public.packing_list_boxes where id=p_box) then raise exception 'NOT_FOUND: box'; end if;
  if p_qty is null or p_qty < 0 or p_qty::text in ('NaN','Infinity','-Infinity') then raise exception 'REFUSED: invalid quantity'; end if;
  select * into it from public.shipment_items where id=p_item;
  select * into s from public.shipments where id=it.shipment_id for update;
  if s.id is null then raise exception 'NOT_FOUND: shipment item'; end if;
  if s.status='cancelled' and p_qty > 0 then raise exception 'REFUSED: shipment is cancelled'; end if;
  select * into it from public.shipment_items where id=p_item;
  select * into st from public.storage_stock where item_id=p_item and shipment_id=s.id for update;
  if st.id is null then raise exception 'REFUSED: item has not been received into storage'; end if;
  if public.unit_is_whole(st.unit) and p_qty <> round(p_qty) then raise exception 'REFUSED: whole pieces required'; end if;
  select * into e from public.packing_entries where packing_list_box_id=p_box and shipment_id=s.id;
  select coalesce(sum(qty),0) into old_qty from public.packing_lines where entry_id=e.id and item_id=p_item;
  delta := p_qty-old_qty;
  if st.packed_qty+delta > least(st.received_qty,it.qty) then
    raise exception 'REFUSED: only % % available', greatest(least(st.received_qty,it.qty)-st.packed_qty+old_qty,0),st.unit;
  end if;
  if st.packed_qty+delta < 0 then raise exception 'REFUSED: inconsistent packing balance'; end if;
  if e.id is null and p_qty > 0 then
    r := 'HC-PK-'||public.yymm()||'-'||public.document_counter('PK-'||public.yymm());
    insert into public.packing_entries(ref,shipment_id,packing_list_box_id,packed_by)
    values(r,s.id,p_box,auth.uid()) returning * into e;
  end if;
  update public.storage_stock set packed_qty=packed_qty+delta,updated_at=now() where id=st.id;
  if p_qty = 0 then
    delete from public.packing_lines where entry_id=e.id and item_id=p_item;
  else
    update public.packing_lines set qty=p_qty where entry_id=e.id and item_id=p_item;
    if not found then insert into public.packing_lines(entry_id,item_id,qty) values(e.id,p_item,p_qty); end if;
  end if;
  update public.packing_lists set updated_at=now() where id=b.packing_list_id;
  perform public.log_audit('packing_list.item_set','packing_list',b.packing_list_id::text,
    jsonb_build_object('box',b.box_no,'shipment',s.ref,'item_id',p_item,'before',old_qty,'qty',p_qty));
end $$;

create or replace function public.remove_packing_box(p_box uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.packing_list_boxes;
begin
  select * into b from public.packing_list_boxes where id=p_box;
  perform public.packing_list_lock(b.packing_list_id);
  if exists(select 1 from public.packing_lines l join public.packing_entries e on e.id=l.entry_id
    where e.packing_list_box_id=p_box) then raise exception 'REFUSED: remove the items first'; end if;
  delete from public.packing_entries where packing_list_box_id=p_box;
  delete from public.packing_list_boxes where id=p_box;
  update public.packing_lists set updated_at=now() where id=b.packing_list_id;
  perform public.log_audit('packing_list.box_remove','packing_list',b.packing_list_id::text,jsonb_build_object('box_no',b.box_no));
end $$;

create or replace function public.move_packing_box_item(p_line bigint, p_box uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.packing_lines; source_box uuid; source_list uuid; target_list uuid; q numeric;
begin
  select * into l from public.packing_lines where id=p_line;
  select e.packing_list_box_id,b.packing_list_id into source_box,source_list
    from public.packing_entries e join public.packing_list_boxes b on b.id=e.packing_list_box_id where e.id=l.entry_id;
  select packing_list_id into target_list from public.packing_list_boxes where id=p_box;
  if source_list is null or source_list is distinct from target_list then raise exception 'REFUSED: choose a box in the same list'; end if;
  perform public.packing_list_lock(source_list);
  select * into l from public.packing_lines where id=p_line;
  if l.id is null then raise exception 'REFUSED: item changed; reload the list'; end if;
  if source_box=p_box then return; end if;
  select coalesce(sum(pl.qty),0) into q from public.packing_lines pl join public.packing_entries e on e.id=pl.entry_id
    where e.packing_list_box_id=p_box and pl.item_id=l.item_id;
  perform public.set_packing_box_item(source_box,l.item_id,0);
  perform public.set_packing_box_item(p_box,l.item_id,q+l.qty);
end $$;

create or replace function public.finalize_packing_list(p_list uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.packing_list_lock(p_list);
  -- Share the shipment lock with item edits and cancellations.
  perform 1 from public.shipments s where s.id in
    (select e.shipment_id from public.packing_entries e join public.packing_list_boxes b on b.id=e.packing_list_box_id
      where b.packing_list_id=p_list) order by s.id for update;
  if not exists(select 1 from public.packing_lines l join public.packing_entries e on e.id=l.entry_id
    join public.packing_list_boxes b on b.id=e.packing_list_box_id where b.packing_list_id=p_list) then
    raise exception 'REFUSED: add items before finalizing'; end if;
  if exists(select 1 from public.packing_entries e join public.packing_list_boxes b on b.id=e.packing_list_box_id
    join public.shipments s on s.id=e.shipment_id where b.packing_list_id=p_list and s.status='cancelled') then
    raise exception 'REFUSED: list contains a cancelled shipment'; end if;
  update public.packing_lists set status='finalized',finalized_at=now(),updated_at=now() where id=p_list;
  perform public.log_audit('packing_list.finalize','packing_list',p_list::text);
end $$;

create or replace view public.v_packing_lists with (security_invoker=true) as
select l.*,p.full_name as prepared_by,
 (select count(*) from public.packing_list_boxes b where b.packing_list_id=l.id) as total_boxes,
 (select coalesce(sum(pl.qty),0) from public.packing_lines pl join public.packing_entries e on e.id=pl.entry_id
   join public.packing_list_boxes b on b.id=e.packing_list_box_id where b.packing_list_id=l.id) as total_qty
from public.packing_lists l left join public.profiles p on p.id=l.created_by;
create or replace view public.v_packing_box_items with (security_invoker=true) as
select l.*,b.id as box_id,b.box_no,b.packing_list_id,e.shipment_id,s.ref as shipment_ref,
 i.description,i.unit,i.qty as original_qty
from public.packing_lines l join public.packing_entries e on e.id=l.entry_id
join public.packing_list_boxes b on b.id=e.packing_list_box_id
join public.shipments s on s.id=e.shipment_id join public.shipment_items i on i.id=l.item_id;

-- Preserve legacy partial packing; it must obey the same original-quantity cap.
-- Linked entries can only be edited through the list RPCs, never legacy voiding.
do $$ declare src text; needle text;
begin
  src := pg_get_functiondef('public.record_packing(jsonb)'::regprocedure);
  src := replace(src,'where id = (p->>''shipment_id'')::uuid;', 'where id = (p->>''shipment_id'')::uuid for update;');
  src := replace(src,'if st.packed_qty + q > st.received_qty then',
    'if st.packed_qty + q > least(st.received_qty, (select qty from public.shipment_items where id=st.item_id)) then');
  execute src;
  src := pg_get_functiondef('public.void_packing_entry(uuid,text)'::regprocedure);
  needle := 'if e.id is null or e.void then';
  if position('v5: list-owned entry' in src)=0 then
    if position(needle in src)=0 then raise exception 'Unexpected void_packing_entry definition'; end if;
    execute replace(src,needle,E'-- v5: list-owned entry\n  if e.packing_list_box_id is not null then raise exception ''REFUSED: edit the draft packing list instead''; end if;\n  '||needle);
  end if;
end $$;

alter table public.packing_lists enable row level security;
alter table public.packing_list_boxes enable row level security;
drop policy if exists staff_read on public.packing_lists;
create policy staff_read on public.packing_lists for select to authenticated using(public.is_staff());
drop policy if exists staff_read on public.packing_list_boxes;
create policy staff_read on public.packing_list_boxes for select to authenticated using(public.is_staff());
grant select on public.packing_lists,public.packing_list_boxes,public.v_packing_lists,public.v_packing_box_items to authenticated;
revoke all on public.packing_lists,public.packing_list_boxes,public.v_packing_lists,public.v_packing_box_items from anon;
revoke insert,update,delete on public.packing_lists,public.packing_list_boxes from authenticated;
revoke all on function public.packing_list_lock(uuid) from public,anon,authenticated;
revoke all on function public.create_packing_list(text),public.add_packing_box(uuid,text),
  public.set_packing_box_item(uuid,bigint,numeric),public.remove_packing_box(uuid),
  public.move_packing_box_item(bigint,uuid),public.finalize_packing_list(uuid) from public,anon;
grant execute on function public.create_packing_list(text),public.add_packing_box(uuid,text),
  public.set_packing_box_item(uuid,bigint,numeric),public.remove_packing_box(uuid),
  public.move_packing_box_item(bigint,uuid),public.finalize_packing_list(uuid) to authenticated;
-- Shipment editing previously deleted/recreated every item, cascading stock and
-- packing history. Reconcile stable IDs instead; retain received item references.
create or replace function public.reconcile_shipment_items(p_shipment uuid,p_items jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare it jsonb; existing public.shipment_items; item_id bigint; seen bigint[] := '{}';
  q numeric; u text; stocked boolean;
begin
  perform 1 from public.storage_stock st where st.shipment_id=p_shipment order by st.item_id for update;
  for it in select * from jsonb_array_elements(p_items) loop
    item_id := nullif(it->>'id','')::bigint;
    if item_id is null then
      -- Compatibility with older clients that submit unchanged items without IDs.
      select id into item_id from public.shipment_items where shipment_id=p_shipment
        and not(id=any(seen)) and description=coalesce(nullif(trim(it->>'description'),''),'Cargo')
        and unit=coalesce(nullif(it->>'unit',''),'PCS')
        and category_id is not distinct from nullif(it->>'category_id','')::int order by id limit 1;
    end if;
    q := coalesce((it->>'qty')::numeric,1); u := coalesce(nullif(it->>'unit',''),'PCS');
    if q <= 0 or q::text in ('NaN','Infinity','-Infinity') then raise exception 'REFUSED: invalid item quantity'; end if;
    if item_id is not null then
      select * into existing from public.shipment_items where id=item_id and shipment_id=p_shipment;
      if existing.id is null or item_id=any(seen) then raise exception 'REFUSED: invalid shipment item ID'; end if;
      stocked := exists(select 1 from public.storage_stock st where st.shipment_id=p_shipment and st.item_id=existing.id);
      if stocked and u <> existing.unit then raise exception 'REFUSED: received item units cannot change'; end if;
      if exists(select 1 from public.storage_stock st where st.item_id=existing.id and st.packed_qty>q) then
        raise exception 'REFUSED: quantity is below the amount already packed'; end if;
      update public.shipment_items set description=coalesce(nullif(trim(it->>'description'),''),'Cargo'),
        category_id=nullif(it->>'category_id','')::int,qty=q,unit=u where id=item_id;
    else
      insert into public.shipment_items(shipment_id,description,category_id,qty,unit)
      values(p_shipment,coalesce(nullif(trim(it->>'description'),''),'Cargo'),nullif(it->>'category_id','')::int,q,u)
      returning id into item_id;
    end if;
    seen := array_append(seen,item_id);
  end loop;
  if exists(select 1 from public.storage_stock st where st.shipment_id=p_shipment and not(st.item_id=any(seen))) then
    raise exception 'REFUSED: received items cannot be removed; keep their history'; end if;
  delete from public.shipment_items where shipment_id=p_shipment and not(id=any(seen));
end $$;
do $$ declare src text; old_block text;
begin
  src := pg_get_functiondef('public.update_shipment(jsonb)'::regprocedure);
  old_block := substring(src from '    delete from public.shipment_items where shipment_id = s_id;.*?    end loop;');
  if position('reconcile_shipment_items' in src)=0 then
    if old_block is null then raise exception 'Unexpected update_shipment definition'; end if;
    execute replace(src,old_block,'    perform public.reconcile_shipment_items(s_id,p->''items'');');
  end if;
end $$;
revoke all on function public.reconcile_shipment_items(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.verify_document(text) to anon;
commit;
