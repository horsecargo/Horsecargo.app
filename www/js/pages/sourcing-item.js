import { t } from '../i18n.js';
import { from, run, rpc, can, state, errText } from '../api.js';
import { icon, esc, fdate, fdatetime, num, money, modal, toast, formData, busy } from '../ui.js';
import { activeStaff } from '../staff.js';
import { sourcingBadge, sourcingForm, checkSourcing, SOURCING_STATUSES } from './sourcing.js';

export async function render({ el, params, setTitle, rerender }) {
  const id = params[0];
  const r = await run(from('v_sourcing').select('*').eq('id', id).maybeSingle());
  if (!r) {
    el.innerHTML = `<div class="card card-b"><div class="callout danger">${icon('lock')}<div>${esc(t('not_found'))}</div></div>
      <div style="margin-top:12px"><a class="btn" href="#/sourcing">${esc(t('back'))}</a></div></div>`;
    return;
  }
  setTitle(r.sourcing_number);
  const events = await run(from('v_sourcing_events').select('*').eq('sourcing_id', id).order('at', { ascending: false }));
  const mayWork = can('sourcing.write') || r.assigned_to === state.profile.id;
  const closed = ['completed', 'cancelled'].includes(r.status);
  const idx = SOURCING_STATUSES.indexOf(r.status);
  const next = SOURCING_STATUSES.filter((s) => s !== r.status && s !== 'cancelled');
  const margin = r.quoted_price !== null && r.estimated_cost !== null ? Number(r.quoted_price) - Number(r.estimated_cost) : null;

  el.innerHTML = `
  <div class="page-head">
    <div class="grow"><div class="row" style="gap:8px">${sourcingBadge(r.status)}</div>
      <h1 style="margin-top:4px">${esc(r.product)}</h1>
      <p class="mono">${esc(r.sourcing_number)} · ${fdate(r.request_date)}</p></div>
    <div class="row wrap-actions">
      ${mayWork && !closed ? `<button class="btn" data-act="edit">${icon('gear')}${esc(t('edit'))}</button>
        <button class="btn primary" data-act="status">${icon('refresh')}${esc(t('change_status'))}</button>` : ''}
    </div>
  </div>
  ${closed ? `<div class="callout ${r.status === 'completed' ? 'ok' : 'warn'}" style="margin-bottom:14px">${icon(r.status === 'completed' ? 'check' : 'x')}<div>${esc(t('closed_request'))}</div></div>` : ''}
  <div class="steps-line" aria-hidden="true">${SOURCING_STATUSES.filter((s) => s !== 'cancelled').map((s, i) => `<span class="${r.status === 'cancelled' ? '' : i <= idx ? 'on' : ''}">${esc(t('ss_' + s))}</span>`).join('')}</div>
  <div class="split">
    <div class="stack">
      <div class="card"><div class="card-h"><h2>${esc(t('details'))}</h2></div><div class="card-b"><dl class="kv">
        <dt>${esc(t('for_whom'))}</dt><dd>${r.customer_id ? `<a href="#/customer/${r.customer_id}">${esc(r.customer_display)}</a> <span class="mono small">${esc(r.customer_code || '')}</span>` : esc(r.customer_display || '—')}
          ${r.lead_id ? `<div class="small">${esc(t('linked_lead'))}: <a class="mono" href="#/lead/${r.lead_id}">${esc(r.lead_number)}</a></div>` : ''}
          ${r.contact_phone ? `<div class="muted small">${esc(r.contact_phone)}</div>` : ''}</dd>
        <dt>${esc(t('description'))}</dt><dd class="pre">${esc(r.description || '—')}</dd>
        <dt>${esc(t('quantity'))}</dt><dd>${r.quantity !== null ? `${num(r.quantity, 2)} ${esc(r.unit || '')}` : '—'}</dd>
        <dt>${esc(t('supplier'))}</dt><dd>${esc(r.supplier || '—')}</dd>
        <dt>${esc(t('supplier_contact'))}</dt><dd>${esc(r.supplier_contact || '—')}</dd>
        <dt>${esc(t('estimated_cost'))}</dt><dd>${r.estimated_cost !== null ? money(r.estimated_cost, r.currency) : '—'}</dd>
        <dt>${esc(t('quoted_price'))}</dt><dd>${r.quoted_price !== null ? money(r.quoted_price, r.currency) : '—'}
          ${margin !== null ? `<div class="muted small">${esc(t('acc_margin'))}: ${money(margin, r.currency)}</div>` : ''}</dd>
        <dt>${esc(t('notes'))}</dt><dd class="pre">${esc(r.notes || '—')}</dd>
      </dl></div></div>
    </div>
    <div class="stack">
      <div class="card"><div class="card-h"><h2>${esc(t('assigned_to'))}</h2></div><div class="card-b"><dl class="kv">
        <dt>${esc(t('assigned_to'))}</dt><dd><b>${esc(r.assigned_to_name || t('unassigned'))}</b></dd>
        <dt>${esc(t('created_by_label'))}</dt><dd>${esc(r.created_by_name || '—')}<div class="muted small">${fdatetime(r.created_at)}</div></dd>
        <dt>${esc(t('last_updated'))}</dt><dd>${fdatetime(r.updated_at)}</dd>
        ${r.completed_at ? `<dt>${esc(t('ss_completed'))}</dt><dd>${fdatetime(r.completed_at)}</dd>` : ''}
      </dl></div></div>
      <div class="card"><div class="card-h"><h2>${esc(t('lead_history'))}</h2></div><div class="card-b">
        <ol class="tl">${events.map((e) => `<li><b>${esc(e.kind === 'status' ? `${t('ss_' + e.from_status)} → ${t('ss_' + e.to_status)}`
          : e.kind === 'assigned' ? `${t('ev_assigned')}: ${e.to_name || t('unassigned')}` : t('ev_' + e.kind))}</b>
          <div class="muted small">${fdatetime(e.at)}${e.actor_name ? ' · ' + esc(e.actor_name) : ''}</div>
          ${e.note ? `<div class="small pre">${esc(e.note)}</div>` : ''}</li>`).join('')}</ol>
      </div></div>
    </div>
  </div>`;

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'edit') {
      const staff = await activeStaff();
      modal({
        title: `${t('edit')} · ${r.sourcing_number}`, wide: true, body: sourcingForm(r, staff),
        foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="se">${icon('check')}${esc(t('save'))}</button>`,
        onMount: (m) => { m.el.querySelector('#se').onclick = (ev) => busy(ev.currentTarget, async () => {
          const d = formData(m.el.querySelector('#src-form'));
          const missing = checkSourcing(d); if (missing) { toast(`${t('required_fields')}: ${missing}`, 'err'); return; }
          if (!can('sourcing.write')) delete d.assigned_to;
          try { await rpc('update_sourcing', { p: { id, ...d } }); m.close(); toast(t('sourcing_saved')); rerender(); } catch (err) { toast(errText(err), 'err'); }
        }); },
      });
    }
    if (b.dataset.act === 'status') {
      modal({
        title: t('change_status'),
        body: `<form class="form" id="ssf"><div class="field full"><label>${esc(t('status'))}</label><select class="input" name="status">
          ${[...next, 'cancelled'].map((s) => `<option value="${s}" ${SOURCING_STATUSES.indexOf(s) === idx + 1 ? 'selected' : ''}>${esc(t('ss_' + s))}</option>`).join('')}</select></div>
          <div class="field full"><label>${esc(t('notes'))}</label><textarea class="input" name="note" rows="2"></textarea>
          <div class="hint">${esc(t('ss_cancelled'))}: ${esc(t('reason'))}</div></div></form>`,
        foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="sss">${icon('check')}${esc(t('save'))}</button>`,
        onMount: (m) => { m.el.querySelector('#sss').onclick = (ev) => busy(ev.currentTarget, async () => {
          const d = formData(m.el.querySelector('#ssf'));
          try { await rpc('set_sourcing_status', { p_id: id, p_status: d.status, p_note: d.note }); m.close(); toast(t('saved')); rerender(); } catch (err) { toast(errText(err), 'err'); }
        }); },
      });
    }
  });
}
