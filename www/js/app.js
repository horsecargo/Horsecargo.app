import { t, getLang, setLang } from './i18n.js';
import { sb, configured, state, loadSession, loadReference, errText, can, canAny, isAdmin } from './api.js';
import { refreshMailBadge, mailBadge } from './mailbadge.js';
import { icon, esc, toast, $ } from './ui.js';

// [pattern, page module, nav key, permission(s) required — any of them]
// Detail pages without a permission rely on the database to refuse what the user may not see.
const ROUTES = [
  [/^\/?$/, 'dashboard', 'dashboard'],
  [/^\/shipments\/new$/, 'shipment-new', 'shipments', 'shipment.create'],
  [/^\/shipments$/, 'shipments', 'shipments', 'shipment.read'],
  [/^\/shipment\/([\w-]+)\/edit$/, 'shipment-new', 'shipments', 'shipment.edit'],
  [/^\/shipment\/([\w-]+)\/grn$/, 'grn', 'grn_register', 'grn.record'],
  [/^\/shipment\/([\w-]+)$/, 'shipment', 'shipments'],
  [/^\/grn$/, 'grn-register', 'grn_register', 'grn.read'],
  [/^\/labels$/, 'labels', 'cargo_labels', 'label.read'],
  [/^\/invoices$/, 'invoices', 'invoices', 'invoice.read'],
  [/^\/payments$/, 'payments', 'payments', 'payment.read'],
  [/^\/storage$/, 'storage', 'storage', 'storage.read'],
  [/^\/storage\/([\w-]+)$/, 'storage-shipment', 'storage', 'storage.read'],
  [/^\/packing-list\/([\w-]+)$/, 'packing-list', 'packing_list', 'packing.read'],
  [/^\/packing-list$/, 'packing-list', 'packing_list', 'packing.read'],
  [/^\/customers$/, 'customers', 'customers', 'customer.read'],
  [/^\/customer\/([\w-]+)$/, 'customer', 'customers'],
  [/^\/leads$/, 'leads', 'leads', ['lead.create', 'lead.read']],
  [/^\/lead\/([\w-]+)$/, 'lead', 'leads'],
  [/^\/sourcing$/, 'sourcing', 'sourcing', ['sourcing.read', 'sourcing.write']],
  [/^\/sourcing\/([\w-]+)$/, 'sourcing-item', 'sourcing'],
  [/^\/mail$/, 'mail', 'staff_mail', 'mail.use'],
  [/^\/mail\/([\w-]+)$/, 'mail', 'staff_mail', 'mail.use'],
  [/^\/scan$/, 'scan', 'scan', 'scan.use'],
  [/^\/search$/, 'search', null],
  [/^\/rates$/, 'rates', 'rates'],
  [/^\/reports$/, 'reports', 'reports', 'reports.read'],
  [/^\/users$/, 'users', 'users', ['users.manage', 'staff.read']],
  [/^\/settings$/, 'settings', 'settings'],
  [/^\/profile$/, 'profile', 'profile'],
  [/^\/audit$/, 'audit', 'audit', 'audit.read'],
  [/^\/more$/, 'more', 'more'],
  [/^\/doc\/(\w+)\/([\w-]+)$/, 'doc', null],
  [/^\/acc$/, 'acc', 'acc', 'acc.read'],
  [/^\/acc\/bills$/, 'acc-bills', 'acc_bills', 'acc.read'],
  [/^\/acc\/bills\/new$/, 'acc-bill-new', 'acc_bills', 'acc.read'],
  [/^\/acc\/bill\/([\w-]+)$/, 'acc-bill', 'acc_bills', 'acc.read'],
  [/^\/acc\/expenses$/, 'acc-expenses', 'acc_expenses', 'acc.read'],
  [/^\/acc\/journals$/, 'acc-journals', 'acc_journals', 'acc.read'],
  [/^\/acc\/coa$/, 'acc-coa', 'acc_coa', 'acc.read'],
  [/^\/acc\/account\/(\w+)$/, 'acc-account', 'acc_coa', 'acc.read'],
  [/^\/acc\/money$/, 'acc-money', 'acc_money', 'acc.read'],
  [/^\/acc\/suppliers$/, 'acc-suppliers', 'acc_suppliers', 'acc.read'],
  [/^\/acc\/reports$/, 'acc-reports', 'acc_reports', 'acc.read'],
];
export const routeAllowed = (perm) => !perm || (Array.isArray(perm) ? canAny(...perm) : can(perm));

function navItems() {
  const acc = can('acc.read') && state.companies.length > 0;
  const items = [
    { key: 'dashboard', href: '#/', ic: 'dashboard' },
    { key: 'customers', href: '#/customers', ic: 'users', show: can('customer.read') },
    { key: 'leads', href: '#/leads', ic: 'target', show: canAny('lead.create', 'lead.read') },
    { key: 'sourcing', href: '#/sourcing', ic: 'globe', show: canAny('sourcing.read', 'sourcing.write') },
    { key: 'shipments', href: '#/shipments', ic: 'box', show: can('shipment.read') },
    { key: 'grn_register', href: '#/grn', ic: 'scale', show: can('grn.read') },
    { key: 'cargo_labels', href: '#/labels', ic: 'tag', show: can('label.read') },
    { key: 'invoices', href: '#/invoices', ic: 'file', show: can('invoice.read') },
    { key: 'payments', href: '#/payments', ic: 'receipt', show: can('payment.read') },
    { key: 'storage', href: '#/storage', ic: 'warehouse', show: can('storage.read') },
    { key: 'packing_list', href: '#/packing-list', ic: 'clipboard', show: can('packing.read') },
    { key: 'scan', href: '#/scan', ic: 'scan', show: can('scan.use') },
    { key: 'staff_mail', href: '#/mail', ic: 'mail', show: can('mail.use'), badge: 'mail' },
    { key: 'reports', href: '#/reports', ic: 'chart', show: can('reports.read') },
    { sep: true, label: 'accounting', show: acc },
    { key: 'acc', href: '#/acc', ic: 'money', show: acc },
    { key: 'acc_bills', href: '#/acc/bills', ic: 'list', show: acc },
    { key: 'acc_expenses', href: '#/acc/expenses', ic: 'truck', show: acc },
    { key: 'acc_journals', href: '#/acc/journals', ic: 'scale', show: acc },
    { key: 'acc_reports', href: '#/acc/reports', ic: 'chart', show: acc },
    { key: 'acc_coa', href: '#/acc/coa', ic: 'tag', show: acc },
    { key: 'acc_money', href: '#/acc/money', ic: 'shield', show: acc },
    { key: 'acc_suppliers', href: '#/acc/suppliers', ic: 'users', show: acc },
    { sep: true, label: 'admin' },
    { key: 'users', href: '#/users', ic: 'shield', show: isAdmin() || can('staff.read') },
    { key: 'rates', href: '#/rates', ic: 'tag' },
    { key: 'audit', href: '#/audit', ic: 'list', show: can('audit.read') },
    { key: 'settings', href: '#/settings', ic: 'gear' },
  ];
  return items.filter((i) => i.show !== false);
}
export { navItems };

function langToggle() {
  return `<div class="lang-toggle" role="group" aria-label="${esc(t('language'))}">
    <button data-lang="en" class="${getLang() === 'en' ? 'on' : ''}">EN</button>
    <button data-lang="sw" class="${getLang() === 'sw' ? 'on' : ''}">SW</button></div>`;
}

// phone bottom bar: Home · two permitted modules · Scan (or Mail) · More
function bottomNav() {
  const centre = can('scan.use') ? { key: 'scan', href: '#/scan', ic: 'scan', label: t('scan') }
    : can('mail.use') ? { key: 'staff_mail', href: '#/mail', ic: 'mail', label: t('mail_short') } : null;
  const pool = [
    { key: 'shipments', href: '#/shipments', ic: 'box', ok: can('shipment.read') },
    { key: 'customers', href: '#/customers', ic: 'users', ok: can('customer.read') },
    { key: 'leads', href: '#/leads', ic: 'target', ok: canAny('lead.create', 'lead.read') },
    { key: 'sourcing', href: '#/sourcing', ic: 'globe', ok: canAny('sourcing.read', 'sourcing.write') },
    { key: 'staff_mail', href: '#/mail', ic: 'mail', ok: can('mail.use') },
  ].filter((x) => x.ok && x.key !== centre?.key).slice(0, 2);
  const a = (x) => `<a href="${x.href}" data-nav="${x.key}">${icon(x.ic)}<span>${esc(x.key === 'staff_mail' ? t('mail_short') : t(x.key))}</span>${x.key === 'staff_mail' ? mailBadge() : ''}</a>`;
  return [
    `<a href="#/" data-nav="dashboard">${icon('dashboard')}<span>${esc(t('home'))}</span></a>`,
    pool[0] ? a(pool[0]) : '<span></span>',
    centre ? `<a href="${centre.href}" data-nav="${centre.key}" class="scan"><span class="ic">${icon(centre.ic)}${centre.key === 'staff_mail' ? mailBadge() : ''}</span><span class="tx">${esc(centre.label)}</span></a>` : '<span></span>',
    pool[1] ? a(pool[1]) : '<span></span>',
    `<a href="#/more" data-nav="more">${icon('menu')}<span>${esc(t('more'))}</span></a>`,
  ].join('');
}

function renderShell() {
  const p = state.profile;
  $('#app').innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="side-logo"><img src="img/logo-white.png" alt="Horse Cargo"></div><div class="side-branches">DUBAI · DAR ES SALAAM · MWANZA</div>
      <nav class="nav">${navItems().map((i) => i.sep ? `<div class="sep"></div><div class="nav-label">${esc(t(i.label))}</div>` :
        `<a href="${i.href}" data-nav="${i.key}">${icon(i.ic)}<span>${esc(t(i.key))}</span>${i.badge ? mailBadge() : ''}</a>`).join('')}</nav>
      <div class="side-foot">
        <a href="#/profile" class="who" style="display:block;color:#fff">${esc(p.full_name || p.email)}</a>
        <div class="role">${esc(t('r_' + p.role))}${p.branch_code ? ' · ' + esc(p.branch_code) : ''}</div>
        <div class="row" style="margin-top:10px;justify-content:space-between">${langToggle()}
          <button class="icon-btn" style="color:#f3dde1" data-logout title="${esc(t('logout'))}">${icon('logout')}</button></div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn back-btn hidden" data-back aria-label="${esc(t('back'))}">${icon('arrowLeft')}</button>
        <img class="mobile-brand" src="img/mark-white.png" alt="Horse Cargo">
        <div class="title" id="page-title"></div>
        <a class="icon-btn top-act" href="#/search" title="${esc(t('search'))}" aria-label="${esc(t('search'))}">${icon('search')}</a>
        ${can('mail.use') ? `<a class="icon-btn top-act mail-btn" href="#/mail" title="${esc(t('staff_mail'))}" aria-label="${esc(t('staff_mail'))}">${icon('mail')}${mailBadge()}</a>` : ''}
        <span class="hide-desktop-lang">${langToggle()}</span>
      </header>
      <main class="content" id="page"></main>
    </div>
    <nav class="bottom-nav">${bottomNav()}</nav>
  </div>`;
  // desktop: language toggle lives in sidebar
  const mq = window.matchMedia('(min-width: 861px)');
  const topLang = $('.hide-desktop-lang');
  const apply = () => { topLang.style.display = mq.matches ? 'none' : ''; };
  apply(); mq.addEventListener('change', apply);
}

let currentCleanup = null;
async function route() {
  if (!state.profile) return;
  const path = (location.hash || '#/').slice(1).split('?')[0];
  const query = new URLSearchParams((location.hash.split('?')[1]) || '');
  const match = ROUTES.find(([re]) => re.test(path));
  const old = $('#page');
  if (!old) return;
  const page = old.cloneNode(false); // fresh element → no stale listeners from the previous page
  old.replaceWith(page);
  if (currentCleanup) { try { currentCleanup(); } catch { /* ignore */ } currentCleanup = null; }
  if (!match) { location.hash = '#/'; return; }
  const [re, mod, nav, perm] = match;
  const params = path.match(re).slice(1);
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
  const isRoot = ['dashboard', 'bookings', 'customers', 'shipments', 'scan', 'more', 'leads', 'sourcing', 'search'].includes(mod) || (mod === 'mail' && !params[0]);
  document.querySelector('.back-btn')?.classList.toggle('hidden', isRoot);
  document.querySelector('.mobile-brand')?.classList.toggle('hidden', !isRoot);
  page.innerHTML = `<div class="boot" style="min-height:40vh"><div class="spinner"></div></div>`;
  window.scrollTo(0, 0);
  const setTitle = (s) => { $('#page-title').textContent = s; document.title = `${s} · Horse Cargo`; };
  setTitle(nav ? t(nav) : 'Horse Cargo');
  refreshMailBadge();
  if (!routeAllowed(perm)) {
    page.innerHTML = `<div class="card card-b"><div class="callout danger">${icon('lock')}<div><b>${esc(t('no_access_title'))}</b><br>${esc(t('no_access_body'))}</div></div>
      <div style="margin-top:12px"><a class="btn" href="#/">${esc(t('home'))}</a></div></div>`;
    return;
  }
  try {
    const m = await import(`./pages/${mod}.js`);
    const cleanup = await m.render({ el: page, params, query, setTitle, rerender: route });
    if (typeof cleanup === 'function') currentCleanup = cleanup;
  } catch (e) {
    console.error(e);
    page.innerHTML = `<div class="card card-b"><div class="callout danger">${icon('alert')}<div>${esc(errText(e))}</div></div>
      <div style="margin-top:12px"><button class="btn" onclick="location.reload()">${esc(t('retry'))}</button></div></div>`;
  }
}

// ───────── auth screens ─────────
function renderSetup() {
  $('#app').innerHTML = `<div class="auth-form" style="min-height:100vh"><div class="auth-box card card-b">
    <div class="brand"><img src="icons/icon-192.png" alt=""><div><b>HORSE CARGO</b></div></div>
    <h2>${esc(t('setup_needed'))}</h2><p class="muted">${esc(t('setup_body'))}</p></div></div>`;
}

function loginScene() {
  // Decorative, animated background: flight routes with planes, drifting clouds, sea with a container ship.
  const plane = '<path d="M24 0c0-1.8-2.6-3-5.5-3L-15-2.6-21.5-9h-3.2L-20.6 0l-4.1 9h3.2L-15 2.6 18.5 3C21.4 3 24 1.8 24 0Z"/><path d="M7-2.8-5.5-20h-5l6.3 17.2ZM7 2.8-5.5 20h-5l6.3-17.2Z"/>';
  return `
  <div class="login-scene" aria-hidden="true">
    <div class="cloud c1"></div><div class="cloud c2"></div><div class="cloud c3"></div>
    <svg class="routes" viewBox="0 0 1200 380" preserveAspectRatio="xMidYMin meet">
      <path id="hc-route-out" d="M120 318 Q600 -258 1080 318" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="2" stroke-dasharray="2 10" stroke-linecap="round"/>
      <path id="hc-route-back" d="M1080 318 Q600 -170 120 318" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="2" stroke-dasharray="2 10" stroke-linecap="round"/>
      <path class="route-draw" d="M120 318 Q600 -258 1080 318" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.5" stroke-linecap="round" pathLength="100"/>
      <g class="hub"><circle cx="120" cy="318" r="6" fill="#fff"/><circle cx="120" cy="318" r="6" fill="none" stroke="#fff" stroke-width="2"><animate attributeName="r" values="6;22" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".8;0" dur="2.4s" repeatCount="indefinite"/></circle>
        <text x="120" y="358" text-anchor="middle">DUBAI</text></g>
      <g class="hub"><circle cx="1080" cy="318" r="6" fill="#fff"/><circle cx="1080" cy="318" r="6" fill="none" stroke="#fff" stroke-width="2"><animate attributeName="r" values="6;22" dur="2.4s" begin="1.2s" repeatCount="indefinite"/><animate attributeName="opacity" values=".8;0" dur="2.4s" begin="1.2s" repeatCount="indefinite"/></circle>
        <text x="1080" y="358" text-anchor="middle">DAR ES SALAAM</text></g>
      <g class="plane" fill="#fff" opacity="0">${plane}
        <animateMotion dur="9s" repeatCount="indefinite" rotate="auto"><mpath href="#hc-route-out"/></animateMotion>
        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.07;.93;1" dur="9s" repeatCount="indefinite"/></g>
      <g class="plane" fill="#fff" opacity="0" transform="scale(.7)">${plane}
        <animateMotion dur="14s" begin="4s" repeatCount="indefinite" rotate="auto"><mpath href="#hc-route-back"/></animateMotion>
        <animate attributeName="opacity" values="0;.5;.5;0" keyTimes="0;.07;.93;1" dur="14s" begin="4s" repeatCount="indefinite"/></g>
    </svg>
    <div class="sea">
      <div class="ship"><svg viewBox="0 0 130 56" width="130" height="56"><g fill="#fff">
        <rect x="10" y="10" width="16" height="22" rx="1.5" opacity=".95"/><rect x="14" y="4" width="4" height="7" opacity=".8"/>
        <rect x="30" y="20" width="18" height="12" opacity=".75"/><rect x="50" y="20" width="18" height="12" opacity=".9"/><rect x="70" y="20" width="18" height="12" opacity=".7"/><rect x="90" y="20" width="16" height="12" opacity=".85"/>
        <rect x="40" y="9" width="18" height="10" opacity=".85"/><rect x="60" y="9" width="18" height="10" opacity=".65"/><rect x="80" y="9" width="16" height="10" opacity=".8"/>
        <path d="M0 33h128l-12 17H9Z"/></g></svg></div>
      <svg class="wave w1" viewBox="0 0 1440 80" preserveAspectRatio="none"><path d="M0 40c120-26 240-26 360 0s240 26 360 0 240-26 360 0 240 26 360 0v40H0Z"/></svg>
      <svg class="wave w2" viewBox="0 0 1440 80" preserveAspectRatio="none"><path d="M0 46c120 22 240 22 360 0s240-22 360 0 240 22 360 0 240-22 360 0v34H0Z"/></svg>
    </div>
  </div>`;
}

function renderLogin(mode = 'login') {
  $('#app').innerHTML = `
  <div class="login">
    ${loginScene()}
    <div class="login-lang">${langToggle()}</div>
    <main class="login-center">
      <div class="login-logo"><img src="img/logo-white.png" alt="Horse Cargo"></div>
      <p class="login-tagline">${esc(t('auth_tagline'))}</p>
      <div class="login-card">
        <h1>${esc(mode === 'login' ? t('sign_in') : t('request_access'))}</h1>
        <form id="auth-form" class="stack" style="gap:12px" novalidate>
          ${mode === 'signup' ? `<div class="field"><label class="req">${esc(t('full_name'))}</label><input class="input" name="full_name" required autocomplete="name"></div>` : ''}
          <div class="field"><label class="req">${esc(t('email'))}</label><input class="input" name="email" type="email" required autocomplete="email" inputmode="email"></div>
          <div class="field"><label class="req">${esc(t('password'))}</label><input class="input" name="password" type="password" required minlength="8" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></div>
          <button class="btn primary" style="width:100%;min-height:46px" type="submit">${esc(mode === 'login' ? t('sign_in') : t('request_access'))}</button>
          <div id="auth-msg"></div>
          <a href="#" id="auth-switch" class="small" style="text-align:center">${esc(mode === 'login' ? t('no_account') : t('have_account'))}</a>
        </form>
      </div>
      <div class="login-lanes"><span>DXB → DAR</span><span>DXB → MWZ</span><span>DAR → DXB</span><span>${esc(t('sea'))} · ${esc(t('air'))}</span></div>
    </main>
  </div>`;
  $('#auth-switch').onclick = (e) => { e.preventDefault(); renderLogin(mode === 'login' ? 'signup' : 'login'); };
  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target; const btn = f.querySelector('button[type=submit]');
    const email = f.email.value.trim(); const password = f.password.value;
    if (!email || !password) { toast(t('required_fields'), 'err'); return; }
    btn.disabled = true;
    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await boot();
      } else {
        const { error } = await sb.auth.signUp({ email, password, options: { data: { full_name: f.full_name.value.trim() } } });
        if (error) throw error;
        $('#auth-msg').innerHTML = `<div class="callout ok">${icon('check')}<div>${esc(t('access_requested'))}</div></div>`;
        await sb.auth.signOut();
      }
    } catch (err) {
      $('#auth-msg').innerHTML = `<div class="callout danger">${icon('alert')}<div>${esc(errText(err))}</div></div>`;
    } finally { btn.disabled = false; }
  };
}

function renderInactive() {
  $('#app').innerHTML = `<div class="auth-form" style="min-height:100vh"><div class="auth-box card card-b stack">
    <div class="brand"><img src="icons/icon-192.png" alt=""><div><b>HORSE CARGO</b></div></div>
    <div class="callout warn">${icon('lock')}<div><b>${esc(t('inactive_title'))}</b><br>${esc(t('inactive_body'))}</div></div>
    <div class="muted small">${esc(state.user?.email || '')}</div>
    <div class="row"><button class="btn" onclick="location.reload()">${esc(t('retry'))}</button><button class="btn danger" data-logout>${esc(t('logout'))}</button></div>
  </div></div>`;
}

async function boot() {
  if (!configured) return renderSetup();
  try {
    const profile = await loadSession();
    if (!state.user) return renderLogin();
    if (!profile || !profile.active) return renderInactive();
    await loadReference(true);
    renderShell();
    startMailPolling();
    await route();
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = `<div class="auth-form" style="min-height:100vh"><div class="auth-box card card-b stack">
      <div class="callout danger">${icon('alert')}<div>${esc(errText(e))}</div></div>
      <div class="row"><button class="btn primary" onclick="location.reload()">${esc(t('retry'))}</button><button class="btn" data-logout>${esc(t('logout'))}</button></div></div></div>`;
  }
}

// unread staff mail: a light, cheap poll (no realtime infrastructure needed)
let mailTimer = null;
function startMailPolling() {
  if (mailTimer || !can('mail.use')) return;
  mailTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshMailBadge(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshMailBadge(); });
}

// global handlers
document.addEventListener('click', async (e) => {
  const l = e.target.closest('[data-lang]');
  if (l) { setLang(l.dataset.lang); if (state.profile?.active) { renderShell(); route(); } else boot(); return; }
  if (e.target.closest('[data-logout]')) { await sb?.auth.signOut(); state.profile = null; location.hash = '#/'; boot(); return; }
  if (e.target.closest('[data-back]')) { if (history.length > 1) history.back(); else location.hash = '#/'; }
});
window.addEventListener('hashchange', route);
if (sb) sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && state.profile) { state.profile = null; renderLogin(); } });

if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !location.hostname.match(/^(localhost|127\.)/)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); toast(errText(e.reason), 'err'); });

boot();
