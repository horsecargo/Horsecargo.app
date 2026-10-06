import { t } from '../i18n.js';
import { registerPage } from '../register.js';
import { esc, num, fdatetime, fdate, statusBadge, icon } from '../ui.js';

export async function render({ el, setTitle }) {
  setTitle(t('grn_register'));
  await registerPage({
    el, title: t('grn_register'), sub: t('grn_register_sub'), view: 'v_grn_register', order: ['received_at', false],
    search: ['ref', 'shipment_ref', 'customer_name', 'receiver_name'], emptyIcon: 'scale',
    head: ['GRN', esc(t('shipment')), esc(t('customer')), `<span class="num">${esc(t('pieces'))}</span>`, '<span class="num">CBM</span>', `<span class="num">kg</span>`, esc(t('received_by')), ''],
    row: (r) => [`<b class="mono">${esc(r.ref)}</b><div class="muted small">${fdatetime(r.received_at)}</div>`,
      `<span class="mono">${esc(r.shipment_ref)}</span><div>${statusBadge(r.shipment_status)}</div>`, esc(r.customer_name || '—'),
      `<span class="num">${num(r.pieces, 0)}</span>`, `<span class="num">${r.total_cbm ? num(r.total_cbm, 3) : '—'}</span>`,
      `<span class="num">${r.total_kg ? num(r.total_kg, 1) : '—'}</span>`, esc(r.received_by_name || '—'),
      `<span class="nowrap"><a class="icon-btn" href="#/doc/grn/${r.shipment_id}" title="${esc(t('print'))}">${icon('print')}</a><a class="icon-btn" href="#/doc/labels/${r.shipment_id}" title="${esc(t('print_labels'))}">${icon('tag')}</a></span>`],
    card: (r) => `<a class="lc" href="#/doc/grn/${r.shipment_id}"><div class="top"><b class="mono">${esc(r.ref)}</b><span>${statusBadge(r.shipment_status)}</span></div>
      <div class="sub mono">${esc(r.shipment_ref)} · ${fdate(r.received_at)}</div>
      <div class="sub">${esc(r.customer_name || '')} · ${num(r.pieces, 0)} pcs${r.total_cbm ? ` · ${num(r.total_cbm, 3)} CBM` : ''}${r.total_kg ? ` · ${num(r.total_kg, 1)} kg` : ''}</div></a>`,
    href: (r) => `#/doc/grn/${r.shipment_id}`,
  });
}
