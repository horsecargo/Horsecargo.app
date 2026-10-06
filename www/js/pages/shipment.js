import { t, tr } from '../i18n.js';
import { from, run, rpc, can, isAdmin, state, errText, catName, publicTrackUrl, verifyUrl, fxFor, branchName } from '../api.js';
import {
  icon, esc, usd, money, num, fdate, fdatetime, ago, statusBadge, modeTag, route, modal, toast, confirmDialog,
  formData, checkRequired, busy, empty, qrSVG, whatsappLink, $, $$,
} from '../ui.js';
import { FLOW, payBadge } from './shipments.js';
import { stateBadge, bar, packingModal } from './storage.js';

export const docBadge = (st) => st === 'approved' ? `<span class="badge s-ready">${esc(t('ds_approved'))}</span>`
  : st === 'rejected' ? `<span class="badge s-cancelled">${esc(t('ds_rejected'))}</span>`
  : `<span class="badge s-pending_deposit">${esc(t('ds_pending'))}</span>`;

export async function render({ el, params, setTitle, rerender }) {
  const id = params[0];
  const [s, items, lines, receipts, events, rel, grn, store] = await Promise.all([
    run(from('v_shipments').select('*').eq('id', id).single()),
    run(from('v_shipment_items').select('*').eq('shipment_id', id).order('id')),
    run(from('v_invoice_lines').select('*').eq('shipment_id', id).eq('invoice_status', 'issued').order('id')),
    run(from('v_receipts').select('*').eq('shipment_id', id).order('received_at', { ascending: false })),
    run(from('v_events').select('*').eq('shipment_id', id).order('created_at', { ascending: false })),
    run(from('v_releases').select('*').eq('shipment_id', id).maybeSingle()),
    run(from('grns').select('*').eq('shipment_id', id).maybeSingle()),
    run(from('v_storage').select('*').eq('shipment_id', id).maybeSingle()).catch(() => null),
  ]);
  setTitle(s.ref);
  const grnLines = grn ? await run(from('grn_lines').select('*').eq('grn_id', grn.id).order('id')) : [];
  const storeItems = store ? await run(from('v_storage_items').select('*').eq('shipment_id', id).order('id')) : [];
  const closed = ['delivered', 'cancelled'].includes(s.status);
  const idx = FLOW.indexOf(s.status);
  const bal = Number(s.balance_txn);
  const fx = Number(s.invoice_fx || 1);
  const cur = s.invoice_currency || 'USD';
  const M = (v) => money(v, cur);

  const A = [];
  if (!closed && can('payment.record') && bal > 0.009) A.push(`<button class="btn accent" data-act="pay">${icon('money')}${esc(t('record_payment'))}</button>`);
  if (!closed && !grn && can('grn.record')) A.push(`<a class="btn" href="#/shipment/${s.id}/grn">${icon('scale')}${esc(t('record_grn'))}</a>`);
  if (!closed && s.status === 'arrived' && can('deliver')) A.push(`<button class="btn accent" data-act="deliver">${icon('release')}${esc(t('deliver_cargo'))}</button>`);
  if (!closed && can('shipment.edit')) A.push(`<a class="btn" href="#/shipment/${s.id}/edit">${icon('gear')}${esc(t('edit_shipment'))}</a>`);

  el.innerHTML = `
  <div class="page-head">
    <div class="grow">
      <div class="row" style="gap:8px">${modeTag(s.mode)} ${route(s.origin_branch, s.destination_branch)} ${statusBadge(s.status)} ${payBadge(s.payment_status)}</div>
      <h1 class="mono" style="margin-top:4px">${esc(s.ref)}</h1>
      <p>${esc(s.customer_name)} → ${esc(s.receiver_name)} · ${fdate(s.created_at)}</p>
    </div>
    <div class="row">${A.join('')}
      <button class="btn" data-act="more">${icon('more')}</button></div>
  </div>
  ${s.status === 'cancelled' ? `<div class="callout danger" style="margin-bottom:14px">${icon('x')}<div>${esc(t('st_cancelled'))}: ${esc(s.cancelled_reason || '')}</div></div>` : ''}
  <div class="stack">
    <div class="grid c4">
      <div class="card kpi"><div class="k">${esc(t('chargeable'))}</div><div class="v">${s.mode === 'sea' ? num(s.cbm, 3) : num(s.weight_kg || s.actual_kg, 1)}</div><div class="s">${s.mode === 'sea' ? 'CBM' : 'kg'} · USD ${num(s.rate_used, 2)}${s.rate_source === 'override' ? ` · ${esc(t('rate_overridden'))}` : ''}</div></div>
      <div class="card kpi"><div class="k">${esc(t('invoice_total'))}</div><div class="v">${M(s.invoice_total_txn)}</div>${cur !== 'USD' ? `<div class="s">USD ${num(s.invoice_total, 2)} · 1 USD = ${num(fx, 2)} ${esc(cur)}</div>` : ''}</div>
      <div class="card kpi"><div class="k">${esc(t('paid'))}</div><div class="v ok">${M(s.paid_txn)}</div></div>
      <div class="card kpi"><div class="k">${esc(t('balance'))}</div><div class="v ${bal > 0.009 ? 'due' : 'ok'}">${M(bal)}</div></div>
    </div>

    ${s.status !== 'cancelled' ? `<div class="card"><div class="card-b">
      <div class="steps">${FLOW.map((st, i) => `<div class="stp ${i < idx ? 'done' : ''} ${i === idx ? 'on' : ''}"><span></span><b>${esc(t('st_' + st))}</b></div>`).join('')}</div>
      ${can('shipment.status') && !closed ? `<div class="status-btns" id="sbtns">
        ${FLOW.filter((st) => st !== 'delivered').map((st) => `<button class="sbtn ${st === s.status ? 'on' : ''}" data-status="${st}" ${st === s.status ? 'disabled' : ''}>
          ${st === s.status ? icon('check') : ''}${esc(t('st_' + st))}</button>`).join('')}
        ${can('deliver') ? `<button class="sbtn last" data-act="deliver">${icon('release')}${esc(t('deliver_cargo'))}</button>` : ''}
      </div>
      <p class="muted small" style="margin:8px 2px 0">${esc(t('status_btn_hint'))}</p>` : ''}
    </div></div>` : ''}

    <div class="split">
      <div class="stack">
        <div class="card"><div class="card-h"><h2>${esc(t('cargo'))}</h2><span class="muted">${items.length} ${esc(t('items'))}</span></div>
          <div class="table-wrap"><table class="t"><thead><tr><th>${esc(t('description'))}</th><th>${esc(t('cargo_category'))}</th><th class="num">${esc(t('qty'))}</th></tr></thead>
          <tbody>${items.map((i) => `<tr><td>${esc(i.description)}</td><td>${esc(catName({ category_name: i.category_name, category_name_sw: i.category_name_sw }) || '—')}</td>
            <td class="num nowrap">${num(i.qty, 2)} ${esc(i.unit)}</td></tr>`).join('')}</tbody></table></div></div>

        <div class="card"><div class="card-h"><h2>${esc(t('charges_pricing'))}</h2>
          ${!closed && can('charge.add') ? `<button class="btn sm" data-act="charge">${icon('plus')}${esc(t('add_charge'))}</button>` : ''}</div>
          <div class="table-wrap"><table class="t"><thead><tr><th>${esc(t('description'))}</th><th class="num hide-m">${esc(t('qty'))}</th><th class="num hide-m">${esc(t('unit_price'))}</th><th class="num">${esc(t('amount'))}</th><th></th></tr></thead>
          <tbody>${lines.map((l) => `<tr><td>${esc(l.description)}<div class="muted small">${esc(t('ch_' + (l.charge_type || l.kind)))} · ${esc(l.created_by_name || '')}${cur !== 'USD' ? ` · USD ${num(l.amount, 2)}` : ''}</div></td>
            <td class="num hide-m">${num(l.qty, 2)}</td><td class="num hide-m">${num(l.unit_price, 2)}</td>
            <td class="num ${Number(l.amount_txn ?? l.amount) < 0 ? 'ok' : ''}">${money(l.amount_txn ?? l.amount, cur, { bare: true })}</td>
            <td class="right">${l.kind !== 'freight' && can('charge.remove') && !closed ? `<button class="icon-btn" data-act="rmline" data-id="${l.id}">${icon('trash')}</button>` : ''}</td></tr>`).join('')}
            <tr style="font-weight:800"><td colspan="3" class="span-m">${esc(t('grand_total'))}</td><td class="num">${money(s.invoice_total_txn, cur, { bare: true })}</td><td></td></tr>
          </tbody></table></div>
          <div class="card-b row" style="gap:10px;flex-wrap:wrap">
            <span class="muted small">${esc(t('invoice'))}: <b class="mono">${esc(s.invoice_ref || '—')}</b></span>
            <span class="muted small">${esc(t('currency'))}: <b>${esc(cur)}</b>${cur !== 'USD' ? ` @ ${num(fx, 4)}` : ''}</span>
            ${can('currency.set') && !closed ? `<button class="btn sm" data-act="cur">${icon('money')}${esc(t('change_currency'))}</button>` : ''}
          </div>
        </div>

        <div class="card"><div class="card-h"><h2>${esc(t('payments'))}</h2>
          ${!closed && can('payment.record') ? `<button class="btn sm" data-act="pay">${icon('plus')}${esc(t('record_payment'))}</button>` : ''}</div>
          ${receipts.length ? `<div class="table-wrap"><table class="t"><tbody>${receipts.map((r) => `<tr style="${r.void ? 'opacity:.5;text-decoration:line-through' : ''}">
            <td><b class="mono">${esc(r.ref)}</b><div class="muted small">${fdatetime(r.received_at)} · ${esc(t('m_' + r.method))} · ${esc(r.received_by_name || '')}</div></td>
            <td class="num nowrap">${money(r.amount, r.currency)}</td><td class="num">${usd(r.amount_usd)}</td>
            <td class="right nowrap"><a class="icon-btn" href="#/doc/receipt/${r.id}" title="${esc(t('print'))}">${icon('print')}</a>
              ${!r.void && can('payment.void') ? `<button class="icon-btn" data-act="void" data-id="${r.id}">${icon('trash')}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
            : empty(t('no_payments'), 'money')}
        </div>

        ${grn ? `<div class="card"><div class="card-h"><h2>${esc(t('grn'))}</h2><div class="row" style="gap:6px"><a class="btn sm" href="#/doc/grn/${s.id}">${icon('print')}${esc(t('print'))}</a>
          ${can('label.read') ? `<a class="btn sm" href="#/doc/labels/${s.id}">${icon('tag')}${esc(t('cargo_labels'))}</a>` : ''}</div></div>
          <div class="card-b"><div class="money">
            <div><div class="k">${esc(t('pieces'))}</div><div class="v">${num(grn.pieces, 0)}</div></div>
            <div><div class="k">CBM</div><div class="v">${num(grn.total_cbm, 3)}</div></div>
            <div><div class="k">${esc(t('weight_kg'))}</div><div class="v">${num(grn.total_kg, 1)}</div></div>
            <div><div class="k">${esc(t('chargeable_kg'))}</div><div class="v">${num(grn.chargeable_kg, 1)}</div></div>
          </div>
          <p class="muted small" style="margin:10px 0 0">${esc(t('condition'))}: ${esc(t('c_' + grn.condition))}${grn.condition_notes ? ' · ' + esc(grn.condition_notes) : ''} · ${fdatetime(grn.received_at)}</p>
          ${grnLines.length ? `<div class="table-wrap" style="margin-top:10px"><table class="t"><tbody>${grnLines.map((l) => `<tr>
            <td>${num(l.pieces, 0)} ${esc(t('pieces').toLowerCase())}${l.length_cm && l.width_cm && l.height_cm ? ` · ${num(l.length_cm, 0)}×${num(l.width_cm, 0)}×${num(l.height_cm, 0)} cm` : ''}${l.packaging ? ` · ${esc(l.packaging)}` : ''}</td>
            <td class="num">${l.cbm ? `${num(l.cbm, 4)} CBM` : '—'}</td><td class="num">${l.weight_kg ? `${num(l.weight_kg, 1)} kg` : '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}
          </div></div>` : ''}

        ${store ? `<div class="card"><div class="card-h"><h2>${esc(t('storage'))}</h2>
          <div class="row" style="gap:8px">${stateBadge(store.state)}
            ${can('storage.pack') && store.state !== 'fully_packed' && s.status !== 'cancelled'
              ? `<button class="btn sm" id="pack-btn">${esc(t('record_packing'))}</button>` : ''}
            <a class="btn sm" href="#/storage/${esc(id)}">${esc(t('history'))}</a></div></div>
          <div class="card-b">
            <div class="money">
              <div><div class="k">${esc(t('received'))}</div><div class="v">${num(store.received_qty, 0)}</div></div>
              <div><div class="k">${esc(t('packed'))}</div><div class="v">${num(store.packed_qty, 0)}</div></div>
              <div><div class="k">${esc(t('remaining'))}</div><div class="v">${num(store.remaining_qty, 0)}</div></div>
            </div>
            ${bar(store.received_qty, store.packed_qty)}
            <div class="table-wrap" style="margin-top:10px"><table class="t"><tbody>${storeItems.map((i) => `<tr>
              <td>${esc(i.description)}<div class="muted small">${esc(i.unit)}</div></td>
              <td class="num">${num(i.packed_qty, 0)} / ${num(i.received_qty, 0)}</td>
              <td>${stateBadge(i.state)}</td></tr>`).join('')}</tbody></table></div>
            <p class="muted small" style="margin:10px 0 0">${esc(t('packing_vs_status'))}.</p>
          </div></div>` : ''}

        <div class="card" id="docs-card"><div class="card-h"><h2>${esc(t('documents'))}</h2>
          <span class="muted small">${esc(t('scan_to_verify'))}</span></div>
          <div id="docs"><div class="card-b"><div class="spinner"></div></div></div></div>

        ${can('acc.read') && state.companies.length ? `<div class="card" id="pnl-card"><div class="card-h"><h2>${esc(t('acc_costs_profit'))}</h2>
          ${can('acc.write') ? `<div class="row" style="gap:6px"><a class="btn sm" href="#/acc/expenses?new=1&shipment=${s.id}">${icon('plus')}${esc(t('acc_new_expense'))}</a>
          <a class="btn sm primary" href="#/acc/bills/new?shipment=${s.id}">${icon('plus')}${esc(t('acc_add_cost'))}</a></div>` : ''}</div>
          <div class="card-b" id="pnl"><div class="spinner"></div></div></div>` : ''}
      </div>

      <div class="stack">
        <div class="card"><div class="card-h"><h2>${esc(t('sender'))} / ${esc(t('receiver'))}</h2></div>
          <div class="card-b"><dl class="kv">
            <dt>${esc(t('sender'))}</dt><dd><a href="#/customer/${s.customer_id}">${esc(s.sender_name || s.customer_name)}</a><div class="muted small">${esc(s.sender_phone || s.customer_phone)}${s.sender_address ? '<br>' + esc(s.sender_address) : ''}</div></dd>
            <dt>${esc(t('receiver'))}</dt><dd>${s.receiver_customer_id ? `<a href="#/customer/${s.receiver_customer_id}">${esc(s.receiver_name)}</a>` : esc(s.receiver_name)}<div class="muted small">${esc(s.receiver_phone)}${s.receiver_address ? '<br>' + esc(s.receiver_address) : ''}${s.receiver_tin ? '<br>TIN ' + esc(s.receiver_tin) : ''}</div></dd>
            <dt>${esc(t('route'))}</dt><dd>${esc(branchName(s.origin_branch))} → ${esc(branchName(s.destination_branch))}</dd>
            <dt>${esc(t('created'))}</dt><dd>${fdatetime(s.created_at)}</dd>
            ${s.delivered_at ? `<dt>${esc(t('st_delivered'))}</dt><dd>${fdatetime(s.delivered_at)}</dd>` : ''}
            ${s.notes ? `<dt>${esc(t('notes'))}</dt><dd>${esc(s.notes)}</dd>` : ''}
          </dl></div>
          <div class="card-b row" style="gap:8px;flex-wrap:wrap;border-top:1px solid var(--line-2)">
            ${grn && can('grn.read') ? `<a class="btn sm" href="#/doc/grn/${s.id}">${icon('print')}GRN</a>` : ''}
            ${grn && can('label.read') ? `<a class="btn sm" href="#/doc/labels/${s.id}">${icon('tag')}${esc(t('cargo_labels'))}</a>` : ''}
            ${can('invoice.read') ? `<a class="btn sm" href="#/doc/invoice/${s.id}">${icon('print')}${esc(t('invoice'))}</a>` : ''}
            ${rel ? `<a class="btn sm" href="#/doc/release/${s.id}">${icon('print')}${esc(t('release_note'))}</a>` : ''}
            <a class="btn sm" target="_blank" rel="noopener" href="${esc(whatsappLink(s.receiver_phone, trackMsg(s)))}">${icon('whatsapp')}${esc(t('share_whatsapp'))}</a>
          </div>
        </div>

        <div class="card"><div class="card-h"><h2>${esc(t('qr_code'))}</h2></div>
          <div class="card-b" style="text-align:center">${qrSVG(publicTrackUrl(s.ref), 150)}
            <div class="muted small mono" style="margin-top:6px">${esc(s.ref)}</div></div></div>

        <div class="card"><div class="card-h"><h2>${esc(t('timeline'))}</h2>
          ${can('tracking.note') && !closed ? `<button class="btn sm" data-act="note">${icon('plus')}${esc(t('add_note'))}</button>` : ''}</div>
          <div class="card-b"><ol class="tl">${events.map((e) => `<li>
            <b>${esc(tr(e.title))}</b>${e.is_public ? '' : ` <span class="badge plain">${esc(t('internal'))}</span>`}
            <div class="muted small">${fdatetime(e.created_at)} · ${ago(e.created_at)}${e.created_by_name ? ' · ' + esc(e.created_by_name) : ''}${e.location ? ' · ' + esc(e.location) : ''}</div>
            ${e.note ? `<div class="small">${esc(e.note)}</div>` : ''}
            ${e.prev_status ? `<div class="muted small">${esc(t('st_' + e.prev_status))} → ${esc(t('st_' + e.status))}</div>` : ''}
          </li>`).join('')}</ol></div></div>
      </div>
    </div>
  </div>`;

  // documents: register/refresh and show approval state
  const loadDocs = async () => {
    const box = $('#docs', el); if (!box) return;
    try {
      // workflow order: GRN → Cargo Labels → Invoice → (delivery note, receipts)
      const types = [['grn', s.grn_id], ['label', s.grn_id ? s.id : null], ['invoice', s.invoice_id]];
      if (rel) types.push(['release', rel.id]);
      receipts.filter((r) => !r.void).forEach((r) => types.push(['receipt', r.id]));
      const rows = [];
      for (const [type, did] of types) {
        if (!did) continue;
        try { rows.push({ type, id: did, ...(await rpc('doc_register', { p_type: type, p_doc_id: did })) }); } catch { /* skip */ }
      }
      const DOCHREF = { invoice: `#/doc/invoice/${s.id}`, grn: `#/doc/grn/${s.id}`, label: `#/doc/labels/${s.id}`,
        release: rel ? `#/doc/release/${s.id}` : '#' };
      box.innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><tbody>${rows.map((d) => `<tr>
        <td><b class="mono">${esc(d.ref)}</b><div class="muted small">${esc(t('doct_' + d.type))}${d.version > 1 ? ` · v${d.version}` : ''}</div></td>
        <td>${['invoice','grn','label'].includes(d.type) ? `<span class="badge s-ready">${esc(t('dst_issued'))}</span>` : docBadge(d.status)}${!['invoice','grn','label'].includes(d.type) && d.approved_by ? `<div class="muted small">${esc(d.approved_by)}</div>` : ''}</td>
        <td class="right nowrap">
          <a class="icon-btn" href="${d.type === 'receipt' ? `#/doc/receipt/${d.id}` : DOCHREF[d.type]}" title="${esc(t('print'))}">${icon('print')}</a>
          <a class="icon-btn" target="_blank" rel="noopener" href="${esc(verifyUrl(d.token))}" title="${esc(t('verify'))}">${icon('search')}</a>
          ${!['invoice','grn','label'].includes(d.type) && can('doc.approve') && d.status !== 'approved' ? `<button class="btn sm primary" data-approve="${d.token}">${esc(t('approve'))}</button>` : ''}
          ${!['invoice','grn','label'].includes(d.type) && can('doc.approve') && d.status === 'approved' ? `<button class="btn sm" data-reject="${d.token}">${esc(t('reject'))}</button>` : ''}
        </td></tr>`).join('')}</tbody></table></div>`
        : empty(t('nothing_here'), 'print');
    } catch (err) { box.innerHTML = `<div class="card-b"><p class="muted small">${esc(errText(err))}</p></div>`; }
  };
  loadDocs();

  if (can('acc.read') && state.companies.length) {
    rpc('acc_shipment_pnl', { p_shipment: s.id }).then((p) => {
      const b = $('#pnl', el); if (!b) return;
      b.innerHTML = `<div class="money">
        <div><div class="k">${esc(t('acc_revenue'))}</div><div class="v">${usd(p.revenue)}</div></div>
        <div><div class="k">${esc(t('acc_cost'))}</div><div class="v">${usd(p.cost)}</div></div>
        <div><div class="k">${esc(t('acc_profit'))}</div><div class="v ${p.profit < 0 ? 'due' : 'ok'}">${usd(p.profit)}</div></div>
        <div><div class="k">${esc(t('acc_margin'))}</div><div class="v">${p.margin_pct ?? '—'}%</div></div></div>
        ${p.cost_lines.length ? `<div class="table-wrap" style="margin-top:10px"><table class="t"><tbody>${p.cost_lines.map((c) => `<tr>
          <td class="small nowrap">${fdate(c.date)}</td><td><span class="mono small">${esc(c.code)}</span> ${esc(c.account)}<div class="muted small">${esc(c.description || '')} · ${esc(c.journal)}</div></td>
          <td class="num">${usd(c.amount, { bare: true })}</td></tr>`).join('')}</tbody></table></div>`
        : `<p class="muted small" style="margin:10px 0 0">${esc(t('acc_no_costs'))}</p>`}`;
    }).catch((err) => { const b = $('#pnl', el); if (b) b.innerHTML = `<p class="muted small">${esc(errText(err))}</p>`; });
  }

  el.addEventListener('click', async (e) => {
    if (e.target.closest('#pack-btn')) return packingModal(id, rerender);
    const sb = e.target.closest('[data-status]');
    if (sb) {
      if (sb.disabled) return;
      const to = sb.dataset.status;
      return busy(sb, async () => {
        $$('#sbtns .sbtn', el).forEach((b) => { b.disabled = true; });      // no double submits
        try { await rpc('set_shipment_status', { p_shipment: s.id, p_status: to, p_note: null, p_public: true });
          toast(`${t('st_' + to)} ✓`); rerender();
        } catch (err) { toast(errText(err), 'err'); $$('#sbtns .sbtn', el).forEach((b) => { b.disabled = b.dataset.status === s.status; }); }
      });
    }
    const ap = e.target.closest('[data-approve]');
    if (ap) return busy(ap, async () => {
      try { await rpc('approve_document', { p_token: ap.dataset.approve, p_approve: true, p_note: null });
        toast(t('approved_ok')); loadDocs(); } catch (err) { toast(errText(err), 'err'); }
    });
    const rj = e.target.closest('[data-reject]');
    if (rj) {
      const reason = await confirmDialog(t('reject_doc_q'), { danger: true, withReason: true, okText: t('reject') });
      if (!reason) return;
      try { await rpc('approve_document', { p_token: rj.dataset.reject, p_approve: false, p_note: reason });
        toast(t('saved')); loadDocs(); } catch (err) { toast(errText(err), 'err'); }
      return;
    }
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (act === 'status') return statusModal(s, rerender);
    if (act === 'pay') return paymentModal(s, rerender);
    if (act === 'charge') return chargeModal(s, rerender);
    if (act === 'cur') return currencyModal(s, rerender);
    if (act === 'deliver') return deliverModal(s, rerender);
    if (act === 'note') {
      return modal({
        title: t('add_note'),
        body: `<form class="form" id="nf"><div class="field full"><label class="req">${esc(t('update_title'))}</label><input class="input" name="title" required></div>
          <div class="field full"><label>${esc(t('notes'))}</label><textarea class="input" name="note" rows="3"></textarea></div>
          <div class="field full"><label><input type="checkbox" name="pub" checked> ${esc(t('public_update'))}</label></div></form>`,
        foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="ns">${icon('check')}${esc(t('save'))}</button>`,
        onMount: (m) => { m.el.querySelector('#ns').onclick = (ev) => busy(ev.currentTarget, async () => {
          const f = m.el.querySelector('#nf'); if (!checkRequired(f)) return;
          const d = formData(f);
          try { await rpc('add_tracking_note', { p_shipment: s.id, p_title: d.title, p_note: d.note, p_public: d.pub }); m.close(); toast(t('saved')); rerender(); }
          catch (err) { toast(errText(err), 'err'); }
        }); },
      });
    }
    if (act === 'void') {
      const reason = await confirmDialog(`${t('void')} ${t('receipt').toLowerCase()}?`, { danger: true, withReason: true, okText: t('void') });
      if (!reason) return;
      try { await rpc('void_receipt', { p_receipt: a.dataset.id, p_reason: reason }); toast(t('saved')); rerender(); } catch (err) { toast(errText(err), 'err'); }
    }
    if (act === 'rmline') {
      const reason = await confirmDialog(t('remove_charge_q'), { danger: true, withReason: true, okText: t('void') });
      if (!reason) return;
      try { await rpc('remove_charge', { p_line: Number(a.dataset.id), p_reason: reason }); toast(t('saved')); rerender(); } catch (err) { toast(errText(err), 'err'); }
    }
    if (act === 'more') {
      const opts = [];
      if (!closed && can('shipment.cancel')) opts.push(`<button class="lc row danger" data-m="cancel">${icon('x')}${esc(t('cancel_shipment'))}</button>`);
      opts.push(`<a class="lc row" target="_blank" rel="noopener" href="${esc(publicTrackUrl(s.ref))}">${icon('search')}${esc(t('track_cargo'))}</a>`);
      if (isAdmin()) opts.push(`<a class="lc row" href="#/audit?q=${encodeURIComponent(s.ref)}">${icon('shield')}${esc(t('audit'))}</a>`);
      modal({ title: t('more'), body: `<div class="card">${opts.join('')}</div>`, onMount: (m) => {
        m.el.addEventListener('click', async (ev) => {
          const b = ev.target.closest('[data-m]'); if (!b) return;
          m.close();
          if (b.dataset.m === 'cancel') {
            const reason = await confirmDialog(`${t('cancel_shipment')} ${s.ref}?`, { danger: true, withReason: true, okText: t('cancel_shipment') });
            if (!reason) return;
            try { await rpc('cancel_shipment', { p_shipment: s.id, p_reason: reason }); toast(t('saved')); rerender(); } catch (err) { toast(errText(err), 'err'); }
          }
        });
      } });
    }
  });
}

function trackMsg(s) {
  return `Horse Cargo — ${s.ref}\n${t('status')}: ${t('st_' + s.status)}\n${t('route')}: ${s.origin_branch} → ${s.destination_branch}\n${publicTrackUrl(s.ref)}`;
}

function statusModal(s, done) {
  const i = FLOW.indexOf(s.status);
  const next = FLOW.slice(0, FLOW.length - 1).filter((x) => x !== s.status);
  modal({
    title: `${t('update_status')} · ${s.ref}`,
    body: `<div class="callout info" style="margin-bottom:12px">${icon('info')}<div>${esc(t('now'))}: <b>${esc(t('st_' + s.status))}</b></div></div>
      <form class="form" id="sf">
        <div class="field full"><label class="req">${esc(t('new_status'))}</label><select class="input" name="status">
          ${next.map((x, k) => `<option value="${x}" ${x === FLOW[i + 1] ? 'selected' : ''}>${esc(t('st_' + x))}</option>`).join('')}</select></div>
        <div class="field full"><label>${esc(t('notes'))}</label><input class="input" name="note" placeholder="${esc(t('status_note_ph'))}"></div>
        <div class="field full"><label><input type="checkbox" name="pub" checked> ${esc(t('public_update'))}</label></div>
      </form>`,
    foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="ss">${icon('check')}${esc(t('save'))}</button>`,
    onMount: (m) => { m.el.querySelector('#ss').onclick = (ev) => busy(ev.currentTarget, async () => {
      const d = formData(m.el.querySelector('#sf'));
      try { await rpc('set_shipment_status', { p_shipment: s.id, p_status: d.status, p_note: d.note, p_public: d.pub }); m.close(); toast(t('saved')); done(); }
      catch (err) { toast(errText(err), 'err'); }
    }); },
  });
}

function paymentModal(s, done) {
  const cur0 = s.invoice_currency || 'USD';
  const fx0 = Number(s.invoice_fx || 1);
  const due = Math.max(Number(s.balance_txn), 0);            // due in the billing currency
  modal({
    title: `${t('record_payment')} · ${s.ref}`,
    body: `<div class="callout ${due > 0 ? 'warn' : 'ok'}" style="margin-bottom:14px">${icon('money')}<div>${esc(t('amount_due'))}: <b>${usd(due)}</b></div></div>
      <form class="form" id="pay-form" novalidate>
        <div class="field"><label class="req">${esc(t('currency'))}</label><select class="input" name="currency">
          ${['USD', 'AED', 'TZS'].map((c) => `<option ${c === cur0 ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label class="req">${esc(t('amount'))}</label><input class="input" name="amount" type="number" min="0" step="0.01" required inputmode="decimal"></div>
        <div class="field"><label>${esc(t('fx_rate'))} <span class="muted small">(1 USD = …)</span></label><input class="input" name="fx_rate" type="number" step="0.0001" value="${fx0}"></div>
        <div class="field"><label>${esc(t('usd_equiv'))}</label><input class="input" id="usd-eq" readonly></div>
        <div class="field"><label class="req">${esc(t('method'))}</label><select class="input" name="method">
          ${['cash', 'bank', 'mobile_money', 'card'].map((x) => `<option value="${x}">${esc(t('m_' + x))}</option>`).join('')}</select></div>
        <div class="field"><label>${esc(t('txn_ref'))}</label><input class="input" name="reference"></div>
        ${state.companies.length ? `<div class="field full"><label>${esc(t('acc_paid_into'))}</label><select class="input" name="account"><option value="">${esc(t('acc_auto_account'))}</option></select></div>` : ''}
      </form>`,
    foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn accent" id="pay-save">${icon('check')}${esc(t('save'))}</button>`,
    onMount: (m) => {
      const f = m.el.querySelector('#pay-form');
      let accs = [];
      const upd = (curChanged) => {
        if (curChanged) {
          // paying in the invoice currency uses the invoice rate — the amount is never converted twice
          const r = f.currency.value === cur0 ? fx0 : fxFor(f.currency.value);
          f.fx_rate.value = r; f.fx_rate.readOnly = f.currency.value === 'USD';
          const dueUsd = due / fx0;
          if (due > 0) f.amount.value = f.currency.value === cur0 ? (cur0 === 'TZS' ? Math.round(due) : due.toFixed(2))
            : (f.currency.value === 'TZS' ? Math.round(dueUsd * r) : (dueUsd * r).toFixed(2));
        }
        m.el.querySelector('#usd-eq').value = usd(Number(f.amount.value || 0) / Number(f.fx_rate.value || 1));
        fillAcc();
      };
      const fillAcc = () => {
        if (!f.account) return;
        const want = { cash: 'cash', bank: 'bank', mobile_money: 'mobile_money', card: 'bank' }[f.method.value];
        const list = accs.filter((x) => x.currency === f.currency.value)
          .sort((a, b) => (b.kind === want) - (a.kind === want) || (b.branch_code === state.profile?.branch_code) - (a.branch_code === state.profile?.branch_code));
        const keep = f.account.value;
        f.account.innerHTML = `<option value="">${esc(t('acc_auto_account'))}</option>` +
          list.map((x) => `<option value="${x.id}">${esc(x.company_code)} · ${esc(x.name)}</option>`).join('');
        if ([...f.account.options].some((o) => o.value === keep)) f.account.value = keep;
      };
      if (f.account) from('money_accounts').select('id,name,kind,currency,company_code,branch_code').eq('active', true).order('name')
        .then(({ data }) => { accs = data || []; fillAcc(); });
      f.currency.onchange = () => upd(true);
      f.method.onchange = fillAcc;
      f.amount.oninput = () => upd(false); f.fx_rate.oninput = () => upd(false);
      upd(true);
      m.el.querySelector('#pay-save').onclick = (ev) => busy(ev.currentTarget, async () => {
        if (!checkRequired(f)) return;
        const d = formData(f);
        try {
          const r = await rpc('record_payment', { p_shipment: s.id, p_amount: d.amount, p_currency: d.currency, p_method: d.method,
            p_reference: d.reference, p_fx_rate: d.fx_rate, ...(d.account ? { p_account: d.account } : {}) });
          m.close(); toast(`${t('payment_saved')} · ${r.ref}`); done();
          setTimeout(() => modal({ title: r.ref,
            body: `<div class="callout ok">${icon('check')}<div>${esc(t('payment_saved'))} — ${usd(r.amount_usd)}</div></div>`,
            foot: `<button class="btn" data-close>${esc(t('close'))}</button><a class="btn primary" data-close href="#/doc/receipt/${r.id}">${icon('print')}${esc(t('receipt'))}</a>` }), 250);
        } catch (err) { toast(errText(err), 'err'); }
      });
    },
  });
}

function chargeModal(s, done) {
  const KINDS = ['packing', 'handling', 'storage', 'delivery', 'duty', 'other'].concat(can('charge.discount') ? ['discount'] : []);
  modal({
    title: `${t('add_charge')} · ${s.ref}`,
    body: `<form class="form" id="cf" novalidate>
      <div class="field"><label class="req">${esc(t('charge_type'))}</label><select class="input" name="charge_type">
        ${KINDS.map((k) => `<option value="${k}">${esc(t('ch_' + k))}</option>`).join('')}</select></div>
      <div class="field"><label class="req">${esc(t('amount'))}</label><input class="input" type="number" step="0.01" min="0" name="unit_price" required inputmode="decimal"></div>
      <div class="field"><label class="req">${esc(t('currency'))}</label><select class="input" name="currency">
        <option value="${esc(s.invoice_currency || 'USD')}">${esc(s.invoice_currency || 'USD')} · ${esc(t('billing_currency'))}</option>
        ${(s.invoice_currency || 'USD') !== 'USD' ? `<option value="USD">USD</option>` : ''}</select></div>
      <div class="field full"><label>${esc(t('description'))}</label><input class="input" name="description"></div>
      <div class="field"><label>${esc(t('qty'))}</label><input class="input" type="number" step="0.01" name="qty" value="1"></div>
    </form>
    <p class="muted small">${esc(t('duty_note'))}</p>`,
    foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="cs">${icon('check')}${esc(t('save'))}</button>`,
    onMount: (m) => { m.el.querySelector('#cs').onclick = (ev) => busy(ev.currentTarget, async () => {
      const f = m.el.querySelector('#cf'); if (!checkRequired(f)) return;
      const d = formData(f);
      try { await rpc('add_charge', { p_shipment: s.id, p_charge_type: d.charge_type, p_description: d.description || '',
          p_qty: d.qty || 1, p_unit_price: d.unit_price, p_currency: d.currency });
        m.close(); toast(t('saved')); done(); } catch (err) { toast(errText(err), 'err'); }
    }); },
  });
}

function currencyModal(s, done) {
  modal({
    title: t('change_currency'),
    body: `<form class="form" id="uf">
      <div class="field"><label class="req">${esc(t('currency'))}</label><select class="input" name="currency">
        ${['USD', 'AED', 'TZS'].map((c) => `<option ${c === s.invoice_currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>${esc(t('fx_rate'))}</label><input class="input" type="number" step="0.0001" name="fx_rate"></div>
      <div class="field full"><label>${esc(t('amount_due'))}</label><input class="input" id="due" readonly></div></form>`,
    foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="us">${icon('check')}${esc(t('save'))}</button>`,
    onMount: (m) => {
      const f = m.el.querySelector('#uf');
      const upd = () => {
        if (!f.fx_rate.value || f.dataset.auto !== '0') f.fx_rate.value = fxFor(f.currency.value);
        m.el.querySelector('#due').value = money(Number(s.invoice_total) * Number(f.fx_rate.value || 1), f.currency.value);
      };
      f.currency.onchange = () => { f.dataset.auto = '1'; upd(); };
      f.fx_rate.oninput = () => { f.dataset.auto = '0'; m.el.querySelector('#due').value = money(Number(s.invoice_total) * Number(f.fx_rate.value || 1), f.currency.value); };
      upd();
      m.el.querySelector('#us').onclick = (ev) => busy(ev.currentTarget, async () => {
        try { await rpc('set_invoice_currency', { p_shipment: s.id, p_currency: f.currency.value, p_fx_rate: Number(f.fx_rate.value) });
          m.close(); toast(t('saved')); done(); } catch (err) { toast(errText(err), 'err'); }
      });
    },
  });
}

function deliverModal(s, done) {
  const bal = Number(s.balance_txn); const cur = s.invoice_currency || 'USD';
  modal({
    title: `${t('deliver_cargo')} · ${s.ref}`,
    body: `${bal > 0.009 ? `<div class="callout warn" style="margin-bottom:12px">${icon('alert')}<div>${esc(t('balance_at_handover'))}: <b>${money(bal, cur)}</b></div></div>` : ''}
      <form class="form" id="df" novalidate>
        <div class="field"><label class="req">${esc(t('collector_name'))}</label><input class="input" name="name" required value="${esc(s.receiver_name)}"></div>
        <div class="field"><label class="req">${esc(t('collector_phone'))}</label><input class="input" type="tel" name="phone" required value="${esc(s.receiver_phone)}"></div>
        <div class="field"><label>${esc(t('id_type'))}</label><input class="input" name="id_type"></div>
        <div class="field"><label>${esc(t('id_number'))}</label><input class="input" name="id_number"></div>
        <div class="field full"><label>${esc(t('notes'))}</label><input class="input" name="notes"></div>
      </form>`,
    foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn accent" id="ds">${icon('check')}${esc(t('deliver_cargo'))}</button>`,
    onMount: (m) => { m.el.querySelector('#ds').onclick = (ev) => busy(ev.currentTarget, async () => {
      const f = m.el.querySelector('#df'); if (!checkRequired(f)) return;
      const d = formData(f);
      try {
        const r = await rpc('deliver_shipment', { p_shipment: s.id, p_name: d.name, p_phone: d.phone, p_id_type: d.id_type, p_id_number: d.id_number, p_notes: d.notes });
        m.close(); toast(`${t('delivered_ok')} · ${r.ref}`); done();
      } catch (err) { toast(errText(err), 'err'); }
    }); },
  });
}
