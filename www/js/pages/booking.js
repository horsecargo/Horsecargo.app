import { t, tr } from '../i18n.js';
import { from, run, rpc, can, isAdmin, state, errText, errCode, catName, publicTrackUrl } from '../api.js';
import {
  icon, esc, usd, money, num, fdate, fdatetime, statusBadge, modeTag, route, modal, toast, confirmDialog,
  formData, checkRequired, busy, empty, qrSVG, whatsappLink, $, $$,
} from '../ui.js';

const FLOW = ['pending_deposit', 'booked', 'received', 'loaded', 'in_transit', 'arrived', 'clearing', 'ready', 'released'];

export async function render({ el, params, setTitle, rerender }) {
  const id = params[0];
  const [b, grn, inv, receipts, events, rel] = await Promise.all([
    run(from('v_bookings').select('*').eq('id', id).single()),
    run(from('grns').select('*').eq('booking_id', id).maybeSingle()),
    run(from('invoices').select('*').eq('booking_id', id).eq('status', 'issued').maybeSingle()),
    run(from('v_receipts').select('*').eq('booking_id', id).order('received_at', { ascending: false })),
    run(from('v_events').select('*').eq('booking_id', id).order('created_at', { ascending: false })),
    run(from('v_releases').select('*').eq('booking_id', id).maybeSingle()),
  ]);
  const [lines, grnLines] = await Promise.all([
    inv ? run(from('invoice_lines').select('*').eq('invoice_id', inv.id).order('id')) : [],
    grn ? run(from('grn_lines').select('*').eq('grn_id', grn.id).order('id')) : [],
  ]);
  setTitle(b.ref);

  const bal = Number(b.balance_usd);
  const st = b.status;
  const closed = ['released', 'cancelled'].includes(st);
  const idx = FLOW.indexOf(st);
  const depositDue = Math.max(Number(b.deposit_required) - Number(b.deposit_paid), 0);

  // ── action buttons, each shown only when the status + role allow it ──
  const A = [];
  if (st === 'pending_deposit' && can('payment.record')) A.push(`<button class="btn accent" data-act="pay">${icon('money')}${esc(t('record_deposit'))}</button>`);
  if (st === 'booked' && can('grn.record')) A.push(`<a class="btn primary" href="#/booking/${b.id}/grn">${icon('scale')}${esc(t('record_grn'))}</a>`);
  if (!closed && st !== 'pending_deposit' && can('payment.record')) A.push(`<button class="btn ${bal > 0 ? 'accent' : ''}" data-act="pay">${icon('money')}${esc(t('record_payment'))}</button>`);
  if (st === 'arrived' && can('booking.status')) A.push(`<button class="btn" data-act="status" data-to="clearing">${icon('shield')}${esc(t('mark_clearing'))}</button>`);
  if (['arrived', 'clearing'].includes(st) && can('booking.status')) A.push(`<button class="btn primary" data-act="status" data-to="ready">${icon('check')}${esc(t('mark_ready'))}</button>`);
  if (st === 'ready' && can('release')) A.push(`<button class="btn ${bal > 0.009 ? '' : 'success'}" data-act="release">${icon(bal > 0.009 ? 'lock' : 'release')}${esc(t('release_cargo'))}</button>`);
  if (inv && !closed && can('invoice.line')) A.push(`<button class="btn" data-act="charge">${icon('plus')}${esc(t('add_charge'))}</button>`);
  const more = [];
  if (st === 'pending_deposit' && can('booking.edit')) more.push(`<a class="btn sm" href="#/bookings/new?edit=${b.id}">${icon('gear')}${esc(t('edit'))}</a>`);
  if (!closed && can('tracking.note')) more.push(`<button class="btn sm" data-act="note">${icon('clock')}${esc(t('add_note'))}</button>`);
  if (grn) more.push(`<a class="btn sm" href="#/doc/labels/${b.id}">${icon('tag')}${esc(t('print_labels'))}</a>`);
  more.push(`<a class="btn sm" target="_blank" rel="noopener" href="${whatsappLink(b.consignee_phone, trackMsg(b))}">${icon('whatsapp')}${esc(t('share_whatsapp'))}</a>`);
  if (['pending_deposit', 'booked', 'received'].includes(st) && can('booking.cancel')) more.push(`<button class="btn sm danger" data-act="cancel">${icon('x')}${esc(t('cancel_booking'))}</button>`);

  el.innerHTML = `
  <div class="page-head">
    <div class="grow">
      <div class="row" style="gap:8px">${modeTag(b.mode)} ${route(b.origin_branch, b.destination_branch)} ${statusBadge(st)}</div>
      <h1 class="mono" style="margin-top:4px">${esc(b.ref)}</h1>
      <p>${esc(b.customer_name)} → ${esc(b.consignee_name)} · ${esc(catName(b) || '')}</p>
    </div>
    <div class="row">${A.join('')}</div>
  </div>

  <div class="stack">
    ${st === 'pending_deposit' ? `<div class="callout warn">${icon('lock')}<div><b>${esc(t('gate_deposit'))}</b><br>${esc(t('amount_due'))}: <b>${usd(depositDue)}</b></div></div>` : ''}
    ${st === 'ready' && bal > 0.009 ? `<div class="callout danger">${icon('lock')}<div><b>${esc(t('gate_settlement'))}</b><br>${esc(t('amount_due'))}: <b>${usd(bal)}</b></div></div>` : ''}
    ${st === 'cancelled' ? `<div class="callout danger">${icon('x')}<div><b>${esc(t('st_cancelled'))}</b> — ${esc(b.cancelled_reason || '')}</div></div>` : ''}

    <div class="card">
      ${st !== 'cancelled' ? `<div class="stepper">${FLOW.map((s, i) => `<div class="step ${i < idx ? 'done' : i === idx ? 'cur' : ''}"><div class="dot">${i < idx ? icon('check') : ''}</div>${esc(t('st_' + s))}</div>`).join('')}</div>` : ''}
      <div class="money" style="border-top:1px solid var(--line-2)">
        <div><div class="k">${esc(inv ? t('invoice_total') : t('quote'))}</div><div class="v">${usd(inv ? b.invoice_total : b.quoted_amount)}</div></div>
        <div><div class="k">${esc(t('deposit_required'))}</div><div class="v">${usd(b.deposit_required)}</div></div>
        <div><div class="k">${esc(t('paid'))}</div><div class="v ok">${usd(b.paid_usd)}</div></div>
        <div><div class="k">${esc(t('balance'))}</div><div class="v ${bal > 0.009 ? 'due' : 'ok'}">${usd(bal)}</div></div>
      </div>
    </div>

    <div class="split">
      <div class="card">
        <div class="tabs" id="tabs">
          <button data-tab="details" class="on">${esc(t('details'))}</button>
          <button data-tab="grn">GRN</button>
          <button data-tab="invoice">${esc(t('invoice'))}</button>
          <button data-tab="payments">${esc(t('receipts'))} (${receipts.length})</button>
        </div>
        <div class="card-b" data-pane="details">
          <div class="grid c2">
            <dl class="kv">
              <dt>${esc(t('customer'))}</dt><dd><a href="#/customer/${b.customer_id}">${esc(b.customer_name)}</a><div class="muted small mono">${esc(b.customer_code)} · ${esc(b.customer_phone)}</div></dd>
              <dt>${esc(t('consignee'))}</dt><dd>${esc(b.consignee_name)}<div class="muted small">${esc(b.consignee_phone)}${b.consignee_tin ? ' · TIN ' + esc(b.consignee_tin) : ''}</div>${b.consignee_address ? `<div class="muted small">${esc(b.consignee_address)}</div>` : ''}</dd>
              <dt>${esc(t('cargo_category'))}</dt><dd>${esc(catName(b) || '—')}</dd>
              <dt>${esc(t('cargo_description'))}</dt><dd>${esc(b.description)}</dd>
            </dl>
            <dl class="kv">
              <dt>${esc(t('pieces'))}</dt><dd>${b.pieces !== null ? `<b>${num(b.pieces, 0)}</b>` : `≈ ${num(b.est_pieces, 0)}`}</dd>
              <dt>${esc(t('cbm'))}</dt><dd>${b.cbm !== null ? `<b>${num(b.cbm, 3)}</b>` : `≈ ${num(b.est_cbm, 3)}`}</dd>
              <dt>${esc(t('weight_kg'))}</dt><dd>${b.actual_kg !== null ? `<b>${num(b.actual_kg, 1)}</b>${b.mode === 'air' ? ` <span class="muted small">(${esc(t('chargeable_kg'))}: ${num(b.chargeable_kg, 1)})</span>` : ''}` : `≈ ${num(b.est_kg, 1)}`}</dd>
              <dt>${esc(t('in_container'))}</dt><dd>${b.shipment_id ? `<a href="#/shipment/${b.shipment_id}" class="mono">${esc(b.container_no || b.shipment_ref)}</a>${b.shipment_eta ? `<div class="muted small">${esc(t('eta'))} ${fdate(b.shipment_eta)}</div>` : ''}` : '—'}</dd>
              <dt>${esc(t('created'))}</dt><dd>${fdatetime(b.created_at)}</dd>
              ${b.notes ? `<dt>${esc(t('notes'))}</dt><dd>${esc(b.notes)}</dd>` : ''}
            </dl>
          </div>
          ${rel ? `<div class="callout ok" style="margin-top:14px">${icon('release')}<div><b>${esc(t('st_released'))}</b> · ${fdatetime(rel.released_at)}<br>
            ${esc(rel.released_to_name)} · ${esc(rel.released_to_phone)}${rel.id_number ? ` · ${esc(rel.id_type || '')} ${esc(rel.id_number)}` : ''} · ${esc(t('by'))} ${esc(rel.released_by_name || '')}
            ${rel.override_reason ? `<br><b>${esc(t('override_reason'))}:</b> ${esc(rel.override_reason)}` : ''}
            <div style="margin-top:6px"><a class="btn sm" href="#/doc/release/${b.id}">${icon('print')}${esc(t('release_note'))}</a></div></div></div>` : ''}
          ${more.length ? `<div class="row" style="margin-top:16px;gap:6px">${more.join('')}</div>` : ''}
        </div>

        <div class="card-b hidden" data-pane="grn">
          ${grn ? `
            <div class="row" style="justify-content:space-between;margin-bottom:10px"><div><b class="mono">${esc(grn.ref)}</b><div class="muted small">${fdatetime(grn.received_at)} · ${esc(grn.branch_code)} · ${esc(t('c_' + grn.condition))}</div></div>
              <div class="row"><a class="btn sm" href="#/doc/grn/${b.id}">${icon('print')}GRN</a><a class="btn sm" href="#/doc/labels/${b.id}">${icon('tag')}${esc(t('print_labels'))}</a></div></div>
            ${grn.condition !== 'good' ? `<div class="callout warn" style="margin-bottom:10px">${icon('alert')}<div>${esc(t('c_' + grn.condition))}${grn.condition_notes ? ': ' + esc(grn.condition_notes) : ''}</div></div>` : ''}
            <div class="table-wrap"><table class="t"><thead><tr><th class="num">${esc(t('pieces'))}</th><th class="num">L×W×H cm</th><th class="num">kg</th><th class="num">CBM</th><th class="hide-m">${esc(t('packaging'))}</th></tr></thead>
            <tbody>${grnLines.map((l) => `<tr><td class="num">${l.pieces}</td><td class="num nowrap">${num(l.length_cm, 1)}×${num(l.width_cm, 1)}×${num(l.height_cm, 1)}</td><td class="num">${num(l.weight_kg, 1)}</td><td class="num">${num(l.cbm, 4)}</td><td class="hide-m">${esc(l.packaging || '')}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td class="num">${grn.pieces}</td><td></td><td class="num">${num(grn.total_kg, 1)}</td><td class="num">${num(grn.total_cbm, 3)}</td><td class="hide-m"></td></tr></tfoot></table></div>
            <p class="muted small">${esc(t('volumetric_kg'))}: ${num(grn.volumetric_kg, 1)} · ${esc(t('chargeable_kg'))}: ${num(grn.chargeable_kg, 1)}</p>`
          : `<div class="empty">${icon('scale')}<div>${esc(t('no_grn_yet'))}</div>${st === 'booked' && can('grn.record') ? `<a class="btn primary" style="margin-top:10px" href="#/booking/${b.id}/grn">${esc(t('record_grn'))}</a>` : ''}</div>`}
        </div>

        <div class="card-b hidden" data-pane="invoice">
          ${inv ? `
            <div class="row" style="justify-content:space-between;margin-bottom:10px"><div><b class="mono">${esc(inv.ref)}</b><div class="muted small">${fdatetime(inv.issued_at)}</div></div>
              <a class="btn sm" href="#/doc/invoice/${b.id}">${icon('print')}${esc(t('invoice'))}</a></div>
            <div class="table-wrap"><table class="t"><thead><tr><th>${esc(t('description'))}</th><th class="num">${esc(t('qty'))}</th><th class="num">${esc(t('unit_price'))}</th><th class="num">USD</th><th></th></tr></thead>
            <tbody>${lines.map((l) => `<tr><td><span class="badge plain" style="margin-right:6px">${esc(t('l_' + l.kind))}</span>${esc(l.description)}</td><td class="num">${num(l.qty, 3)}</td><td class="num">${usd(l.unit_price, { bare: true })}</td>
              <td class="num" style="${l.amount < 0 ? 'color:var(--green)' : ''}">${usd(l.amount, { bare: true })}</td>
              <td class="right">${l.kind !== 'freight' && !closed && can('invoice.remove') ? `<button class="icon-btn" data-act="rmline" data-id="${l.id}" title="${esc(t('void'))}">${icon('trash')}</button>` : ''}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td colspan="3">${esc(t('total'))}</td><td class="num">${usd(inv.total)}</td><td></td></tr></tfoot></table></div>
            ${lines.some((l) => l.kind === 'duty') ? `<p class="muted small">${esc(t('duty_note'))}</p>` : ''}`
          : `<div class="empty">${icon('list')}<div>${esc(t('no_invoice_yet'))}</div></div>`}
        </div>

        <div class="card-b tight hidden" data-pane="payments">
          ${receipts.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>${esc(t('receipt'))}</th><th class="hide-m">${esc(t('method'))}</th><th class="num">${esc(t('amount'))}</th><th class="num">USD</th><th></th></tr></thead>
          <tbody>${receipts.map((r) => `<tr style="${r.void ? 'opacity:.5;text-decoration:line-through' : ''}">
            <td><b class="mono">${esc(r.ref)}</b><div class="muted small">${esc(t('k_' + r.kind))} · ${fdatetime(r.received_at)} · ${esc(r.received_by_name || '')}</div>${r.void ? `<div class="small" style="color:var(--red)">${esc(t('voided'))}: ${esc(r.void_reason)}</div>` : ''}</td>
            <td class="hide-m">${esc(t('m_' + r.method))}${r.reference ? `<div class="muted small">${esc(r.reference)}</div>` : ''}</td>
            <td class="num nowrap">${money(r.amount, r.currency)}</td><td class="num">${usd(r.amount_usd, { bare: true })}</td>
            <td class="right nowrap"><a class="icon-btn" href="#/doc/receipt/${r.id}" title="${esc(t('print'))}">${icon('print')}</a>
              ${!r.void && !closed && can('payment.void') ? `<button class="icon-btn" data-act="void" data-id="${r.id}" title="${esc(t('void'))}">${icon('trash')}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
          : empty(t('no_payments'), 'money')}
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-h"><h2>${esc(t('timeline'))}</h2></div>
          <div class="card-b"><ul class="timeline">${events.map((e) => `<li>
            <div class="tt">${esc(tr(e.title))} ${e.is_public ? '' : `<span class="badge plain small">${esc(t('internal'))}</span>`}</div>
            ${e.note ? `<div class="tn">${esc(tr(e.note))}</div>` : ''}
            <div class="tm">${esc([e.location, e.created_by_name].filter(Boolean).join(' · '))} · ${fdatetime(e.created_at)}</div></li>`).join('')}</ul></div>
        </div>
        <div class="card"><div class="card-b row" style="flex-wrap:nowrap;align-items:center">
          <div class="qr-box" style="width:112px;flex:none">${qrSVG(b.ref)}</div>
          <div class="small"><b>${esc(t('qr_code'))}</b><div class="muted">${esc(t('scan_sub'))}</div>
            <a class="small" href="${publicTrackUrl(b.ref)}" target="_blank" rel="noopener">${esc(t('track_cargo'))} →</a></div>
        </div></div>
      </div>
    </div>
  </div>`;

  // tabs
  $('#tabs', el).onclick = (e) => {
    const x = e.target.closest('button'); if (!x) return;
    $$('#tabs button', el).forEach((y) => y.classList.toggle('on', y === x));
    $$('[data-pane]', el).forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== x.dataset.tab));
  };

  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (act === 'pay') return paymentModal(b, depositDue, bal, rerender);
    if (act === 'charge') return chargeModal(b, rerender);
    if (act === 'release') return releaseModal(b, bal, rerender);
    if (act === 'note') return noteModal(b, rerender);
    if (act === 'status') {
      const to = a.dataset.to;
      const note = await confirmDialog(`${b.ref} → ${t('st_' + to)}`, { withReason: false });
      if (!note) return;
      return busy(a, async () => { try { await rpc('set_booking_status', { p_booking: b.id, p_status: to, p_note: null }); toast(t('saved')); rerender(); } catch (err) { toast(errText(err), 'err'); } });
    }
    if (act === 'cancel') {
      const reason = await confirmDialog(`${t('cancel_booking')} ${b.ref}?`, { danger: true, withReason: true, okText: t('cancel_booking') });
      if (!reason) return;
      try { await rpc('cancel_booking', { p_booking: b.id, p_reason: reason }); toast(t('saved')); rerender(); } catch (err) { toast(errText(err), 'err'); }
    }
    if (act === 'void') {
      const reason = await confirmDialog(`${t('void')} ${t('receipt').toLowerCase()}?`, { danger: true, withReason: true, okText: t('void') });
      if (!reason) return;
      try { await rpc('void_receipt', { p_receipt: a.dataset.id, p_reason: reason }); toast(t('saved')); rerender(); } catch (err) { toast(errText(err), 'err'); }
    }
    if (act === 'rmline') {
      if (!(await confirmDialog(t('void') + '?', { danger: true }))) return;
      try { await rpc('remove_invoice_line', { p_line: Number(a.dataset.id) }); toast(t('saved')); rerender(); } catch (err) { toast(errText(err), 'err'); }
    }
  });
}

function trackMsg(b) {
  return `Horse Cargo — ${b.ref}\n${t('status')}: ${t('st_' + b.status)}\n${t('route')}: ${b.origin_branch} → ${b.destination_branch}\n${publicTrackUrl(b.ref)}`;
}

function paymentModal(b, depositDue, bal, done) {
  const s = state.settings;
  const due = b.status === 'pending_deposit' ? depositDue : Math.max(bal, 0);
  modal({
    title: `${b.status === 'pending_deposit' ? t('record_deposit') : t('record_payment')} · ${b.ref}`,
    body: `
      <div class="callout ${due > 0 ? 'warn' : 'ok'}" style="margin-bottom:14px">${icon('money')}<div>${esc(t('amount_due'))}: <b>${usd(due)}</b></div></div>
      <form class="form" id="pay-form" novalidate>
        <div class="field"><label class="req">${esc(t('currency'))}</label><select class="input" name="currency">
          <option>USD</option><option>AED</option><option>TZS</option></select></div>
        <div class="field"><label class="req">${esc(t('amount'))}</label><input class="input" name="amount" type="number" min="0" step="0.01" required inputmode="decimal" value="${due > 0 ? due.toFixed(2) : ''}"></div>
        <div class="field"><label>${esc(t('fx_rate'))}</label><input class="input" name="fx_rate" type="number" step="0.0001" value="1" readonly></div>
        <div class="field"><label>${esc(t('usd_equiv'))}</label><input class="input" id="usd-eq" readonly></div>
        <div class="field"><label class="req">${esc(t('method'))}</label><select class="input" name="method">
          ${['cash', 'bank', 'mobile_money', 'card'].map((m) => `<option value="${m}">${esc(t('m_' + m))}</option>`).join('')}</select></div>
        <div class="field"><label>${esc(t('txn_ref'))}</label><input class="input" name="reference"></div>
        ${state.companies.length ? `<div class="field full"><label>${esc(t('acc_paid_into'))}</label><select class="input" name="account"><option value="">${esc(t('acc_auto_account'))}</option></select></div>` : ''}
      </form>`,
    foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn accent" id="pay-save">${icon('check')}${esc(t('save'))}</button>`,
    onMount: (m) => {
      const f = m.el.querySelector('#pay-form');
      const upd = (curChanged) => {
        const cur = f.currency.value;
        if (curChanged) {
          const rate = cur === 'USD' ? 1 : cur === 'AED' ? s.fx_aed : s.fx_tzs;
          f.fx_rate.value = rate; f.fx_rate.readOnly = cur === 'USD';
          if (due > 0) f.amount.value = cur === 'TZS' ? Math.round(due * rate) : (due * rate).toFixed(2);
        }
        const v = Number(f.amount.value || 0) / Number(f.fx_rate.value || 1);
        m.el.querySelector('#usd-eq').value = usd(v);
      };
      let moneyList = [];
      const fillAcc = () => {
        if (!f.account) return;
        const want = { cash: 'cash', bank: 'bank', mobile_money: 'mobile_money', card: 'bank' }[f.method.value];
        const list = moneyList.filter((x) => x.currency === f.currency.value);
        list.sort((a, b) => (b.kind === want) - (a.kind === want) || (b.branch_code === state.profile?.branch_code) - (a.branch_code === state.profile?.branch_code));
        const keep = f.account.value;
        f.account.innerHTML = `<option value="">${esc(t('acc_auto_account'))}</option>` + list.map((x) => `<option value="${x.id}">${esc(x.company_code)} · ${esc(x.name)}</option>`).join('');
        if ([...f.account.options].some((o) => o.value === keep)) f.account.value = keep;
      };
      if (f.account) from('money_accounts').select('id,name,kind,currency,company_code,branch_code').eq('active', true).order('name').then(({ data }) => { moneyList = data || []; fillAcc(); });
      f.method.addEventListener('change', fillAcc);
      f.currency.onchange = () => { upd(true); fillAcc(); };
      f.amount.oninput = () => upd(false); f.fx_rate.oninput = () => upd(false);
      upd(false);
      m.el.querySelector('#pay-save').onclick = (e) => busy(e.currentTarget, async () => {
        if (!checkRequired(f)) return;
        const d = formData(f);
        try {
          const r = await rpc('record_payment', { p_booking: b.id, p_amount: d.amount, p_currency: d.currency, p_method: d.method, p_reference: d.reference, p_fx_rate: d.fx_rate, ...(d.account ? { p_account: d.account } : {}) });
          m.close();
          toast(`${t('payment_saved')} · ${r.ref}`);
          done();
          setTimeout(() => modal({
            title: r.ref, body: `<div class="callout ok">${icon('check')}<div>${esc(t('payment_saved'))} — ${usd(r.amount_usd)}</div></div>`,
            foot: `<button class="btn" data-close>${esc(t('close'))}</button><a class="btn primary" data-close href="#/doc/receipt/${r.id}">${icon('print')}${esc(t('receipt'))}</a>`,
          }), 250);
        } catch (err) { toast(errText(err), 'err'); }
      });
    },
  });
}

function chargeModal(b, done) {
  const kinds = ['extra', 'duty'].concat(can('invoice.discount') ? ['discount'] : []);
  modal({
    title: `${t('add_charge')} · ${b.ref}`,
    body: `<form class="form" id="ch-form" novalidate>
      <div class="field full"><label class="req">${esc(t('charge_type'))}</label><select class="input" name="kind">${kinds.map((k) => `<option value="${k}">${esc(t('l_' + k))}</option>`).join('')}</select></div>
      <div class="field full"><label class="req">${esc(t('description'))}</label><input class="input" name="description" required list="charge-presets">
        <datalist id="charge-presets"><option>Packing / crating</option><option>Local delivery</option><option>Storage</option><option>Insurance top-up</option><option>Import duty & VAT (at cost)</option><option>Port & wharfage (at cost)</option><option>TBS / TMDA permit</option></datalist></div>
      <div class="field"><label class="req">${esc(t('qty'))}</label><input class="input" type="number" step="0.001" min="0" name="qty" value="1" required></div>
      <div class="field"><label class="req">${esc(t('unit_price'))}</label><input class="input" type="number" step="0.01" min="0" name="unit_price" required></div>
      <div class="field full hidden" id="duty-note"><div class="callout info">${icon('info')}<div class="small">${esc(t('duty_note'))}</div></div></div>
    </form>`,
    foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="ch-save">${icon('check')}${esc(t('save'))}</button>`,
    onMount: (m) => {
      const f = m.el.querySelector('#ch-form');
      f.kind.onchange = () => m.el.querySelector('#duty-note').classList.toggle('hidden', f.kind.value !== 'duty');
      m.el.querySelector('#ch-save').onclick = (e) => busy(e.currentTarget, async () => {
        if (!checkRequired(f)) return;
        const d = formData(f);
        try { await rpc('add_invoice_line', { p_booking: b.id, p_kind: d.kind, p_description: d.description, p_qty: d.qty, p_unit_price: d.unit_price }); m.close(); toast(t('saved')); done(); } catch (err) { toast(errText(err), 'err'); }
      });
    },
  });
}

function releaseModal(b, bal, done) {
  const blocked = bal > 0.009;
  modal({
    title: `${t('release_cargo')} · ${b.ref}`,
    body: `
      ${blocked ? `<div class="callout danger" style="margin-bottom:14px">${icon('lock')}<div><b>${esc(t('release_blocked'))}</b><br>${esc(t('gate_settlement'))}<br>${esc(t('amount_due'))}: <b>${usd(bal)}</b></div></div>`
        : `<div class="callout ok" style="margin-bottom:14px">${icon('check')}<div>${esc(t('balance'))}: ${usd(0)}</div></div>`}
      <form class="form" id="rel-form" novalidate>
        <div class="field"><label class="req">${esc(t('collector_name'))}</label><input class="input" name="name" required value="${esc(b.consignee_name)}"></div>
        <div class="field"><label class="req">${esc(t('collector_phone'))}</label><input class="input" name="phone" type="tel" required value="${esc(b.consignee_phone)}"></div>
        <div class="field"><label>${esc(t('id_type'))}</label><select class="input" name="id_type"><option></option><option>NIDA</option><option>Passport</option><option>Driving licence</option><option>Voter ID</option><option>Company letter</option></select></div>
        <div class="field"><label>${esc(t('id_number'))}</label><input class="input" name="id_number"></div>
        <div class="field full"><label>${esc(t('notes'))}</label><textarea class="input" name="notes"></textarea></div>
        ${blocked && isAdmin() ? `<div class="field full"><label>${esc(t('override_reason'))}</label><textarea class="input" name="override" placeholder="Only if management approved credit — logged in audit"></textarea></div>` : ''}
      </form>
      <p class="muted small" style="margin:12px 0 0">${esc(t('segregation_note'))}</p>`,
    foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn success" id="rel-save" ${blocked && !isAdmin() ? 'disabled' : ''}>${icon('release')}${esc(t('release_cargo'))}</button>`,
    onMount: (m) => {
      const f = m.el.querySelector('#rel-form');
      m.el.querySelector('#rel-save').onclick = (e) => busy(e.currentTarget, async () => {
        if (!checkRequired(f)) return;
        const d = formData(f);
        try {
          await rpc('release_booking', { p_booking: b.id, p_name: d.name, p_phone: d.phone, p_id_type: d.id_type, p_id_number: d.id_number, p_notes: d.notes, p_override_reason: d.override || null });
          m.close(); toast(t('released_ok')); location.hash = `#/doc/release/${b.id}`;
        } catch (err) {
          if (errCode(err) === 'SETTLEMENT_GATE' || errCode(err) === 'SEGREGATION') { m.el.querySelector('.modal-b').insertAdjacentHTML('afterbegin', `<div class="callout danger" style="margin-bottom:12px">${icon('lock')}<div>${esc(errText(err))}</div></div>`); }
          toast(errText(err), 'err');
        }
      });
    },
  });
}

function noteModal(b, done) {
  modal({
    title: `${t('add_note')} · ${b.ref}`,
    body: `<form class="form" id="n-form" novalidate>
      <div class="field full"><label class="req">${esc(t('update_title'))}</label><input class="input" name="title" required list="note-presets">
        <datalist id="note-presets"><option>Documents received</option><option>Waiting for permit</option><option>Transhipment</option><option>Vessel delayed</option><option>Customer contacted</option></datalist></div>
      <div class="field full"><label>${esc(t('notes'))}</label><textarea class="input" name="note"></textarea></div>
      <label class="row full small" style="gap:8px"><input type="checkbox" name="is_public" checked> ${esc(t('public_update'))}</label>
    </form>`,
    foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="n-save">${icon('check')}${esc(t('save'))}</button>`,
    onMount: (m) => {
      const f = m.el.querySelector('#n-form');
      m.el.querySelector('#n-save').onclick = (e) => busy(e.currentTarget, async () => {
        if (!checkRequired(f)) return;
        const d = formData(f);
        try { await rpc('add_tracking_note', { p_booking: b.id, p_title: d.title, p_note: d.note, p_public: d.is_public }); m.close(); toast(t('saved')); done(); } catch (err) { toast(errText(err), 'err'); }
      });
    },
  });
}
