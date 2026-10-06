// v6 API / RPC / RLS checks: roles & permission matrix, QR registry + scan resolver,
// leads, sourcing, staff mail, registers, global search. Run after v5_test.mjs
// (which re-runs the v5 migration); this file re-applies v6 first and again at the end.
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import pg from 'pg';

const url = 'http://127.0.0.1:8787';
const DB = process.env.HC_TEST_DATABASE_URL || 'postgres://postgres:local-test-only@127.0.0.1:55439/hc';
const db = new pg.Client({ connectionString: DB }); await db.connect();
const reapply = async () => db.query(await fs.readFile('supabase/crm-mail-v6-2.sql', 'utf8'));
await reapply();

const as = async (name) => { const c = createClient(url, 'anon', { auth: { persistSession: false } }); const { error } = await c.auth.signInWithPassword({ email: name + '@hc.test', password: 'Pass1234!' }); assert.ifError(error); return c; };
const names = ['admin', 'manager', 'ops', 'care', 'sales', 'hr', 'logistics', 'sourcing', 'warehouse', 'accountant', 'release'];
const U = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await as(n)])));
const anon = createClient(url, 'anon', { auth: { persistSession: false } });
const uid = async (n) => (await db.query('select id from profiles where email=$1', [n + '@hc.test'])).rows[0].id;
const ID = {}; for (const n of names) ID[n] = await uid(n);

let checks = 0;
const good = (r, label = '') => { if (r.error) throw new Error(`${label}: ${r.error.message}`); checks++; return r.data; };
const bad = (r, pattern) => { assert(r.error, 'Expected server refusal' + (pattern ? ' ' + pattern : '')); if (pattern) assert.match(r.error.message, pattern); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (v, m) => { assert(v, m); checks++; };
const rpc = async (c, name, args) => good(await c.rpc(name, args), name);
const today = (await db.query("select to_char(public.hc_today(),'YYYYMMDD') d")).rows[0].d;

// ───────── 1. roles & permission matrix ─────────
const assignable = await rpc(U.admin, 'assignable_roles', {});
eq(assignable, ['admin', 'manager', 'operations', 'hr', 'accountant', 'logistics', 'sales_marketing', 'sourcing', 'customer_care']);
const inv = await rpc(U.admin, 'admin_invite_staff', { p_email: 'new.hr@hc.test', p_full_name: 'New HR', p_role: 'hr', p_branch: 'DAR' }); eq(inv.role, 'hr');
bad(await U.admin.rpc('admin_invite_staff', { p_email: 'old.role@hc.test', p_full_name: 'X', p_role: 'counter', p_branch: null }), /cannot be assigned/);
bad(await U.manager.rpc('admin_invite_staff', { p_email: 'x@hc.test', p_full_name: 'X', p_role: 'hr', p_branch: null }), /NOT_ALLOWED/);
// a retired role keeps working for its holder; moving to a new role is allowed, moving back is not
await rpc(U.admin, 'admin_save_staff', { p: { id: ID.release, role: 'logistics' } });
bad(await U.admin.rpc('admin_save_staff', { p: { id: ID.release, role: 'release_officer' } }), /no longer assignable/);
await db.query("update profiles set role='release_officer' where id=$1", [ID.release]);
const perms = async (n) => rpc(U[n], 'my_permissions', {});
const P = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await perms(n)])));
ok(P.sales.includes('lead.read') && P.sales.includes('lead.convert') && !P.sales.includes('grn.record'), 'sales defaults');
ok(P.hr.includes('staff.read') && P.hr.includes('mail.use') && !P.hr.includes('shipment.read') && !P.hr.includes('scan.use'), 'hr defaults');
ok(P.logistics.includes('grn.record') && P.logistics.includes('storage.pack') && P.logistics.includes('scan.use') && !P.logistics.includes('invoice.read'), 'logistics defaults');
ok(P.accountant.includes('invoice.read') && P.accountant.includes('payment.record') && P.accountant.includes('acc.read'), 'accounting defaults');
ok(P.care.includes('lead.create') && P.care.includes('scan.use') && !P.care.includes('sourcing.read'), 'customer care defaults');
ok(P.sourcing.includes('sourcing.write') && P.sourcing.includes('lead.read'), 'sourcing defaults');
ok(P.warehouse.includes('grn.record') && P.warehouse.includes('shipment.read') && P.warehouse.includes('mail.use'), 'retired role keeps + gains module views');
for (const n of names.filter((x) => x !== 'admin')) ok(P[n].includes('lead.create'), `${n} can record leads`);
// admin edits the matrix; nobody else can; the guard rails hold
bad(await U.manager.rpc('admin_set_role_permission', { p_role: 'hr', p_permission: 'shipment.read', p_enabled: true }), /NOT_ALLOWED/);
bad(await U.admin.rpc('admin_set_role_permission', { p_role: 'admin', p_permission: 'shipment.read', p_enabled: false }), /administrator/);
bad(await U.admin.rpc('admin_set_role_permission', { p_role: 'hr', p_permission: 'everything.please', p_enabled: true }), /unknown permission/);
await rpc(U.admin, 'admin_set_role_permission', { p_role: 'hr', p_permission: 'customer.read', p_enabled: true });
ok((await perms('hr')).includes('customer.read'), 'grant applies immediately');
await rpc(U.admin, 'admin_set_role_permission', { p_role: 'hr', p_permission: 'customer.read', p_enabled: false });
ok(!(await perms('hr')).includes('customer.read'), 'removal applies immediately');
bad(await U.admin.from('role_permissions').insert({ role: 'hr', permission: 'acc.write' }));
// admin edits survive re-running the migration
await rpc(U.admin, 'admin_set_role_permission', { p_role: 'operations', p_permission: 'lead.create', p_enabled: false });
await reapply();
ok(!(await perms('ops')).includes('lead.create'), 'admin edit kept after rerun');
await rpc(U.admin, 'admin_set_role_permission', { p_role: 'operations', p_permission: 'lead.create', p_enabled: true });
// customers follow customer.write
good(await U.care.from('customers').insert({ name: 'Care Direct', phone: '0712000999' }).select().single());
bad(await U.hr.from('customers').insert({ name: 'HR Direct', phone: '0712000998' }));
// dashboard money only for money roles
ok(!('outstanding_usd' in await rpc(U.hr, 'dashboard_stats', {})), 'hr dashboard has no money');
ok('outstanding_usd' in await rpc(U.manager, 'dashboard_stats', {}), 'manager dashboard has money');

// ───────── 2. QR registry & scan ─────────
const ship = await rpc(U.admin, 'create_shipment', { p: { mode: 'sea', origin_branch: 'DXB', destination_branch: 'DAR',
  sender: { name: 'QR Sender', phone: '0754555111' }, receiver: { name: 'QR Receiver', phone: '0713555111' },
  items: [{ description: 'Speakers', qty: 10, unit: 'CTN', category_id: 1 }], category_id: 1, cbm: 2, rate: 300, rate_note: 'v6 test' } });
const grn = await rpc(U.logistics, 'record_grn', { p_shipment: ship.id, p_lines: [{ pieces: 10, weight_kg: 50 }] });
const docs = (await db.query('select * from documents where shipment_id=$1', [ship.id])).rows;
const docOf = (type) => docs.find((d) => d.doc_type === type);
ok(docOf('grn') && docOf('label') && docOf('invoice'), 'tokens issued automatically on GRN / invoice');
ok(/^[0-9a-f]{36}$/.test(docOf('grn').token), 'opaque random token');
const vurl = (tok) => `https://app.horsecargoltd.com/verify.html?d=${tok}`;
let s = await rpc(U.ops, 'scan_document', { p_code: vurl(docOf('grn').token) });
eq([s.recognized, s.valid, s.document_type, s.document_number, s.shipment_ref, s.route], [true, true, 'grn', grn.grn_ref, ship.ref, `#/doc/grn/${ship.id}`]);
eq(s.customer, 'QR Sender'); eq(Number(s.pieces), 10);
s = await rpc(U.manager, 'scan_document', { p_code: vurl(docOf('invoice').token) });
eq([s.document_type, s.document_number, s.grn_number], ['invoice', ship.invoice_ref, grn.grn_ref]); ok('invoice_total' in s, 'manager sees invoice total');
s = await rpc(U.care, 'scan_document', { p_code: docOf('invoice').token });
eq(s.document_type, 'invoice'); ok(!('invoice_total' in s), 'customer care does not see money');
s = await rpc(U.logistics, 'scan_document', { p_code: vurl(docOf('label').token) });
eq([s.document_type, s.route], ['label', `#/shipment/${ship.id}`]);
// packing list: token at creation, QR identifies it, finalize → issued
const items = good(await U.logistics.from('shipment_items').select('*').eq('shipment_id', ship.id));
const pl = await rpc(U.logistics, 'create_packing_list', { p_token: 'v6-pl-' + Date.now() });
const box = await rpc(U.logistics, 'add_packing_box', { p_list: pl.id, p_token: 'v6-box-' + Date.now() });
await rpc(U.logistics, 'set_packing_box_item', { p_box: box.id, p_item: items[0].id, p_qty: 4 });
const plDoc = (await db.query("select * from documents where doc_type='packing_list' and doc_id=$1", [pl.id])).rows[0];
ok(plDoc && plDoc.doc_ref === pl.ref, 'packing list token issued at creation');
const reg = await rpc(U.logistics, 'doc_register', { p_type: 'packing_list', p_doc_id: pl.id });
eq(reg.token, plDoc.token);
s = await rpc(U.ops, 'scan_document', { p_code: vurl(plDoc.token) });
eq([s.document_type, s.document_number, s.status, Number(s.boxes), s.route, s.prepared_by], ['packing_list', pl.ref, 'draft', 1, `#/packing-list/${pl.id}`, 'Lucas Logistics']);
eq(s.shipments, [ship.ref]);
await rpc(U.logistics, 'finalize_packing_list', { p_list: pl.id });
eq((await rpc(U.ops, 'scan_document', { p_code: vurl(plDoc.token) })).status, 'issued');
// public page: minimal facts only
let v = await rpc(anon, 'verify_document', { p_token: plDoc.token });
eq([v.found, v.document_type, v.status], [true, 'packing_list', 'issued']); ok(!('boxes' in v) && !('customer' in v), 'public verify is minimal');
// manual entry & legacy labels
eq((await rpc(U.ops, 'scan_document', { p_code: grn.grn_ref.toLowerCase() })).document_type, 'grn');
eq((await rpc(U.ops, 'scan_document', { p_code: pl.ref })).document_type, 'packing_list');
s = await rpc(U.ops, 'scan_document', { p_code: ship.ref });
eq([s.document_type, s.legacy], ['label', true]);
// not ours / tampered
for (const code of ['https://example.com/?d=1234', 'hello world', 'a'.repeat(36), vurl('b'.repeat(36)), 'GRN-FAKE-0001', ''])
  eq((await rpc(U.ops, 'scan_document', { p_code: code })).recognized, false, `not recognised: ${code}`);
eq((await rpc(anon, 'verify_document', { p_token: 'c'.repeat(36) })).found, false);
// revoke & replace
bad(await U.ops.rpc('rotate_document_token', { p_document: plDoc.id, p_reason: 'x' }), /NOT_ALLOWED/);
bad(await U.manager.rpc('rotate_document_token', { p_document: plDoc.id, p_reason: '' }), /reason/);
await rpc(U.manager, 'rotate_document_token', { p_document: plDoc.id, p_reason: 'copy sent to wrong client' });
s = await rpc(U.ops, 'scan_document', { p_code: vurl(plDoc.token) });
eq([s.recognized, s.valid, s.status], [true, false, 'revoked']);
eq((await rpc(anon, 'verify_document', { p_token: plDoc.token })).status, 'revoked');
const fresh = (await db.query('select token from documents where id=$1', [plDoc.id])).rows[0].token;
ok(fresh !== plDoc.token, 'new token issued');
eq((await rpc(U.ops, 'scan_document', { p_code: vurl(fresh) })).status, 'issued');
// cancelled shipment → void; retired confirmation stays historical
const waybill = (await db.query("select token from documents where doc_type='waybill' limit 1")).rows[0];
if (waybill) { s = await rpc(U.ops, 'scan_document', { p_code: waybill.token }); eq([s.document_type, s.retired, s.status], ['waybill', true, 'retired']); }
bad(await U.admin.rpc('doc_register', { p_type: 'waybill', p_doc_id: ship.id }), /unsupported/);
// who may scan
bad(await U.hr.rpc('scan_document', { p_code: plDoc.token }), /NOT_ALLOWED/);
bad(await anon.rpc('scan_document', { p_code: plDoc.token }));
ok(Number((await db.query("select count(*) from audit_log where action='document.scan'")).rows[0].count) >= 5, 'scans audited');
ok(Number((await db.query("select count(*) from audit_log where action='document.qr_revoke'")).rows[0].count) === 1, 'revocation audited');

// ───────── 3. leads ─────────
const leadP = (n, extra = {}) => ({ customer_name: `Lead by ${n}`, phone: '07' + String(10000000 + Math.floor(Math.random() * 8.9e7)), service: 'sea', ...extra });
const L = {};
for (const n of ['manager', 'ops', 'care', 'sales', 'hr', 'logistics', 'warehouse', 'accountant']) {
  L[n] = await rpc(U[n], 'create_lead', { p: leadP(n) });
  ok(new RegExp(`^LEAD-${today}-\\d{3,}$`).test(L[n].lead_number), `lead number format ${L[n].lead_number}`);
  eq(L[n].created_by, ID[n]);
}
const token = 'lead-token-' + Date.now();
const once = await rpc(U.ops, 'create_lead', { p: { ...leadP('ops'), client_token: token } });
eq((await rpc(U.ops, 'create_lead', { p: { ...leadP('ops'), client_token: token } })).id, once.id);
const many = await Promise.all(Array.from({ length: 10 }, (_, i) => rpc(U.sales, 'create_lead', { p: leadP('sales' + i) })));
eq(new Set(many.map((l) => l.lead_number)).size, 10);
bad(await U.ops.rpc('create_lead', { p: { customer_name: 'No contact', service: 'air' } }), /phone number or an email/);
bad(await U.ops.rpc('create_lead', { p: { customer_name: 'No need', phone: '0711222333' } }), /what the customer needs/);
bad(await U.ops.rpc('create_lead', { p: { phone: '0711222333', service: 'air' } }), /name/);
bad(await U.ops.rpc('create_lead', { p: { customer_name: 'Bad mail', email: 'nope', service: 'air' } }), /email/);
good(await U.ops.rpc('create_lead', { p: { customer_name: 'Email only', email: 'buyer@example.com', description: 'needs 20ft container' } }));
bad(await U.ops.rpc('create_lead', { p: { ...leadP('ops'), assigned_to: ID.sales } }), /manager/);
bad(await anon.rpc('create_lead', { p: leadP('anon') }));
// visibility: own / assigned vs team
const opsSees = good(await U.ops.from('v_leads').select('id,created_by,assigned_to'));
ok(opsSees.every((l) => l.created_by === ID.ops || l.assigned_to === ID.ops), 'ops sees only own leads');
eq(good(await U.ops.from('v_leads').select('id').eq('id', L.care.id)).length, 0);
bad(await U.ops.rpc('set_lead_status', { p_lead: L.care.id, p_status: 'contacted' }), /NOT_ALLOWED/);
ok(good(await U.sales.from('v_leads').select('id')).length >= 18, 'sales sees all leads');
// assign / status / follow-up / history
bad(await U.ops.rpc('assign_lead', { p_lead: L.ops.id, p_user: ID.sales }), /NOT_ALLOWED/);
await rpc(U.manager, 'assign_lead', { p_lead: L.care.id, p_user: ID.ops, p_note: 'you are near this client' });
eq(good(await U.ops.from('v_leads').select('id,assigned_to_name').eq('id', L.care.id)).length, 1);
await rpc(U.ops, 'set_lead_status', { p_lead: L.care.id, p_status: 'contacted', p_note: 'called' });
await rpc(U.ops, 'add_lead_follow_up', { p_lead: L.care.id, p_note: 'call back Monday', p_follow_up: '2026-10-12' });
bad(await U.ops.rpc('set_lead_status', { p_lead: L.care.id, p_status: 'converted' }), /Convert to customer/);
bad(await U.ops.rpc('set_lead_status', { p_lead: L.care.id, p_status: 'maybe' }), /unknown status/);
const ev = good(await U.ops.from('v_lead_events').select('*').eq('lead_id', L.care.id).order('at'));
eq(ev.map((e) => e.kind), ['created', 'assigned', 'status', 'note']);
eq(good(await U.ops.from('leads').select('follow_up_date').eq('id', L.care.id).single()).follow_up_date, '2026-10-12');
bad(await U.ops.from('leads').update({ status: 'qualified' }).eq('id', L.ops.id));
bad(await U.ops.from('leads').insert({ lead_number: 'LEAD-FAKE', customer_name: 'x' }));
good(await U.ops.rpc('update_lead', { p: { id: L.ops.id, contact_person: 'Juma', notes: 'met at office' } }));
bad(await U.ops.rpc('update_lead', { p: { id: L.ops.id, phone: '', email: '' } }), /phone number or an email/);
// convert: duplicate-safe
const custCount = async () => Number((await db.query('select count(*) from customers')).rows[0].count);
const before = await custCount();
const dup = await rpc(U.sales, 'create_lead', { p: { customer_name: 'Duplicate Phone', phone: '+255754555111', service: 'air' } });
let c = await rpc(U.sales, 'convert_lead', { p_lead: dup.id });
eq(c.status, 'matches'); eq(c.matches[0].match, 'phone');
c = await rpc(U.sales, 'convert_lead', { p_lead: dup.id, p_create_new: true });
eq(c.status, 'matches', 'phone match blocks a second customer');
c = await rpc(U.sales, 'convert_lead', { p_lead: dup.id, p_customer: c.matches[0].id });
eq(c.status, 'converted'); eq(await custCount(), before);
const conv = good(await U.sales.from('v_leads').select('*').eq('id', dup.id).single());
eq([conv.status, conv.customer_id], ['converted', c.customer_id]);
bad(await U.sales.rpc('set_lead_status', { p_lead: dup.id, p_status: 'lost' }), /already converted/);
eq((await rpc(U.sales, 'convert_lead', { p_lead: dup.id })).already, true);
const fresh1 = await rpc(U.care, 'create_lead', { p: { customer_name: 'Brand New Co', contact_person: 'Asha', phone: '0788000111', email: 'asha@brandnew.co', service: 'air' } });
c = await rpc(U.care, 'convert_lead', { p_lead: fresh1.id });
eq(c.status, 'converted'); eq(await custCount(), before + 1);
const newCust = (await db.query('select * from customers where id=$1', [c.customer_id])).rows[0];
eq([newCust.name, newCust.phone, newCust.email], ['Brand New Co', '+255788000111', 'asha@brandnew.co']);
const emailOnly = await rpc(U.sales, 'create_lead', { p: { customer_name: 'Asha again', email: 'ASHA@brandnew.co', service: 'sea' } });
c = await rpc(U.sales, 'convert_lead', { p_lead: emailOnly.id });
eq([c.status, c.matches[0].match], ['matches', 'email']);
bad(await U.sales.rpc('convert_lead', { p_lead: emailOnly.id, p_create_new: true }), /phone number/);
bad(await U.ops.rpc('convert_lead', { p_lead: L.ops.id }), /NOT_ALLOWED/);
const race = await rpc(U.sales, 'create_lead', { p: { customer_name: 'Race Ltd', phone: '0799111222', service: 'sea' } });
const raced = await Promise.all([U.sales.rpc('convert_lead', { p_lead: race.id }), U.manager.rpc('convert_lead', { p_lead: race.id })]);
eq(raced.filter((r) => !r.error).length, 2); eq(new Set(raced.map((r) => r.data.customer_id)).size, 1);
eq(Number((await db.query("select count(*) from customers where phone='+255799111222'")).rows[0].count), 1);

// ───────── 4. sourcing ─────────
bad(await U.sales.rpc('create_sourcing', { p: { lead_id: L.sales.id, product: 'Speakers' } }), /NOT_ALLOWED/);
const sr = await rpc(U.sourcing, 'create_sourcing', { p: { lead_id: L.sales.id, product: 'Bluetooth speakers', quantity: 100, unit: 'PCS', description: 'Customer wants 100 Bluetooth speakers' } });
ok(new RegExp(`^SRC-${today}-\\d{3,}$`).test(sr.sourcing_number), 'sourcing number format');
eq(sr.lead_id, L.sales.id); eq(sr.requester_name, null);
const vs = good(await U.sourcing.from('v_sourcing').select('*').eq('id', sr.id).single());
eq([vs.customer_display, vs.lead_number], [L.sales.customer_name, L.sales.lead_number]);
eq(good(await U.sales.from('v_lead_events').select('*').eq('lead_id', L.sales.id).eq('kind', 'sourcing')).length, 1);
eq(good(await U.sales.from('v_sourcing').select('id').eq('id', sr.id)).length, 1, 'sales reads sourcing');
eq(good(await U.care.from('v_sourcing').select('id').eq('id', sr.id)).length, 0, 'care cannot read until assigned');
bad(await U.sourcing.rpc('create_sourcing', { p: { product: 'Orphan' } }), /lead or customer/);
bad(await U.sourcing.rpc('create_sourcing', { p: { requester_name: 'Walk-in', product: 'Phones', estimated_cost: -5 } }));
const viaCust = await rpc(U.sourcing, 'create_sourcing', { p: { customer_id: c.matches ? newCust.id : newCust.id, product: 'Tyres', currency: 'CNY' } });
eq(viaCust.customer_id, newCust.id);
const srs = await Promise.all(Array.from({ length: 6 }, (_, i) => rpc(U.manager, 'create_sourcing', { p: { requester_name: 'Walk-in ' + i, product: 'Item ' + i } })));
eq(new Set(srs.map((x) => x.sourcing_number)).size, 6);
await rpc(U.sourcing, 'update_sourcing', { p: { id: sr.id, assigned_to: ID.care } });
eq(good(await U.care.from('v_sourcing').select('id').eq('id', sr.id)).length, 1, 'assignee reads');
await rpc(U.care, 'set_sourcing_status', { p_id: sr.id, p_status: 'searching' });
bad(await U.care.rpc('update_sourcing', { p: { id: sr.id, assigned_to: ID.ops } }), /reassign/);
await rpc(U.sourcing, 'update_sourcing', { p: { id: sr.id, supplier: 'Shenzhen Audio Co', supplier_contact: '+86 755 0000', estimated_cost: 1250.5, currency: 'USD', quoted_price: 1600 } });
for (const st of ['supplier_found', 'quotation_sent', 'customer_approved', 'purchased', 'completed']) await rpc(U.sourcing, 'set_sourcing_status', { p_id: sr.id, p_status: st });
const done = good(await U.sourcing.from('v_sourcing').select('*').eq('id', sr.id).single());
eq([done.status, Number(done.estimated_cost), done.supplier, !!done.completed_at], ['completed', 1250.5, 'Shenzhen Audio Co', true]);
bad(await U.sourcing.rpc('set_sourcing_status', { p_id: sr.id, p_status: 'searching' }), /closed/);
bad(await U.sourcing.rpc('update_sourcing', { p: { id: sr.id, notes: 'late' } }), /closed/);
bad(await U.sourcing.rpc('set_sourcing_status', { p_id: srs[0].id, p_status: 'cancelled' }), /reason/);
await rpc(U.sourcing, 'set_sourcing_status', { p_id: srs[0].id, p_status: 'cancelled', p_note: 'customer changed mind' });
bad(await U.sourcing.rpc('set_sourcing_status', { p_id: srs[1].id, p_status: 'shipped' }), /unknown status/);
eq(good(await U.sourcing.from('v_sourcing_events').select('kind').eq('sourcing_id', sr.id)).filter((e) => e.kind === 'status').length, 6);
bad(await U.sourcing.from('sourcing_requests').update({ status: 'new' }).eq('id', sr.id));

// ───────── 5. staff mail ─────────
const send = (c, p) => c.rpc('mail_send', { p });
const unread = async (n) => rpc(U[n], 'mail_unread_count', {});
const m1 = good(await send(U.ops, { to: [ID.care], cc: [ID.sales], subject: `Shipment ${ship.ref}`, body: 'Please confirm whether this cargo has been packed.', client_token: 'mail-1' }));
eq((await rpc(U.ops, 'mail_send', { p: { to: [ID.care], subject: 'dup', body: 'dup', client_token: 'mail-1' } })).duplicate, true);
eq([await unread('care'), await unread('sales'), await unread('ops')], [1, 1, 0]);
let box1 = await rpc(U.care, 'mail_list', { p_folder: 'inbox' });
eq([box1.total, box1.rows[0].subject, box1.rows[0].unread], [1, `Shipment ${ship.ref}`, 1]);
let th = await rpc(U.care, 'mail_thread', { p_thread: m1.thread_id });
eq(th.messages.length, 1); eq(await unread('care'), 0);
th = await rpc(U.ops, 'mail_thread', { p_thread: m1.thread_id });
const rc = Object.fromEntries(th.messages[0].recipients.map((r) => [r.id, r]));
ok(rc[ID.care].read_at && !rc[ID.sales].read_at, 'sender sees who has read');
eq([rc[ID.care].kind, rc[ID.sales].kind], ['to', 'cc']);
good(await send(U.care, { thread_id: m1.thread_id, to: [ID.ops], body: 'Yes, it has been packed in Box 3.' }));
eq(await unread('ops'), 1);
good(await send(U.sales, { thread_id: m1.thread_id, to: [ID.ops, ID.care], body: 'Noted, thanks both.' }));
good(await send(U.ops, { thread_id: m1.thread_id, to: [ID.care], cc: [ID.sales], body: 'Thank you.' }));
th = await rpc(U.ops, 'mail_thread', { p_thread: m1.thread_id });
eq(th.messages.map((m) => m.body), ['Please confirm whether this cargo has been packed.', 'Yes, it has been packed in Box 3.', 'Noted, thanks both.', 'Thank you.']);
eq(new Set((await db.query('select thread_id from mail_messages where thread_id=$1', [m1.thread_id])).rows.map((r) => r.thread_id)).size, 1);
const sent = await rpc(U.ops, 'mail_list', { p_folder: 'sent' });
ok(sent.rows.some((r) => r.id === m1.thread_id), 'sent folder');
eq((await rpc(U.care, 'mail_list', { p_folder: 'inbox', p_q: 'Box 3' })).total, 1);
eq((await rpc(U.care, 'mail_list', { p_folder: 'inbox', p_q: 'no-such-text' })).total, 0);
// outsiders see nothing
bad(await U.hr.rpc('mail_thread', { p_thread: m1.thread_id }), /not part/);
eq(good(await U.hr.from('mail_messages').select('id').eq('thread_id', m1.thread_id)).length, 0);
bad(await send(U.hr, { thread_id: m1.thread_id, to: [ID.ops], body: 'sneak' }), /not part/);
bad(await U.ops.from('mail_messages').insert({ thread_id: m1.thread_id, sender_id: ID.care, body: 'forged' }));
bad(await anon.rpc('mail_unread_count', {}));
// archive / trash / unread
await rpc(U.care, 'mail_set_state', { p_thread: m1.thread_id, p_action: 'archive' });
eq((await rpc(U.care, 'mail_list', { p_folder: 'inbox' })).total, 0);
eq((await rpc(U.care, 'mail_list', { p_folder: 'archived' })).total, 1);
good(await send(U.ops, { thread_id: m1.thread_id, to: [ID.care], body: 'One more thing.' }));
eq((await rpc(U.care, 'mail_list', { p_folder: 'inbox' })).total, 1, 'new reply returns it to the inbox');
await rpc(U.care, 'mail_set_state', { p_thread: m1.thread_id, p_action: 'trash' });
eq([(await rpc(U.care, 'mail_list', { p_folder: 'trash' })).total, await unread('care')], [1, 0]);
await rpc(U.care, 'mail_set_state', { p_thread: m1.thread_id, p_action: 'restore' });
await rpc(U.care, 'mail_thread', { p_thread: m1.thread_id });
await rpc(U.care, 'mail_set_state', { p_thread: m1.thread_id, p_action: 'unread' });
eq(await unread('care'), 1);
// validation
bad(await send(U.ops, { to: [], subject: 'x', body: 'x' }), /recipient/);
bad(await send(U.ops, { to: [ID.care], subject: '', body: 'x' }), /subject/);
bad(await send(U.ops, { to: [ID.care], subject: 'x', body: '   ' }), /write a message/);
await db.query("insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values (gen_random_uuid(),'gone@hc.test',crypt('x',gen_salt('bf')),'{}')");
const gone = (await db.query("select id from profiles where email='gone@hc.test'")).rows[0].id;
bad(await send(U.ops, { to: [gone], subject: 'x', body: 'x' }), /active staff/);
eq((await rpc(U.ops, 'mail_directory', {})).some((d) => d.id === gone || d.id === ID.ops), false);
ok(Number((await db.query("select count(*) from audit_log where action='mail.send'")).rows[0].count) >= 5, 'mail sends audited');

// ───────── 6. registers, search, leaks ─────────
eq(good(await U.logistics.from('v_grn_register').select('*').eq('id', grn.grn_id)).length, 1);
eq(good(await U.logistics.from('v_label_register').select('*').eq('shipment_id', ship.id)).length, 1);
eq(good(await U.accountant.from('v_invoice_register').select('*').eq('shipment_id', ship.id)).length, 1);
let gs = await rpc(U.ops, 'global_search', { p_q: grn.grn_ref });
ok(gs.some((r) => r.type === 'grn' && r.route === `#/doc/grn/${ship.id}`), 'search finds GRN');
gs = await rpc(U.ops, 'global_search', { p_q: pl.ref }); ok(gs.some((r) => r.type === 'packing_list'), 'search finds packing list');
gs = await rpc(U.sales, 'global_search', { p_q: L.care.lead_number }); ok(gs.some((r) => r.type === 'lead'), 'search finds lead');
gs = await rpc(U.ops, 'global_search', { p_q: L.hr.lead_number }); ok(!gs.some((r) => r.type === 'lead'), 'search respects lead visibility');
gs = await rpc(U.manager, 'global_search', { p_q: sr.sourcing_number }); ok(gs.some((r) => r.type === 'sourcing'), 'search finds sourcing');
gs = await rpc(U.hr, 'global_search', { p_q: ship.ref }); ok(!gs.some((r) => r.type === 'shipment'), 'hr cannot search shipments');
gs = await rpc(U.manager, 'global_search', { p_q: '0754555111' }); ok(gs.some((r) => r.type === 'customer'), 'search by phone');
for (const fn of ['doc_issue', 'daily_number', 'doc_scan_payload', 'dashboard_stats_all'])
  bad(await U.admin.rpc(fn, fn === 'daily_number' ? { p_prefix: 'LEAD' } : fn === 'doc_issue' ? { p_type: 'grn', p_doc_id: grn.grn_id } : {}));
bad(await anon.from('leads').select('*'));
bad(await anon.from('mail_messages').select('*'));

// re-running the migration on all this data changes nothing
const snap = async () => (await db.query(`select (select count(*) from leads) l, (select count(*) from sourcing_requests) s, (select count(*) from mail_messages) m,
  (select count(*) from documents) d, (select count(*) from role_permissions) rp, (select string_agg(token, ',' order by id) from documents) tk`)).rows[0];
const s1 = await snap(); await reapply(); eq(await snap(), s1);
await db.end();
await fs.mkdir('work', { recursive: true });
await fs.writeFile('work/v6-fixtures.json', JSON.stringify({ ship: ship.id, shipRef: ship.ref, grnRef: grn.grn_ref, invoiceRef: ship.invoice_ref,
  pl: pl.id, plRef: pl.ref, thread: m1.thread_id, tokens: { grn: docOf('grn').token, invoice: docOf('invoice').token, pl: fresh, revoked: plDoc.token } }));
console.log(`PASS: ${checks} v6 checks — roles/permissions, QR registry & scan, leads, sourcing, staff mail, search, RLS.`);
