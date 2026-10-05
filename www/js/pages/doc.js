import { shipmentItemTable, paymentInformation } from '../document-items.js';
import { wirePDF } from '../document-pdf.js';
import { t } from '../i18n.js';
import { from, run, rpc, state, branchName, catName, publicTrackUrl, verifyUrl } from '../api.js';
import { icon, esc, usd, money, num, fdate, fdatetime, qrSVG, whatsappLink, isNative } from '../ui.js';

// Printed documents are ENGLISH ONLY, whatever language the app interface is set to.
const L = (en) => en;
const ST_EN = { received_dubai: 'Received at Dubai office', packed: 'Packed for dispatch', dispatched: 'Dispatched from Dubai',
  in_transit: 'On transit to Tanzania', in_customs: 'In customs', arrived: 'Arrived at the office',
  delivered: 'Delivered', cancelled: 'Cancelled' };
const DASH = '—';
const dim = (v) => (v === null || v === undefined || v === '' ? DASH : v);

// Every document carries a QR code that opens its verification page.
async function docStamp(type, id) {
  let d = null;
  try { d = await rpc('doc_register', { p_type: type, p_doc_id: id }); } catch { /* verification optional */ }
  if (!d) return '';
  const exempt = ['invoice', 'grn'].includes(type);
  const label = exempt ? 'Issued' : { pending: 'Pending approval', approved: 'Approved', rejected: 'Rejected' }[d.status] || d.status;
  const color = exempt || d.status === 'approved' ? '#1d8a55' : d.status === 'rejected' ? '#b3261e' : '#8a5a00';
  return `<div class="qr-box verify">
    ${qrSVG(verifyUrl(d.token), 4)}
    <div class="vq">Scan to verify document</div>
    <div class="vs" style="color:${color}">${esc(label)}${!exempt && d.approved_by ? ` · ${esc(d.approved_by)}` : ''}</div>
  </div>`;
}

function header(title, ref, extra = '') {
  const s = state.settings;
  return `<div class="dh">
    <div class="co" style="display:flex;gap:12px;align-items:center"><span class="logo-tile"><img src="img/logo-white.png" alt="Horse Cargo"></span>
      <div><b>${esc('Horse Cargo Company Ltd')}</b><div>${esc(s.company_address)}</div><div>${esc(s.company_phone)} · ${esc(s.company_email)}</div>
      <div>Dar es Salaam: ${esc(state.branches.find((b) => b.code === 'DAR')?.phone || '')} · Mwanza: ${esc(state.branches.find((b) => b.code === 'MWZ')?.phone || '')}</div></div></div>
    <div class="dt"><h1>${title}</h1><div class="mono" style="font-size:15px;font-weight:700">${esc(ref)}</div>${extra}</div>
  </div>`;
}
const toolbar = (back, share) => `<div class="doc-toolbar"><a class="btn" href="${back}">${icon('arrowLeft')}${esc(t('back'))}</a>
  ${isNative() ? '' : `<button class="btn primary" onclick="window.print()">${icon('print')}${esc(t('print'))}</button>`}${share || ''}<button class="btn" id="download-pdf">${icon('download')}Download PDF</button></div>`;

export async function render({ el, params, setTitle }) {
  const [type, id] = params;
  const H = { invoice, receipt, grn, labels, release, packing: packingList }[type];
  if (!H) { el.innerHTML = 'Unknown document'; return; }
  await H(el, id, setTitle);
  if (type !== 'labels') wirePDF(el);
  else el.querySelector('#download-pdf')?.remove();
}

async function loadBooking(id) { return run(from('v_shipments').select('*').eq('id', id).single()); }
function parties(b) {
  return `<div class="parties">
    <div><h4>${L('Sender', 'Mtumaji')}</h4><b>${esc(b.sender_name || b.customer_name)}</b>${b.customer_company ? `<div>${esc(b.customer_company)}</div>` : ''}<div>${esc(b.sender_phone || b.customer_phone)}</div>${b.sender_address ? `<div>${esc(b.sender_address)}</div>` : ''}<div class="mono">${esc(b.customer_code)}</div></div>
    <div><h4>${L('Receiver', 'Mpokeaji')}</h4><b>${esc(b.receiver_name)}</b><div>${esc(b.receiver_phone)}</div>${b.receiver_address ? `<div>${esc(b.receiver_address)}</div>` : ''}${b.receiver_tin ? `<div>TIN ${esc(b.receiver_tin)}</div>` : ''}</div>
  </div>
  <table><tbody><tr><td><b>${L('Shipment', 'Shipment')}</b><br><span class="mono">${esc(b.ref)}</span></td><td><b>${L('Mode', 'Njia')}</b><br>${esc(b.mode.toUpperCase())}</td>
    <td><b>${L('Route', 'Safari')}</b><br>${esc(branchName(b.origin_branch))} → ${esc(branchName(b.destination_branch))}</td>
    <td><b>${L('Status')}</b><br>${esc(ST_EN[b.status] || b.status)}</td></tr></tbody></table>`;
}

async function invoice(el, id, setTitle) {
  const b = await loadBooking(id);
  const inv = await run(from('invoices').select('*').eq('shipment_id', id).eq('status', 'issued').single());
  const items = await run(from('v_shipment_items').select('*').eq('shipment_id', id).order('id'));
  const lines = await run(from('invoice_lines').select('*').eq('invoice_id', inv.id).order('id'));
  setTitle(inv.ref);
  const cur = inv.currency || 'USD'; const fx = Number(inv.fx_rate || 1);
  const bal = Number(b.balance_txn);
  const stamp = await docStamp('invoice', inv.id);
  el.innerHTML = toolbar(`#/shipment/${id}`, `<a class="btn" target="_blank" rel="noopener" href="${whatsappLink(b.customer_phone, `Horse Cargo — Invoice ${inv.ref}\nShipment: ${b.ref}\nTotal: ${money(inv.total_txn, cur)}\nPaid: ${money(b.paid_txn, cur)}\nBalance: ${money(bal, cur)}`)}">${icon('whatsapp')}${esc(t('share_whatsapp'))}</a>`) + `
  <div class="doc">
    ${header(L('INVOICE'), inv.ref, `<div>${fdate(inv.issued_at)}</div>`)}
    <div class="doc-top"><div style="flex:1">${parties(b)}</div>${stamp}</div>
    <p><b>${L('Cargo')}:</b> ${esc(b.description)} · ${num(b.pieces, 0)} pcs${b.cbm ? ` · ${num(b.cbm, 3)} CBM` : ''}${b.actual_kg ? ` · ${num(b.actual_kg, 1)} kg` : ''}${b.mode === 'air' && b.chargeable_kg ? ` · ${num(b.chargeable_kg, 1)} chargeable kg` : ''}</p>
    <h2>CARGO ITEMS</h2>${shipmentItemTable(items)}
    <h2>FREIGHT &amp; CHARGES</h2>
    <p class="doc-note">Freight is billed by CBM or kg. Cargo items are listed separately.</p>
    <table><thead><tr><th style="width:52%">${L('Description')}</th><th class="num" style="width:10%">${L('Qty')}</th><th class="num" style="width:18%">Billed Rate (${esc(cur)})</th><th class="num" style="width:20%">AMOUNT (${esc(cur)})</th></tr></thead>
    <tbody>${lines.map((l) => `<tr><td>${esc(l.description)}${l.kind === 'duty' && !/at cost/i.test(l.description) ? ' <i>(at cost)</i>' : ''}
        ${cur !== 'USD' ? `<div style="color:#777;font-size:11px">USD ${num(l.amount, 2)}</div>` : ''}</td>
      <td class="num">${num(l.qty, 3)}</td><td class="num">${num(Number(l.qty) ? Number(l.amount_txn ?? l.amount * fx) / Number(l.qty) : 0, 2)}</td><td class="num">${money(l.amount_txn ?? l.amount * fx, cur, { bare: true })}</td></tr>`).join('')}
      <tr class="tot"><td colspan="3">${L('TOTAL')}</td><td class="num">${money(inv.total_txn, cur)}</td></tr>
      <tr><td colspan="3">${L('Paid')}</td><td class="num">${money(b.paid_txn, cur)}</td></tr>
      <tr class="tot"><td colspan="3">${L('BALANCE DUE')}</td><td class="num">${money(bal, cur)}</td></tr></tbody></table>
    ${cur !== 'USD' ? `<p style="font-size:12px;color:#555">Freight rates are quoted in USD. Exchange rate applied to this invoice: <b>1 USD = ${num(fx, 2)} ${esc(cur)}</b> (${fdate(inv.fx_date || inv.issued_at)}). Total in USD: ${usd(inv.total)}.</p>` : ''}
    ${bal <= 0.009 ? `<div class="stamp" style="color:#1d8a55">PAID</div>` : ''}
    ${paymentInformation()}
    <div class="foot">${esc(state.settings.invoice_terms || '')}<br>Track: ${esc(publicTrackUrl(b.ref))}</div>
  </div>`;
}

async function receipt(el, id, setTitle) {
  const r = await run(from('v_receipts').select('*').eq('id', id).single());
  const b = await loadBooking(r.shipment_id);
  setTitle(r.ref);
  const cur = b.invoice_currency || r.currency;
  const stamp = await docStamp('receipt', r.id);
  const METHOD = { cash: 'Cash', bank: 'Bank transfer', mobile_money: 'Mobile money', card: 'Card' };
  el.innerHTML = toolbar(`#/shipment/${b.id}`, `<a class="btn" target="_blank" rel="noopener" href="${whatsappLink(b.customer_phone, `Horse Cargo — Receipt ${r.ref}\nShipment: ${b.ref}\nAmount: ${money(r.amount, r.currency)}\nBalance: ${money(b.balance_txn, cur)}`)}">${icon('whatsapp')}${esc(t('share_whatsapp'))}</a>`) + `
  <div class="doc" style="max-width:640px">
    ${header(L('PAYMENT RECEIPT'), r.ref, `<div>${fdatetime(r.received_at)}</div>`)}
    ${r.void ? `<div class="stamp" style="color:#c8352e;margin-bottom:10px">VOID</div>` : ''}
    <div class="doc-top"><div style="flex:1">
    <table><tbody>
      <tr><td>${L('Received from')}</td><td><b>${esc(b.customer_name)}</b> <span class="mono">(${esc(b.customer_code)})</span></td></tr>
      <tr><td>${L('Shipment')}</td><td class="mono">${esc(b.ref)} · ${esc(b.origin_branch)} → ${esc(b.destination_branch)}</td></tr>
      <tr><td>${L('For')}</td><td>Freight and charges</td></tr>
      <tr><td>${L('Method')}</td><td>${esc(METHOD[r.method] || r.method)}${r.reference ? ` · ${esc(r.reference)}` : ''}</td></tr>
      <tr class="tot"><td>${L('AMOUNT')}</td><td style="font-size:18px">${money(r.amount, r.currency)}</td></tr>
      ${r.currency !== 'USD' ? `<tr><td>${L('Exchange rate')}</td><td>1 USD = ${num(r.fx_rate, 2)} ${esc(r.currency)} · USD ${num(r.amount_usd, 2)}</td></tr>` : ''}
      <tr><td>${L('Balance after payment')}</td><td><b>${money(b.balance_txn, cur)}</b></td></tr>
    </tbody></table></div>${stamp}</div>
    <div class="sig"><div>${L('Received by')}: ${esc(r.received_by_name || '')}</div><div>${L('Customer signature')}</div></div>
    <div class="foot">Track: ${esc(publicTrackUrl(b.ref))}</div>
  </div>`;
}

async function grn(el, id, setTitle) {
  const b = await loadBooking(id);
  const g = await run(from('grns').select('*').eq('shipment_id', id).single());
  const items = await run(from('v_shipment_items').select('*').eq('shipment_id', id).order('id'));
  const lines = await run(from('grn_lines').select('*').eq('grn_id', g.id).order('id'));
  const who = await run(from('profiles').select('full_name').eq('id', g.received_by).maybeSingle());
  setTitle(g.ref);
  const stamp = await docStamp('grn', g.id);
  const dims = (l) => (l.length_cm || l.width_cm || l.height_cm)
    ? `${dim(l.length_cm && num(l.length_cm, 1))} × ${dim(l.width_cm && num(l.width_cm, 1))} × ${dim(l.height_cm && num(l.height_cm, 1))}` : DASH;
  el.innerHTML = toolbar(`#/shipment/${id}`) + `
  <div class="doc">
    ${header(L('GOODS RECEIVED NOTE (GRN)'), g.ref, `<div>${fdatetime(g.received_at)}</div><div>${esc(branchName(g.branch_code))}</div>`)}
    <div class="doc-top"><div style="flex:1">${parties(b)}</div>${stamp}</div>
    <p><b>${L('Cargo')}:</b> ${esc(b.description)} · ${esc(catName(b) || '')}</p>
    <p><b>Shipment Date:</b> ${fdate(b.created_at)}</p>
    ${shipmentItemTable(items)}
    <h2>RECEIVED PACKAGES &amp; MEASUREMENTS</h2>
    <table><thead><tr><th class="num">#</th><th class="num">${L('Pcs')}</th><th class="num">L × W × H (cm)</th><th>${L('Packing')}</th><th class="num">kg</th><th class="num">CBM</th></tr></thead>
    <tbody>${lines.map((l, i) => `<tr><td class="num">${i + 1}</td><td class="num">${l.pieces}</td><td class="num">${dims(l)}</td><td>${esc(l.packaging || DASH)}</td>
      <td class="num">${l.weight_kg ? num(l.weight_kg, 1) : DASH}</td><td class="num">${l.cbm ? num(l.cbm, 4) : DASH}</td></tr>`).join('')}
    <tr class="tot"><td></td><td class="num">${g.pieces}</td><td></td><td></td><td class="num">${g.total_kg ? num(g.total_kg, 1) : DASH}</td><td class="num">${g.total_cbm ? num(g.total_cbm, 3) : DASH}</td></tr></tbody></table>
    <p>${L('Volumetric kg')}: ${g.volumetric_kg ? num(g.volumetric_kg, 1) : DASH} · ${L('Chargeable kg')}: ${g.chargeable_kg ? num(g.chargeable_kg, 1) : DASH} · ${L('Condition')}: <b>${esc(g.condition.toUpperCase())}</b>${g.condition_notes ? ` — ${esc(g.condition_notes)}` : ''}</p>
    <p style="font-size:12px;color:#555">This note acknowledges receipt of the goods described above. Measurements, where recorded, are the basis of the invoice.</p>
    <div class="sig"><div>${L('Measured by')}: ${esc(who?.full_name || '')}</div><div>${L('Delivered by (customer)')}</div></div>
  </div>`;
}

async function labels(el, id, setTitle) {
  const b = await loadBooking(id);
  setTitle(`${t('print_labels')} · ${b.ref}`);
  const n = b.pieces || b.est_pieces || 1;
  const qr = qrSVG(b.ref, 3);
  const cap = Math.min(n, 400);
  el.innerHTML = toolbar(`#/shipment/${id}`) + `
  <p class="no-print muted small" style="text-align:center">${n} pieces${n > cap ? ` (first ${cap})` : ''}</p>
  <div class="labels">${Array.from({ length: cap }, (_, i) => `
    <div class="label"><div>
      <div class="l1">HORSE CARGO</div>
      <div class="l2">${esc(b.ref)}</div>
      <div class="l3">${esc(branchName(b.destination_branch).toUpperCase())} · ${esc(b.mode.toUpperCase())}</div>
      <div class="l4">PIECE ${i + 1} OF ${n}</div>
      <div style="font-size:11px;margin-top:2px">${esc(b.receiver_name)} · ${esc(b.receiver_phone)}</div>
    </div><div class="qr">${qr}</div></div>`).join('')}</div>`;
}

async function release(el, id, setTitle) {
  const b = await loadBooking(id);
  const r = await run(from('v_releases').select('*').eq('shipment_id', id).single());
  setTitle(r.ref);
  const stamp = await docStamp('release', r.id);
  const cur = b.invoice_currency || 'USD';
  el.innerHTML = toolbar(`#/shipment/${id}`) + `
  <div class="doc">
    ${header(L('DELIVERY NOTE'), r.ref, `<div>${fdatetime(r.released_at)}</div><div>${esc(branchName(b.destination_branch))}</div>`)}
    <div class="doc-top"><div style="flex:1">${parties(b)}</div>${stamp}</div>
    <table><tbody>
      <tr><td>${L('Cargo')}</td><td>${esc(b.description)} · <b>${num(b.pieces, 0)} pcs</b>${b.cbm ? ` · ${num(b.cbm, 3)} CBM` : ''}${b.actual_kg ? ` · ${num(b.actual_kg, 1)} kg` : ''}</td></tr>
      <tr><td>${L('Collected by')}</td><td><b>${esc(r.released_to_name)}</b> · ${esc(r.released_to_phone)}${r.id_number ? ` · ${esc(r.id_type || 'ID')} ${esc(r.id_number)}` : ''}</td></tr>
      <tr><td>${L('Balance at handover')}</td><td><b>${money(Number(r.balance_at_release) * Number(b.invoice_fx || 1), cur)}</b></td></tr>
      <tr><td>${L('Released by')}</td><td>${esc(r.released_by_name || '')}</td></tr>
      ${r.notes ? `<tr><td>${L('Notes')}</td><td>${esc(r.notes)}</td></tr>` : ''}
    </tbody></table>
    <p style="font-size:12px">I confirm I have received the cargo above in good order and condition, pieces counted.</p>
    <div class="sig"><div>${L('Collector signature')}</div><div>${L('Horse Cargo officer')}</div></div>
  </div>`;
}

async function packingList(el, id, setTitle) {
  const [list, boxes, items] = await Promise.all([
    run(from('v_packing_lists').select('*').eq('id',id).single()),
    run(from('packing_list_boxes').select('*').eq('packing_list_id',id).order('box_no')),
    run(from('v_packing_box_items').select('*').eq('packing_list_id',id).order('id')),
  ]);
  setTitle(list.ref);
  el.innerHTML = toolbar(`#/packing-list/${id}`) + `<div class="doc">
    ${header('PACKING LIST',list.ref,`<div>${fdate(list.packing_date)}</div>`)}
    <p><b>Prepared By:</b> ${esc(list.prepared_by || DASH)} · <b>Status:</b> ${esc(list.status.toUpperCase())}</p>
    ${list.status === 'draft' ? '<p class="doc-note">DRAFT — items reserve storage stock until finalized or removed.</p>' : ''}
    ${boxes.map(box => {
      const rows = items.filter(i=>i.box_id===box.id);
      return `<section class="packing-box-report"><h2>BOX ${box.box_no}</h2>
        <table><thead><tr><th style="width:31%">ITEM NO. (SHIPMENT NO.)</th><th>ITEM DESCRIPTION</th><th class="num" style="width:18%">QTY</th></tr></thead>
        <tbody>${rows.map(i=>`<tr><td class="mono">${esc(i.shipment_ref)}</td><td>${esc(i.description)}</td><td class="num">${num(i.qty,2)} ${esc(i.unit)}</td></tr>`).join('')}</tbody></table>
        <p><b>Total Qty in Box: ${num(rows.reduce((n,i)=>n+Number(i.qty),0),2)}</b></p></section>`;
    }).join('')}
    <div class="packing-summary"><b>Total Boxes: ${boxes.length}</b><br><b>Total Packed Quantity: ${num(items.reduce((n,i)=>n+Number(i.qty),0),2)}</b></div>
  </div>`;
}
