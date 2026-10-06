// Unread Staff Mail counter shown in the sidebar, top bar and bottom bar.
import { rpc, can, state } from './api.js';

let last = 0;
let inflight = null;
export const mailBadge = () => `<span class="nav-badge${last ? '' : ' hidden'}" data-mail-badge>${last > 99 ? '99+' : last || ''}</span>`;

function paint(n) {
  last = n;
  document.querySelectorAll('[data-mail-badge]').forEach((b) => {
    b.textContent = n > 99 ? '99+' : String(n || '');
    b.classList.toggle('hidden', !n);
    b.setAttribute('aria-label', `${n} unread`);
  });
}

let again = false;
export function refreshMailBadge() {
  if (!state.profile?.active || !can('mail.use')) return Promise.resolve(0);
  // a call made while one is running (e.g. right after opening a message) must
  // end with the newer count, so queue exactly one follow-up
  if (inflight) { again = true; return inflight; }
  inflight = rpc('mail_unread_count')
    .then((n) => { paint(Number(n) || 0); return Number(n) || 0; })
    .catch(() => last)
    .finally(() => { inflight = null; })
    .then((n) => { if (again) { again = false; return refreshMailBadge(); } return n; });
  return inflight;
}
