import { t, getLang } from '../i18n.js';
const getLangLabel = (c) => (getLang() === 'sw' ? c.label_sw : c.label_en);
import { from, run, rpc, isAdmin, can, state, errText } from '../api.js';
import { icon, esc, fdate, fdatetime, modal, toast, formData, busy, empty, $, $$, confirmDialog } from '../ui.js';

// Roles the administrator may still hand out. Finance Manager and Viewer are
// deliberately missing: whoever holds one keeps it and keeps working, but
// nobody new is put on them. The database enforces the same list.
// v6: the eight operational roles (+ the technical administrator). Older roles are
// retired from new assignment but keep working for whoever still holds them.
let ROLES = ['admin', 'manager', 'operations', 'hr', 'accountant', 'logistics', 'sales_marketing', 'sourcing', 'customer_care'];
const RETIRED = ['counter', 'warehouse', 'cashier', 'release_officer', 'finance_manager', 'viewer'];

const PERM_HINT = {
  'payment.record': 'perm_payment_record',
  'payment.void': 'perm_payment_void',
  'currency.set': 'perm_currency_set',
  'charge.add': 'perm_charge_add',
  'acc.read': 'perm_acc_read',
  'acc.write': 'perm_acc_write',
};

export async function render({ el, setTitle, query, rerender }) {
  setTitle(t('users'));
  const admin = isAdmin();
  if (!admin && !can('staff.read')) { el.innerHTML = `<div class="callout danger">${icon('lock')}<div>${esc(errText({ message: 'NOT_ALLOWED:' }))}</div></div>`; return; }
  let tab = admin ? (['access', 'invites', 'perms'].includes(query.get('tab')) ? query.get('tab') : 'staff') : 'staff';
  let roleFilter = ''; let nameFilter = '';

  const [rows, grants, invites, assignable, grantable] = await Promise.all([
    run(from('profiles').select('*').order('active', { ascending: false }).order('full_name')),
    admin ? run(from('v_permission_grants').select('*').order('granted_at', { ascending: false }).limit(100)) : [],
    admin ? run(from('staff_invites').select('*').is('cancelled_at', null).order('invited_at', { ascending: false })).catch(() => []) : [],
    rpc('assignable_roles').catch(() => ROLES),
    admin ? rpc('grantable_permissions').catch(() => Object.keys(PERM_HINT)) : [],
  ]);
  ROLES = assignable;
  const live = grants.filter((g) => g.is_active);

  el.innerHTML = `
  <div class="page-head">
    <div class="grow"><h1>${esc(admin ? t('users') : t('staff_directory'))}</h1><p>${esc(admin ? t('users_sub') : '')}</p></div>
    ${admin ? `<div class="row">
      <button class="btn primary" id="invite">${icon('plus')}${esc(t('add_staff'))}</button>
    </div>` : ''}
  </div>
  <div class="chips ${admin ? '' : 'hidden'}" id="tabs" style="margin-bottom:14px">
    <button class="chip" data-tab="staff">${esc(t('staff'))} <span class="muted">${rows.filter((r) => r.active).length}</span></button>
    <button class="chip" data-tab="access">${esc(t('special_access'))}${live.length ? ` <span class="pill">${live.length}</span>` : ''}</button>
    <button class="chip" data-tab="perms">${esc(t('role_permissions'))}</button>
    <button class="chip" data-tab="invites">${esc(t('pending_invites'))}${invites.filter((i) => !i.accepted_at).length ? ` <span class="pill">${invites.filter((i) => !i.accepted_at).length}</span>` : ''}</button>
  </div>
  <div id="pane"></div>`;

  const paint = () => {
    $$('#tabs .chip', el).forEach((c) => c.classList.toggle('on', c.dataset.tab === tab));
    if (tab === 'perms') { permsPane($('#pane', el)); return; }
    $('#pane', el).innerHTML = tab === 'staff' ? staffPane(filtered()) : tab === 'access' ? accessPane(grants, live) : invitePane(invites);
    if (tab === 'staff') wireFilters();
  };
  const filtered = () => rows.filter((u) => (!roleFilter || u.role === roleFilter)
    && (!nameFilter || `${u.full_name} ${u.email} ${u.phone || ''}`.toLowerCase().includes(nameFilter)));
  const presentRoles = [...new Set([...ROLES.filter((r) => r !== 'admin'), ...rows.map((r) => r.role)])];
  const wireFilters = () => {
    const rf = $('#role-filter', el); const nf = $('#name-filter', el);
    if (rf) rf.onchange = () => { roleFilter = rf.value; const list = $('#staff-list', el); list.outerHTML = staffTable(filtered()); };
    if (nf) nf.oninput = () => { nameFilter = nf.value.trim().toLowerCase(); const list = $('#staff-list', el); list.outerHTML = staffTable(filtered()); };
  };

  // ───────── role permissions (admin edits the matrix; the database enforces it) ─────────
  const permsPane = async (host) => {
    host.innerHTML = `<div class="card card-b"><div class="spinner"></div></div>`;
    const [catalog, matrix] = await Promise.all([
      run(from('permission_catalog').select('*').order('sort')),
      run(from('role_permissions').select('*')),
    ]);
    const editable = presentRoles.filter((r) => r !== 'admin');
    let role = editable.includes('manager') ? 'manager' : editable[0];
    const modules = [...new Set(catalog.map((c) => c.module))];
    const paintPerms = () => {
      const have = new Set(matrix.filter((m) => m.role === role).map((m) => m.permission));
      host.querySelector('#perm-grid').innerHTML = modules.map((mod) => `<fieldset class="perm-group"><legend>${esc(t('m_' + mod))}</legend>
        ${catalog.filter((c) => c.module === mod).map((c) => `<label class="perm-row"><input type="checkbox" data-perm="${esc(c.permission)}" ${have.has(c.permission) ? 'checked' : ''}>
          <span>${esc(getLangLabel(c))}<span class="muted small mono"> ${esc(c.permission)}</span></span></label>`).join('')}</fieldset>`).join('');
    };
    host.innerHTML = `<div class="callout info">${icon('shield')}<div class="small">${esc(t('role_permissions_help'))}</div></div>
      <div class="card" style="margin-top:14px"><div class="card-h"><div class="field" style="min-width:220px"><label for="perm-role">${esc(t('role'))}</label>
        <select class="input" id="perm-role">${editable.map((r) => `<option value="${r}" ${r === role ? 'selected' : ''}>${esc(t('r_' + r))}${RETIRED.includes(r) ? ' · ' + esc(t('role_retired')) : ''}</option>`).join('')}</select></div></div>
        <div class="card-b perm-grid" id="perm-grid"></div></div>`;
    host.querySelector('#perm-role').onchange = (e) => { role = e.target.value; paintPerms(); };
    host.querySelector('#perm-grid').addEventListener('change', async (e) => {
      const cb = e.target.closest('[data-perm]'); if (!cb) return;
      cb.disabled = true;
      try {
        await rpc('admin_set_role_permission', { p_role: role, p_permission: cb.dataset.perm, p_enabled: cb.checked });
        if (cb.checked) matrix.push({ role, permission: cb.dataset.perm });
        else { const i = matrix.findIndex((m) => m.role === role && m.permission === cb.dataset.perm); if (i >= 0) matrix.splice(i, 1); }
        toast(t('saved'));
      } catch (err) { cb.checked = !cb.checked; toast(errText(err), 'err'); }
      finally { cb.disabled = false; }
    });
    paintPerms();
  };

  // ───────── staff ─────────
  const staffPane = (list) => `
    ${admin ? `<div class="callout info">${icon('shield')}<div class="small">${esc(t('segregation_note'))}</div></div>` : ''}
    <div class="row staff-filters" style="margin-top:14px;gap:10px;flex-wrap:wrap">
      <div class="search" style="flex:1;min-width:200px;max-width:360px">${icon('search')}<input class="input" id="name-filter" type="search" placeholder="${esc(t('search'))}" aria-label="${esc(t('search'))}" value="${esc(nameFilter)}"></div>
      <select class="input" id="role-filter" aria-label="${esc(t('filter_role'))}" style="max-width:240px"><option value="">${esc(t('all_roles'))}</option>
        ${presentRoles.map((r) => `<option value="${r}" ${r === roleFilter ? 'selected' : ''}>${esc(t('r_' + r))}</option>`).join('')}</select>
    </div>
    ${staffTable(list)}`;
  const staffTable = (list) => `
    <div class="card" id="staff-list" style="margin-top:14px"><div class="table-wrap cards-m"><table class="t"><thead><tr>
      <th>${esc(t('name'))}</th><th>${esc(t('role'))}</th><th>${esc(t('branch'))}</th>
      <th>${esc(t('status'))}</th><th class="hide-m">${esc(t('special_access'))}</th><th class="hide-m">${esc(t('created'))}</th></tr></thead>
    <tbody>${list.map((u) => {
      const mine = live.filter((g) => g.user_id === u.id);
      return `<tr class="${admin ? 'click' : ''}" data-id="${u.id}">
        <td><b>${esc(u.full_name || '—')}</b><div class="muted small">${esc(u.email)}</div></td>
        <td>${esc(t('r_' + u.role))}${RETIRED.includes(u.role) ? ` <span class="badge s-pending_deposit" title="${esc(t('role_retired_hint'))}">${esc(t('role_retired'))}</span>` : ''}</td>
        <td>${esc(u.branch_code || '—')}</td>
        <td>${u.active ? `<span class="badge s-ready">${esc(t('active'))}</span>` : `<span class="badge s-cancelled">${esc(t('inactive'))}</span>`}</td>
        <td class="hide-m small">${mine.length ? mine.map((g) => `<span class="badge s-booked">${esc(t('p_' + g.permission.replace('.', '_')))}</span>`).join(' ') : '<span class="muted">—</span>'}</td>
        <td class="hide-m muted small">${fdate(u.created_at)}</td></tr>`;
    }).join('')}</tbody></table></div>
    <div class="list-cards">${list.map((u) => `<div class="lc ${admin ? 'click' : ''}" data-id="${u.id}"><div class="top"><b>${esc(u.full_name || u.email)}</b>
      ${u.active ? `<span class="badge s-ready">${esc(t('active'))}</span>` : `<span class="badge s-cancelled">${esc(t('inactive'))}</span>`}</div>
      <div class="sub">${esc(t('r_' + u.role))}${RETIRED.includes(u.role) ? ` · ${esc(t('role_retired'))}` : ''}${u.branch_code ? ' · ' + esc(u.branch_code) : ''}</div>
      <div class="sub">${esc(u.email || '')}${u.phone ? ' · ' + esc(u.phone) : ''}</div></div>`).join('') || `<div class="lc muted">${esc(t('nothing_here'))}</div>`}</div></div>`;

  // ───────── special access ─────────
  const accessPane = (all, active) => `
    <div class="callout info">${icon('key')}<div class="small">${esc(t('special_access_help'))}</div></div>
    <div class="row" style="margin:14px 0"><button class="btn primary" id="grant">${icon('plus')}${esc(t('grant_access'))}</button></div>
    ${all.length ? `<div class="card"><div class="table-wrap"><table class="t"><thead><tr>
        <th>${esc(t('staff_member'))}</th><th>${esc(t('permission'))}</th><th>${esc(t('expires'))}</th>
        <th>${esc(t('granted_by'))}</th><th>${esc(t('reason'))}</th><th></th></tr></thead>
      <tbody>${all.map((g) => `<tr class="${g.is_active ? '' : 'void-row'}">
        <td><b>${esc(g.user_name || g.user_email)}</b><div class="muted small">${esc(t('r_' + g.user_role))}</div></td>
        <td>${esc(t('p_' + g.permission.replace('.', '_')))}</td>
        <td class="small">${g.revoked_at ? `<span class="badge s-cancelled">${esc(t('revoked'))}</span> <span class="muted">${fdatetime(g.revoked_at)}</span>`
            : g.expires_at ? (new Date(g.expires_at) < new Date()
                ? `<span class="badge s-cancelled">${esc(t('expired'))}</span>`
                : `<span class="badge s-ready">${esc(t('active'))}</span> <span class="muted">${fdatetime(g.expires_at)}</span>`)
            : `<span class="badge s-ready">${esc(t('no_expiry'))}</span>`}</td>
        <td class="small">${esc(g.granted_by_name || '—')}<div class="muted small">${fdate(g.granted_at)}</div></td>
        <td class="small">${esc(g.reason || '')}${g.revoke_reason ? `<div class="muted small">${esc(t('revoked'))}: ${esc(g.revoke_reason)}</div>` : ''}</td>
        <td class="num">${g.is_active ? `<button class="btn small danger" data-revoke="${g.id}">${esc(t('revoke'))}</button>` : ''}</td>
      </tr>`).join('')}</tbody></table></div></div>`
      : empty(t('no_special_access'), 'key')}`;

  // ───────── invites ─────────
  const invitePane = (list) => list.length ? `
    <div class="card"><div class="table-wrap"><table class="t"><thead><tr>
      <th>${esc(t('email'))}</th><th>${esc(t('role'))}</th><th>${esc(t('branch'))}</th><th>${esc(t('status'))}</th><th></th></tr></thead>
    <tbody>${list.map((i) => `<tr>
      <td><b>${esc(i.email)}</b><div class="muted small">${esc(i.full_name || '')}</div></td>
      <td>${esc(t('r_' + i.role))}</td><td>${esc(i.branch_code || '—')}</td>
      <td>${i.accepted_at ? `<span class="badge s-ready">${esc(t('joined'))}</span>` : `<span class="badge s-booked">${esc(t('waiting_signup'))}</span>`}</td>
      <td class="num">${i.accepted_at ? '' : `<button class="btn small danger" data-cancel="${i.id}">${esc(t('cancel'))}</button>`}</td>
    </tr>`).join('')}</tbody></table></div>
    <div class="card-b muted small">${esc(t('invite_help'))}</div></div>` : empty(t('no_invites'), 'users');

  // ───────── actions ─────────
  $('#tabs', el).onclick = (e) => { const c = e.target.closest('.chip'); if (!c) return; tab = c.dataset.tab; paint(); };
  if (admin) $('#invite', el).onclick = () => inviteModal(rerender);

  el.addEventListener('click', async (e) => {
    const g = e.target.closest('#grant');
    if (g) { grantModal(rows.filter((r) => r.active && r.role !== 'admin'), grantable, rerender); return; }

    const rv = e.target.closest('[data-revoke]');
    if (rv) {
      const reason = await confirmDialog(t('revoke_confirm'), { okText: t('revoke'), danger: true, withReason: true, reasonLabel: t('reason') });
      if (!reason) return;
      try { await rpc('revoke_permission', { p_grant: rv.dataset.revoke, p_reason: reason }); toast(t('access_revoked')); rerender(); }
      catch (err) { toast(errText(err), 'err'); }
      return;
    }

    const cx = e.target.closest('[data-cancel]');
    if (cx) {
      if (!(await confirmDialog(t('cancel_invite_confirm'), { okText: t('cancel_invite'), danger: true }))) return;
      try { await rpc('admin_cancel_invite', { p_id: cx.dataset.cancel }); toast(t('saved')); rerender(); }
      catch (err) { toast(errText(err), 'err'); }
      return;
    }

    const tr = e.target.closest('tr[data-id], .lc[data-id]');
    if (tr && admin) staffModal(rows.find((x) => x.id === tr.dataset.id), live, rerender);
  });

  paint();
}

// ───────── modals ─────────
function roleOptions(current) {
  const list = [...ROLES];
  if (current && !list.includes(current)) list.unshift(current);   // keep a retired role visible on its holder
  return list.map((r) => `<option value="${r}" ${current === r ? 'selected' : ''}>${esc(t('r_' + r))}${RETIRED.includes(r) ? ' · ' + t('role_retired') : ''}</option>`).join('');
}

function inviteModal(after) {
  modal({
    title: t('add_staff'),
    body: `<p class="muted">${esc(t('invite_help'))}</p>
      <form class="form" id="inv" novalidate>
        <div class="field full"><label class="req">${esc(t('email'))}</label><input class="input" name="email" type="email" required autocomplete="off"></div>
        <div class="field"><label>${esc(t('full_name'))}</label><input class="input" name="full_name"></div>
        <div class="field"><label class="req">${esc(t('role'))}</label><select class="input" name="role">${roleOptions('customer_care')}</select></div>
        <div class="field"><label>${esc(t('branch'))}</label><select class="input" name="branch_code"><option value="">—</option>
          ${state.branches.map((b) => `<option value="${b.code}">${esc(b.code)} · ${esc(b.name)}</option>`).join('')}</select></div>
      </form>`,
    foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="iv">${icon('check')}${esc(t('save'))}</button>`,
    onMount: (m) => {
      m.el.querySelector('#iv').onclick = (ev) => busy(ev.currentTarget, async () => {
        const d = formData(m.el.querySelector('#inv'));
        if (!d.email) { toast(t('required_fields'), 'err'); return; }
        try {
          await rpc('admin_invite_staff', { p_email: d.email, p_full_name: d.full_name || null, p_role: d.role, p_branch: d.branch_code || null });
          m.close(); toast(t('invite_created')); after();
        } catch (err) { toast(errText(err), 'err'); }
      });
    },
  });
}

function staffModal(u, live, after) {
  if (!u) return;
  const self = u.id === state.profile.id;
  const mine = live.filter((g) => g.user_id === u.id);
  modal({
    title: u.full_name || u.email,
    body: `<form class="form" id="uf" novalidate>
      <div class="field full"><label>${esc(t('email'))}</label><input class="input" readonly value="${esc(u.email)}"></div>
      <div class="field"><label>${esc(t('full_name'))}</label><input class="input" name="full_name" value="${esc(u.full_name || '')}"></div>
      <div class="field"><label>${esc(t('phone'))}</label><input class="input" name="phone" value="${esc(u.phone || '')}"></div>
      <div class="field"><label>${esc(t('role'))}</label>
        <select class="input" name="role" ${self ? 'disabled' : ''}>${roleOptions(u.role)}</select>
        ${RETIRED.includes(u.role) ? `<div class="hint">${esc(t('role_retired_hint'))}</div>` : ''}</div>
      <div class="field"><label>${esc(t('branch'))}</label><select class="input" name="branch_code"><option value="">—</option>
        ${state.branches.map((b) => `<option value="${b.code}" ${u.branch_code === b.code ? 'selected' : ''}>${esc(b.code)} · ${esc(b.name)}</option>`).join('')}</select></div>
      <label class="row small full"><input type="checkbox" name="active" ${u.active ? 'checked' : ''} ${self ? 'disabled' : ''}> ${esc(t('active'))}</label>
      ${self ? `<div class="hint full">${esc(t('cannot_change_self'))}</div>` : ''}
      ${mine.length ? `<div class="full"><div class="lbl">${esc(t('special_access'))}</div>
        ${mine.map((g) => `<div class="small">${esc(t('p_' + g.permission.replace('.', '_')))} · ${g.expires_at ? esc(t('until')) + ' ' + fdatetime(g.expires_at) : esc(t('no_expiry'))}</div>`).join('')}
        <div class="hint">${esc(t('deactivate_revokes'))}</div></div>` : ''}
    </form>`,
    foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="us">${icon('check')}${esc(t('save'))}</button>`,
    onMount: (m) => {
      m.el.querySelector('#us').onclick = (ev) => busy(ev.currentTarget, async () => {
        const d = formData(m.el.querySelector('#uf'));
        const p = { id: u.id, full_name: d.full_name, phone: d.phone, branch_code: d.branch_code || null };
        if (!self) { p.role = d.role; p.active = !!d.active; }
        try { await rpc('admin_save_staff', { p }); m.close(); toast(t('saved')); after(); }
        catch (err) { toast(errText(err), 'err'); }
      });
    },
  });
}

function grantModal(staff, grantable, after) {
  const hours = [{ h: 8, k: 'today_only' }, { h: 24, k: 'one_day' }, { h: 72, k: 'three_days' }, { h: 168, k: 'one_week' }, { h: 0, k: 'no_expiry' }];
  modal({
    title: t('grant_access'),
    body: `<p class="muted">${esc(t('grant_help'))}</p>
      <form class="form" id="gf" novalidate>
        <div class="field full"><label class="req">${esc(t('staff_member'))}</label>
          <select class="input" name="user_id">${staff.map((s) => `<option value="${s.id}">${esc(s.full_name || s.email)} · ${esc(t('r_' + s.role))}</option>`).join('')}</select></div>
        <div class="field full"><label class="req">${esc(t('permission'))}</label>
          <select class="input" name="permission">${grantable.map((p) => `<option value="${p}">${esc(t('p_' + p.replace('.', '_')))}</option>`).join('')}</select>
          <div class="hint" id="ph"></div></div>
        <div class="field"><label class="req">${esc(t('expires'))}</label>
          <select class="input" name="hours">${hours.map((h) => `<option value="${h.h}" ${h.h === 24 ? 'selected' : ''}>${esc(t(h.k))}</option>`).join('')}</select></div>
        <div class="field"><label class="req">${esc(t('reason'))}</label><input class="input" name="reason" placeholder="${esc(t('grant_reason_ph'))}"></div>
      </form>`,
    foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="gs">${icon('key')}${esc(t('grant_access'))}</button>`,
    onMount: (m) => {
      const sel = m.el.querySelector('[name=permission]');
      const hint = () => { m.el.querySelector('#ph').textContent = t(PERM_HINT[sel.value] || 'perm_generic'); };
      sel.onchange = hint; hint();
      m.el.querySelector('#gs').onclick = (ev) => busy(ev.currentTarget, async () => {
        const d = formData(m.el.querySelector('#gf'));
        if (!d.reason?.trim()) { toast(t('grant_reason_required'), 'err'); return; }
        const h = Number(d.hours);
        try {
          await rpc('grant_permission', {
            p_user: d.user_id, p_permission: d.permission,
            p_expires: h ? new Date(Date.now() + h * 3600e3).toISOString() : null,
            p_reason: d.reason.trim(),
          });
          m.close(); toast(t('access_granted')); after();
        } catch (err) { toast(errText(err), 'err'); }
      });
    },
  });
}
