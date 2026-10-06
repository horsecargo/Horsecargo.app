// v6 browser checks (desktop + 390px phone): navigation by role, Leads, Sourcing,
// Staff Mail between two users, Scan by typed code AND by a real (fake-device)
// camera feed, Packing List / label QR codes, registers, users & permissions.
// Run after v6_test.mjs (uses work/v6-fixtures.json).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const fx = JSON.parse(await fs.readFile('work/v6-fixtures.json', 'utf8'));
await fs.mkdir('work/qa', { recursive: true });
const BASE = 'http://127.0.0.1:8787';
const verify = (tok) => `${BASE}/verify.html?d=${tok}`;

// A fake camera: a Y4M video whose frames show the GRN's QR code.
const qrcode = createRequire(import.meta.url)('../www/vendor/qrcode.js');
async function qrVideo(text, file) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const W = 640, H = 480, n = q.getModuleCount(), cell = Math.floor(400 / (n + 8));
  const off = Math.floor((W - cell * n) / 2), offY = Math.floor((H - cell * n) / 2);
  const Y = Buffer.alloc(W * H, 235);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c))
    for (let y = 0; y < cell; y++) Y.fill(16, (offY + r * cell + y) * W + off + c * cell, (offY + r * cell + y) * W + off + (c + 1) * cell);
  const UV = Buffer.alloc((W / 2) * (H / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, UV, UV]);
  await fs.writeFile(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...Array(20).fill(frame)]));
}
const cam = path.resolve('work/qa/qr-grn.y4m');
await qrVideo(verify(fx.tokens.grn), cam);

const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${cam}`] });
const errors = [];
let checks = 0;
const ok = (v, m) => { assert(v, m); checks++; console.log('  ✓', m); };

async function session(email, viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport, permissions: ['camera'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${email}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${email}: ${m.text()}`); });
  await page.goto(BASE);
  await page.locator('input[type=email]').fill(email + '@hc.test');
  await page.locator('input[type=password]').fill('Pass1234!');
  await page.locator('button[type=submit]').click();
  await page.locator('#page .page-head, #page .card').first().waitFor();
  return { ctx, page };
}
const go = async (page, hash, sel = '#page .page-head') => { await page.goto(`${BASE}/#${hash}`); await page.locator(sel).first().waitFor(); };
const noSideScroll = async (page, label) => ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: no horizontal scroll at 390px`);
const shot = (page, name) => page.screenshot({ path: `work/qa/v6-${name}.png`, fullPage: true });

try {
  // ───── manager, desktop: navigation order, registers ─────
  {
    const { ctx, page } = await session('manager');
    const nav = await page.$$eval('.sidebar .nav a', (as) => as.map((a) => a.dataset.nav));
    const want = ['dashboard', 'customers', 'leads', 'sourcing', 'shipments', 'grn_register', 'cargo_labels', 'invoices', 'payments', 'storage', 'packing_list', 'scan', 'staff_mail', 'reports'];
    assert.deepEqual(nav.slice(0, want.length), want); checks++; console.log('  ✓ manager sidebar follows the new module order');
    ok(nav.indexOf('cargo_labels') === nav.indexOf('grn_register') + 1, 'Cargo Labels sits right after GRN');
    await go(page, '/grn', 'tr[data-href]'); ok(await page.locator(`text=${fx.grnRef}`).count() > 0, 'GRN register lists the GRN');
    await go(page, '/labels', 'tr[data-href]'); ok(await page.locator(`a[href="#/doc/labels/${fx.ship}"]`).count() > 0, 'Cargo Labels register links label printing');
    await go(page, '/invoices', 'tr[data-href]'); ok(await page.locator(`text=${fx.invoiceRef}`).count() > 0, 'Invoice register lists the invoice');
    await go(page, '/payments', '#page .card'); ok(true, 'Payments register opens');
    await go(page, `/shipment/${fx.ship}`, '#docs tr');
    const docOrder = await page.$$eval('#docs tr .muted.small', (d) => d.map((x) => x.textContent));
    ok(/Goods Received/.test(docOrder[0]) && /Cargo label/.test(docOrder[1]) && /Invoice/.test(docOrder[2]), 'shipment documents: GRN → Cargo label → Invoice');
    await go(page, `/doc/labels/${fx.ship}`, '.label');
    ok(await page.locator('.label .qr svg').count() > 0, 'cargo labels carry a QR');
    await go(page, '/search', '#gq'); await page.locator('#gq').fill(fx.plRef);
    await page.locator('#gres a.lc').first().waitFor(); ok(await page.locator(`#gres a[href="#/packing-list/${fx.pl}"]`).count() === 1, 'global search finds the packing list');
    await ctx.close();
  }

  // ───── logistics: packing list QR on screen, on the A4 doc and in the PDF ─────
  {
    const { ctx, page } = await session('logistics');
    await go(page, `/packing-list/${fx.pl}`, '.pl-qr svg');
    ok(true, 'packing list page shows its QR');
    await go(page, `/doc/packing/${fx.pl}`, '.doc .verify svg');
    ok(await page.locator('.doc .verify').innerText().then((s) => /Scan to verify/.test(s)), 'A4 packing list carries the verification QR');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#download-pdf').click()]);
    const pdf = path.resolve('work/qa/v6-packing-list.pdf'); await dl.saveAs(pdf);
    ok((await fs.stat(pdf)).size > 5000, 'packing list PDF downloads');
    await shot(page, 'packing-list-doc');
    const nav = await page.$$eval('.sidebar .nav a', (as) => as.map((a) => a.dataset.nav));
    ok(!nav.includes('invoices') && nav.includes('leads') && nav.includes('grn_register') && nav.includes('cargo_labels') && nav.includes('scan'), 'logistics sees GRN/Labels/Scan/Leads, not Invoice');
    await ctx.close();
  }

  // ───── customer care on a phone: lead, scan (typed + camera), not-recognised ─────
  {
    const { ctx, page } = await session('care', { width: 390, height: 844 });
    ok(await page.locator('.bottom-nav a[data-nav="scan"]').isVisible(), 'phone bottom bar has Scan');
    await go(page, '/more', '#page .card');
    const more = await page.$$eval('#page .card a.lc', (as) => as.map((a) => a.getAttribute('href')));
    ok(more.includes('#/leads') && more.includes('#/mail') && !more.includes('#/invoices') && !more.includes('#/grn'), 'menu only shows permitted modules');
    await go(page, '/invoices', '#page .callout'); ok(await page.locator('text=No access').count() === 1, 'route guard blocks Invoice for Customer Care');
    // record a lead with only the basics
    await go(page, '/leads', '#new-lead'); await page.locator('#new-lead').click();
    await page.locator('#lead-form [name=customer_name]').fill('Phone Shop Kariakoo');
    await page.locator('#lead-form [name=phone]').fill('0766123456');
    await page.locator('#lead-form [name=service]').selectOption('sea');
    await page.locator('#lead-save').click();
    await page.waitForURL(/#\/lead\//); await page.locator('#page h1').waitFor();
    ok(/LEAD-\d{8}-\d{3}/.test(await page.locator('#page .page-head p').innerText()), 'lead saved with LEAD-YYYYMMDD-NNN');
    await noSideScroll(page, 'lead page'); await shot(page, 'lead-phone');
    await go(page, '/leads', '.list-cards .lc'); await noSideScroll(page, 'leads list');
    // scan by typing the QR content
    await go(page, '/scan', '#manual');
    await page.locator('#manual [name=code]').fill(verify(fx.tokens.pl)); await page.locator('#manual button').click();
    await page.locator('.scan-result').waitFor();
    let txt = await page.locator('.scan-result').innerText();
    ok(/Verified document/.test(txt) && /PACKING LIST/i.test(txt) && txt.includes(fx.plRef), 'typed code → Packing List identified');
    ok(await page.locator(`.scan-result a[href="#/packing-list/${fx.pl}"]`).count() === 1, 'View document opens the right packing list');
    await noSideScroll(page, 'scan result'); await shot(page, 'scan-packing-list-phone');
    await page.locator('#manual [name=code]').fill(verify(fx.tokens.revoked)); await page.locator('#manual button').click();
    await page.locator('.scan-result.no').waitFor(); ok(/revoked/i.test(await page.locator('.scan-result').innerText()), 'revoked QR is reported');
    await page.locator('#manual [name=code]').fill('https://example.com/some-other-qr'); await page.locator('#manual button').click();
    await page.locator('.scan-result.no').waitFor();
    ok(/QR Code Not Recognized/.test(await page.locator('.scan-result').innerText()), 'foreign QR → "QR Code Not Recognized"');
    // scan with the (fake) phone camera showing the GRN QR
    await page.locator('[data-again]').click();
    await page.locator('.scan-result').waitFor({ timeout: 20000 });
    txt = await page.locator('.scan-result').innerText();
    ok(/Verified document/.test(txt) && txt.includes(fx.grnRef) && txt.includes(fx.shipRef), 'camera scan → GRN identified with shipment');
    await shot(page, 'scan-camera-grn-phone');
    await ctx.close();
  }

  // ───── staff mail: Operations ↔ Customer Care ─────
  let thread;
  {
    const a = await session('ops');
    await go(a.page, '/mail', '#compose'); await a.page.locator('#compose').click();
    await a.page.locator('#mc-to-in').fill('Catherine'); await a.page.locator('.rcpt-opt').first().click();
    await a.page.locator('#mc-subject').fill('Shipment check ' + fx.shipRef);
    await a.page.locator('#mc-body').fill('Please confirm whether this cargo has been packed.');
    await a.page.locator('#mc-send').click(); await a.page.waitForURL(/#\/mail\/[\w-]+$/);
    thread = a.page.url().split('/').pop();
    await a.page.locator('.mail-msg').first().waitFor();
    ok(await a.page.locator('.mail-msg').count() === 1, 'message sent and thread opened');

    const b = await session('care', { width: 390, height: 844 });
    await b.page.waitForFunction(() => Number(document.querySelector('[data-mail-badge]:not(.hidden)')?.textContent || 0) >= 1);
    ok(true, 'recipient sees the unread badge');
    await go(b.page, '/mail', '.mail-row'); ok(await b.page.locator('.mail-row.unread').count() >= 1, 'inbox shows it unread');
    await noSideScroll(b.page, 'mail inbox');
    const badgeN = () => b.page.evaluate(() => Number(document.querySelector('[data-mail-badge]')?.textContent || 0));
    const before = await badgeN();
    await b.page.locator(`a.mail-row[href="#/mail/${thread}"]`).click(); await b.page.locator('.mail-msg').first().waitFor();
    await b.page.waitForFunction((n) => Number(document.querySelector('[data-mail-badge]')?.textContent || 0) === n - 1, before);
    ok(true, 'opening the message clears the unread counter');
    await b.page.locator('#reply-box [data-r="reply"]').click();
    await b.page.locator('#r-body').fill('Yes, it has been packed in Box 3.'); await b.page.locator('#r-send').click();
    await b.page.waitForFunction(() => document.querySelectorAll('.mail-msg').length === 2);
    ok(true, 'reply stays in the same conversation'); await noSideScroll(b.page, 'mail thread'); await shot(b.page, 'mail-thread-phone');

    await a.page.reload(); await a.page.locator('.mail-msg').nth(1).waitFor();
    ok(await a.page.locator('.mail-msg').count() === 2, 'sender sees the reply in the thread');
    ok(await a.page.locator('.mail-msg.mine .rr.ok').count() >= 1, 'sender sees a read receipt');
    await a.ctx.close(); await b.ctx.close();
  }

  // ───── sales: convert a lead; sourcing: create a request from a lead ─────
  {
    const s = await session('sales');
    await go(s.page, '/leads', 'tr[data-href]');
    await s.page.locator('tr[data-href]', { hasText: 'Phone Shop Kariakoo' }).click(); await s.page.locator('[data-act="convert"]').waitFor();
    await s.page.locator('[data-act="convert"]').click();
    await s.page.locator('.callout.ok').waitFor(); ok(/Converted/i.test(await s.page.locator('.callout.ok').innerText()), 'lead converted to customer');
    const leadUrl = s.page.url(); await s.ctx.close();
    const r = await session('sourcing');
    await r.page.goto(leadUrl); await r.page.locator('[data-act="sourcing"]').click();
    await r.page.locator('#src-form [name=product]').fill('Bluetooth speakers'); await r.page.locator('#src-form [name=quantity]').fill('100');
    await r.page.locator('#srs').click(); await r.page.waitForURL(/#\/sourcing\//); await r.page.locator('#page h1').waitFor();
    ok(/SRC-\d{8}-\d{3}/.test(await r.page.locator('#page .page-head p').innerText()), 'sourcing request created from the lead');
    await r.page.locator('[data-act="status"]').click(); await r.page.locator('#sss').click();
    await r.page.locator('.badge', { hasText: 'Searching' }).first().waitFor(); ok(true, 'sourcing status changed');
    await r.ctx.close();
  }

  // ───── admin: roles, filter, permission matrix; HR read-only directory ─────
  {
    const a = await session('admin');
    await go(a.page, '/users', '#role-filter'); await a.page.locator('#role-filter').selectOption('hr');
    const rows = await a.page.$$eval('#staff-list tbody tr', (t) => t.map((r) => r.innerText));
    ok(rows.length >= 1 && rows.every((r) => /HR/.test(r)), 'filter staff by role');
    await a.page.locator('[data-tab="perms"]').click(); await a.page.locator('#perm-role').selectOption('hr');
    const cb = a.page.locator('[data-perm="customer.read"]'); await cb.check(); await a.page.locator('.toast', { hasText: 'Saved' }).first().waitFor();
    ok(true, 'admin edits the role permission matrix'); await cb.uncheck(); await a.page.waitForTimeout(400);
    await go(a.page, '/users?tab=invites', '#pane'); await a.page.locator('#pane >> text=new.hr@hc.test').waitFor();
    ok(true, 'pending invitations list loads (was silently empty before)');
    await go(a.page, '/users', '#invite'); await a.page.locator('#invite').click();
    const roleOpts = await a.page.$$eval('#inv [name=role] option', (o) => o.map((x) => x.value));
    assert.deepEqual(roleOpts, ['admin', 'manager', 'operations', 'hr', 'accountant', 'logistics', 'sales_marketing', 'sourcing', 'customer_care']); checks++;
    console.log('  ✓ new staff can only be given the eight operational roles (+ admin)');
    await a.ctx.close();
    const h = await session('hr', { width: 390, height: 844 });
    await go(h.page, '/users', '#staff-list'); ok(await h.page.locator('#invite').count() === 0, 'HR sees a read-only staff directory');
    await noSideScroll(h.page, 'staff directory');
    await go(h.page, '/shipments', '#page .callout'); ok(true, 'HR cannot open Shipments');
    await h.ctx.close();
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: ${checks} v6 browser checks (desktop + 390px phone, real camera feed); no console/page errors.`);
} finally { await browser.close(); }
