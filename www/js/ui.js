import { t, getLang } from './i18n.js';

// ───────────── icons (inline SVG, stroke) ─────────────
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.6c2.6.2 4.4 1.9 5 4.9"/>',
  container: '<rect x="2" y="6" width="20" height="12" rx="1.5"/><path d="M6 9v6M10 9v6M14 9v6M18 9v6"/>',
  scan: '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M7 12h10"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  ship: '<path d="M3 17c1.5 1.3 3 2 4.5 2s3-.7 4.5-2c1.5 1.3 3 2 4.5 2s3-.7 4.5-2"/><path d="M5 15 4 10h16l-1 5M8 10V6h8v4M12 3v3"/>',
  plane: '<path d="M10.5 13.5 3 11l1.5-1.5 8 1 4-4c1-1 2.5-1.5 3.5-.5s.5 2.5-.5 3.5l-4 4 1 8L15 23l-2.5-7.5L9 19v3l-1.5 1-1-3.5L3 18.5l1-1.5h3l3.5-3.5Z"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  whatsapp: '<path d="M3 21l1.7-4.6A9 9 0 1 1 8 20l-5 1Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.3-1.8-1-1 .7a4 4 0 0 1-2.3-2.3l.7-1-1-1.8L9 9.5Z"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  scale: '<path d="M12 3v18M5 7h14M7 7l-4 7a4 4 0 0 0 8 0L7 7ZM17 7l-4 7a4 4 0 0 0 8 0l-4-7Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  warehouse: '<path d="M3 21V9l9-5 9 5v12"/><path d="M7 21v-7h10v7"/><path d="M7 17h10"/>',
  clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 10h6M9 14h6M9 18h3"/>',
  key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M15.5 12v2.5"/>',
  boxes: '<rect x="2.5" y="12" width="8" height="8" rx="1"/><rect x="13.5" y="12" width="8" height="8" rx="1"/><rect x="8" y="3" width="8" height="8" rx="1"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6l2-8Z"/>',
  send: '<path d="M21 3 10 14"/><path d="M21 3 14 21l-4-7-7-4 18-7Z"/>',
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v4"/>',
  replyAll: '<path d="M7 14 2 9l5-5"/><path d="M12 14 7 9l5-5"/><path d="M7 9h8a6 6 0 0 1 6 6v4"/>',
  forward: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0-6 6v4"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8M10 12h4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
  release: '<path d="M20 12v8H4v-8M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7ZM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7Z"/>',
};
export function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// ───────────── formatting ─────────────
export function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const loc = () => (getLang() === 'sw' ? 'sw-TZ' : 'en-GB');
export function usd(n, opts = {}) {
  const v = Number(n || 0);
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = v < 0 && Math.abs(v) >= 0.005 ? '-' : '';
  return opts.bare ? sign + s : `${sign}$${s}`;
}
// one rounding policy everywhere: whole shillings for TZS, 2 decimals for USD / AED
export function money(n, cur = 'USD', opts = {}) {
  const c = cur || 'USD';
  const v = Number(n || 0);
  const dec = c === 'TZS' ? 0 : 2;
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const sign = v < 0 && Math.abs(v) >= (dec ? 0.005 : 0.5) ? '-' : '';
  return opts.bare ? sign + s : `${sign}${c} ${s}`;
}
export function num(n, d = 2) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
}
export function fdate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(loc(), { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fdatetime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(loc(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function ago(d) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  const sw = getLang() === 'sw';
  if (s < 60) return sw ? 'sasa hivi' : 'just now';
  if (s < 3600) return sw ? `dakika ${Math.floor(s / 60)} zilizopita` : `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return sw ? `saa ${Math.floor(s / 3600)} zilizopita` : `${Math.floor(s / 3600)} h ago`;
  return fdate(d);
}
export const today = () => new Date().toISOString().slice(0, 10);

export function statusBadge(s) { return `<span class="badge s-${esc(s)}">${esc(t('st_' + s))}</span>`; }
export function shipBadge(s) { return `<span class="badge s-${esc(s)}">${esc(t('sh_' + s))}</span>`; }
export function modeTag(m) { return `<span class="mode">${icon(m === 'air' ? 'plane' : 'ship')}${esc(t(m))}</span>`; }
export function route(o, d) { return `<span class="nowrap mono">${esc(o)} → ${esc(d)}</span>`; }

// ───────────── DOM helpers ─────────────
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function debounce(fn, ms = 300) { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; }
export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'number') o[el.name] = el.value === '' ? null : Number(el.value);
    else o[el.name] = el.value.trim() === '' ? null : el.value.trim();
  }
  return o;
}
export function checkRequired(form) {
  let ok = true;
  for (const el of form.querySelectorAll('[required]')) {
    if (!String(el.value || '').trim()) { ok = false; el.style.borderColor = 'var(--red)'; el.addEventListener('input', () => { el.style.borderColor = ''; }, { once: true }); }
  }
  if (!ok) toast(t('required_fields'), 'err');
  return ok;
}

// ───────────── toast / modal ─────────────
export function toast(msg, kind = 'ok', ms = 4200) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'err' ? 'alert' : kind === 'ok' ? 'check' : 'info')}<div>${esc(msg)}</div>`;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? ms + 2500 : ms);
}

export function modal({ title, body, foot = '', wide = false, onMount }) {
  const root = $('#modal-root');
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-h"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="${esc(t('close'))}">${icon('x')}</button></div>
    <div class="modal-b">${body}</div>
    ${foot ? `<div class="modal-f">${foot}</div>` : ''}
  </div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  root.appendChild(bg);
  const m = { el: bg.querySelector('.modal'), close };
  if (onMount) onMount(m);
  const first = bg.querySelector('input:not([type=hidden]):not([readonly]), select, textarea');
  if (first && window.matchMedia('(min-width: 861px)').matches) setTimeout(() => first.focus(), 30);
  return m;
}

export function confirmDialog(message, { okText, danger = false, withReason = false, reasonLabel } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: t('confirm'),
      body: `<p style="margin:0 0 12px">${esc(message)}</p>${withReason ? `<div class="field"><label class="req">${esc(reasonLabel || t('reason'))}</label><textarea class="input" id="cf-reason"></textarea></div>` : ''}`,
      foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cf-ok">${esc(okText || t('confirm'))}</button>`,
      onMount: (mm) => {
        mm.el.querySelector('#cf-ok').onclick = () => {
          const reason = withReason ? mm.el.querySelector('#cf-reason').value.trim() : true;
          if (withReason && !reason) { toast(t('required_fields'), 'err'); return; }
          done = true; mm.close(); resolve(reason);
        };
      },
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe($('#modal-root'), { childList: true });
  });
}

export async function busy(btn, fn) {
  if (!btn) return fn();
  const old = btn.innerHTML; btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="width:16px;height:16px;border-width:2px"></span>`;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}

// ───────────── tables ─────────────
export function empty(text = t('nothing_here'), ic = 'box') {
  return `<div class="empty">${icon(ic)}<div>${esc(text)}</div></div>`;
}

export function toCSV(rows, cols) {
  const q = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.map((c) => q(c.label)).join(','), ...rows.map((r) => cols.map((c) => q(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','))].join('\n');
}
export const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
export async function downloadCSV(name, csv) {
  if (isNative()) {
    // Android WebView cannot save blob downloads — use the system share sheet instead
    try {
      const file = new File(['\ufeff' + csv], name, { type: 'text/csv' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
    } catch { /* fall through */ }
    toast('CSV export works in the web version (browser).', 'info'); return;
  }
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ───────────── QR ─────────────
export function qrSVG(text, cell = 4) {
  if (!window.qrcode) return '';
  const q = window.qrcode(0, 'M');
  q.addData(text); q.make();
  return q.createSvgTag({ cellSize: cell, margin: 1, scalable: true });
}

export function whatsappLink(phone, text) {
  const p = String(phone || '').replace(/[^\d]/g, '');
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
