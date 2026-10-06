// One navigation catalogue for desktop, mobile More and role-specific shortcuts.
// This only organises existing pages; RPC/RLS permissions remain authoritative.
import { can, canAny, isAdmin, state } from './api.js';
import { t } from './i18n.js';
import { icon, esc } from './ui.js';

export function navGroups() {
  const accounting = can('acc.read') && state.companies.length > 0;
  const groups = [
    { key: 'dashboard', label: 'dashboard', ic: 'dashboard', href: '#/' },
    { key: 'sales', label: 'nav_sales', short: 'nav_sales_short', ic: 'users', sections: [{ items: [
      { key: 'customers', href: '#/customers', ic: 'users', show: can('customer.read') },
      { key: 'leads', href: '#/leads', ic: 'target', show: canAny('lead.create', 'lead.read') },
      { key: 'sourcing', href: '#/sourcing', ic: 'globe', show: canAny('sourcing.read', 'sourcing.write') },
    ] }] },
    { key: 'cargo', label: 'nav_cargo', short: 'nav_cargo_short', ic: 'box', sections: [{ items: [
      { key: 'shipments', href: '#/shipments', ic: 'box', show: can('shipment.read') },
      { key: 'grn_register', href: '#/grn', ic: 'scale', show: can('grn.read') },
      { key: 'cargo_labels', href: '#/labels', ic: 'tag', show: can('label.read') },
      { key: 'storage', href: '#/storage', ic: 'warehouse', show: can('storage.read') },
      { key: 'packing_list', href: '#/packing-list', ic: 'clipboard', show: can('packing.read') },
    ] }] },
    { key: 'finance', label: 'nav_finance', ic: 'money', sections: [
      { label: 'nav_overview', items: [{ key: 'acc', href: '#/acc', ic: 'money', show: accounting }] },
      { label: 'nav_customer_accounts', items: [
        { key: 'invoices', href: '#/invoices', ic: 'file', show: can('invoice.read') },
        { key: 'payments', href: '#/payments', ic: 'receipt', show: can('payment.read') },
      ] },
      { label: 'nav_costs_suppliers', items: [
        { key: 'acc_bills', href: '#/acc/bills', ic: 'list', show: accounting },
        { key: 'acc_expenses', href: '#/acc/expenses', ic: 'truck', show: accounting },
        { key: 'acc_suppliers', href: '#/acc/suppliers', ic: 'users', show: accounting },
      ] },
      { label: 'nav_accounts', items: [
        { key: 'acc_money', href: '#/acc/money', ic: 'shield', show: accounting },
        { key: 'acc_journals', href: '#/acc/journals', ic: 'scale', show: accounting },
        { key: 'acc_coa', href: '#/acc/coa', ic: 'tag', show: accounting },
      ] },
    ] },
    { key: 'reporting', label: 'reports', ic: 'chart', sections: [{ items: [
      { key: 'reports', label: 'nav_operational_reports', href: '#/reports', ic: 'chart', show: can('reports.read') },
      { key: 'acc_reports', href: '#/acc/reports', ic: 'chart', show: accounting },
    ] }] },
    { key: 'administration', label: 'nav_administration', short: 'nav_admin_short', ic: 'gear', sections: [{ items: [
      { key: 'users', href: '#/users', ic: 'users', show: isAdmin() || can('staff.read') },
      { key: 'rates', href: '#/rates', ic: 'tag', show: can('rates.write') },
      { key: 'audit', href: '#/audit', ic: 'shield', show: can('audit.read') },
      { key: 'settings', href: '#/settings', ic: 'gear', show: can('settings.write') },
    ] }] },
  ];
  return groups.map((g) => g.href ? g : {
    ...g, sections: g.sections.map((s) => ({ ...s, items: s.items.filter((i) => i.show) })).filter((s) => s.items.length),
  }).filter((g) => g.href || g.sections.length);
}

export const groupItems = (g) => g.sections?.flatMap((s) => s.items) || [];
export function navTools() {
  return [
    { key: 'scan', href: '#/scan', ic: 'scan', show: can('scan.use') },
    { key: 'staff_mail', label: 'mail_short', href: '#/mail', ic: 'mail', show: can('mail.use') },
  ].filter((i) => i.show);
}

export function groupForNav(key) {
  return navGroups().find((g) => g.key === key || groupItems(g).some((i) => i.key === key))?.key || null;
}

export function primaryGroup() {
  const role = state.profile?.role;
  const order = ['accountant', 'finance_manager', 'cashier'].includes(role) ? ['finance', 'cargo', 'sales']
    : role === 'hr' ? ['administration', 'sales', 'cargo']
    : ['sales_marketing', 'sourcing', 'customer_care', 'counter'].includes(role) ? ['sales', 'cargo', 'finance']
    : ['cargo', 'sales', 'finance', 'administration'];
  const groups = navGroups();
  return order.map((key) => groups.find((g) => g.key === key)).find(Boolean) || groups.find((g) => !g.href);
}

// Native disclosure buttons: one open group, no nested dropdowns.
export function groupedMenu(groups, surface) {
  const link = (i) => `<a href="${i.href}" data-nav="${i.key}">${icon(i.ic)}<span>${esc(t(i.label || i.key))}</span></a>`;
  return groups.map((g) => {
    if (g.href) return link(g);
    const id = `${surface}-group-${g.key}`;
    return `<div class="menu-group" data-group="${g.key}">
      <button type="button" class="menu-group-toggle" data-menu-group="${g.key}" aria-expanded="false" aria-controls="${id}">
        ${icon(g.ic)}<span>${esc(t(g.label))}</span><span class="menu-chevron" aria-hidden="true">›</span>
      </button>
      <div class="menu-group-links" id="${id}" hidden>${g.sections.map((s) =>
        `${s.label ? `<div class="menu-section-label">${esc(t(s.label))}</div>` : ''}${s.items.map(link).join('')}`).join('')}</div>
    </div>`;
  }).join('');
}

export function openMenuGroup(root, key) {
  if (!root) return;
  root.querySelectorAll('[data-menu-group]').forEach((button) => {
    const open = button.dataset.menuGroup === key;
    button.setAttribute('aria-expanded', String(open));
    const panel = root.querySelector(`#${button.getAttribute('aria-controls')}`);
    if (panel) panel.hidden = !open;
  });
}

export function quickActions() {
  const actions = [
    { key: 'new_shipment', href: '#/shipments/new', ic: 'box', show: can('shipment.create') },
    { key: 'new_lead', href: '#/leads?new=1', ic: 'target', show: can('lead.create') },
    { key: 'nav_follow_ups', href: '#/leads?filter=follow_up', ic: 'clock', show: canAny('lead.create', 'lead.read') },
    { key: 'nav_receive_cargo', href: '#/shipments', ic: 'scale', show: can('grn.record') && can('shipment.read') },
    { key: 'nav_pack_cargo', href: '#/packing-list', ic: 'boxes', show: can('storage.pack') && can('packing.read') },
    { key: 'record_payment', href: '#/shipments', ic: 'money', show: can('payment.record') && can('shipment.read') },
    { key: 'acc_expenses', href: '#/acc/expenses', ic: 'truck', show: can('acc.write') && can('acc.read') && state.companies.length > 0 },
    { key: 'invoices', href: '#/invoices', ic: 'file', show: can('invoice.read') },
    { key: 'new_customer', href: '#/customers?new=1', ic: 'users', show: can('customer.write') && can('customer.read') },
    { key: 'new_sourcing', href: '#/sourcing?new=1', ic: 'globe', show: can('sourcing.write') },
    { key: 'users', href: '#/users', ic: 'users', show: isAdmin() || can('staff.read') },
    { key: 'compose', href: '#/mail?compose=1', ic: 'mail', show: can('mail.use') },
    { key: 'scan', href: '#/scan', ic: 'scan', show: can('scan.use') },
  ].filter((i) => i.show);
  const role = state.profile?.role;
  const priority = ['accountant', 'finance_manager', 'cashier'].includes(role)
    ? ['record_payment', 'acc_expenses', 'invoices', 'new_lead']
    : ['logistics', 'operations', 'warehouse', 'release_officer'].includes(role)
      ? ['nav_receive_cargo', 'nav_pack_cargo', 'new_shipment', 'scan']
      : role === 'hr' ? ['users', 'compose', 'new_lead']
        : ['sales_marketing', 'customer_care', 'counter'].includes(role)
          ? ['new_lead', 'nav_follow_ups', 'new_customer', 'new_sourcing']
          : role === 'sourcing' ? ['new_sourcing', 'nav_follow_ups', 'new_lead']
            : ['new_shipment', 'new_lead', 'record_payment', 'nav_receive_cargo', 'nav_pack_cargo'];
  return actions.map((i, index) => ({ ...i, rank: priority.includes(i.key) ? priority.indexOf(i.key) : priority.length + index }))
    .sort((a, b) => a.rank - b.rank).slice(0, 6);
}
