// Public track page script, kept out of the HTML so the CSP can forbid inline scripts.
(function () {
  var T = {
    en: { title: 'Track your cargo', sub: 'Enter the shipment number on your receipt or carton label.', go: 'Track', nf: 'No shipment found with that number. Check the number or contact our office.', eta: 'ETA', pcs: 'pieces', cont: 'Container', err: 'Could not connect. Please try again.', help: 'Questions? Dubai +971 50 608 3531 · Dar es Salaam +255 778 222 251 · Mwanza +255 797 000 254',
      s: { received_dubai: 'Received at Dubai office', packed: 'Packed for dispatch', dispatched: 'Dispatched from Dubai', in_transit: 'On transit to Tanzania', in_customs: 'In customs', arrived: 'Arrived at the office', delivered: 'Delivered' }, sea: 'Sea freight', air: 'Air freight' },
    sw: { title: 'Fuatilia mzigo wako', sub: 'Weka namba ya shipment iliyo kwenye risiti au lebo ya katoni.', go: 'Fuatilia', nf: 'Hakuna mzigo wenye namba hiyo. Hakikisha namba au wasiliana na ofisi yetu.', eta: 'Kufika', pcs: 'vipande', cont: 'Kontena', err: 'Imeshindwa kuunganisha. Jaribu tena.', help: 'Maswali? Dubai +971 50 608 3531 · Dar es Salaam +255 778 222 251 · Mwanza +255 797 000 254',
      s: { received_dubai: 'Imepokelewa ofisi ya Dubai', packed: 'Imefungashwa', dispatched: 'Imeondoka Dubai', in_transit: 'Njiani kwenda Tanzania', in_customs: 'Forodhani', arrived: 'Imefika ofisini', delivered: 'Imekabidhiwa' }, sea: 'Usafiri wa bahari', air: 'Usafiri wa anga' }
  };
  var EV = [[/^Received at Dubai office$/, 'Imepokelewa ofisi ya Dubai'], [/^Packed for dispatch$/, 'Imefungashwa kusafirishwa'], [/^Dispatched from Dubai$/, 'Imeondoka Dubai'], [/^On transit to Tanzania$/, 'Njiani kwenda Tanzania'], [/^In customs$/, 'Forodhani'], [/^Arrived at (.+) office$/, 'Imefika ofisi ya $1'], [/^Delivered$/, 'Imekabidhiwa'], [/^Collected by (.+)$/, 'Imechukuliwa na $1'], [/^Cargo measured \(GRN (.+)\)$/, 'Mzigo umepimwa (GRN $1)'], [/^Shipment updated$/, 'Shipment imehaririwa'], [/^Shipment cancelled$/, 'Shipment imefutwa']];
  function tr(x) { if (lang !== 'sw' || !x) return x; for (var i = 0; i < EV.length; i++) if (EV[i][0].test(x)) return x.replace(EV[i][0], EV[i][1]); return x; }
  var names = { DXB: 'Dubai', DAR: 'Dar es Salaam', MWZ: 'Mwanza' };
  var lang = (localStorage.getItem('hc.lang') || (navigator.language || '').slice(0, 2)) === 'sw' ? 'sw' : 'en';
  var cfg = window.HC_CONFIG || {};
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  var last = null;
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-t]').forEach(function (e) { e.textContent = T[lang][e.dataset.t]; });
    document.querySelectorAll('[data-l]').forEach(function (b) { b.className = b.dataset.l === lang ? 'on' : ''; b.style.color = b.dataset.l === lang ? '' : '#f3dde1'; });
    document.getElementById('foot').textContent = T[lang].help;
    if (last) draw(last);
  }
  function fmt(d) { return new Date(d).toLocaleString(lang === 'sw' ? 'sw-TZ' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function draw(r) {
    var L = T[lang], out = document.getElementById('out');
    if (!r) { out.innerHTML = '<div class="callout warn">' + esc(L.nf) + '</div>'; return; }
    out.innerHTML = '<div class="card"><div class="card-b stack" style="gap:8px">' +
      '<div class="row" style="justify-content:space-between"><span class="mono" style="font-weight:700">' + esc(r.ref) + '</span><span class="badge s-' + esc(r.status) + '">' + esc(L.s[r.status] || r.status) + '</span></div>' +
      '<div class="status-big">' + esc(names[r.origin] || r.origin) + ' → ' + esc(names[r.destination] || r.destination) + '</div>' +
      '<div class="muted">' + esc(L[r.mode]) + ' · ' + esc(r.pieces) + ' ' + esc(L.pcs) + (r.cbm ? ' · ' + esc(r.cbm) + ' CBM' : '') + ' · ' + esc(r.receiver) + '</div>' +
      (r.weight_kg ? '<div class="muted">' + esc(r.weight_kg) + ' kg</div>' : '') +
      '</div><div class="card-b" style="border-top:1px solid var(--line-2)"><ul class="timeline">' +
      (r.events || []).map(function (e) { return '<li><div class="tt">' + esc(tr(e.title)) + '</div>' + (e.note ? '<div class="tn">' + esc(tr(e.note)) + '</div>' : '') + '<div class="tm">' + esc(e.location ? (names[e.location] || e.location) + ' · ' : '') + esc(fmt(e.at)) + '</div></li>'; }).join('') +
      '</ul></div></div>';
  }
  async function track(ref) {
    ref = (ref || '').trim().toUpperCase(); if (!ref) return;
    var m = ref.match(/HC-BK-\d{4}-\d{4,}/); if (m) ref = m[0];
    document.getElementById('ref').value = ref;
    history.replaceState(null, '', '?ref=' + encodeURIComponent(ref));
    document.getElementById('out').innerHTML = '<div class="boot" style="min-height:120px"><div class="spinner"></div></div>';
    var res = await sb.rpc('track_shipment', { p_ref: ref });
    if (res.error) { document.getElementById('out').innerHTML = '<div class="callout danger">' + esc(T[lang].err) + '</div>'; return; }
    last = res.data; draw(res.data);
  }
  document.getElementById('f').onsubmit = function (e) { e.preventDefault(); track(document.getElementById('ref').value); };
  document.querySelectorAll('[data-l]').forEach(function (b) { b.onclick = function () { lang = b.dataset.l; try { localStorage.setItem('hc.lang', lang); } catch (e) {} applyLang(); }; });
  applyLang();
  var q = new URLSearchParams(location.search).get('ref'); if (q) track(q);
})();
