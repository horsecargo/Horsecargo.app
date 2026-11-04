-- =====================================================================
-- Horse Cargo — website sourcing intake (v8)
-- Install after mail-v7.sql. Rerunnable.
--
-- The public website (horsecargoltd.com) forwards each sourcing form to the
-- Netlify function `website-intake`, which verifies the website's HMAC
-- signature and calls website_intake() with the service role. Browsers and
-- signed-in staff cannot call it: the website never holds a Supabase key.
--
-- One submission creates a Lead (source 'website') and a linked Sourcing
-- request, both 'new' and unassigned, so the team triages them as usual.
-- The website reference (SRC-YYMMDD-XXXXX) is the idempotency key: a retry
-- returns the records created the first time.
-- =====================================================================

create or replace function public.website_intake(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tok text := 'web:' || nullif(trim(p->>'reference'), '');
  l public.leads; r public.sourcing_requests;
  v_qty numeric; v_desc text; v_product text;
begin
  if tok is null then raise exception 'REFUSED: website reference is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('website:' || tok, 0));
  select * into l from public.leads where client_token = tok;
  if l.id is not null then
    select * into r from public.sourcing_requests where client_token = tok;
    return jsonb_build_object('lead', l.lead_number, 'sourcing', r.sourcing_number, 'duplicate', true);
  end if;

  v_desc := concat_ws(E'\n',
    nullif(trim(p->>'requirements'), ''),
    'Company: '     || nullif(trim(p->>'company'), ''),
    'Quantity: '    || nullif(trim(p->>'quantity'), ''),
    'Origin: '      || nullif(trim(p->>'origin_market'), ''),
    'Destination: ' || nullif(trim(p->>'destination'), ''),
    'Timeline: '    || nullif(trim(p->>'timeline'), ''),
    'Attachments: ' || nullif(nullif(p->>'files', ''), '0') || ' (kept on the website server)',
    'Website ref: ' || trim(p->>'reference'));

  l.customer_name  := left(coalesce(nullif(trim(p->>'company'), ''), trim(p->>'full_name')), 255);
  l.contact_person := left(nullif(trim(p->>'full_name'), ''), 255);
  l.phone          := left(nullif(trim(p->>'phone'), ''), 30);
  l.email          := left(nullif(lower(trim(p->>'email')), ''), 255);
  l.service        := left(coalesce(nullif(trim(p->>'service'), ''), 'Product Sourcing'), 255);
  l.description    := left(v_desc, 6000);
  perform public.lead_validate(l);

  insert into public.leads(lead_number, customer_name, contact_person, phone, email, country, service, source,
                           description, created_by, client_token)
  values (public.daily_number('LEAD'), l.customer_name, l.contact_person, l.phone, l.email,
          left(nullif(trim(p->>'destination'), ''), 100), l.service, 'website', l.description, null, tok)
  returning * into l;
  insert into public.lead_events(lead_id, kind, to_status, actor, details)
  values (l.id, 'created', 'new', null, jsonb_build_object('via', 'website', 'reference', p->>'reference'));

  -- "500 pcs" → 500; anything unparseable stays only in the description.
  v_qty := nullif(substring(coalesce(p->>'quantity', '') from '([0-9]+(?:\.[0-9]+)?)'), '')::numeric;
  if v_qty is not null and v_qty <= 0 then v_qty := null; end if;
  v_product := left(coalesce(nullif(trim(p->>'product'), ''), l.service), 255);

  insert into public.sourcing_requests(sourcing_number, lead_id, product, description, quantity, currency,
                                       created_by, client_token)
  values (public.daily_number('SRC'), l.id, v_product, l.description, v_qty, 'USD', null, tok)
  returning * into r;
  insert into public.sourcing_events(sourcing_id, kind, to_status, actor) values (r.id, 'created', 'new', null);
  insert into public.lead_events(lead_id, kind, details, actor)
  values (l.id, 'sourcing', jsonb_build_object('sourcing_id', r.id, 'sourcing_number', r.sourcing_number), null);

  perform public.log_audit('website.intake', 'lead', l.id::text,
          jsonb_build_object('lead', l.lead_number, 'sourcing', r.sourcing_number, 'reference', p->>'reference'));
  return jsonb_build_object('lead', l.lead_number, 'sourcing', r.sourcing_number, 'duplicate', false);
end $$;

revoke execute on function public.website_intake(jsonb) from public, anon, authenticated;
grant execute on function public.website_intake(jsonb) to service_role;
