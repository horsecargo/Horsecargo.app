import { t } from '../i18n.js';
import { from, run, rpc, can, canAny, state, errText } from '../api.js';
import { icon, esc, fdate, fdatetime, modal, toast, formData, busy, empty, today } from '../ui.js';
import { activeStaff, staffOptions } from '../staff.js';
import { leadBadge, leadForm, checkLead, svcLabel, srcLabel, LEAD_STATUSES } from './leads.js';
import { sourcingBadge, sourcingForm, checkSourcing } from './sourcing.js';

export async function render({ el, params, setTitle, rerender }) {
  const id = params[0];
  const l = await run(from('v_leads').select('*').eq('id', id).maybeSingle());
  if (!l) {
    el.innerHTML = `<div class="card card-b"><div class="callout danger">${icon('lock')}<div>${esc(t('not_found'))}</div></div>
      <div style="margin-top:12px"><a class="btn" href="#/leads">${esc(t('back'))}</a></div></div>`;
    return;
  }
  setTitle(l.lead_number);
  const [events, sourcing] = await Promise.all([
    run(from('v_lead_events').select('*').eq('lead_id', id).order('at', { ascending: false })),
    run(from('v_sourcing').select('*').eq('lead_id', id).order('created_at', { ascending: false })).catch(() => []),
  ]);
  const me = state.profile.id;
  const mayWork = can('lead.read') || l.created_by === me || l.assigned_to === me;
  const open = l.status !== 'converted';
  const due = l.follow_up_date && l.follow_up_date <= today() && !['converted', 'lost'].includes(l.status);

  const A = [];
  if (mayWork && open) A.push(`<button class="btn" data-act="status">${icon('refresh')}${esc(t('change_status'))}</button>`);
  if (mayWork) A.push(`<button class="btn" data-act="follow">${icon('clock')}${esc(t('add_follow_up'))}</button>`);
  if (can('lead.assign')) A.push(`<button class="btn" data-act="assign">${icon('user')}${esc(t('assign'))}</button>`);
  if (can('sourcing.write')) A.push(`<button class="btn" data-act="sourcing">${icon('globe')}${esc(t('create_sourcing_request'))}</button>`);
  if (can('lead.convert') && open) A.push(`<button class="btn accent" data-act="convert">${icon('users')}${esc(t('convert_to_customer'))}</button>`);

  const EV = (e) => {
    if (e.kind === 'status' || e.kind === 'converted') return `${esc(t('ls_' + (e.from_status || 'new')))} → ${esc(t('ls_' + e.to_status))}`;
    if (e.kind === 'assigned') return esc(e.to_name || t('unassigned'));
    if (e.kind === 'sourcing') return `<a class="mono" href="#/sourcing/${esc(e.details?.sourcing_id)}">${esc(e.details?.sourcing_number || '')}</a>`;
    if (e.kind === 'note' && e.details?.follow_up_date) return `${esc(t('follow_up_date'))}: ${fdate(e.details.follow_up_date)}`;
    return '';
  };

  el.innerHTML = `
  <div class="page-head">
    <div class="grow">
      <div class="row" style="gap:8px">${leadBadge(l.status)}${due ? ` <span class="badge s-pending_deposit">${esc(t('follow_up_due'))}</span>` : ''}</div>
      <h1 style="margin-top:4px">${esc(l.customer_name)}</h1>
      <p class="mono">${esc(l.lead_number)} · ${fdate(l.lead_date)}</p>
    </div>
    <div class="row wrap-actions">${A.join('')}${mayWork ? `<button class="btn" data-act="edit">${icon('gear')}${esc(t('edit'))}</button>` : ''}</div>
  </div>
  ${l.status === 'converted' && l.customer_id ? `<div class="callout ok" style="margin-bottom:14px">${icon('check')}<div>${esc(t('ev_converted'))}: <a href="#/customer/${l.customer_id}"><b class="mono">${esc(l.customer_code || '')}</b></a> · ${fdatetime(l.converted_at)}</div></div>` : ''}
  <div class="split">
    <div class="stack">
      <div class="card"><div class="card-h"><h2>${esc(t('details'))}</h2></div><div class="card-b"><dl class="kv">
        <dt>${esc(t('contact_person'))}</dt><dd>${esc(l.contact_person || '—')}</dd>
        <dt>${esc(t('phone'))}</dt><dd>${l.phone ? `<a href="tel:${esc(l.phone)}">${esc(l.phone)}</a>` : '—'}</dd>
        <dt>${esc(t('email'))}</dt><dd>${l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : '—'}</dd>
        <dt>${esc(t('country'))}</dt><dd>${esc(l.country || '—')}</dd>
        <dt>${esc(t('service_interested'))}</dt><dd>${esc(svcLabel(l.service))}</dd>
        <dt>${esc(t('lead_source'))}</dt><dd>${esc(srcLabel(l.source))}</dd>
        <dt>${esc(t('requirement'))}</dt><dd class="pre">${esc(l.description || '—')}</dd>
        <dt>${esc(t('follow_up_date'))}</dt><dd>${l.follow_up_date ? fdate(l.follow_up_date) : '—'}</dd>
        <dt>${esc(t('notes'))}</dt><dd class="pre">${esc(l.notes || '—')}</dd>
      </dl></div></div>
      ${sourcing.length || canAny('sourcing.read', 'sourcing.write') ? `<div class="card"><div class="card-h"><h2>${esc(t('linked_sourcing'))}</h2></div>
        ${sourcing.length ? sourcing.map((r) => `<a class="lc" href="#/sourcing/${r.id}"><div class="top"><b class="mono">${esc(r.sourcing_number)}</b>${sourcingBadge(r.status)}</div>
          <div class="sub">${esc(r.product)}${r.quantity ? ` · ${esc(r.quantity)} ${esc(r.unit || '')}` : ''}</div></a>`).join('') : empty(t('nothing_here'), 'globe')}
      </div>` : ''}
    </div>
    <div class="stack">
      <div class="card"><div class="card-h"><h2>${esc(t('assigned_to'))}</h2></div><div class="card-b"><dl class="kv">
        <dt>${esc(t('assigned_to'))}</dt><dd><b>${esc(l.assigned_to_name || t('unassigned'))}</b></dd>
        <dt>${esc(t('created_by_label'))}</dt><dd>${esc(l.created_by_name || '—')}<div class="muted small">${fdatetime(l.created_at)}</div></dd>
        <dt>${esc(t('last_updated'))}</dt><dd>${fdatetime(l.updated_at)}</dd>
      </dl></div></div>
      <div class="card"><div class="card-h"><h2>${esc(t('lead_history'))}</h2></div><div class="card-b">
        <ol class="tl">${events.map((e) => `<li><b>${esc(t('ev_' + e.kind))}</b> <span class="small">${EV(e)}</span>
          <div class="muted small">${fdatetime(e.at)}${e.actor_name ? ' · ' + esc(e.actor_name) : ''}</div>
          ${e.note ? `<div class="small pre">${esc(e.note)}</div>` : ''}</li>`).join('')}</ol>
      </div></div>
    </div>
  </div>`;

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'edit') {
      modal({
        title: `${t('edit')} · ${l.lead_number}`, wide: true, body: leadForm(l),
        foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="ls">${icon('check')}${esc(t('save'))}</button>`,
        onMount: (m) => { m.el.querySelector('#ls').onclick = (ev) => busy(ev.currentTarget, async () => {
          const d = formData(m.el.querySelector('#lead-form'));
          const missing = checkLead(d); if (missing) { toast(`${t('required_fields')}: ${missing}`, 'err'); return; }
          try { await rpc('update_lead', { p: { id, ...d } }); m.close(); toast(t('lead_saved')); rerender(); } catch (err) { toast(errText(err), 'err'); }
        }); },
      });
    }
    if (a === 'status') {
      modal({
        title: t('change_status'),
        body: `<form class="form" id="sf"><div class="field full"><label>${esc(t('status'))}</label><select class="input" name="status">
          ${LEAD_STATUSES.filter((s) => s !== 'converted').map((s) => `<option value="${s}" ${s === l.status ? 'selected' : ''}>${esc(t('ls_' + s))}</option>`).join('')}</select></div>
          <div class="field full"><label>${esc(t('notes'))}</label><textarea class="input" name="note" rows="2"></textarea></div></form>`,
        foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="ss">${icon('check')}${esc(t('save'))}</button>`,
        onMount: (m) => { m.el.querySelector('#ss').onclick = (ev) => busy(ev.currentTarget, async () => {
          const d = formData(m.el.querySelector('#sf'));
          try { await rpc('set_lead_status', { p_lead: id, p_status: d.status, p_note: d.note }); m.close(); toast(t('saved')); rerender(); } catch (err) { toast(errText(err), 'err'); }
        }); },
      });
    }
    if (a === 'follow') {
      modal({
        title: t('add_follow_up'),
        body: `<form class="form" id="ff"><div class="field full"><label>${esc(t('notes'))}</label><textarea class="input" name="note" rows="3"></textarea></div>
          <div class="field"><label>${esc(t('follow_up_date'))}</label><input class="input" type="date" name="date" value="${esc(l.follow_up_date || '')}"></div></form>`,
        foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="fs">${icon('check')}${esc(t('save'))}</button>`,
        onMount: (m) => { m.el.querySelector('#fs').onclick = (ev) => busy(ev.currentTarget, async () => {
          const d = formData(m.el.querySelector('#ff'));
          try { await rpc('add_lead_follow_up', { p_lead: id, p_note: d.note, p_follow_up: d.date }); m.close(); toast(t('saved')); rerender(); } catch (err) { toast(errText(err), 'err'); }
        }); },
      });
    }
    if (a === 'assign') {
      const staff = await activeStaff();
      modal({
        title: t('assign'),
        body: `<form class="form" id="af"><div class="field full"><label>${esc(t('assigned_to'))}</label><select class="input" name="user">${staffOptions(staff, l.assigned_to)}</select></div>
          <div class="field full"><label>${esc(t('notes'))}</label><input class="input" name="note"></div></form>`,
        foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="as">${icon('check')}${esc(t('save'))}</button>`,
        onMount: (m) => { m.el.querySelector('#as').onclick = (ev) => busy(ev.currentTarget, async () => {
          const d = formData(m.el.querySelector('#af'));
          try { await rpc('assign_lead', { p_lead: id, p_user: d.user, p_note: d.note }); m.close(); toast(t('saved')); rerender(); } catch (err) { toast(errText(err), 'err'); }
        }); },
      });
    }
    if (a === 'convert') busy(b, () => convert());
    if (a === 'sourcing') {
      const staff = await activeStaff();
      const token = crypto.randomUUID();
      modal({
        title: t('create_sourcing_request'), wide: true,
        body: `<div class="callout info" style="margin-bottom:12px">${icon('target')}<div><b class="mono">${esc(l.lead_number)}</b> · ${esc(l.customer_name)}</div></div>
          ${sourcingForm({ description: l.description }, staff)}`,
        foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="srs">${icon('check')}${esc(t('save'))}</button>`,
        onMount: (m) => { m.el.querySelector('#srs').onclick = (ev) => busy(ev.currentTarget, async () => {
          const d = formData(m.el.querySelector('#src-form'));
          const missing = checkSourcing(d, true); if (missing) { toast(`${t('required_fields')}: ${missing}`, 'err'); return; }
          try {
            const r = await rpc('create_sourcing', { p: { ...d, lead_id: id, client_token: token } });
            m.close(); toast(`${t('sourcing_saved')} · ${r.sourcing_number}`); location.hash = `#/sourcing/${r.id}`;
          } catch (err) { toast(errText(err), 'err'); }
        }); },
      });
    }
  });

  async function convert(choice = {}) {
    try {
      const r = await rpc('convert_lead', { p_lead: id, p_customer: choice.customer || null, p_create_new: !!choice.createNew });
      if (r.status === 'converted') { toast(t('converted_ok')); rerender(); return; }
      const phoneMatch = r.matches.some((x) => x.match === 'phone');
      const m = modal({
        title: t('convert_to_customer'),
        body: `<p>${esc(t('matches_found'))}</p>
          <div class="stack" style="gap:8px">${r.matches.map((c) => `<div class="card card-b row" style="justify-content:space-between;gap:10px">
            <div><b>${esc(c.name)}</b> <span class="mono small">${esc(c.code)}</span><div class="muted small">${esc(c.phone || '')}${c.email ? ' · ' + esc(c.email) : ''} · ${esc(c.match === 'phone' ? t('phone') : t('email'))}</div></div>
            <button class="btn sm primary" data-use="${c.id}">${esc(t('use_this_customer'))}</button></div>`).join('')}</div>
          ${phoneMatch ? `<p class="muted small" style="margin-top:12px">${esc(t('phone_match_note'))}</p>` : ''}`,
        foot: `<button class="btn" data-close>${esc(t('cancel'))}</button>${phoneMatch ? '' : `<button class="btn" id="cnew">${esc(t('create_new_customer'))}</button>`}`,
        onMount: (mm) => {
          mm.el.addEventListener('click', (ev) => {
            const u = ev.target.closest('[data-use]');
            if (u) busy(u, async () => { mm.close(); await convert({ customer: u.dataset.use }); });
          });
          const n = mm.el.querySelector('#cnew');
          if (n) n.onclick = () => busy(n, async () => { mm.close(); await convert({ createNew: true }); });
        },
      });
      return m;
    } catch (err) { toast(errText(err), 'err'); }
    return null;
  }
}
