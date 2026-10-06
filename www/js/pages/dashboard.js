import { t, tr } from '../i18n.js';
import { rpc, state, can } from '../api.js';
import { icon, esc, usd, num, ago } from '../ui.js';

const PIPE = [
  ['received_dubai', '#2463b8'], ['packed', '#6a48b8'], ['dispatched', '#4b43b8'], ['in_transit', '#1f6f95'],
  ['in_customs', '#a2561a'], ['arrived', '#16777a'], ['delivered', '#1d8a55'],
];

export async function render({ el, setTitle }) {
  setTitle(t('dashboard'));
  const d = await rpc('dashboard_stats');
  const bs = d.by_status || {};
  const first = (state.profile.full_name || '').split(' ')[0];
  const money = d.outstanding_usd !== undefined;
  el.innerHTML = `
  <div class="page-head">
    <div class="grow"><h1>${esc(t('good_morning'))}${first ? ', ' + esc(first) : ''}</h1><p>${esc(t('dash_sub'))}</p></div>
    <div class="row">
      ${can('shipment.create') ? `<a class="btn primary" href="#/shipments/new">${icon('plus')}${esc(t('new_shipment'))}</a>` : ''}
      ${can('lead.create') ? `<a class="btn" href="#/leads?new=1">${icon('target')}${esc(t('new_lead'))}</a>` : ''}
      ${can('scan.use') ? `<a class="btn" href="#/scan">${icon('scan')}${esc(t('scan'))}</a>` : ''}
    </div>
  </div>
  <div class="stack">
    ${money || can('shipment.read') ? `<div class="grid c4">
      <div class="card kpi"><div class="k">${esc(t('in_dubai'))}</div><div class="v">${num(d.cbm_in_dubai, 2)} <small style="font-size:13px">CBM</small></div><div class="s">${(bs.received_dubai || 0) + (bs.packed || 0)} ${esc(t('shipments').toLowerCase())}${d.kg_in_dubai ? ` · ${num(d.kg_in_dubai, 0)} kg` : ''}</div></div>
      ${money ? `<div class="card kpi ${Number(d.outstanding_usd) > 0 ? 'alert' : ''}"><div class="k">${esc(t('outstanding'))}</div><div class="v">${usd(d.outstanding_usd)}</div><div class="s">${esc(t('awaiting_payment'))}</div></div>
      <div class="card kpi"><div class="k">${esc(t('collected_today'))}</div><div class="v">${usd(d.collected_today_usd)}</div><div class="s">USD equiv.</div></div>
      <div class="card kpi"><div class="k">${esc(t('collected_month'))}</div><div class="v">${usd(d.collected_month_usd)}</div><div class="s">USD equiv.</div></div>` : ''}
    </div>` : ''}

    <div class="card">
      <div class="card-h"><h2>${esc(t('cargo_pipeline'))}</h2><a class="small" href="#/shipments">${esc(t('view'))} →</a></div>
      <div class="card-b"><div class="pipeline">
        ${PIPE.map(([s, c]) => `<a class="pipe" href="#/shipments?status=${s}"><span class="bar" style="background:${c}"></span><div class="n">${bs[s] || 0}</div><div class="l">${esc(t('st_' + s))}</div></a>`).join('')}
      </div></div>
    </div>

    <div class="split">
      <div class="card">
        <div class="card-h"><h2>${esc(t('recent_activity'))}</h2></div>
        <div class="card-b">
          ${(d.recent_events || []).length ? `<ul class="timeline">${d.recent_events.map((e) => `
            <li><div class="tt"><a class="mono" href="#/search?q=${encodeURIComponent(e.shipment_ref)}">${esc(e.shipment_ref)}</a> · ${esc(tr(e.title))}</div>
            ${e.note ? `<div class="tn">${esc(tr(e.note))}</div>` : ''}<div class="tm">${esc(e.location || '')} · ${esc(ago(e.created_at))}</div></li>`).join('')}</ul>`
            : `<div class="empty">${icon('clock')}<div>${esc(t('nothing_here'))}</div></div>`}
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-h"><h2>${esc(t('today'))}</h2><a class="small" href="#/shipments">${esc(t('view'))} →</a></div>
          <div class="card-b grid c2" style="gap:10px">
            <a class="pipe" href="#/shipments"><span class="bar" style="background:#800C1F"></span><div class="n">${d.shipments_today || 0}</div><div class="l">${esc(t('new_shipments_today'))}</div></a>
            <a class="pipe" href="#/shipments?status=delivered"><span class="bar" style="background:#1d8a55"></span><div class="n">${bs.delivered || 0}</div><div class="l">${esc(t('st_delivered'))}</div></a>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h2>${esc(t('quick_actions'))}</h2></div>
          <div class="card-b stack" style="gap:8px">
            ${can('shipment.create') ? `<a class="btn" style="justify-content:flex-start" href="#/shipments/new">${icon('box')}${esc(t('new_shipment'))}</a>` : ''}
            ${can('customer.write') ? `<a class="btn" style="justify-content:flex-start" href="#/customers?new=1">${icon('users')}${esc(t('new_customer'))}</a>` : ''}
            ${can('lead.create') ? `<a class="btn" style="justify-content:flex-start" href="#/leads?new=1">${icon('target')}${esc(t('new_lead'))}</a>` : ''}
            ${can('sourcing.write') ? `<a class="btn" style="justify-content:flex-start" href="#/sourcing?new=1">${icon('globe')}${esc(t('new_sourcing'))}</a>` : ''}
            ${can('mail.use') ? `<a class="btn" style="justify-content:flex-start" href="#/mail?compose=1">${icon('mail')}${esc(t('compose'))}</a>` : ''}
                        <a class="btn" style="justify-content:flex-start" href="track.html" target="_blank" rel="noopener">${icon('search')}${esc(t('track_cargo'))}</a>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}
