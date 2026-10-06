// Staff Mail — internal messages between Horse Cargo staff accounts.
import { t } from '../i18n.js';
import { rpc, state, errText } from '../api.js';
import { icon, esc, fdatetime, ago, modal, toast, busy, debounce, empty, $ } from '../ui.js';
import { refreshMailBadge } from '../mailbadge.js';

const FOLDERS = [['inbox', 'inbox', 'inbox'], ['sent', 'sent_box', 'send'], ['archived', 'archived', 'archive'], ['trash', 'trash', 'trash']];
let directory = null;
const loadDirectory = async () => { if (!directory) directory = await rpc('mail_directory', { p_q: null }).catch(() => []); return directory; };
const initial = (n) => esc(String(n || '?').trim().slice(0, 1).toUpperCase());
const roleOf = (r) => (r ? t('r_' + r) : '');

// ───────── recipient picker (search active staff, chips) ─────────
function picker(host, dir, selected = [], { label, id }) {
  let sel = [...new Set(selected)].filter((x) => dir.some((d) => d.id === x));
  host.innerHTML = `<label for="${id}">${esc(label)}</label>
    <div class="rcpt" data-rcpt><span class="rcpt-chips"></span>
      <input class="rcpt-in" id="${id}" autocomplete="off" placeholder="${esc(t('search_staff'))}" role="combobox" aria-expanded="false"></div>
    <div class="rcpt-list hidden" role="listbox"></div>`;
  const chips = host.querySelector('.rcpt-chips'); const input = host.querySelector('input'); const list = host.querySelector('.rcpt-list');
  const paint = () => {
    chips.innerHTML = sel.map((uid) => { const d = dir.find((x) => x.id === uid); return `<span class="rchip" data-uid="${uid}">${esc(d?.name || '?')}<button type="button" aria-label="remove" data-rm="${uid}">×</button></span>`; }).join('');
  };
  const show = () => {
    const q = input.value.trim().toLowerCase();
    const hits = dir.filter((d) => !sel.includes(d.id) && (!q || d.name.toLowerCase().includes(q) || (d.email || '').toLowerCase().includes(q) || roleOf(d.role).toLowerCase().includes(q))).slice(0, 8);
    list.innerHTML = hits.map((d) => `<button type="button" class="rcpt-opt" role="option" data-add="${d.id}"><b>${esc(d.name)}</b><span class="muted small">${esc(roleOf(d.role))}${d.branch ? ' · ' + esc(d.branch) : ''}</span></button>`).join('')
      || `<div class="muted small" style="padding:8px">${esc(t('nothing_here'))}</div>`;
    list.classList.remove('hidden'); input.setAttribute('aria-expanded', 'true');
  };
  const hide = () => { list.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); };
  input.addEventListener('focus', show);
  input.addEventListener('input', show);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const first = list.querySelector('[data-add]'); if (first) first.click(); }
    if (e.key === 'Backspace' && !input.value && sel.length) { sel.pop(); paint(); }
    if (e.key === 'Escape') hide();
  });
  host.addEventListener('mousedown', (e) => { if (e.target.closest('[data-add]')) e.preventDefault(); });
  host.addEventListener('click', (e) => {
    const a = e.target.closest('[data-add]'); if (a) { sel.push(a.dataset.add); input.value = ''; paint(); show(); input.focus(); return; }
    const r = e.target.closest('[data-rm]'); if (r) { sel = sel.filter((x) => x !== r.dataset.rm); paint(); }
  });
  input.addEventListener('blur', () => setTimeout(hide, 150));
  paint();
  return { get: () => [...sel] };
}

async function compose({ to = [], cc = [], subject = '', body = '' } = {}) {
  const dir = await loadDirectory();
  const token = crypto.randomUUID();
  modal({
    title: t('compose'), wide: true,
    body: `<form class="form mail-form" id="mc" novalidate>
      <div class="field full" id="mc-to"></div>
      <div class="field full" id="mc-cc"></div>
      <div class="field full"><label class="req" for="mc-subject">${esc(t('subject'))}</label><input class="input" id="mc-subject" name="subject" maxlength="200" value="${esc(subject)}"></div>
      <div class="field full"><label class="req" for="mc-body">${esc(t('message'))}</label><textarea class="input" id="mc-body" name="body" rows="9">${esc(body)}</textarea></div>
    </form>`,
    foot: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="mc-send">${icon('send')}${esc(t('send'))}</button>`,
    onMount: (m) => {
      const pto = picker(m.el.querySelector('#mc-to'), dir, to, { label: t('mail_to'), id: 'mc-to-in' });
      const pcc = picker(m.el.querySelector('#mc-cc'), dir, cc, { label: t('mail_cc'), id: 'mc-cc-in' });
      if (body) { const ta = m.el.querySelector('#mc-body'); ta.setSelectionRange(0, 0); }
      m.el.querySelector('#mc-send').onclick = (ev) => busy(ev.currentTarget, async () => {
        const p = { to: pto.get(), cc: pcc.get(), subject: m.el.querySelector('#mc-subject').value.trim(), body: m.el.querySelector('#mc-body').value, client_token: token };
        if (!p.to.length && !p.cc.length) { toast(t('choose_recipient'), 'err'); return; }
        if (!p.subject || !p.body.trim()) { toast(t('required_fields'), 'err'); return; }
        try { const r = await rpc('mail_send', { p }); m.close(); toast(t('mail_sent')); location.hash = `#/mail/${r.thread_id}`; }
        catch (err) { toast(errText(err), 'err'); }
      });
    },
  });
}

export async function render(ctx) {
  if (ctx.params[0]) return thread(ctx);
  return inbox(ctx);
}

// ───────── folder list ─────────
async function inbox({ el, setTitle, query }) {
  setTitle(t('staff_mail'));
  let folder = FOLDERS.some((f) => f[0] === query.get('f')) ? query.get('f') : 'inbox';
  let q = '';
  el.innerHTML = `
    <div class="page-head"><div class="grow"><h1>${esc(t('staff_mail'))}</h1></div>
      <button class="btn primary" id="compose">${icon('plus')}${esc(t('compose'))}</button></div>
    <div class="mail-folders chips" role="tablist">${FOLDERS.map(([k, label, ic]) => `<button class="chip" role="tab" data-f="${k}">${icon(ic)} ${esc(t(label))}<span class="cnt" data-cnt="${k}"></span></button>`).join('')}</div>
    <div class="card" style="margin-top:12px">
      <div class="card-h"><div class="search" style="flex:1;max-width:460px">${icon('search')}<input class="input" id="mq" type="search" placeholder="${esc(t('mail_search_ph'))}" aria-label="${esc(t('mail_search_ph'))}"></div>
        <button class="icon-btn" id="mrefresh" title="${esc(t('retry'))}" aria-label="${esc(t('retry'))}">${icon('refresh')}</button></div>
      <div id="mlist"><div class="card-b"><div class="spinner"></div></div></div>
    </div>`;
  const paintTabs = () => el.querySelectorAll('[data-f]').forEach((b) => { b.classList.toggle('on', b.dataset.f === folder); b.setAttribute('aria-selected', b.dataset.f === folder); });
  const load = async () => {
    const box = $('#mlist', el);
    try {
      const { rows, total } = await rpc('mail_list', { p_folder: folder, p_q: q || null, p_limit: 100, p_offset: 0 });
      if (folder === 'inbox') { const n = rows.reduce((s, r) => s + Number(r.unread || 0), 0); const c = el.querySelector('[data-cnt="inbox"]'); if (c) c.textContent = n ? ` ${n}` : ''; }
      box.innerHTML = rows.length ? `<div class="mail-list">${rows.map((r) => {
        const who = folder === 'sent' ? `${esc(t('mail_to'))}: ${esc((r.participants || []).join(', ') || t('you'))}` : esc(r.last_sender_id === state.profile.id ? t('you') : r.last_sender || '');
        return `<a class="mail-row ${Number(r.unread) ? 'unread' : ''}" href="#/mail/${r.id}">
          <span class="av">${initial(r.last_sender)}</span>
          <span class="mr-main"><span class="mr-top"><span class="mr-who">${who}${Number(r.message_count) > 1 ? ` <span class="muted">(${r.message_count})</span>` : ''}</span>
            <span class="mr-time" title="${esc(fdatetime(r.last_at))}">${esc(ago(r.last_at))}</span></span>
            <span class="mr-subj">${Number(r.unread) ? `<span class="dot" aria-label="${esc(t('unread'))}"></span>` : ''}${esc(r.subject)}</span>
            <span class="mr-snip">${esc(r.snippet || '')}</span></span></a>`;
      }).join('')}</div>${total > rows.length ? `<div class="card-b muted small">${rows.length} / ${total}</div>` : ''}` : empty(t('no_mail'), 'mail');
    } catch (err) { box.innerHTML = `<div class="card-b"><div class="callout danger">${icon('alert')}<div>${esc(errText(err))}</div></div></div>`; }
  };
  el.addEventListener('click', (e) => {
    const f = e.target.closest('[data-f]');
    if (f) { folder = f.dataset.f; history.replaceState(null, '', `#/mail?f=${folder}`); paintTabs(); load(); }
  });
  $('#compose', el).onclick = () => compose();
  $('#mrefresh', el).onclick = () => { load(); refreshMailBadge(); };
  $('#mq', el).addEventListener('input', debounce((e) => { q = e.target.value.trim(); load(); }, 300));
  paintTabs();
  await load();
  refreshMailBadge();
  if (query.get('compose') === '1') compose();
  const timer = setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('.modal-bg')) load(); }, 30000);
  return () => clearInterval(timer);
}

// ───────── conversation ─────────
async function thread({ el, params, setTitle, rerender }) {
  const id = params[0];
  let th;
  try { th = await rpc('mail_thread', { p_thread: id }); }
  catch (err) {
    el.innerHTML = `<div class="card card-b"><div class="callout danger">${icon('lock')}<div>${esc(errText(err))}</div></div>
      <div style="margin-top:12px"><a class="btn" href="#/mail">${esc(t('back'))}</a></div></div>`;
    return;
  }
  refreshMailBadge();
  setTitle(th.subject);
  const me = state.profile.id;
  const msgs = th.messages || [];
  const last = msgs[msgs.length - 1];
  const names = (list) => list.map((r) => (r.id === me ? t('you') : r.name)).join(', ');

  el.innerHTML = `
  <div class="page-head mail-head">
    <div class="grow"><a class="small" href="#/mail">← ${esc(t('inbox'))}</a><h1 style="margin-top:4px">${esc(th.subject)}</h1>
      <p>${msgs.length} ${esc(t('messages_n'))}</p></div>
    <div class="row wrap-actions">
      <button class="btn sm" data-st="${th.archived ? 'unarchive' : 'archive'}">${icon(th.archived ? 'inbox' : 'archive')}${esc(t(th.archived ? 'unarchive' : 'archive'))}</button>
      <button class="btn sm" data-st="${th.trashed ? 'restore' : 'trash'}">${icon(th.trashed ? 'refresh' : 'trash')}${esc(t(th.trashed ? 'restore' : 'move_to_trash'))}</button>
      <button class="btn sm" data-st="unread">${icon('mail')}${esc(t('mark_unread'))}</button>
    </div>
  </div>
  <div class="mail-thread">${msgs.map((m) => {
    const to = (m.recipients || []).filter((r) => r.kind === 'to'); const cc = (m.recipients || []).filter((r) => r.kind === 'cc');
    return `<article class="mail-msg ${m.mine ? 'mine' : ''}" id="m-${m.id}">
      <header><span class="av">${initial(m.sender)}</span>
        <div class="grow"><b>${esc(m.mine ? t('you') : m.sender)}</b> <span class="muted small">${esc(roleOf(m.sender_role))}</span>
          <div class="muted small">${esc(t('mail_to'))}: ${esc(names(to))}${cc.length ? ` · ${esc(t('mail_cc'))}: ${esc(names(cc))}` : ''}</div></div>
        <span class="muted small nowrap" title="${esc(fdatetime(m.created_at))}">${esc(fdatetime(m.created_at))}</span></header>
      <div class="mail-body">${esc(m.body)}</div>
      ${m.mine ? `<footer class="receipts">${(m.recipients || []).map((r) => r.read_at
          ? `<span class="rr ok" title="${esc(fdatetime(r.read_at))}">${icon('check')} ${esc(r.name)} · ${esc(t('read_at'))} ${esc(ago(r.read_at))}</span>`
          : `<span class="rr">${icon('clock')} ${esc(r.name)} · ${esc(t('not_read_yet'))}</span>`).join('')}</footer>` : ''}
      <div class="msg-acts"><button class="btn sm ghost" data-r="reply" data-m="${m.id}">${icon('reply')}${esc(t('reply'))}</button>
        ${(m.recipients || []).length > 1 || !m.mine ? `<button class="btn sm ghost" data-r="all" data-m="${m.id}">${icon('replyAll')}${esc(t('reply_all'))}</button>` : ''}
        <button class="btn sm ghost" data-r="fwd" data-m="${m.id}">${icon('forward')}${esc(t('forward'))}</button></div>
    </article>`;
  }).join('')}</div>
  <div class="card mail-reply" id="reply-box">
    <div class="card-b row" style="gap:8px;flex-wrap:wrap">
      <button class="btn primary" data-r="reply" data-m="${last?.id || ''}">${icon('reply')}${esc(t('reply'))}</button>
      <button class="btn" data-r="all" data-m="${last?.id || ''}">${icon('replyAll')}${esc(t('reply_all'))}</button>
      <button class="btn" data-r="fwd" data-m="${last?.id || ''}">${icon('forward')}${esc(t('forward'))}</button>
    </div>
  </div>`;
  // bring the newest message into view on long threads
  if (msgs.length > 2) setTimeout(() => document.getElementById(`m-${last.id}`)?.scrollIntoView({ block: 'start' }), 30);

  const replyTargets = (m, all) => {
    const to = (m.recipients || []).filter((r) => r.kind === 'to').map((r) => r.id);
    const cc = (m.recipients || []).filter((r) => r.kind === 'cc').map((r) => r.id);
    if (!all) return { to: m.mine ? to : [m.sender_id], cc: [] };
    const T = m.mine ? to : [m.sender_id, ...to];
    return { to: [...new Set(T)].filter((x) => x !== me), cc: cc.filter((x) => x !== me && !T.includes(x)) };
  };

  const openReply = async (m, all) => {
    const dir = await loadDirectory();
    const { to, cc } = replyTargets(m, all);
    const token = crypto.randomUUID();
    const box = $('#reply-box', el);
    box.innerHTML = `<div class="card-h"><h2>${esc(all ? t('reply_all') : t('reply'))}</h2><button class="icon-btn" id="rx" aria-label="${esc(t('cancel'))}">${icon('x')}</button></div>
      <div class="card-b"><form class="form mail-form" novalidate>
        <div class="field full" id="r-to"></div><div class="field full" id="r-cc"></div>
        <div class="field full"><label class="req" for="r-body">${esc(t('message'))}</label><textarea class="input" id="r-body" rows="6"></textarea></div>
      </form><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn primary" id="r-send">${icon('send')}${esc(t('send'))}</button></div></div>`;
    const pto = picker($('#r-to', box), dir, to, { label: t('mail_to'), id: 'r-to-in' });
    const pcc = picker($('#r-cc', box), dir, cc, { label: t('mail_cc'), id: 'r-cc-in' });
    $('#r-body', box).focus();
    box.scrollIntoView({ block: 'nearest' });
    $('#rx', box).onclick = () => rerender();
    $('#r-send', box).onclick = (ev) => busy(ev.currentTarget, async () => {
      const body = $('#r-body', box).value;
      const p = { thread_id: id, to: pto.get(), cc: pcc.get(), body, client_token: token };
      if (!p.to.length && !p.cc.length) { toast(t('choose_recipient'), 'err'); return; }
      if (!body.trim()) { toast(t('required_fields'), 'err'); return; }
      try { await rpc('mail_send', { p }); toast(t('mail_sent')); rerender(); } catch (err) { toast(errText(err), 'err'); }
    });
  };

  el.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-r]');
    if (r) {
      const m = msgs.find((x) => x.id === r.dataset.m); if (!m) return;
      if (r.dataset.r === 'fwd') {
        const subj = /^fwd:/i.test(th.subject) ? th.subject : `Fwd: ${th.subject}`;
        const quoted = `\n\n---------- Forwarded message ----------\nFrom: ${m.sender}\nDate: ${fdatetime(m.created_at)}\nSubject: ${th.subject}\n\n${m.body}`;
        compose({ subject: subj, body: quoted });
      } else openReply(m, r.dataset.r === 'all');
      return;
    }
    const s = e.target.closest('[data-st]');
    if (s) busy(s, async () => {
      try {
        await rpc('mail_set_state', { p_thread: id, p_action: s.dataset.st });
        await refreshMailBadge();
        if (['archive', 'trash', 'unread'].includes(s.dataset.st)) location.hash = '#/mail'; else rerender();
      } catch (err) { toast(errText(err), 'err'); }
    });
  });
}
