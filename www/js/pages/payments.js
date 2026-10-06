import { t } from '../i18n.js';
import { registerPage } from '../register.js';
import { esc, money, usd, fdatetime, icon } from '../ui.js';

export async function render({ el, setTitle }) {
  setTitle(t('payments'));
  await registerPage({
    el, title: t('payments'), sub: t('payments_sub'), view: 'v_receipts', order: ['received_at', false],
    search: ['ref', 'shipment_ref', 'customer_name', 'reference'], emptyIcon: 'money',
    head: [esc(t('receipt') || 'Receipt'), esc(t('shipment')), esc(t('customer')), esc(t('method')), `<span class="num">${esc(t('amount'))}</span>`, '<span class="num">USD</span>', ''],
    row: (r) => [`<b class="mono" style="${r.void ? 'text-decoration:line-through' : ''}">${esc(r.ref)}</b>${r.void ? ' <span class="badge s-cancelled">VOID</span>' : ''}<div class="muted small">${fdatetime(r.received_at)} · ${esc(r.received_by_name || '')}</div>`,
      `<span class="mono">${esc(r.shipment_ref)}</span>`, esc(r.customer_name || '—'), esc(t('m_' + r.method)),
      `<span class="num nowrap">${money(r.amount, r.currency)}</span>`, `<span class="num">${usd(r.amount_usd)}</span>`,
      `<a class="icon-btn" href="#/doc/receipt/${r.id}" title="${esc(t('print'))}">${icon('print')}</a>`],
    card: (r) => `<a class="lc" href="#/doc/receipt/${r.id}" style="${r.void ? 'opacity:.55' : ''}"><div class="top"><b class="mono">${esc(r.ref)}</b><span class="num">${money(r.amount, r.currency)}</span></div>
      <div class="sub mono">${esc(r.shipment_ref)} · ${fdatetime(r.received_at)}</div><div class="sub">${esc(r.customer_name || '')} · ${esc(t('m_' + r.method))}${r.void ? ' · VOID' : ''}</div></a>`,
    href: (r) => `#/doc/receipt/${r.id}`,
  });
}
