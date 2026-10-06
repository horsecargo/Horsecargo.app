// v4 — staff administration, special access, storage and partial packing
import { createClient } from '@supabase/supabase-js';
const as = async (e) => { const c = createClient('http://localhost:8787', 'anon', { auth: { persistSession: false } }); const r = await c.auth.signInWithPassword({ email: e + '@hc.test', password: 'Pass1234!' }); if (r.error) throw r.error; return c; };
const ok = (r, label) => { if (r.error) { console.log('✗', label, '—', r.error.message); process.exitCode = 1; return null; } return r.data; };
const expectErr = (r, label) => { const good = !!r.error; if (!good) process.exitCode = 1; console.log(good ? '✓ refused' : '✗ NOT refused', label, good ? '(' + r.error.message.slice(0, 70) + ')' : ''); };
const eq = (a, b, label) => { const good = Math.abs(Number(a) - Number(b)) < 0.005 || String(a) === String(b); if (!good) process.exitCode = 1; console.log(good ? '✓' : `✗ (${a} ≠ ${b})`, label); };
const yes = (v, label) => { if (!v) process.exitCode = 1; console.log(v ? '✓' : '✗', label); };

const [admin, counter, cashier, wh, ops, acct, fin] =
  await Promise.all(['admin','counter','cashier','warehouse','ops','accountant','finance'].map(as));
const uid = async (c) => (await c.auth.getUser()).data.user.id;

console.log('\n— 1 · Finance Manager and Viewer are retired from new assignment —');
const roles = ok(await admin.rpc('assignable_roles'), 'assignable_roles');
console.log('   assignable:', roles.join(', '));
yes(!roles.includes('finance_manager'), 'Finance Manager cannot be assigned');
yes(!roles.includes('viewer'), 'Viewer cannot be assigned');
yes(roles.includes('accountant') && roles.includes('manager') && roles.includes('operations'), 'the working roles remain');  // v6: cashier/counter/warehouse/release officer retired from new assignment
const finId = await uid(fin), counterId = await uid(counter);
expectErr(await admin.rpc('admin_save_staff', { p: { id: counterId, role: 'finance_manager' } }), 'assigning Finance Manager to somebody new');
expectErr(await admin.rpc('admin_invite_staff', { p_email: 'v@hc.test', p_full_name: 'V', p_role: 'viewer' }), 'inviting a Viewer');

console.log('\n— 2 · the existing Finance Manager keeps working —');
const fperm = ok(await fin.rpc('my_permissions'), 'finance manager permissions');
yes(fperm.includes('acc.read') && fperm.includes('payment.record'), 'still holds their permissions (' + fperm.length + ')');
ok(await admin.rpc('admin_save_staff', { p: { id: finId, full_name: 'Omari Finance', branch_code: 'DAR' } }), 'edit without touching the role');
ok(await admin.rpc('admin_save_staff', { p: { id: finId, role: 'accountant' } }), 'move them onto an assignable role');
expectErr(await admin.rpc('admin_save_staff', { p: { id: finId, role: 'finance_manager' } }), 'putting them back on Finance Manager (one-way door)');

console.log('\n— 3 · a shipment to work with —');
const s = ok(await admin.rpc('create_shipment', { p: {
  mode: 'sea', origin_branch: 'DXB', destination_branch: 'DAR',
  sender: { name: 'Juma Hardware', phone: '0754 900 100' }, receiver: { name: 'Neema Ltd', phone: '0713 900 200' },
  items: [{ description: 'Floor tiles', category_id: 1, qty: 73, unit: 'CTN' },
          { description: 'Cement mix',  category_id: 1, qty: 10, unit: 'BAG' }],
  category_id: 1, cbm: 3, rate: 200 } }), 'create shipment');
console.log('   ', s?.ref, '| USD', s?.total, '| TZS', s?.total_txn);

console.log('\n— 4 · the Accountant can take a customer payment —');
const p1 = ok(await acct.rpc('record_payment', { p_shipment: s.id, p_amount: 100000, p_currency: 'TZS', p_method: 'cash' }), 'accountant records TZS 100,000');
yes(p1?.receipt_no || p1?.ref, 'a receipt is issued: ' + (p1?.receipt_no || p1?.ref));
eq(p1.fx_rate, 2600, 'same invoice rate as the cashier would use');
const aud = ok(await admin.from('audit_log').select('*').eq('action', 'receipt.create').order('at', { ascending: false }).limit(1), 'audit');
yes(aud?.length === 1, 'the payment is in the audit trail');
expectErr(await acct.rpc('record_payment', { p_shipment: s.id, p_amount: 100000, p_currency: 'TZS', p_method: 'cash' }), 'the duplicate guard still applies to the accountant');
expectErr(await acct.rpc('record_payment', { p_shipment: s.id, p_amount: -5000, p_currency: 'TZS', p_method: 'cash' }), 'negative amount');

console.log('\n— 5 · nobody else can reach the money, even through the API directly —');
expectErr(await wh.rpc('record_payment', { p_shipment: s.id, p_amount: 1000, p_currency: 'TZS', p_method: 'cash' }), 'warehouse records a payment');
expectErr(await ops.rpc('record_payment', { p_shipment: s.id, p_amount: 1000, p_currency: 'TZS', p_method: 'cash' }), 'logistics officer records a payment');
expectErr(await ops.rpc('set_invoice_currency', { p_shipment: s.id, p_currency: 'USD' }), 'logistics officer changes the billing currency');
expectErr(await wh.from('storage_stock').insert({ shipment_id: s.id, item_id: 1, received_qty: 999 }), 'writing to storage_stock directly');
expectErr(await ops.from('permission_grants').insert({ user_id: await uid(ops), permission: 'payment.record' }), 'granting yourself a permission');
expectErr(await ops.rpc('grant_permission', { p_user: await uid(ops), p_permission: 'payment.record' }), 'calling grant_permission as a non-admin');

console.log('\n— 6 · the Admin lends a permission, with an expiry —');
const opsId = await uid(ops);
expectErr(await admin.rpc('grant_permission', { p_user: opsId, p_permission: 'staff.manage' }), 'lending an administrative permission');
const g = ok(await admin.rpc('grant_permission', { p_user: opsId, p_permission: 'payment.record',
  p_expires: new Date(Date.now() + 3600e3).toISOString(), p_reason: 'Cashier on leave' }), 'lend payment.record for an hour');
const opsPerms = ok(await ops.rpc('my_permissions'), 'permissions after the grant');
yes(opsPerms.includes('payment.record'), 'the logistics officer now has payment.record');
yes(!opsPerms.includes('staff.manage') && !opsPerms.includes('acc.write'), 'and nothing else was handed over');
const p2 = ok(await ops.rpc('record_payment', { p_shipment: s.id, p_amount: 50000, p_currency: 'TZS', p_method: 'cash' }), 'and can now take a payment');
yes(!!p2, 'payment accepted while the grant is live');

console.log('\n— 7 · revoking is immediate —');
ok(await admin.rpc('revoke_permission', { p_grant: g.id, p_reason: 'Cashier is back' }), 'revoke');
yes(!(ok(await ops.rpc('my_permissions'), 'perms')).includes('payment.record'), 'the permission is gone at once');
expectErr(await ops.rpc('record_payment', { p_shipment: s.id, p_amount: 1000, p_currency: 'TZS', p_method: 'cash' }), 'the next payment attempt');
const rows = ok(await admin.from('v_permission_grants').select('*').eq('user_id', opsId), 'grant history');
yes(rows.length === 1 && rows[0].is_active === false && rows[0].revoke_reason === 'Cashier is back', 'the history keeps who lent it, why and when it ended');
const ag = ok(await admin.from('audit_log').select('action').in('action', ['access.grant', 'access.revoke']), 'access audit');
yes(ag.length === 2, 'both the grant and the revocation are audited');
// an expired grant stops working on its own
const g2 = ok(await admin.rpc('grant_permission', { p_user: opsId, p_permission: 'acc.read', p_expires: new Date(Date.now() + 1500).toISOString() }), 'a 1.5-second grant');
yes((ok(await ops.rpc('my_permissions'), 'perms')).includes('acc.read'), 'live now');
await new Promise(r => setTimeout(r, 2200));
yes(!(ok(await ops.rpc('my_permissions'), 'perms')).includes('acc.read'), 'expired on its own, with nobody revoking it');
yes(g2 && g2.id, 'the expired grant is still on the record for the auditor');

console.log('\n— 8 · storage fills up exactly once, when the goods arrive —');
let st = ok(await counter.from('v_storage').select('*').eq('shipment_id', s.id), 'storage before the GRN');
yes(st.length === 0, 'nothing in storage before the goods are received');
const items = ok(await counter.from('shipment_items').select('id,description,qty,unit').eq('shipment_id', s.id).order('id'), 'items');
const tiles = items.find(i => i.description === 'Floor tiles'), cement = items.find(i => i.description === 'Cement mix');
ok(await wh.rpc('record_grn', { p_shipment: s.id, p_lines: [
  { item_id: tiles.id, pieces: 73, weight_kg: 900 }, { item_id: cement.id, pieces: 10, weight_kg: 500 }] }), 'record the GRN');
st = ok(await counter.from('v_storage').select('*').eq('shipment_id', s.id).single(), 'storage after the GRN');
eq(st.received_qty, 83, 'received 83 units (73 CTN + 10 BAG)');
eq(st.packed_qty, 0, 'nothing packed yet');
eq(st.state, 'unpacked', 'state: unpacked');
expectErr(await wh.rpc('record_grn', { p_shipment: s.id, p_lines: [{ item_id: tiles.id, pieces: 73, weight_kg: 900 }] }), 'a second GRN for the same shipment');
st = ok(await counter.from('v_storage').select('*').eq('shipment_id', s.id).single(), 'storage again');
eq(st.received_qty, 83, 'the quantity did not double');

console.log('\n— 9 · partial packing: 73 tiles go out as 38, then 35 —');
const pk1 = ok(await wh.rpc('record_packing', { p: { shipment_id: s.id, lines: [{ item_id: tiles.id, qty: 38 }], notes: 'First lorry' } }), 'pack 38');
console.log('   ', pk1?.ref, '→ state', pk1?.state);
let si = ok(await counter.from('v_storage_items').select('*').eq('item_id', tiles.id).single(), 'tiles');
eq(si.packed_qty, 38, 'tiles packed 38'); eq(si.remaining_qty, 35, 'tiles remaining 35'); eq(si.state, 'partially_packed', 'tiles partially packed');
st = ok(await counter.from('v_storage').select('*').eq('shipment_id', s.id).single(), 'shipment storage');
eq(st.state, 'partially_packed', 'the shipment is partially packed');
const pk2 = ok(await wh.rpc('record_packing', { p: { shipment_id: s.id, lines: [{ item_id: tiles.id, qty: 35 }], notes: 'Second lorry' } }), 'pack the remaining 35');
si = ok(await counter.from('v_storage_items').select('*').eq('item_id', tiles.id).single(), 'tiles');
eq(si.packed_qty, 73, 'tiles packed 73'); eq(si.remaining_qty, 0, 'tiles remaining 0'); eq(si.state, 'fully_packed', 'tiles fully packed');
st = ok(await counter.from('v_storage').select('*').eq('shipment_id', s.id).single(), 'shipment storage');
eq(st.state, 'partially_packed', 'the shipment is still only partial — the cement has not been packed');
const hist = ok(await counter.from('v_packing_lines').select('*').eq('item_id', tiles.id).order('packed_at'), 'history');
eq(hist.length, 2, 'two packing entries are kept, not one merged figure');
console.log('   history:', hist.map(h => `${h.entry_ref} ${h.qty}`).join(' · '));

console.log('\n— 10 · packing cannot overrun, double-submit or race —');
expectErr(await wh.rpc('record_packing', { p: { shipment_id: s.id, lines: [{ item_id: tiles.id, qty: 1 }] } }), 'packing more than was received');
expectErr(await wh.rpc('record_packing', { p: { shipment_id: s.id, lines: [{ item_id: cement.id, qty: 11 }] } }), 'packing 11 of 10 bags');
expectErr(await wh.rpc('record_packing', { p: { shipment_id: s.id, lines: [{ item_id: cement.id, qty: 2.5 }] } }), 'half a bag');
expectErr(await wh.rpc('record_packing', { p: { shipment_id: s.id, lines: [{ item_id: cement.id, qty: -2 }] } }), 'a negative quantity');
expectErr(await wh.rpc('record_packing', { p: { shipment_id: s.id, lines: [] } }), 'an empty packing entry');
expectErr(await cashier.rpc('record_packing', { p: { shipment_id: s.id, lines: [{ item_id: cement.id, qty: 1 }] } }), 'the cashier packing goods (no storage.pack)');
const tok = 'tok-' + Date.now();
const d1 = ok(await wh.rpc('record_packing', { p: { shipment_id: s.id, lines: [{ item_id: cement.id, qty: 3 }], client_token: tok } }), 'pack 3 bags');
const d2 = ok(await wh.rpc('record_packing', { p: { shipment_id: s.id, lines: [{ item_id: cement.id, qty: 3 }], client_token: tok } }), 'the same submission again');
yes(d2.duplicate === true && d1.ref === d2.ref, 'the retry returns the first entry instead of packing twice');
si = ok(await counter.from('v_storage_items').select('*').eq('item_id', cement.id).single(), 'cement');
eq(si.packed_qty, 3, 'cement packed 3, not 6');
// two officers pressing at the same moment: 7 bags left, both try 5
const race = await Promise.all([
  wh.rpc('record_packing', { p: { shipment_id: s.id, lines: [{ item_id: cement.id, qty: 5 }] } }),
  admin.rpc('record_packing', { p: { shipment_id: s.id, lines: [{ item_id: cement.id, qty: 5 }] } })]);
const won = race.filter(r => !r.error).length;
si = ok(await counter.from('v_storage_items').select('*').eq('item_id', cement.id).single(), 'cement');
yes(won === 1 && Number(si.packed_qty) === 8, `only one of two simultaneous entries got through (${won} accepted, packed ${si.packed_qty} of 10)`);

console.log('\n— 11 · a mistake can be reversed, with a reason on the record —');
expectErr(await wh.rpc('void_packing_entry', { p_entry: pk1.id, p_reason: 'oops' }), 'a warehouse hand reversing an entry (no storage.correct)');
expectErr(await admin.rpc('void_packing_entry', { p_entry: pk1.id, p_reason: '  ' }), 'reversing without giving a reason');
ok(await admin.rpc('void_packing_entry', { p_entry: pk1.id, p_reason: 'Counted wrong, tiles came back' }), 'reverse the 38');
si = ok(await counter.from('v_storage_items').select('*').eq('item_id', tiles.id).single(), 'tiles');
eq(si.packed_qty, 35, 'tiles back to 35 packed'); eq(si.remaining_qty, 38, '38 loose again');
const ve = ok(await counter.from('v_packing_entries').select('*').eq('id', pk1.id).single(), 'entry');
yes(ve.void && ve.void_reason && ve.voided_by_name, 'the reversal keeps the reason and who did it');
expectErr(await admin.rpc('void_packing_entry', { p_entry: pk1.id, p_reason: 'again' }), 'reversing the same entry twice');
ok(await wh.rpc('record_packing', { p: { shipment_id: s.id, lines: [{ item_id: tiles.id, qty: 38 }] } }), 're-pack the 38');

console.log('\n— 12 · packing is not dispatch, and not payment —');
st = ok(await counter.from('v_storage').select('*').eq('shipment_id', s.id).single(), 'storage');
let sv = ok(await counter.from('v_shipments').select('*').eq('id', s.id).single(), 'shipment');
console.log('   storage:', st.state, '| transport:', sv.status, '| payment:', sv.payment_status);
eq(st.state, 'partially_packed', 'storage says partially packed');
eq(sv.status, 'received_dubai', 'the transport status has not moved on its own');
yes(sv.payment_status === 'part_paid', 'and the payment status is its own thing');
ok(await ops.rpc('set_shipment_status', { p_shipment: s.id, p_status: 'dispatched' }), 'dispatch the shipment');
st = ok(await counter.from('v_storage').select('*').eq('shipment_id', s.id).single(), 'storage after dispatch');
eq(st.state, 'partially_packed', 'dispatching did not silently mark the goods packed');

console.log('\n— 13 · the historical migration —');
// a shipment that never had a GRN, and one that was delivered long ago
const noGrn = ok(await admin.rpc('create_shipment', { p: { mode: 'air', origin_branch: 'DXB', destination_branch: 'MWZ',
  sender: { name: 'Old Sender', phone: '0754 111 999' }, receiver: { name: 'Old Receiver', phone: '0713 111 999' },
  items: [{ description: 'Books', category_id: 1, qty: 5, unit: 'CTN' }], category_id: 1, weight_kg: 20, rate: 4 } }), 'shipment without a GRN');
const gone = ok(await admin.rpc('create_shipment', { p: { mode: 'air', origin_branch: 'DXB', destination_branch: 'DAR',
  sender: { name: 'Past Sender', phone: '0754 222 999' }, receiver: { name: 'Past Receiver', phone: '0713 222 999' },
  items: [{ description: 'Shoes', category_id: 1, qty: 12, unit: 'CTN' }], category_id: 1, weight_kg: 30, rate: 4 } }), 'shipment already delivered');
const gItems = ok(await counter.from('shipment_items').select('id').eq('shipment_id', gone.id), 'items');
ok(await wh.rpc('record_grn', { p_shipment: gone.id, p_lines: [{ item_id: gItems[0].id, pieces: 12, weight_kg: 30 }] }), 'GRN');
for (const stt of ['packed', 'dispatched', 'in_transit', 'arrived'])
  ok(await ops.rpc('set_shipment_status', { p_shipment: gone.id, p_status: stt }), 'status ' + stt);
// wipe the storage rows these two created so the migration has to rebuild them from scratch
for (const id of [gone.id, s.id]) ok(await admin.rpc('test_clear_storage', { p_shipment: id }), 'clear storage');
const mig = ok(await admin.rpc('storage_migrate_v4'), 'replay the migration');
console.log('   migration seeded', mig?.shipments, 'shipments,', mig?.opening_packed_entries, 'as already packed');
let noneSt = ok(await counter.from('v_storage').select('*').eq('shipment_id', noGrn.id), 'no-GRN shipment');
yes(noneSt.length === 0, 'a shipment that was never received stays out of storage');
const goneSt = ok(await counter.from('v_storage').select('*').eq('shipment_id', gone.id).single(), 'delivered shipment');
eq(goneSt.received_qty, 12, 'the delivered shipment is recorded as received');
eq(goneSt.state, 'fully_packed', 'and as fully packed, not as loose stock sitting in the warehouse');
const goneHist = ok(await counter.from('v_packing_entries').select('*').eq('shipment_id', gone.id), 'its packing history');
yes(goneHist.length === 1 && /Opening balance/.test(goneHist[0].notes) && !goneHist[0].packed_by_name,
    'its history says it is an opening balance, credited to nobody');
const back = ok(await counter.from('v_storage').select('*').eq('shipment_id', s.id).single(), 'the dispatched shipment');
eq(back.state, 'fully_packed', 'the dispatched shipment is rebuilt as fully packed too');
const again = ok(await admin.rpc('storage_migrate_v4'), 'run the migration a second time');
eq(again.shipments, 0, 'running the migration twice changes nothing');
const cancelled = ok(await admin.rpc('create_shipment', { p: { mode: 'air', origin_branch: 'DXB', destination_branch: 'DAR',
  sender: { name: 'Cx Sender', phone: '0754 333 999' }, receiver: { name: 'Cx Receiver', phone: '0713 333 999' },
  items: [{ description: 'Cancelled goods', category_id: 1, qty: 4, unit: 'CTN' }], category_id: 1, weight_kg: 5, rate: 4 } }), 'cancelled shipment');
const cItems = ok(await counter.from('shipment_items').select('id').eq('shipment_id', cancelled.id), 'items');
ok(await wh.rpc('record_grn', { p_shipment: cancelled.id, p_lines: [{ item_id: cItems[0].id, pieces: 4, weight_kg: 5 }] }), 'GRN');
ok(await admin.rpc('test_clear_storage', { p_shipment: cancelled.id }), 'clear');
ok(await admin.rpc('cancel_shipment', { p_shipment: cancelled.id, p_reason: 'Customer withdrew' }), 'cancel it');
ok(await admin.rpc('storage_migrate_v4'), 'migrate again');
yes((ok(await counter.from('v_storage').select('*').eq('shipment_id', cancelled.id), 'cancelled storage')).length === 0,
    'a cancelled shipment is left out of storage');

console.log('\n— 14 · packing a cancelled shipment is refused —');
expectErr(await wh.rpc('record_packing', { p: { shipment_id: cancelled.id, lines: [{ item_id: cItems[0].id, qty: 1 }] } }), 'packing cancelled goods');

console.log(process.exitCode ? '\n✗ SOME CHECKS FAILED' : '\n✓ all v4 checks passed');
