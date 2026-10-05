// Horse Cargo service worker — caches the app shell so it opens instantly and offline.
// Data always comes live from Supabase (never cached).
const CACHE = 'hc-shell-v7';
const SHELL = [
  './', 'index.html', 'track.html', 'verify.html', 'config.js', 'manifest.webmanifest', 'css/app.css',
  'vendor/supabase.js', 'vendor/qrcode.js', 'vendor/html5-qrcode.min.js',
  'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js',
  'js/document-items.js', 'js/document-pdf.js',
  'js/app.js', 'js/api.js', 'js/ui.js', 'js/i18n.js', 'js/scanner.js', 'js/acc.js',
  'js/pages/dashboard.js', 'js/pages/shipments.js', 'js/pages/shipment.js', 'js/pages/shipment-new.js', 'js/pages/grn.js',
  'js/pages/customers.js', 'js/pages/customer.js', 'js/pages/scan.js',
  'js/pages/storage.js', 'js/pages/storage-shipment.js', 'js/pages/packing-list.js',
  'js/pages/rates.js', 'js/pages/reports.js', 'js/pages/users.js', 'js/pages/settings.js', 'js/pages/profile.js',
  'js/pages/audit.js', 'js/pages/more.js', 'js/pages/doc.js',
  'js/pages/acc.js', 'js/pages/acc-bills.js', 'js/pages/acc-bill.js', 'js/pages/acc-bill-new.js', 'js/pages/acc-expenses.js', 'js/pages/acc-journals.js',
  'js/pages/acc-coa.js', 'js/pages/acc-account.js', 'js/pages/acc-money.js', 'js/pages/acc-suppliers.js', 'js/pages/acc-reports.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-96.png',
  'img/logo-white.png', 'img/mark-white.png', 'img/logo.jpg',
  'img/logo-brand.png',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Supabase API calls go straight to network
  // network first, fall back to cache (so updates arrive as soon as you deploy)
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
