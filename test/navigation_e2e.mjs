// Grouped navigation checks on the isolated fixtures used by v6_test/v6_e2e.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
const BASE = 'http://127.0.0.1:8787';
const fixtures = JSON.parse(await fs.readFile('work/v6-fixtures.json', 'utf8'));
const errors = [];
let checks = 0;
const ok = (value, label) => { assert(value, label); checks++; console.log('  ✓', label); };
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; console.log('  ✓', label); };
const go = async (page, hash, selector = '#dashboard-actions') => {
  await page.goto(`${BASE}/#${hash}`);
  await page.locator(selector).waitFor();
};
async function session(name, width = 1366) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(`${name}: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`${name}: ${msg.text()}`); });
  await page.goto(BASE);
  await page.locator('input[type=email]').fill(`${name}@hc.test`);
  await page.locator('input[type=password]').fill('Pass1234!');
  await page.locator('button[type=submit]').click();
  await page.locator('#dashboard-actions').waitFor();
  return { context, page };
}
const groups = (page, root = '.sidebar') => page.$$eval(`${root} [data-menu-group]`, (bs) => bs.map((b) => b.dataset.menuGroup));
const actions = (page) => page.$$eval('#dashboard-actions [data-action]', (as) => as.map((a) => a.dataset.action));
const fits = async (page, label) => ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label);
await fs.mkdir('work/qa', { recursive: true });

try {
  const admin = await session('admin');
  const p = admin.page;
  eq(await groups(p), ['sales', 'cargo', 'finance', 'reporting', 'administration'], 'Admin has six top-level menu entries including Dashboard');
  eq(await p.locator('.sidebar [data-menu-group][aria-expanded=true]').count(), 0, 'Dashboard starts with all groups collapsed');
  ok(await p.locator('.topbar a[href="#/scan"]').isVisible() && await p.locator('.topbar a[href="#/mail"]').isVisible(), 'Scan and Mail are visible top-bar tools');
  ok(await p.locator('.topbar .tool-label', { hasText: 'Mail' }).isVisible(), 'Desktop Mail has a visible label');
  await p.locator('.sidebar [data-menu-group=cargo]').focus();
  await p.keyboard.press('Enter');
  eq(await p.locator('.sidebar [data-menu-group=cargo]').getAttribute('aria-expanded'), 'true', 'Keyboard opens Cargo');
  await p.locator('.sidebar a[data-nav=shipments]').click();
  await p.waitForURL('**/#/shipments');
  await p.locator('.sidebar a[data-nav=shipments][aria-current=page]').waitFor();
  await p.locator('#page .page-head').waitFor();
  eq(await p.locator('.sidebar a[data-nav=shipments]').getAttribute('aria-current'), 'page', 'Selected shipment page is highlighted');
  await p.locator('.sidebar [data-menu-group=finance]').click();
  eq(await p.locator('.sidebar [aria-expanded=true]').count(), 1, 'Only one group remains expanded');
  eq(await p.locator('.sidebar [data-menu-group=cargo]').getAttribute('aria-expanded'), 'false', 'Opening Finance collapses Cargo');
  eq(await p.$$eval('#sidebar-group-finance .menu-section-label', (es) => es.map((e) => e.textContent)),
    ['Overview', 'Customer accounts', 'Costs & Suppliers', 'Accounts'], 'Finance has four sections without nested dropdowns');
  ok(await p.locator('#sidebar-group-finance a[href="#/payments"]').isVisible(), 'Payments register is directly available in Finance');
  ok(await p.locator('#sidebar-group-finance a[href="#/acc/reports"]').count() === 0, 'Financial reports are under Reports, without a duplicate Finance link');
  await go(p, `/doc/invoice/${fixtures.ship}`, '.doc');
  eq(await p.locator('.sidebar [data-menu-group=finance]').getAttribute('aria-expanded'), 'true', 'Invoice document deep link opens Finance');
  await go(p, `/doc/grn/${fixtures.ship}`, '.doc');
  eq(await p.locator('.sidebar [data-menu-group=cargo]').getAttribute('aria-expanded'), 'true', 'GRN document deep link opens Cargo');
  await p.screenshot({ path: 'work/qa/navigation-desktop-cargo.png', fullPage: true });
  const setInvoicePermission = (enabled) => p.evaluate(async (value) => {
    const { rpc } = await import('/js/api.js');
    await rpc('admin_set_role_permission', { p_role: 'hr', p_permission: 'invoice.read', p_enabled: value });
  }, enabled);
  await setInvoicePermission(true);
  let delegated;
  try {
    delegated = await session('hr');
    ok((await groups(delegated.page)).includes('finance'), 'An admin-granted permission reveals the matching group after sign-in');
    await delegated.page.locator('.sidebar [data-menu-group=finance]').click();
    ok(await delegated.page.locator('#sidebar-group-finance a[href="#/invoices"]').isVisible(), 'Granted invoice access appears in Customer accounts');
    eq(await delegated.page.locator('#sidebar-group-finance a[href="#/payments"]').count(), 0, 'Granting invoice access does not also reveal Payments');
  } finally {
    await delegated?.context.close();
    await setInvoicePermission(false);
  }
  await admin.context.close();

  for (const spec of [
    { name: 'logistics', groups: ['sales', 'cargo'], primary: 'cargo', first: 'nav_receive_cargo', allowed: '#/grn', denied: '#/invoices' },
    { name: 'care', groups: ['sales', 'cargo'], primary: 'sales', first: 'new_lead', allowed: '#/leads', denied: '#/grn' },
    { name: 'hr', groups: ['sales', 'administration'], primary: 'administration', first: 'users', allowed: '#/users', denied: '#/settings' },
    { name: 'accountant', groups: ['sales', 'cargo', 'finance', 'reporting'], primary: 'finance', first: 'record_payment', allowed: '#/payments', denied: '#/users' },
    { name: 'sourcing', groups: ['sales'], primary: 'sales', first: 'new_sourcing', allowed: '#/sourcing', denied: '#/shipments' },
  ]) {
    const { context, page } = await session(spec.name, 390);
    eq(await groups(page), spec.groups, `${spec.name}: only permitted nonempty groups exist`);
    eq((await actions(page))[0], spec.first, `${spec.name}: dashboard prioritises their work`);
    ok((await actions(page)).length <= 6, `${spec.name}: shortcuts stay compact`);
    const workspace = page.locator(`.bottom-nav a[data-nav-group=${spec.primary}]`);
    ok(await workspace.isVisible(), `${spec.name}: mobile work-area shortcut`);
    ok(await page.locator('.bottom-nav a[data-nav=staff_mail]').isVisible(), `${spec.name}: Mail remains directly reachable on mobile`);
    await fits(page, `${spec.name}: dashboard fits 390px`);
    await workspace.click();
    await page.locator('.workspace-menu').waitFor();
    eq(await page.locator(`.workspace-menu [data-menu-group=${spec.primary}]`).getAttribute('aria-expanded'), 'true', `${spec.name}: work-area shortcut opens its group`);
    eq(await page.locator('.bottom-nav a.active').count(), 1, `${spec.name}: exactly one mobile item is selected`);
    ok(await page.locator(`.workspace-menu a[href="${spec.allowed}"]`).isVisible(), `${spec.name}: expected page is reachable`);
    eq(await page.locator(`.workspace-menu a[href="${spec.denied}"]`).count(), 0, `${spec.name}: restricted page absent from menu`);
    await fits(page, `${spec.name}: grouped More fits 390px`);
    await page.locator('.topbar [data-lang=sw]').click();
    await page.locator('.workspace-menu').waitFor();
    ok((await page.locator('.workspace-menu').innerText()).includes('Dashibodi'), `${spec.name}: menu translates to Kiswahili`);
    await page.setViewportSize({ width: 320, height: 800 });
    await fits(page, `${spec.name}: translated menu fits 320px`);
    await page.screenshot({ path: `work/qa/navigation-${spec.name}-phone.png`, fullPage: true });
    await page.locator('.topbar [data-lang=en]').click();
    await page.locator('.workspace-menu').waitFor();
    if (spec.name === 'care') {
      await go(page, '/');
      await page.locator('#dashboard-actions [data-action=nav_follow_ups]').click();
      await page.locator('#reg-chips [data-chip=follow_up].on').waitFor();
      ok(true, 'Follow-up shortcut selects the follow-up filter');
      await go(page, '/invoices', '#page .callout');
      ok(await page.locator('#page').innerText().then((s) => s.includes('No access')), 'Customer Care still cannot open invoices by a direct URL');
    }
    if (spec.name === 'hr') {
      eq(await page.locator('.bottom-nav a[data-nav=scan]').count(), 0, 'HR does not gain a Scan shortcut');
      await go(page, '/');
      eq(await page.locator('#page a[href="#/shipments"]').count(), 0, 'HR dashboard has no inaccessible shipment shortcuts');
    }
    if (spec.name === 'accountant') {
      await page.locator('.workspace-menu a[href="#/acc/coa"]').click();
      await page.waitForURL('**/#/acc/coa');
      await page.locator('#page .page-head').waitFor();
      ok(true, 'Accounting pages below the mobile fold remain reachable');
    }
    await context.close();
  }
  eq(errors, [], 'No browser console or page errors');
  console.log(`PASS: ${checks} grouped navigation checks across desktop, 390px and 320px, English and Kiswahili.`);
} finally { await browser.close(); }
