import { t } from '../i18n.js';
import { rpc, can, state, errText } from '../api.js';
import { registerPage } from '../register.js';
import { icon, esc, fdate, modal, toast, formData, busy, today } from '../ui.js';
import { activeStaff, staffOptions } from '../staff.js';

export const LEAD_STATUSES = ['new', 'contacted', 'follow_up', 'qualified', 'quotation_sent', 'converted', 'lost'];
export const SERVICES = ['sea', 'air', 'sourcing', 'clearing', 'warehousing', 'door', 'other'];
export const SOURCES = ['walk_in', 'phone', 'whatsapp', 'referral', 'social', 'website', 'existing', 'other'];
const SVC_TXT = (v) => (SERVICES.includes(v) ? t('svc_' + v) : v);
export const svcLabel = (v) => (v ? SVC_TXT(v) : '—');
export const srcLabel = (v) => (v ? (SOURCES.includes(v) ? t('src_' + v) : v) : '—');
const BADGE = { new: 's-booked', contacted: 's-received_dubai', follow_up: 's-pending_deposit', qualified: 's-in_transit',
  quotation_sent: 's-packed', converted: 's-ready', lost: 's-cancelled' };
export const leadBadge = (s) => `<span class="badge ${BADGE[s] || ''}">${esc(t('ls_' + s))}</span>`;

export function leadForm(l = {}, staff = [], { assign = false } = {}) {
  const opt = (list, cur, lbl) => `<option value="">—</option>` + list.map((v) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${esc(lbl(v))}</option>`).join('');
  return `<form class="form" id="lead-form" novalidate>
    <p class="hint full">${esc(t('lead_min_hint'))}</p>
    <div class="field full"><label class="req">${esc(t('customer_or_company'))}</label><input class="input" name="customer_name" required value="${esc(l.customer_name)}" autocomplete="off"></div>
    <div class="field"><label>${esc(t('contact_person'))}</label><input class="input" name="contact_person" value="${esc(l.contact_person)}"></div>
    <div class="field"><label class="req">${esc(t('phone'))}</label><input class="input" name="phone" type="tel" inputmode="tel" value="${esc(l.phone)}" placeholder="+255… / +971…"></div>
    <div class="field"><label>${esc(t('email'))}</label><input class="input" name="email" type="email" inputmode="email" value="${esc(l.email)}"></div>
    <div class="field"><label>${esc(t('country'))}</label><input class="input" name="country" value="${esc(l.country)}" list="hc-countries">
      <datalist id="hc-countries"><option value="Tanzania"><option value="UAE"><option value="Kenya"><option value="Uganda"><option value="Rwanda"><option value="Burundi"><option value="DR Congo"><option value="Zambia"><option value="Malawi"><option value="China"></datalist></div>
    <div class="field"><label class="req">${esc(t('service_interested'))}</label><select class="input" name="service">${opt(SERVICES, l.service, (v) => t('svc_' + v))}</select></div>
    <div class="field"><label>${esc(t('lead_source'))}</label><select class="input" name="source">${opt(SOURCES, l.source, (v) => t('src_' + v))}</select></div>
    <div class="field full"><label>${esc(t('requirement'))}</label><textarea class="input" name="description" rows="3">${esc(l.description)}</textarea></div>
    <div class="field"><label>${esc(t('follow_up_date'))}</label><input class="input" name="follow_up_date" type="date" value="${esc(l.follow_up_date || '')}"></div>
    ${assign ? `<div class="field"><label>${esc(t('assigned_to'))}</label><select class="input" name="assigned_to">${staffOptions(staff, l.assigned_to)}</select></div>` : ''}
    <div class="field full"><label>${esc(t('notes'))}</label><textarea class="input" name="notes" rows="2">${esc(l.notes)}</textarea></div>
  </form>`;
}

export function checkLead(d) {
  if (!d.customer_name?.trim()) return t('customer_or_company');
  if (!d.phone?.trim() && !d.email?.trim()) return `${t('phone')} / ${t('email')}`;
  if (!d.service && !d.description?.trim()) return `${t('service_interested')} / ${t('requirement')}`;
  return null;
}

export async function newLeadModal(prefill = {}) {
  const staff = can('lead.assign') ? await activeStaff() : [];
  const token = crypto.randomUUID();
  modal({
    title: t('new_lead'), wide: true,
    body: leadForm(prefill, staff, { assign: can('lead.assign') }),
    foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="lead-save">${icon('check')}${esc(t('save'))}</button>`,
    onMount: (m) => {
      m.el.querySelector('#lead-save').onclick = (e) => busy(e.currentTarget, async () => {
        const d = formData(m.el.querySelector('#lead-form'));
        const missing = checkLead(d);
        if (missing) { toast(`${t('required_fields')}: ${missing}`, 'err'); return; }
        try {
          const l = await rpc('create_lead', { p: { ...d, client_token: token } });
          toast(`${t('lead_saved')} · ${l.lead_number}`);
          m.close();
          location.hash = `#/lead/${l.id}`;
        } catch (err) { toast(errText(err), 'err'); }
      });
    },
  });
}

export async function render({ el, setTitle, query }) {
  setTitle(t('leads'));
  const me = state.profile.id;
  const followDue = (l) => l.follow_up_date && l.follow_up_date <= today() && !['converted', 'lost'].includes(l.status);
  await registerPage({
    el, title: t('leads'), view: 'v_leads', order: ['created_at', false],
    search: ['lead_number', 'customer_name', 'contact_person', 'phone', 'email'], emptyText: t('no_leads'), emptyIcon: 'target',
    actions: can('lead.create') ? `<button class="btn primary" id="new-lead">${icon('plus')}${esc(t('new_lead'))}</button>` : '',
    chips: [
      { key: 'all', label: t('all') },
      { key: 'mine', label: t('mine'), apply: (b) => b.or(`created_by.eq.${me},assigned_to.eq.${me}`) },
      ...LEAD_STATUSES.map((s) => ({ key: s, label: t('ls_' + s), apply: (b) => b.eq('status', s) })),
    ],
    head: [esc(t('lead_number')), esc(t('customer_or_company')), esc(t('phone')), esc(t('service_interested')), esc(t('status')), esc(t('assigned_to')), esc(t('follow_up_date'))],
    row: (l) => [`<b class="mono">${esc(l.lead_number)}</b><div class="muted small">${fdate(l.lead_date)} · ${esc(l.created_by_name || '')}</div>`,
      `<b>${esc(l.customer_name)}</b>${l.contact_person ? `<div class="muted small">${esc(l.contact_person)}</div>` : ''}`,
      `<span class="nowrap">${esc(l.phone || '')}</span>${l.email ? `<div class="muted small">${esc(l.email)}</div>` : ''}`,
      esc(svcLabel(l.service)), leadBadge(l.status), esc(l.assigned_to_name || t('unassigned')),
      l.follow_up_date ? `<span class="${followDue(l) ? 'due-flag' : ''}">${fdate(l.follow_up_date)}</span>` : '—'],
    card: (l) => `<a class="lc" href="#/lead/${l.id}"><div class="top"><b>${esc(l.customer_name)}</b>${leadBadge(l.status)}</div>
      <div class="sub mono">${esc(l.lead_number)} · ${esc(l.phone || l.email || '')}</div>
      <div class="sub">${esc(svcLabel(l.service))} · ${esc(l.assigned_to_name || t('unassigned'))}${l.follow_up_date ? ` · <span class="${followDue(l) ? 'due-flag' : ''}">${esc(t('follow_up_date'))}: ${fdate(l.follow_up_date)}</span>` : ''}</div></a>`,
    href: (l) => `#/lead/${l.id}`,
  });
  const nb = el.querySelector('#new-lead');
  if (nb) nb.onclick = () => newLeadModal();
  if (query.get('new') === '1' && nb) newLeadModal();
}
