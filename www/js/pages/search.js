// Global search across the records this user is allowed to see (server-side permission checks).
import { t } from '../i18n.js';
import { rpc, errText } from '../api.js';
import { icon, esc, debounce, empty, $ } from '../ui.js';

const ICON = { shipment: 'box', grn: 'scale', invoice: 'file', packing_list: 'clipboard', lead: 'target', sourcing: 'globe', customer: 'users' };

export async function render({ el, setTitle, query }) {
  setTitle(t('search'));
  el.innerHTML = `
    <div class="page-head"><div class="grow"><h1>${esc(t('search'))}</h1></div></div>
    <div class="card"><div class="card-b">
      <div class="search">${icon('search')}<input class="input" id="gq" type="search" autocomplete="off" placeholder="${esc(t('global_search_ph'))}" aria-label="${esc(t('search'))}"></div>
    </div><div id="gres"></div></div>`;
  const input = $('#gq', el); const out = $('#gres', el);
  let seq = 0;
  const run = async () => {
    const q = input.value.trim(); const n = ++seq;
    history.replaceState(null, '', `#/search${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    if (q.length < 2) { out.innerHTML = `<div class="card-b muted small">${esc(t('type_two_chars'))}</div>`; return; }
    out.innerHTML = `<div class="card-b"><div class="spinner"></div></div>`;
    try {
      const rows = await rpc('global_search', { p_q: q });
      if (n !== seq) return;
      if (!rows.length) { out.innerHTML = empty(t('nothing_here'), 'search'); return; }
      const groups = [...new Set(rows.map((r) => r.type))];
      out.innerHTML = groups.map((g) => `<div class="search-group"><div class="nav-label" style="padding:10px 14px 4px">${esc(t('rt_' + g))}</div>
        ${rows.filter((r) => r.type === g).map((r) => `<a class="lc row" style="gap:12px" href="${esc(r.route)}"><span style="width:22px;display:inline-grid">${icon(ICON[g] || 'list')}</span>
          <span style="min-width:0"><b class="${['customer', 'lead'].includes(g) ? '' : 'mono'}">${esc(r.title)}</b><div class="sub">${esc(r.subtitle || '')}</div></span></a>`).join('')}</div>`).join('');
    } catch (err) { out.innerHTML = `<div class="card-b"><div class="callout danger">${icon('alert')}<div>${esc(errText(err))}</div></div></div>`; }
  };
  input.addEventListener('input', debounce(run, 300));
  input.value = query.get('q') || '';
  input.focus();
  await run();
}
