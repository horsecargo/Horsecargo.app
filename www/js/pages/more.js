import { t } from '../i18n.js';
import { state } from '../api.js';
import { icon, esc } from '../ui.js';
import { mailBadge } from '../mailbadge.js';
import { navGroups, navTools, groupedMenu, openMenuGroup } from '../navigation.js';

export async function render({ el, setTitle, query }) {
  setTitle(t('more'));
  const p = state.profile;
  el.innerHTML = `
  <div class="card" style="margin-bottom:14px"><a class="lc" href="#/profile" style="display:flex;gap:12px;align-items:center">
    <span style="width:42px;height:42px;border-radius:50%;background:var(--brand);color:#fff;display:grid;place-items:center;font-weight:700">${esc((p.full_name || p.email || '?').slice(0, 1).toUpperCase())}</span>
    <div><b>${esc(p.full_name || p.email)}</b><div class="sub">${esc(t('r_' + p.role))}${p.branch_code ? ' · ' + esc(p.branch_code) : ''}</div></div></a></div>
  <div class="page-head"><div class="grow"><h1>${esc(t('nav_workspace'))}</h1><p>${esc(t('nav_workspace_sub'))}</p></div></div>
  <nav class="card grouped-menu workspace-menu" aria-label="${esc(t('nav_workspace'))}">${groupedMenu(navGroups(), 'mobile')}</nav>
  <div class="card workspace-tools"><div class="card-h"><h2>${esc(t('nav_tools'))}</h2></div>
    ${navTools().map((i) => `<a class="lc row" style="gap:12px" href="${i.href}" data-nav="${i.key}">${icon(i.ic)}<span>${esc(t(i.label || i.key))}</span>${i.key === 'staff_mail' ? mailBadge() : ''}</a>`).join('')}
    <a class="lc row" style="gap:12px" href="#/profile">${icon('user')}<span>${esc(t('profile'))}</span></a>
    <a class="lc row" style="gap:12px" href="track.html" target="_blank" rel="noopener"><span style="width:22px;display:inline-grid">${icon('search')}</span>${esc(t('track_cargo'))}</a>
    <button class="lc row btn ghost" style="gap:12px;width:100%;justify-content:flex-start;border-radius:0;color:var(--red)" data-logout><span style="width:22px;display:inline-grid">${icon('logout')}</span>${esc(t('logout'))}</button>
  </div>`;
  openMenuGroup(el.querySelector('.grouped-menu'), query.get('section'));
}
