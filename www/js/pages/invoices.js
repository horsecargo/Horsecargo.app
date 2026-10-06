import { t } from '../i18n.js';
import { registerPage } from '../register.js';
import { esc, money, fdate, icon } from '../ui.js';
import { payBadge } from './shipments.js';

export async function render({ el, setTitle }) {
  setTitle(t('invoices'));
  await registerPage({
    el, title: t('invoices'), sub: t('invoices_sub'), view: 'v_invoice_register', order: ['issued_at', false],
    search: ['ref', 'shipment_ref', 'customer_name', 'customer_phone'], emptyIcon: 'file',
    chips: [
      { key: 'issued', label: t('all'), apply: (b) => b.eq('status', 'issued') },
      { key: 'unpaid', label: t('balance'), apply: (b) => b.eq('status', 'issued').gt('balance_txn', 0.009) },
    ],
    head: [esc(t('invoice')), esc(t('shipment')), esc(t('customer')), `<span class="num">${esc(t('total'))}</span>`, `<span class="num">${esc(t('paid'))}</span>`, `<span class="num">${esc(t('balance'))}</span>`, ''],
    row: (r) => [`<b class="mono">${esc(r.ref)}</b><div class="muted small">${fdate(r.issued_at)}</div>`,
      `<span class="mono">${esc(r.shipment_ref)}</span>`, esc(r.customer_name || '—'),
      `<span class="num nowrap">${money(r.total_txn, r.currency)}</span>`, `<span class="num nowrap">${money(r.paid_txn, r.currency)}</span>`,
      `<span class="num nowrap" style="${Number(r.balance_txn) > 0.009 ? 'color:var(--red);font-weight:700' : ''}">${money(r.balance_txn, r.currency)}</span><div class="right">${payBadge(r.payment_status)}</div>`,
      `<a class="icon-btn" href="#/doc/invoice/${r.shipment_id}" title="${esc(t('print'))}">${icon('print')}</a>`],
    card: (r) => `<a class="lc" href="#/doc/invoice/${r.shipment_id}"><div class="top"><b class="mono">${esc(r.ref)}</b><span class="num">${money(r.total_txn, r.currency)}</span></div>
      <div class="sub mono">${esc(r.shipment_ref)} · ${fdate(r.issued_at)}</div>
      <div class="sub">${esc(r.customer_name || '')} · ${esc(t('balance'))}: <b style="${Number(r.balance_txn) > 0.009 ? 'color:var(--red)' : ''}">${money(r.balance_txn, r.currency)}</b></div></a>`,
    href: (r) => `#/doc/invoice/${r.shipment_id}`,
  });
}
