import { t } from '../i18n.js';
import { registerPage } from '../register.js';
import { esc, num, fdate, statusBadge, icon, modeTag } from '../ui.js';

// Cargo labels come right after the GRN: one label per received piece.
export async function render({ el, setTitle }) {
  setTitle(t('cargo_labels'));
  await registerPage({
    el, title: t('cargo_labels'), sub: t('labels_sub'), view: 'v_label_register', order: ['received_at', false],
    search: ['shipment_ref', 'grn_ref', 'customer_name', 'receiver_name'], emptyIcon: 'tag',
    head: [esc(t('shipment')), 'GRN', esc(t('receiver')), esc(t('route')), `<span class="num">${esc(t('pieces'))}</span>`, ''],
    row: (r) => [`<b class="mono">${esc(r.shipment_ref)}</b><div>${statusBadge(r.shipment_status)}</div>`,
      `<span class="mono">${esc(r.grn_ref)}</span><div class="muted small">${fdate(r.received_at)}</div>`,
      `${esc(r.receiver_name || '—')}<div class="muted small">${esc(r.customer_name || '')}</div>`,
      `${modeTag(r.mode)} <span class="mono">${esc(r.origin_branch)} → ${esc(r.destination_branch)}</span>`,
      `<span class="num">${num(r.pieces, 0)}</span>`,
      `<a class="btn sm primary" href="#/doc/labels/${r.shipment_id}">${icon('tag')}${esc(t('print_labels'))}</a>`],
    card: (r) => `<div class="lc"><div class="top"><b class="mono">${esc(r.shipment_ref)}</b><span>${num(r.pieces, 0)} pcs</span></div>
      <div class="sub">${esc(r.receiver_name || '')} · ${esc(r.origin_branch)} → ${esc(r.destination_branch)} · GRN ${esc(r.grn_ref)}</div>
      <div class="row" style="margin-top:8px"><a class="btn sm primary" href="#/doc/labels/${r.shipment_id}">${icon('tag')}${esc(t('print_labels'))}</a>
      <a class="btn sm" href="#/shipment/${r.shipment_id}">${esc(t('shipment'))}</a></div></div>`,
    href: (r) => `#/doc/labels/${r.shipment_id}`,
  });
}
