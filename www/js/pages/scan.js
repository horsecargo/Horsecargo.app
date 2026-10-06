// Scan: camera (or typed code) → server-side resolver → what this Horse Cargo record is.
// The browser never trusts the QR content: it only forwards it to scan_document(),
// which looks the opaque token up in the document registry.
import { t } from '../i18n.js';
import { rpc, can, errText } from '../api.js';
import { icon, esc, num, money, fdate, fdatetime, toast, busy, confirmDialog, $ } from '../ui.js';
import { startCamera } from '../scanner.js';

const TYPE = { grn: 'doct_grn', invoice: 'doct_invoice', packing_list: 'doct_packing_list', label: 'doct_label',
  receipt: 'doct_receipt', release: 'doct_release', waybill: 'doct_waybill', shipment: 'doct_shipment' };
const OK = ['issued', 'approved', 'draft'];

function rows(d) {
  const r = (k, v) => (v === null || v === undefined || v === '' ? '' : `<div class="vrow"><span>${esc(k)}</span><b>${v}</b></div>`);
  const out = [
    r(t('document_type'), esc(t(TYPE[d.document_type] || d.document_type)).toUpperCase()),
    r(t('document_number'), `<span class="mono">${esc(d.document_number)}</span>`),
    r(t('date'), d.issued_at ? esc(fdate(d.issued_at)) : ''),
    r(t('prepared_by'), esc(d.prepared_by || '')),
    r(t('status'), `<span class="vtag ${d.valid ? 'ok' : 'no'}">${esc(t('dst_' + d.status))}</span>`),
  ];
  if (d.shipment_ref) out.push(r(t('shipment'), `<span class="mono">${esc(d.shipment_ref)}</span>`));
  if (d.customer) out.push(r(t('customer'), esc(d.customer)));
  if (d.document_type === 'grn') {
    out.push(r(t('pieces'), num(d.pieces, 0)), r('CBM', d.cbm ? num(d.cbm, 3) : ''), r('kg', d.kg ? num(d.kg, 1) : ''));
  }
  if (d.document_type === 'invoice') {
    out.push(r(t('grn_number'), d.grn_number ? `<span class="mono">${esc(d.grn_number)}</span>` : ''));
    if (d.invoice_total !== undefined) out.push(r(t('invoice_total_lbl'), esc(money(d.invoice_total, d.currency))), r(t('balance'), esc(money(d.balance, d.currency))));
  }
  if (d.document_type === 'packing_list') {
    out.push(r(t('number_of_boxes'), num(d.boxes, 0)), r(t('total_quantity'), num(d.total_qty, 2)));
    if (d.shipments?.length) out.push(r(t('shipments'), d.shipments.map((s) => `<span class="mono">${esc(s)}</span>`).join(', ')));
  }
  if (d.document_type === 'label') {
    out.push(r(t('pieces'), num(d.pieces, 0)), r(t('destination'), esc(d.destination || '')), r(t('grn_number'), d.grn_number ? `<span class="mono">${esc(d.grn_number)}</span>` : ''),
      r(t('receiver'), esc(d.receiver || '')));
  }
  if (d.document_type === 'receipt' && d.amount !== undefined) out.push(r(t('amount'), esc(money(d.amount, d.currency))));
  if (d.status === 'revoked') out.push(r(t('revoked'), esc(fdatetime(d.revoked_at))), r(t('reason'), esc(d.revoke_reason || '')));
  return out.join('');
}

function resultCard(d) {
  if (!d || !d.recognized) {
    return `<div class="scan-result no" role="status" aria-live="polite">
      <div class="sr-brand">HORSE CARGO</div>
      <div class="sr-head">${icon('alert')}<div><b>${esc(t('qr_not_recognized'))}</b><div class="small">${esc(t('qr_not_recognized_body'))}</div></div></div>
      <div class="row sr-acts"><button class="btn" data-again>${icon('scan')}${esc(t('scan_again'))}</button></div></div>`;
  }
  const good = d.valid && OK.includes(d.status);
  const head = d.status === 'revoked' ? t('revoked_document') : d.retired ? t('dst_retired') : good ? t('verified_document') : t('invalid_document');
  return `<div class="scan-result ${good ? 'ok' : d.retired ? 'warn' : 'no'}" role="status" aria-live="polite">
    <div class="sr-brand">HORSE CARGO</div>
    <div class="sr-head">${icon(good ? 'shield' : 'alert')}<div><b>${esc(head)}</b>${d.legacy ? `<div class="small">${esc(t('legacy_label'))}</div>` : ''}</div></div>
    <div class="sr-rows">${rows(d)}</div>
    <div class="row sr-acts">
      ${d.route && d.status !== 'revoked' ? `<a class="btn primary" href="${esc(d.route)}">${icon('file')}${esc(t('view_document'))}</a>` : ''}
      <button class="btn" data-again>${icon('scan')}${esc(t('scan_again'))}</button>
      ${can('doc.revoke') && d.document_id && d.status !== 'revoked' ? `<button class="btn ghost danger-text" data-revoke="${esc(d.document_id)}">${icon('refresh')}${esc(t('replace_qr'))}</button>` : ''}
    </div></div>`;
}

export async function render({ el, setTitle, query }) {
  setTitle(t('scan'));
  let stop = null; let busyScan = false;
  el.innerHTML = `
  <div class="page-head"><div class="grow"><h1>${esc(t('scan_doc_title'))}</h1><p>${esc(t('scan_doc_sub'))}</p></div></div>
  <div class="scan-wrap">
    <div class="card"><div class="card-b stack">
      <div id="cam-wrap" class="hidden"><div id="scanner"></div></div>
      <button class="btn accent" id="cam" style="min-height:52px">${icon('camera')}${esc(t('start_camera'))}</button>
      <div class="muted small" style="text-align:center">${esc(t('or_type_code'))}</div>
      <form class="row" id="manual" style="flex-wrap:nowrap">
        <input class="input mono" name="code" placeholder="${esc(t('scan_code_ph'))}" aria-label="${esc(t('scan_code_ph'))}" autocapitalize="characters" autocomplete="off" style="flex:1;min-width:0">
        <button class="btn primary" type="submit">${esc(t('open'))}</button>
      </form>
    </div></div>
    <div id="result"></div>
  </div>`;
  const camBtn = $('#cam', el); const out = $('#result', el);

  const stopCam = async () => {
    if (stop) { const s = stop; stop = null; await s(); }
    $('#cam-wrap', el).classList.add('hidden');
    camBtn.innerHTML = `${icon('camera')}${esc(t('start_camera'))}`;
  };
  const resolve = async (code) => {
    if (busyScan || !String(code || '').trim()) return;
    busyScan = true;
    out.innerHTML = `<div class="card card-b"><div class="spinner"></div></div>`;
    try {
      const d = await rpc('scan_document', { p_code: String(code) });
      await stopCam();
      out.innerHTML = resultCard(d);
      out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (err) {
      out.innerHTML = `<div class="callout danger">${icon('alert')}<div>${esc(errText(err))}</div></div>`;
    } finally { busyScan = false; }
  };
  const startCam = async () => {
    $('#cam-wrap', el).classList.remove('hidden');
    try {
      stop = await startCamera($('#scanner', el), (text) => resolve(text));
      camBtn.innerHTML = `${icon('x')}${esc(t('stop_camera'))}`;
    } catch {
      $('#cam-wrap', el).classList.add('hidden');
      toast(t('camera_error'), 'err');
    }
  };
  camBtn.onclick = () => (stop ? stopCam() : startCam());
  $('#manual', el).onsubmit = (e) => { e.preventDefault(); resolve(e.target.code.value); };
  out.addEventListener('click', async (e) => {
    if (e.target.closest('[data-again]')) { out.innerHTML = ''; $('#manual', el).code.value = ''; startCam(); return; }
    const rv = e.target.closest('[data-revoke]');
    if (rv) {
      const reason = await confirmDialog(t('replace_qr_confirm'), { okText: t('replace_qr'), danger: true, withReason: true, reasonLabel: t('reason') });
      if (!reason) return;
      busy(rv, async () => {
        try { await rpc('rotate_document_token', { p_document: rv.dataset.revoke, p_reason: reason }); toast(t('qr_replaced')); rv.remove(); }
        catch (err) { toast(errText(err), 'err'); }
      });
    }
  });
  const pre = query.get('code') || query.get('ref') || query.get('d');
  if (pre) await resolve(query.get('d') ? `verify.html?d=${query.get('d')}` : pre);
  else if (query.get('auto') === '1') camBtn.click();
  return () => { if (stop) stop(); };
}
