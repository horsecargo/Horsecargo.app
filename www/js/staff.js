// Active staff, for "assign to" pickers (cached for the session).
import { from, run } from './api.js';
import { t } from './i18n.js';
import { esc } from './ui.js';

let cache = null;
export async function activeStaff() {
  if (!cache) cache = run(from('profiles').select('id,full_name,email,role,branch_code,active').eq('active', true).order('full_name')).catch(() => []);
  return cache;
}
export const staffName = (list, id) => { const p = list.find((x) => x.id === id); return p ? (p.full_name || p.email) : ''; };
export const staffOptions = (list, selected, { blank = true } = {}) =>
  (blank ? `<option value="">${esc(t('unassigned'))}</option>` : '') +
  list.map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.full_name || p.email)} · ${esc(t('r_' + p.role))}</option>`).join('');
