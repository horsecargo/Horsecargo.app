import { t, getLang } from './i18n.js';

const cfg = window.HC_CONFIG || {};
export const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_URL.includes('YOUR-PROJECT'));
export const sb = configured
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'hc.auth' } })
  : null;

export const state = { user: null, profile: null, settings: null, branches: [], categories: [], companies: [], perms: null };

// ───────── error translation (server refusals → readable text) ─────────
const SW = {
  NOT_ALLOWED: 'Cheo chako hakiruhusu kitendo hiki.',
  SEGREGATION: 'Mgawanyo wa majukumu: mtu mwingine lazima afanye hatua hii.',
};
export function errText(e) {
  let m = (e && (e.message || e.error_description || e.msg)) || String(e);
  const code = (m.match(/^([A-Z_]+):/) || [])[1];
  if (m.includes('Invalid login credentials')) return getLang() === 'sw' ? 'Barua pepe au nenosiri si sahihi.' : 'Wrong email or password.';
  if (m.includes('Failed to fetch') || m.includes('NetworkError')) return getLang() === 'sw' ? 'Hakuna mtandao. Jaribu tena.' : 'No connection. Please try again.';
  if (code === 'NOT_ALLOWED') return getLang() === 'sw' ? SW.NOT_ALLOWED : 'Your role is not allowed to do this.';
  if (code && getLang() === 'sw' && SW[code]) return SW[code];
  if (m.includes('permission denied')) return getLang() === 'sw' ? SW.NOT_ALLOWED : 'Your role is not allowed to do this.';
  return m.replace(/^[A-Z_]+:\s*/, '');
}
export function errCode(e) { return ((e?.message || '').match(/^([A-Z_]+):/) || [])[1] || null; }

// ───────── thin query helpers ─────────
export async function run(builder) {
  const { data, error, count } = await builder;
  if (error) throw error;
  return count !== undefined && count !== null ? { data, count } : data;
}
export async function rpc(fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data;
}
export const from = (table) => sb.from(table);

// ───────── session / cached reference data ─────────
export async function loadSession() {
  const { data } = await sb.auth.getSession();
  state.user = data.session?.user || null;
  if (!state.user) { state.profile = null; return null; }
  const { data: p, error } = await sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
  if (error) throw error;
  state.profile = p;
  await loadPermissions();
  return p;
}

// What this user may actually do, straight from the database: their role's
// permissions plus anything the administrator has lent them temporarily.
// The screen hides what they cannot do; the server refuses it regardless.
export async function loadPermissions() {
  try {
    const list = await rpc('my_permissions');
    state.perms = Array.isArray(list) ? list : [];
  } catch {
    state.perms = null;      // fall back to the role table below
  }
  return state.perms;
}
export async function loadReference(force = false) {
  if (state.settings && !force) return;
  const [s, b, c, co] = await Promise.all([
    run(sb.from('settings').select('*').eq('id', 1).maybeSingle()),
    run(sb.from('branches').select('*').order('code')),
    run(sb.from('cargo_categories').select('*').order('name')),
    sb.from('companies').select('*').order('code').then((r) => r.data || []),  // empty if accounting not installed
  ]);
  state.settings = s; state.branches = b || []; state.categories = c || []; state.companies = co;
}
export const branchName = (code) => state.branches.find((b) => b.code === code)?.name || code || '—';
export const catName = (row) => (getLang() === 'sw' && row.category_name_sw) ? row.category_name_sw : row.category_name;

// ───────── permissions ─────────
// state.perms, loaded from the database, is what decides. This table is only a
// fallback for the moment before it arrives (or if that one call fails).
const PERMS = {
  'customer.write': ['manager', 'counter', 'cashier', 'operations', 'accountant', 'sales_marketing', 'customer_care'],
  'shipment.create': ['manager', 'counter', 'operations', 'warehouse', 'logistics'],
  'shipment.edit': ['manager', 'counter', 'operations', 'logistics'],
  'shipment.cancel': ['manager'],
  'shipment.status': ['operations', 'manager', 'warehouse', 'counter', 'release_officer', 'logistics'],
  'payment.record': ['cashier', 'manager', 'counter'],
  'payment.void': ['manager'],
  'grn.record': ['warehouse', 'manager', 'operations', 'logistics'],
  'charge.add': ['manager', 'counter', 'operations'],
  'charge.discount': ['manager'],
  'charge.remove': ['manager'],
  'rate.override': ['manager'],
  'currency.set': ['manager', 'cashier', 'counter'],
  'tracking.note': ['operations', 'manager', 'counter', 'warehouse', 'logistics'],
  'deliver': ['release_officer', 'manager', 'operations', 'counter', 'logistics'],
  'rates.write': ['manager'],
  'settings.write': ['manager'],
  'audit.read': ['manager'],
  'reports.read': ['manager', 'cashier', 'operations'],
  'users.manage': [],
  'acc.read': ['accountant', 'finance_manager', 'manager'],
  'acc.write': ['accountant', 'finance_manager'],
  'acc.approve': ['finance_manager'],
  'doc.approve': ['manager', 'finance_manager'],
  'storage.read': ['manager', 'counter', 'warehouse', 'operations', 'cashier', 'accountant', 'release_officer', 'logistics'],
  'storage.pack': ['manager', 'warehouse', 'operations', 'logistics'],
  'storage.correct': ['manager'],
  'staff.manage': [],
  // v6 module permissions (fallback only — the database matrix decides)
  'shipment.read': ['manager', 'operations', 'accountant', 'logistics', 'sales_marketing', 'customer_care', 'counter', 'warehouse', 'cashier', 'release_officer', 'finance_manager', 'viewer'],
  'customer.read': ['manager', 'operations', 'accountant', 'sales_marketing', 'sourcing', 'customer_care', 'counter', 'warehouse', 'cashier', 'release_officer', 'finance_manager', 'viewer'],
  'grn.read': ['manager', 'operations', 'accountant', 'logistics', 'counter', 'warehouse', 'cashier', 'release_officer', 'finance_manager', 'viewer'],
  'label.read': ['manager', 'operations', 'logistics', 'counter', 'warehouse', 'cashier', 'release_officer', 'finance_manager', 'viewer'],
  'invoice.read': ['manager', 'accountant', 'counter', 'warehouse', 'cashier', 'release_officer', 'finance_manager', 'viewer'],
  'payment.read': ['manager', 'accountant', 'counter', 'warehouse', 'cashier', 'release_officer', 'finance_manager', 'viewer'],
  'packing.read': ['manager', 'operations', 'logistics', 'counter', 'warehouse', 'cashier', 'release_officer', 'finance_manager', 'viewer'],
  'scan.use': ['manager', 'operations', 'logistics', 'customer_care', 'counter', 'warehouse', 'cashier', 'release_officer', 'finance_manager', 'viewer'],
  'staff.read': ['manager', 'hr'],
  'lead.create': ['manager', 'operations', 'hr', 'accountant', 'logistics', 'sales_marketing', 'sourcing', 'customer_care', 'counter', 'warehouse', 'cashier', 'release_officer', 'finance_manager', 'viewer'],
  'lead.read': ['manager', 'sales_marketing', 'sourcing', 'customer_care', 'counter'],
  'lead.assign': ['manager'],
  'lead.convert': ['manager', 'sales_marketing', 'customer_care'],
  'sourcing.read': ['manager', 'sales_marketing', 'sourcing'],
  'sourcing.write': ['manager', 'sourcing'],
  'mail.use': ['manager', 'operations', 'hr', 'accountant', 'logistics', 'sales_marketing', 'sourcing', 'customer_care', 'counter', 'warehouse', 'cashier', 'release_officer', 'finance_manager', 'viewer'],
  'doc.revoke': ['manager'],
};
export function can(action) {
  const r = state.profile?.role;
  if (!r || !state.profile?.active) return false;
  if (r === 'admin') return true;
  if (Array.isArray(state.perms)) return state.perms.includes(action);
  return (PERMS[action] || []).includes(r);
}
export const canAny = (...actions) => actions.some((a) => can(a));
export const hasGranted = (action) =>
  Array.isArray(state.perms) && state.perms.includes(action) && !(PERMS[action] || []).includes(state.profile?.role);
export const isAdmin = () => state.profile?.role === 'admin' && state.profile?.active;

// ───────── pricing preview (the server is authoritative) ─────────
export const rateFor = (mode, catId) => {
  const c = state.categories.find((x) => x.id === Number(catId));
  if (!c) return 0;
  return Number(mode === 'sea' ? c.sea_rate_cbm : c.air_rate_kg);
};
export function chargeQty(mode, cbm, kg) {
  const s = state.settings; if (!s) return 0;
  if (mode === 'sea') return Math.round(Math.max(Number(cbm || 0), Number(s.min_cbm_sea)) * 1000) / 1000;
  const vol = Math.round(Number(cbm || 0) * 1e6 / Number(s.air_volumetric_divisor) * 10) / 10;
  return Math.round(Math.max(Number(kg || 0), vol) * 10) / 10;
}
export function estimateFreight(mode, catId, cbm, kg, rate) {
  const c = state.categories.find((x) => x.id === Number(catId));
  const r = rate === undefined || rate === null || rate === '' ? rateFor(mode, catId) : Number(rate);
  const amt = Math.round(chargeQty(mode, cbm, kg) * r * 100) / 100;
  if (!c) return amt;
  return Math.max(amt, Number(mode === 'sea' ? c.min_charge_sea : c.min_charge_air) || 0);
}
export const fxFor = (cur) => {
  const s = state.settings || {};
  return cur === 'AED' ? Number(s.fx_aed) : cur === 'TZS' ? Number(s.fx_tzs) : 1;
};
export const destinations = () => state.branches.filter((b) => b.code !== 'DXB' && b.active);

export function appBase() {
  const cfg2 = window.HC_CONFIG || {};
  if (cfg2.APP_URL) return cfg2.APP_URL.replace(/\/+$/, '') + '/';
  if (cfg2.PUBLIC_TRACK_URL) return cfg2.PUBLIC_TRACK_URL.replace(/[^/]*$/, '');
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}
export const verifyUrl = (token) => `${appBase()}verify.html?d=${encodeURIComponent(token)}`;

export function publicTrackUrl(ref) {
  const base = cfg.PUBLIC_TRACK_URL || (location.origin + location.pathname.replace(/[^/]*$/, '') + 'track.html');
  return `${base}?ref=${encodeURIComponent(ref)}`;
}
export const photoBucket = () => cfg.PHOTO_BUCKET || '';
export { t };
