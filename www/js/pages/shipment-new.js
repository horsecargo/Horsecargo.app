import { t } from '../i18n.js';
import { from, run, rpc, can, state, errText, estimateFreight, chargeQty, rateFor, fxFor, destinations, branchName } from '../api.js';
import { icon, esc, usd, money, num, toast, busy, debounce, $, $$ } from '../ui.js';

const UNITS = ['PCS', 'CTN', 'BOX', 'BAG', 'PALLET', 'ROLL', 'SET', 'DRUM'];
const CHARGES = ['packing', 'handling', 'storage', 'delivery', 'other'];
const blankParty = () => ({ customer_id: '', name: '', phone: '', email: '', address: '', tin: '' });

export async function render({ el, params, setTitle, query }) {
  const editId = params?.[0] || null;
  if (!can(editId ? 'shipment.edit' : 'shipment.create')) {
    el.innerHTML = `<div class="callout danger">${icon('lock')}<div>${esc(t('not_allowed'))}</div></div>`; return;
  }
  setTitle(editId ? t('edit_shipment') : t('new_shipment'));

  const d = {
    mode: 'sea', origin_branch: state.profile?.branch_code === 'DXB' ? 'DXB' : 'DXB',
    destination_branch: destinations()[0]?.code || 'DAR',
    sender: blankParty(), receiver: blankParty(),
    items: [{ description: '', category_id: state.categories[0]?.id || null, qty: 1, unit: 'PCS' }],
    cbm: '', weight_kg: '', rate: '', rate_note: '', charges: [],
    currency: state.settings?.default_billing_currency || 'TZS', fx_rate: '', notes: '',
  };
  let existing = null;
  if (editId) {
    existing = await run(from('v_shipments').select('*').eq('id', editId).single());
    const items = await run(from('shipment_items').select('*').eq('shipment_id', editId).order('id'));
    Object.assign(d, {
      mode: existing.mode, origin_branch: existing.origin_branch, destination_branch: existing.destination_branch,
      sender: { customer_id: existing.customer_id, name: existing.sender_name || existing.customer_name, phone: existing.sender_phone || existing.customer_phone, email: existing.sender_email || '', address: existing.sender_address || '' },
      receiver: { customer_id: existing.receiver_customer_id || '', name: existing.receiver_name, phone: existing.receiver_phone, email: existing.receiver_email || '', address: existing.receiver_address || '', tin: existing.receiver_tin || '' },
      items: items.length ? items.map((i) => ({ id: i.id, description: i.description, category_id: i.category_id, qty: Number(i.qty), unit: i.unit })) : d.items,
      cbm: existing.cbm ?? '', weight_kg: existing.weight_kg ?? existing.actual_kg ?? '',
      rate: existing.rate_used ?? '', rate_note: existing.rate_note || '', notes: existing.notes || '',
      currency: existing.invoice_currency || 'USD',
    });
  }
  const STEPS = editId
    ? [['parties', 'w_parties'], ['method', 'w_method'], ['items', 'w_items'], ['measure', 'w_measure'], ['price', 'w_price'], ['review', 'w_review']]
    : [['parties', 'w_parties'], ['method', 'w_method'], ['items', 'w_items'], ['measure', 'w_measure'], ['price', 'w_price'], ['charges', 'w_charges'], ['currency', 'w_currency'], ['review', 'w_review']];
  let step = 0;

  el.innerHTML = `
  <div class="page-head">
    <div class="grow"><a class="small" href="${editId ? '#/shipment/' + editId : '#/shipments'}">← ${esc(editId ? existing.ref : t('shipments'))}</a>
      <h1>${esc(editId ? t('edit_shipment') : t('new_shipment'))}</h1></div>
  </div>
  <div class="wiz">
    <div class="wiz-steps" id="steps">${STEPS.map(([k, lbl], i) => `<div class="wiz-step" data-i="${i}"><span class="n">${i + 1}</span><span class="l">${esc(t(lbl))}</span></div>`).join('')}</div>
    <div class="wiz-bar"><div id="bar"></div></div>
    <div class="card"><div class="card-b" id="body"></div></div>
    <div class="wiz-foot">
      <button class="btn" id="back">${icon('arrowLeft')}${esc(t('back'))}</button>
      <div class="grow small muted" id="hint"></div>
      <button class="btn primary" id="next">${esc(t('next'))}</button>
    </div>
  </div>`;

  const price = () => estimateFreight(d.mode, primaryCat(), d.cbm, d.weight_kg, d.rate === '' ? null : d.rate);
  const primaryCat = () => d.items.find((i) => i.category_id)?.category_id || state.categories[0]?.id;
  const fxNow = () => (d.fx_rate === '' ? fxFor(d.currency) : Number(d.fx_rate)) || 1;
  // every charge is converted at most once, into the billing currency
  const chargeTxn = (c) => {
    const amt = Number(c.amount || 0);
    return (c.currency || d.currency) === 'USD' && d.currency !== 'USD' ? amt * fxNow() : amt;
  };
  const chargesTxn = () => d.charges.reduce((a, c) => a + chargeTxn(c), 0);
  const chargesTotal = () => d.charges.reduce((a, c) => a + ((c.currency || d.currency) === 'USD' ? Number(c.amount || 0) : Number(c.amount || 0) / fxNow()), 0);
  const grandTxn = () => Math.round((price() * fxNow() + chargesTxn()) * 100) / 100;
  const grand = () => Math.round((price() + chargesTotal()) * 100) / 100;

  // ───────── step renderers ─────────
  const partyBox = (who) => {
    const p = d[who];
    return `<div class="card" style="box-shadow:none;border:1px solid var(--line)">
      <div class="card-h"><h2>${icon(who === 'sender' ? 'user' : 'users')}${esc(t(who))}</h2>
        ${p.customer_id ? `<span class="badge plain">${esc(t('existing_customer'))}</span>` : ''}</div>
      <div class="card-b">
        <div class="search" style="margin-bottom:10px"><span>${icon('search')}</span>
          <input class="input" data-find="${who}" placeholder="${esc(t('find_customer'))}" autocomplete="off"></div>
        <div class="cust-hits" data-hits="${who}"></div>
        <div class="form">
          <div class="field full"><label class="req">${esc(t('full_name'))}</label><input class="input" data-f="${who}.name" value="${esc(p.name)}"></div>
          <div class="field"><label class="req">${esc(t('phone'))}</label><input class="input" type="tel" data-f="${who}.phone" value="${esc(p.phone)}" placeholder="0712 345 678"></div>
          <div class="field"><label>${esc(t('email'))}</label><input class="input" type="email" data-f="${who}.email" value="${esc(p.email || '')}"></div>
          <div class="field full"><label>${esc(t('address'))}</label><input class="input" data-f="${who}.address" value="${esc(p.address || '')}"></div>
          ${who === 'receiver' ? `<div class="field"><label>TIN</label><input class="input" data-f="receiver.tin" value="${esc(p.tin || '')}"></div>` : ''}
        </div>
      </div></div>`;
  };

  const sums = {
    items: () => `<div class="money">
        <div><div class="k">${esc(t('item_types'))}</div><div class="v">${d.items.length}</div></div>
        <div><div class="k">${esc(t('total_qty'))}</div><div class="v">${num(d.items.reduce((a, i) => a + Number(i.qty || 0), 0), 2)}</div></div>
      </div>
      <p class="muted small">${esc(t('qty_hint'))}</p>`,
    measure: () => `<div class="callout info">${icon('info')}<div>
        ${esc(t('chargeable'))}: <b>${num(chargeQty(d.mode, d.cbm, d.weight_kg), d.mode === 'sea' ? 3 : 1)} ${d.mode === 'sea' ? 'CBM' : 'kg'}</b>
        <div class="small">${esc(d.mode === 'sea' ? t('min_cbm_note') : t('volumetric_note'))}</div></div></div>`,
    price: () => `<div class="calc">
        <div><span>${esc(t('chargeable'))}</span><b>${num(chargeQty(d.mode, d.cbm, d.weight_kg), d.mode === 'sea' ? 3 : 1)} ${d.mode === 'sea' ? 'CBM' : 'kg'}</b></div>
        <div><span>×</span><b>USD ${num(d.rate === '' ? rateFor(d.mode, primaryCat()) : d.rate, 2)}</b></div>
        <div class="tot"><span>${esc(t('base_shipping'))}</span><b>${usd(price())}</b></div></div>`,
    charges: () => `<div class="calc">
        <div><span>${esc(t('base_shipping'))}</span><b>${money(price() * fxNow(), d.currency)}</b></div>
        <div><span>${esc(t('additional_charges'))}</span><b>${money(chargesTxn(), d.currency)}</b></div>
        <div class="tot"><span>${esc(t('grand_total'))}</span><b>${money(grandTxn(), d.currency)}</b></div>
        ${d.currency !== 'USD' ? `<div><span>USD</span><b>${usd(grand())}</b></div>` : ''}</div>`,
  };

  const views = {
    parties: () => `<p class="muted small" style="margin-top:0">${esc(t('parties_hint'))}</p>
      <div class="split">${partyBox('sender')}${partyBox('receiver')}</div>`,

    method: () => `<div class="pick-grid">
        ${['sea', 'air'].map((m) => `<button type="button" class="pick ${d.mode === m ? 'on' : ''}" data-mode="${m}">
          <span class="pi">${icon(m === 'air' ? 'plane' : 'ship')}</span>
          <b>${esc(t(m === 'air' ? 'air_cargo' : 'sea_cargo'))}</b>
          <span class="muted small">${esc(t(m === 'air' ? 'charged_kg' : 'charged_cbm'))}</span></button>`).join('')}
      </div>
      <h3 style="margin:18px 0 8px;font-size:14px">${esc(t('destination'))}</h3>
      <div class="pick-grid">
        ${destinations().map((b) => `<button type="button" class="pick ${d.destination_branch === b.code ? 'on' : ''}" data-dest="${b.code}">
          <span class="pi">${icon('truck')}</span><b>${esc(b.name)}</b><span class="muted small mono">${esc(b.code)}</span></button>`).join('')}
      </div>
      <p class="muted small">${esc(t('origin'))}: <b>${esc(branchName(d.origin_branch))}</b></p>`,

    items: () => `<div class="table-wrap"><table class="t" id="items"><thead><tr>
        <th>${esc(t('description'))}</th><th>${esc(t('cargo_category'))}</th><th class="num">${esc(t('qty'))}</th><th>${esc(t('unit'))}</th><th></th></tr></thead>
      <tbody>${d.items.map((it, i) => `<tr>
        <td><input class="input sm" data-it="${i}.description" value="${esc(it.description)}" placeholder="${esc(t('item_ph'))}" style="min-width:160px"></td>
        <td><select class="input sm" data-it="${i}.category_id">${state.categories.map((c) => `<option value="${c.id}" ${Number(it.category_id) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></td>
        <td><input class="input sm num" type="number" step="0.01" min="0" data-it="${i}.qty" value="${esc(String(it.qty))}" style="width:90px"></td>
        <td><select class="input sm" data-it="${i}.unit">${UNITS.map((u) => `<option ${it.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></td>
        <td>${d.items.length > 1 ? `<button type="button" class="icon-btn" data-rm-item="${i}">${icon('trash')}</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <button type="button" class="btn sm" id="add-item" style="margin-top:10px">${icon('plus')}${esc(t('add_item'))}</button>
      <div id="sum" style="margin-top:14px">${sums.items()}</div>`,

    measure: () => `<div class="form">
        ${d.mode === 'sea' ? `
        <div class="field"><label class="req">${esc(t('total_cbm'))}</label><input class="input" type="number" step="0.001" min="0" inputmode="decimal" data-f="cbm" value="${esc(String(d.cbm))}"></div>
        <div class="field"><label>${esc(t('total_weight'))} (kg)</label><input class="input" type="number" step="0.1" min="0" inputmode="decimal" data-f="weight_kg" value="${esc(String(d.weight_kg))}"></div>`
        : `
        <div class="field"><label class="req">${esc(t('total_weight'))} (kg)</label><input class="input" type="number" step="0.1" min="0" inputmode="decimal" data-f="weight_kg" value="${esc(String(d.weight_kg))}"></div>
        <div class="field"><label>${esc(t('total_cbm'))} <span class="muted small">(${esc(t('for_volumetric'))})</span></label><input class="input" type="number" step="0.001" min="0" inputmode="decimal" data-f="cbm" value="${esc(String(d.cbm))}"></div>`}
      </div>
      <div id="sum" style="margin-top:12px">${sums.measure()}</div>`,

    price: () => {
      const base = rateFor(d.mode, primaryCat());
      const q = chargeQty(d.mode, d.cbm, d.weight_kg);
      return `<div class="form">
        <div class="field"><label>${esc(t('company_rate'))}</label><input class="input" value="USD ${base} / ${d.mode === 'sea' ? 'CBM' : 'kg'}" readonly></div>
        <div class="field"><label>${esc(t('rate_used'))}</label>
          <input class="input" type="number" step="0.01" min="0" data-f="rate" value="${esc(String(d.rate === '' ? base : d.rate))}" ${can('rate.override') ? '' : 'readonly'}>
          ${can('rate.override') ? `<div class="hint">${esc(t('rate_override_hint'))}</div>` : ''}</div>
        ${can('rate.override') ? `<div class="field full"><label>${esc(t('rate_note'))}</label><input class="input" data-f="rate_note" value="${esc(d.rate_note)}" placeholder="${esc(t('rate_note_ph'))}"></div>` : ''}
      </div>
      <div id="sum">${sums.price()}</div>`;
    },

    charges: () => `<p class="muted small" style="margin-top:0">${esc(t('charges_hint'))}</p>
      <div class="table-wrap"><table class="t" id="charges"><thead><tr>
        <th>${esc(t('charge_type'))}</th><th>${esc(t('description'))}</th><th class="num">${esc(t('amount'))}</th><th>${esc(t('currency'))}</th><th></th></tr></thead>
      <tbody>${d.charges.map((c, i) => `<tr>
        <td><select class="input sm" data-ch="${i}.charge_type">${CHARGES.map((k) => `<option value="${k}" ${c.charge_type === k ? 'selected' : ''}>${esc(t('ch_' + k))}</option>`).join('')}</select></td>
        <td><input class="input sm" data-ch="${i}.description" value="${esc(c.description || '')}" style="min-width:140px"></td>
        <td><input class="input sm num" type="number" step="0.01" min="0" data-ch="${i}.amount" value="${esc(String(c.amount || ''))}" style="width:110px"></td>
        <td><select class="input sm" data-ch="${i}.currency" style="width:92px">
          ${[d.currency, 'USD'].filter((x, j, a) => a.indexOf(x) === j).map((cc) => `<option value="${cc}" ${(c.currency || d.currency) === cc ? 'selected' : ''}>${cc}</option>`).join('')}</select></td>
        <td><button type="button" class="icon-btn" data-rm-ch="${i}">${icon('trash')}</button></td></tr>`).join('')}
      </tbody></table></div>
      <button type="button" class="btn sm" id="add-ch" style="margin-top:10px">${icon('plus')}${esc(t('add_charge'))}</button>
      <div id="sum" style="margin-top:14px">${sums.charges()}</div>`,

    currency: () => {
      const fx = fxNow();
      return `<div class="pick-grid">
        ${['USD', 'TZS', 'AED'].map((c) => `<button type="button" class="pick ${d.currency === c ? 'on' : ''}" data-cur="${c}">
          <span class="pi">${icon('money')}</span><b>${c}</b>
          <span class="muted small">${money(c === d.currency ? grandTxn() : grand() * (c === 'USD' ? 1 : fxFor(c)), c)}</span></button>`).join('')}
      </div>
      <div class="form" style="margin-top:14px">
        <div class="field"><label class="req">${esc(t('fx_rate'))} · 1 USD = </label><input class="input" type="number" step="0.0001" min="0.0001" data-f="fx_rate" value="${esc(String(fx))}" ${d.currency === 'USD' ? 'readonly' : ''}></div>
        <div class="field"><label>${esc(t('amount_due'))}</label><input class="input" value="${money(grandTxn(), d.currency)}" readonly></div>
      </div>
      <p class="muted small">${esc(t('fx_hint'))}</p>`;
    },

    review: () => `
      <div class="split">
        <div class="stack">
          ${rev(t('sender'), `${esc(d.sender.name)}<div class="muted small">${esc(d.sender.phone)}${d.sender.address ? ' · ' + esc(d.sender.address) : ''}</div>`)}
          ${rev(t('receiver'), `${esc(d.receiver.name)}<div class="muted small">${esc(d.receiver.phone)}${d.receiver.address ? ' · ' + esc(d.receiver.address) : ''}</div>`)}
          ${rev(t('shipping_method'), `${esc(t(d.mode === 'air' ? 'air_cargo' : 'sea_cargo'))} · ${esc(branchName(d.origin_branch))} → ${esc(branchName(d.destination_branch))}`)}
          ${rev(t('cargo'), d.items.map((i) => `${esc(i.description || t('cargo'))} — ${num(i.qty, 2)} ${esc(i.unit)}`).join('<br>'))}
        </div>
        <div class="stack">
          ${rev(t('measure'), d.mode === 'sea' ? `${num(d.cbm, 3)} CBM` : `${num(d.weight_kg, 1)} kg`)}
          <div class="card" style="box-shadow:none;border:1px solid var(--line)"><div class="card-b">
            <div class="calc">
              <div><span>${esc(t('base_shipping'))}</span><b>${money(price() * fxNow(), d.currency)}</b></div>
              ${d.charges.filter((c) => Number(c.amount)).map((c) => `<div><span>${esc(t('ch_' + c.charge_type))}${c.description ? ' · ' + esc(c.description) : ''}</span><b>${money(c.amount, c.currency || d.currency)}</b></div>`).join('')}
              <div class="tot"><span>${esc(t('grand_total'))}</span><b>${money(grandTxn(), d.currency)}</b></div>
              ${d.currency !== 'USD' ? `<div><span>USD · 1 USD = ${num(fxNow(), 2)} ${esc(d.currency)}</span><b>${usd(grand())}</b></div>` : ''}
            </div></div></div>
          <div class="form"><div class="field full"><label>${esc(t('notes'))}</label><textarea class="input" rows="2" data-f="notes">${esc(d.notes)}</textarea></div></div>
        </div>
      </div>
      <div class="callout ok" style="margin-top:14px">${icon('check')}<div>${esc(editId ? t('edit_ready') : t('create_ready'))}</div></div>`,
  };
  const rev = (label, html) => `<div class="card" style="box-shadow:none;border:1px solid var(--line)">
    <div class="card-b"><div class="muted small">${esc(label)}</div><div style="margin-top:4px">${html}</div></div></div>`;

  // ───────── wiring ─────────
  const draw = () => {
    const key = STEPS[step][0];
    $('#body', el).innerHTML = views[key]();
    $$('#steps .wiz-step', el).forEach((s, i) => s.classList.toggle('on', i === step) || s.classList.toggle('done', i < step));
    $('#bar', el).style.width = `${(step + 1) / STEPS.length * 100}%`;
    $('#back', el).style.visibility = step === 0 ? 'hidden' : '';
    $('#next', el).innerHTML = step === STEPS.length - 1
      ? `${icon('check')}${esc(editId ? t('save_changes') : t('create_shipment'))}`
      : esc(t('next'));
    $('#next', el).classList.toggle('accent', step === STEPS.length - 1);
    $('#hint', el).textContent = `${step + 1} / ${STEPS.length}`;
    wire(key);
  };

  const setPath = (path, val) => {
    const [a, b] = path.split('.');
    if (b) d[a][b] = val; else d[a] = val;
  };

  function wire(key) {
    const body = $('#body', el);
    $$('[data-f]', body).forEach((inp) => {
      inp.oninput = () => { setPath(inp.dataset.f, inp.value); if (['cbm', 'weight_kg', 'rate'].includes(inp.dataset.f)) refreshCalc(); };
      inp.onchange = inp.oninput;
    });
    $$('[data-find]', body).forEach((inp) => {
      const who = inp.dataset.find;
      inp.oninput = debounce(async () => {
        const box = $(`[data-hits="${who}"]`, body);
        const q = inp.value.trim();
        if (q.length < 2) { box.innerHTML = ''; return; }
        const hits = await rpc('search_customers', { p_q: q });
        box.innerHTML = hits.length ? hits.map((h) => `<button type="button" class="hit" data-pick='${esc(JSON.stringify(h))}'>
            <b>${esc(h.name)}</b><span class="muted small">${esc(h.phone)}${h.company ? ' · ' + esc(h.company) : ''} · ${esc(h.code)}</span></button>`).join('')
          : `<div class="muted small" style="padding:6px 2px">${esc(t('no_match_new'))}</div>`;
      }, 250);
      $(`[data-hits="${who}"]`, body).onclick = (e) => {
        const b = e.target.closest('[data-pick]'); if (!b) return;
        const h = JSON.parse(b.dataset.pick);
        d[who] = { customer_id: h.id, name: h.name, phone: h.phone, email: h.email || '', address: h.address || '', tin: h.tin || '' };
        draw();
      };
    });
    $$('[data-mode]', body).forEach((b) => b.onclick = () => { d.mode = b.dataset.mode; draw(); });
    $$('[data-dest]', body).forEach((b) => b.onclick = () => { d.destination_branch = b.dataset.dest; draw(); });
    $$('[data-cur]', body).forEach((b) => b.onclick = () => { d.currency = b.dataset.cur; d.fx_rate = ''; draw(); });
    $$('[data-it]', body).forEach((inp) => {
      inp.onchange = inp.oninput = () => {
        const [i, f] = inp.dataset.it.split('.');
        d.items[Number(i)][f] = f === 'qty' || f === 'category_id' ? Number(inp.value) : inp.value;
        refreshCalc();
      };
    });
    $$('[data-ch]', body).forEach((inp) => {
      inp.onchange = inp.oninput = () => {
        const [i, f] = inp.dataset.ch.split('.');
        d.charges[Number(i)][f] = f === 'amount' ? Number(inp.value) : inp.value;
        refreshCalc();
      };
    });
    const add = $('#add-item', body); if (add) add.onclick = () => { d.items.push({ description: '', category_id: primaryCat(), qty: 1, unit: 'PCS' }); draw(); };
    const addc = $('#add-ch', body); if (addc) addc.onclick = () => { d.charges.push({ charge_type: 'packing', description: '', amount: '', currency: d.currency }); draw(); };
    body.onclick = (e) => {
      const ri = e.target.closest('[data-rm-item]'); if (ri) { d.items.splice(Number(ri.dataset.rmItem), 1); draw(); return; }
      const rc = e.target.closest('[data-rm-ch]'); if (rc) { d.charges.splice(Number(rc.dataset.rmCh), 1); draw(); }
    };
  }
  const refreshCalc = () => {
    const key = STEPS[step][0]; const box = $('#sum', el);
    if (box && sums[key]) box.innerHTML = sums[key]();
  };

  const validate = () => {
    const k = STEPS[step][0];
    if (k === 'parties') {
      for (const who of ['sender', 'receiver']) {
        if (!d[who].name.trim() || !d[who].phone.trim()) { toast(`${t(who)}: ${t('name_phone_required')}`, 'err'); return false; }
      }
    }
    if (k === 'items' && !d.items.some((i) => i.description.trim())) { toast(t('item_required'), 'err'); return false; }
    if (k === 'measure') {
      if (d.mode === 'sea' && !(Number(d.cbm) > 0)) { toast(t('cbm_required'), 'err'); return false; }
      if (d.mode === 'air' && !(Number(d.weight_kg) > 0)) { toast(t('kg_required'), 'err'); return false; }
    }
    return true;
  };

  $('#back', el).onclick = () => { if (step > 0) { step--; draw(); } };
  $('#next', el).onclick = (e) => {
    if (!validate()) return;
    if (step < STEPS.length - 1) { step++; draw(); return; }
    busy(e.currentTarget, async () => {
      const payload = {
        mode: d.mode, origin_branch: d.origin_branch, destination_branch: d.destination_branch,
        sender: d.sender, receiver: d.receiver,
        items: d.items.filter((i) => i.description.trim()).map((i) => ({ id: i.id, description: i.description, category_id: i.category_id, qty: i.qty, unit: i.unit })),
        category_id: primaryCat(), cbm: d.cbm === '' ? null : Number(d.cbm), weight_kg: d.weight_kg === '' ? null : Number(d.weight_kg),
        rate: d.rate === '' ? null : Number(d.rate), rate_note: d.rate_note || null, notes: d.notes || null,
      };
      try {
        if (editId) {
          payload.id = editId; payload.edit_reason = d.rate_note || null;
          await rpc('update_shipment', { p: payload });
          toast(t('saved')); location.hash = `#/shipment/${editId}`;
        } else {
          payload.charges = d.charges.filter((c) => Number(c.amount) > 0)
            .map((c) => ({ charge_type: c.charge_type, description: c.description, amount: Number(c.amount), currency: c.currency || d.currency }));
          payload.currency = d.currency; payload.fx_rate = d.fx_rate === '' ? null : Number(d.fx_rate);
          const r = await rpc('create_shipment', { p: payload });
          toast(`${t('shipment_created')} · ${r.ref}`);
          location.hash = `#/shipment/${r.id}`;
        }
      } catch (err) { toast(errText(err), 'err'); }
    });
  };
  $('#steps', el).onclick = (e) => { const s = e.target.closest('.wiz-step'); if (!s) return; const i = Number(s.dataset.i); if (i < step) { step = i; draw(); } };
  draw();
}
