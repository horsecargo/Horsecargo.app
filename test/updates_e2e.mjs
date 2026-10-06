import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir, writeFile, cp, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const worker = await readFile(new URL('../www/sw.js', import.meta.url), 'utf8');
let release = 1, broken = false, checks = 0;
const ok = (value, label) => { assert(value, label); checks++; console.log(`✓ ${label}`); };
const pageHTML = () => `<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/css/app.css"><title>Release ${release}</title><input id="draft" aria-label="Unsaved booking"><script type="module">import { startUpdates } from './js/updates.js'; startUpdates();</script>`;
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (pathname === '/sw.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(worker.replace(/const CACHE = '[^']+';/, `const CACHE = 'hc-shell-test-${release}';`)
        .replace(/const SHELL = \[[\s\S]*?\];/, "const SHELL = ['./', 'index.html', 'js/updates.js', 'js/i18n.js', 'css/app.css', 'version.txt'];"));
    } else if (pathname === '/' || pathname === '/index.html') {
      res.setHeader('Content-Type', 'text/html'); res.end(pageHTML());
    } else if (pathname === '/version.txt') {
      if (broken) res.statusCode = 404;
      res.end(`Release ${release}`);
    } else if (pathname === '/api/private') {
      res.end('uncached private data');
    } else if (['/js/updates.js', '/js/i18n.js', '/css/app.css'].includes(pathname)) {
      res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(await readFile(new URL(`../www${pathname}`, import.meta.url)));
    } else { res.statusCode = 404; res.end('not found'); }
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
  await context.addInitScript(() => localStorage.setItem('hc.lang', 'sw'));
  const page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  ok(await page.title() === 'Release 1', 'first release opens');
  ok(await page.locator('#app-update').count() === 0, 'first install has no false update prompt');
  await page.fill('#draft', 'Booking haijahifadhiwa');
  await page.evaluate(async () => {
    await caches.open('unrelated-cache');
    await fetch('/api/private');
  });
  ok(await page.evaluate(async () => !(await Promise.all((await caches.keys()).map(async key => (await caches.open(key)).match('/api/private')))).some(Boolean)), 'private responses are never cached');
  await context.setOffline(true);
  ok(await page.evaluate(async () => (await fetch('/version.txt')).text()) === 'Release 1', 'installed shell works offline');
  ok(await page.evaluate(async () => { try { await fetch('/api/private'); return false; } catch { return true; } }), 'private API data has no offline cache fallback');
  await context.setOffline(false);
  release = 2;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.locator('#app-update').waitFor();
  ok(await page.title() === 'Release 1', 'new release waits rather than reloading');
  ok(await page.inputValue('#draft') === 'Booking haijahifadhiwa', 'unsaved form is preserved');
  ok(await page.getByRole('button', { name: 'Sasisha sasa' }).count() === 1, 'Kiswahili update action');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'update banner fits 320px');
  await page.getByRole('button', { name: 'Sasisha sasa' }).click();
  await page.waitForFunction(() => document.title === 'Release 2');
  ok(await page.locator('#app-update').count() === 0, 'chosen update activates and reloads once');
  ok(await page.evaluate(async () => (await caches.keys()).includes('unrelated-cache')), 'activation preserves other caches');
  ok(await page.evaluate(async () => !(await caches.keys()).includes('hc-shell-test-1')), 'old app release is cleaned');
  ok(await page.evaluate(async () => (await fetch('/version.txt')).text()) === 'Release 2', 'activated release serves matching assets');
  release = 3; broken = true;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
    const installing = registration.installing;
    if (installing) await new Promise(resolve => {
      installing.addEventListener('statechange', () => { if (installing.state === 'redundant') resolve(); });
    });
  });
  ok(await page.evaluate(async () => (await fetch('/version.txt')).text()) === 'Release 2', 'failed release retains working assets');
  ok(await page.locator('#app-update').count() === 0, 'incomplete release is not offered to staff');
  await context.setOffline(true);
  await page.reload();
  ok(await page.title() === 'Release 2', 'working release still launches offline after failed update');
  await context.close();

  // A website-only edit must change the worker even when nobody edits sw.js.
  await mkdir(new URL('../work/', import.meta.url), { recursive: true });
  const temp = await mkdtemp(fileURLToPath(new URL('../work/web-stamp-', import.meta.url)));
  await cp(new URL('../www/', import.meta.url), `${temp}/www`, { recursive: true });
  await mkdir(`${temp}/scripts`);
  await cp(new URL('../scripts/stamp-web-release.mjs', import.meta.url), `${temp}/scripts/stamp-web-release.mjs`);
  const stamp = () => execFileSync(process.execPath, [`${temp}/scripts/stamp-web-release.mjs`], { encoding: 'utf8' });
  const first = stamp();
  ok(stamp() === first, 'release fingerprint is deterministic');
  await writeFile(`${temp}/www/change.txt`, 'a frontend-only update');
  ok(stamp() !== first, 'frontend edits automatically invalidate the app release');
  console.log(`${checks} update checks passed`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
