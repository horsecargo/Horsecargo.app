// Shared list ("register") page: search box, optional filter chips, a table on
// desktop and stacked cards on phones, newest first, "load more" paging.
import { t } from './i18n.js';
import { from, run } from './api.js';
import { icon, esc, debounce, empty, $ } from './ui.js';

const PAGE = 50;

/**
 * cfg = { el, title, sub, view, order:[col,asc], search:[cols], chips:[{key,label,apply(q)}],
 *         head:[html...], row(r)->[html...], card(r)->html, href(r), actions:html, emptyText, emptyIcon, base(q) }
 */
export async function registerPage(cfg) {
  const { el } = cfg;
  let q = ''; let chip = cfg.chips?.find((c) => c.key === cfg.initialChip)?.key || cfg.chips?.[0]?.key || null; let rows = []; let offset = 0;
  el.innerHTML = `
    <div class="page-head"><div class="grow"><h1>${esc(cfg.title)}</h1>${cfg.sub ? `<p>${esc(cfg.sub)}</p>` : ''}</div>${cfg.actions || ''}</div>
    <div class="card">
      <div class="card-h reg-tools">
        <div class="search" style="flex:1;min-width:200px;max-width:420px">${icon('search')}<input class="input" id="reg-q" type="search" placeholder="${esc(t('search'))}" aria-label="${esc(t('search'))}"></div>
        ${cfg.chips ? `<div class="chips" id="reg-chips">${cfg.chips.map((c) => `<button class="chip" data-chip="${c.key}">${esc(c.label)}</button>`).join('')}</div>` : ''}
      </div>
      <div id="reg-list"><div class="card-b"><div class="spinner"></div></div></div>
      <div class="card-b hidden" id="reg-more-wrap" style="text-align:center"><button class="btn" id="reg-more">${esc(t('load_more'))}</button></div>
    </div>`;

  const paintChips = () => el.querySelectorAll('[data-chip]').forEach((b) => b.classList.toggle('on', b.dataset.chip === chip));
  const draw = (count) => {
    const list = $('#reg-list', el);
    if (!rows.length) { list.innerHTML = empty(cfg.emptyText || t('nothing_here'), cfg.emptyIcon || 'list'); $('#reg-more-wrap', el).classList.add('hidden'); return; }
    list.innerHTML = `
      <div class="table-wrap cards-m"><table class="t"><thead><tr>${cfg.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr class="${cfg.href ? 'click' : ''}" ${cfg.href ? `data-href="${esc(cfg.href(r))}"` : ''}>${cfg.row(r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="list-cards">${rows.map((r) => cfg.card(r)).join('')}</div>`;
    $('#reg-more-wrap', el).classList.toggle('hidden', rows.length >= count);
  };
  const load = async (reset = true) => {
    if (reset) { offset = 0; rows = []; }
    let b = from(cfg.view).select('*', { count: 'exact' }).order(cfg.order[0], { ascending: !!cfg.order[1] }).range(offset, offset + PAGE - 1);
    if (cfg.base) b = cfg.base(b);
    const c = cfg.chips?.find((x) => x.key === chip);
    if (c?.apply) b = c.apply(b);
    if (q && cfg.search?.length) {
      const s = q.replace(/[,()%*]/g, ' ').trim();
      if (s) b = b.or(cfg.search.map((col) => `${col}.ilike.%${s}%`).join(','));
    }
    try {
      const { data, count } = await run(b);
      rows = rows.concat(data); offset += data.length;
      draw(count);
    } catch (err) {
      $('#reg-list', el).innerHTML = `<div class="card-b"><div class="callout danger">${icon('alert')}<div>${esc(err.message || err)}</div></div></div>`;
    }
  };
  el.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a,button')) { location.hash = tr.dataset.href; return; }
    const c = e.target.closest('[data-chip]');
    if (c) { chip = c.dataset.chip; paintChips(); load(); }
  });
  $('#reg-q', el).addEventListener('input', debounce((e) => { q = e.target.value.trim(); load(); }, 300));
  $('#reg-more', el).onclick = () => load(false);
  paintChips();
  await load();
  return { reload: () => load() };
}
