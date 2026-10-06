import { t } from '../i18n.js';
import { from, run, rpc, can, state, errText } from '../api.js';
import { registerPage } from '../register.js';
import { icon, esc, fdate, num, money, modal, toast, formData, busy, debounce } from '../ui.js';
import { activeStaff, staffOptions } from '../staff.js';

export const SOURCING_STATUSES = ['new', 'searching', 'supplier_found', 'quotation_sent', 'customer_approved', 'purchased', 'completed', 'cancelled'];
export const CURRENCIES = ['USD', 'AED', 'TZS', 'CNY'];
const BADGE = { new: 's-booked', searching: 's-received_dubai', supplier_found: 's-in_transit', quotation_sent: 's-packed',
  customer_approved: 's-arrived', purchased: 's-dispatched', completed: 's-ready', cancelled: 's-cancelled' };
export const sourcingBadge = (s) => `<span class="badge ${BADGE[s] || ''}">${esc(t('ss_' + s))}</span>`;

export function sourcingForm(r = {}, staff = [], { assign = can('sourcing.write') } = {}) {
  return `<form class="form" id="src-form" novalidate>
    <div class="field full"><label class="req">${esc(t('product_requested'))}</label><input class="input" name="product" required value="${esc(r.product)}"></div>
    <div class="field full"><label>${esc(t('description'))}</label><textarea class="input" name="description" rows="3">${esc(r.description)}</textarea></div>
    <div class="field"><label>${esc(t('quantity'))}</label><input class="input" name="quantity" type="number" min="0" step="any" inputmode="decimal" value="${esc(r.quantity ?? '')}"></div>
    <div class="field"><label>${esc(t('unit'))}</label><input class="input" name="unit" value="${esc(r.unit || '')}" placeholder="PCS, CTN, KG…"></div>
    <div class="field"><label>${esc(t('supplier'))}</label><input class="input" name="supplier" value="${esc(r.supplier)}"></div>
    <div class="field"><label>${esc(t('supplier_contact'))}</label><input class="input" name="supplier_contact" value="${esc(r.supplier_contact)}"></div>
    <div class="field"><label>${esc(t('estimated_cost'))}</label><input class="input" name="estimated_cost" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(r.estimated_cost ?? '')}"></div>
    <div class="field"><label>${esc(t('currency'))}</label><select class="input" name="currency">${CURRENCIES.map((c) => `<option ${c === (r.currency || 'USD') ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="field"><label>${esc(t('quoted_price'))}</label><input class="input" name="quoted_price" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(r.quoted_price ?? '')}"></div>
    ${assign ? `<div class="field"><label>${esc(t('assigned_to'))}</label><select class="input" name="assigned_to">${staffOptions(staff, r.assigned_to)}</select></div>` : ''}
    <div class="field full"><label>${esc(t('notes'))}</label><textarea class="input" name="notes" rows="2">${esc(r.notes)}</textarea></div>
  </form>`;
}
export function checkSourcing(d) {
  if (!d.product) return t('product_requested');
  for (const k of ['quantity', 'estimated_cost', 'quoted_price']) if (d[k] !== null && d[k] !== undefined && Number(d[k]) < 0) return t(k === 'quantity' ? 'quantity' : k);
  return null;
}

async function newSourcingModal() {
  const staff = await activeStaff();
  const leads = await run(from('v_leads').select('id,lead_number,customer_name,status').neq('status', 'lost').order('created_at', { ascending: false }).limit(200)).catch(() => []);
  const token = crypto.randomUUID();
  let customerId = null;
  modal({
    title: t('new_sourcing'), wide: true,
    body: `<div class="form" style="margin-bottom:12px">
        <div class="field full"><label class="req">${esc(t('for_whom'))}</label>
          <select class="input" id="src-lead"><option value="">— ${esc(t('linked_lead'))} —</option>${leads.map((l) => `<option value="${l.id}">${esc(l.lead_number)} · ${esc(l.customer_name)}</option>`).join('')}</select></div>
        <div class="field full"><div class="search">${icon('search')}<input class="input" id="src-cust-q" placeholder="${esc(t('search_customer'))}" autocomplete="off"></div>
          <div id="src-cust-hits" class="stack" style="gap:4px;margin-top:6px"></div><div id="src-cust-pick" class="small"></div></div>
        <div class="field full"><label>${esc(t('requester_name'))}</label><input class="input" id="src-req"></div>
      </div>${sourcingForm({}, staff)}`,
    foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="src-save">${icon('check')}${esc(t('save'))}</button>`,
    onMount: (m) => {
      const q = m.el.querySelector('#src-cust-q'); const hits = m.el.querySelector('#src-cust-hits'); const pick = m.el.querySelector('#src-cust-pick');
      q.addEventListener('input', debounce(async () => {
        const v = q.value.trim(); if (v.length < 2) { hits.innerHTML = ''; return; }
        try {
          const list = await rpc('search_customers', { p_q: v });
          hits.innerHTML = list.slice(0, 6).map((c) => `<button type="button" class="btn sm ghost" style="justify-content:flex-start" data-cust="${c.id}" data-label="${esc(c.name)} · ${esc(c.code)}">${esc(c.name)} <span class="muted mono small">${esc(c.code)} · ${esc(c.phone)}</span></button>`).join('');
        } catch (err) { hits.innerHTML = `<span class="muted small">${esc(errText(err))}</span>`; }
      }, 300));
      hits.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cust]'); if (!b) return;
        customerId = b.dataset.cust; hits.innerHTML = '';
        pick.innerHTML = `${icon('check')} <b>${esc(b.dataset.label)}</b> <button type="button" class="btn sm ghost" id="src-cust-clear">${icon('x')}</button>`;
        pick.querySelector('#src-cust-clear').onclick = () => { customerId = null; pick.innerHTML = ''; };
      });
      m.el.querySelector('#src-save').onclick = (ev) => busy(ev.currentTarget, async () => {
        const d = formData(m.el.querySelector('#src-form'));
        const lead = m.el.querySelector('#src-lead').value || null;
        const req = m.el.querySelector('#src-req').value.trim();
        if (!lead && !customerId && !req) { toast(`${t('required_fields')}: ${t('for_whom')}`, 'err'); return; }
        const missing = checkSourcing(d); if (missing) { toast(`${t('required_fields')}: ${missing}`, 'err'); return; }
        try {
          const r = await rpc('create_sourcing', { p: { ...d, lead_id: lead, customer_id: customerId, requester_name: req || null, client_token: token } });
          m.close(); toast(`${t('sourcing_saved')} · ${r.sourcing_number}`); location.hash = `#/sourcing/${r.id}`;
        } catch (err) { toast(errText(err), 'err'); }
      });
    },
  });
}

export async function render({ el, setTitle, query }) {
  setTitle(t('sourcing'));
  const me = state.profile.id;
  await registerPage({
    el, title: t('sourcing'), view: 'v_sourcing', order: ['created_at', false],
    search: ['sourcing_number', 'product', 'supplier', 'customer_display', 'lead_number'], emptyText: t('no_sourcing'), emptyIcon: 'globe',
    actions: can('sourcing.write') ? `<button class="btn primary" id="new-src">${icon('plus')}${esc(t('new_sourcing'))}</button>` : '',
    chips: [
      { key: 'all', label: t('all') },
      { key: 'mine', label: t('mine'), apply: (b) => b.or(`created_by.eq.${me},assigned_to.eq.${me}`) },
      ...SOURCING_STATUSES.map((s) => ({ key: s, label: t('ss_' + s), apply: (b) => b.eq('status', s) })),
    ],
    head: [esc(t('sourcing_number')), esc(t('product_requested')), esc(t('for_whom')), `<span class="num">${esc(t('quantity'))}</span>`, esc(t('supplier')), `<span class="num">${esc(t('estimated_cost'))}</span>`, esc(t('status')), esc(t('assigned_to'))],
    row: (r) => [`<b class="mono">${esc(r.sourcing_number)}</b><div class="muted small">${fdate(r.request_date)}</div>`,
      `<b>${esc(r.product)}</b>`, `${esc(r.customer_display || '—')}${r.lead_number ? `<div class="muted small mono">${esc(r.lead_number)}</div>` : ''}`,
      `<span class="num">${r.quantity !== null ? `${num(r.quantity, 0)} ${esc(r.unit || '')}` : '—'}</span>`, esc(r.supplier || '—'),
      `<span class="num nowrap">${r.estimated_cost !== null ? money(r.estimated_cost, r.currency) : '—'}</span>`,
      sourcingBadge(r.status), esc(r.assigned_to_name || t('unassigned'))],
    card: (r) => `<a class="lc" href="#/sourcing/${r.id}"><div class="top"><b>${esc(r.product)}</b>${sourcingBadge(r.status)}</div>
      <div class="sub mono">${esc(r.sourcing_number)}${r.quantity !== null ? ` · ${num(r.quantity, 0)} ${esc(r.unit || '')}` : ''}</div>
      <div class="sub">${esc(r.customer_display || '')} · ${esc(r.assigned_to_name || t('unassigned'))}</div></a>`,
    href: (r) => `#/sourcing/${r.id}`,
  });
  const nb = el.querySelector('#new-src');
  if (nb) nb.onclick = () => newSourcingModal();
  if (query.get('new') === '1' && nb) newSourcingModal();
}
