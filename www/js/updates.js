import { t } from './i18n.js';

// Never reload while a member of staff is entering a booking or payment.
export async function startUpdates() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext ||
      window.Capacitor?.isNativePlatform?.()) return;
  let registration, applying = false, controlled = !!navigator.serviceWorker.controller;
  const showUpdate = () => {
    if (document.getElementById('app-update')) return;
    const banner = document.createElement('aside');
    banner.id = 'app-update';
    banner.className = 'app-update';
    banner.setAttribute('role', 'status');
    const label = document.createElement('span');
    label.textContent = t('app_update_ready');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.textContent = t('app_update_apply');
    button.addEventListener('click', () => {
      applying = true;
      button.disabled = true;
      if (registration.waiting) registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
      else window.location.reload();
    });
    banner.append(label, button);
    document.body.append(banner);
  };
  try {
    registration = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
    const observe = worker => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate();
      });
    };
    observe(registration.installing);
    registration.addEventListener('updatefound', () => observe(registration.installing));
    if (registration.waiting) showUpdate();
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (applying) window.location.reload();
      else if (controlled) showUpdate();
      controlled = true;
    });
    let lastCheck = 0;
    const check = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine ||
          Date.now() - lastCheck < 60000) return;
      lastCheck = Date.now();
      registration.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    setInterval(check, 15 * 60 * 1000);
    check();
  } catch {
    // Browsers without service workers still get the current website on next opening.
  }
}
