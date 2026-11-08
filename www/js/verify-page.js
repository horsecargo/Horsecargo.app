// Public verify page script, kept out of the HTML so the CSP can forbid inline scripts.
(function () {
  var cfg = window.HC_CONFIG || {};
  var out = document.getElementById('out');
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var TYPE = { invoice: 'Invoice', receipt: 'Payment receipt', grn: 'Goods Received Note',
               release: 'Delivery note', waybill: 'Shipment confirmation', packing_list: 'Packing list',
               label: 'Cargo label' };
  var token = new URLSearchParams(location.search).get('d') || '';

  function fdt(v) {
    if (!v) return '—';
    var d = new Date(v);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
           d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  function row(k, v) { return '<div class="vrow"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>'; }
  function show(html) { out.innerHTML = html; }

  if (!token) {
    show('<div class="vstat no">No document code</div><p class="muted small" style="margin-top:12px">' +
         'Scan the QR code printed on the document.</p>');
    return;
  }
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.indexOf('YOUR-PROJECT') > -1) {
    show('<div class="vstat no">Verification is not configured</div>'); return;
  }
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  sb.rpc('verify_document', { p_token: token }).then(function (r) {
    if (r.error) { show('<div class="vstat no">Could not check this document</div>' +
      '<p class="muted small" style="margin-top:12px">Please try again.</p>'); return; }
    var d = r.data;
    if (!d || !d.found) {
      show('<div class="vstat no">Document not found</div>' +
           '<p class="muted small" style="margin-top:12px">This code does not match any Horse Cargo document. ' +
           'It may have been cancelled, or the code may be mistyped.</p>');
      return;
    }
    var cls = d.status === 'issued' || d.status === 'approved' ? 'ok' : d.status === 'pending' || d.status === 'draft' ? 'wait' : 'no';
    var label = d.status === 'issued' ? 'Genuine — issued by Horse Cargo' : d.status === 'approved' ? 'Approved' : d.status === 'pending' ? 'Pending approval'
              : d.status === 'draft' ? 'Genuine — draft (not yet finalized)'
              : d.status === 'revoked' ? 'This QR code has been revoked' : d.status === 'rejected' ? 'Rejected' : 'Void';
    if (d.status === 'revoked') {
      show('<div class="vstat no">' + esc(label) + '</div>' +
           '<div class="vbig" style="margin:16px 0 4px">' + esc(d.document_no || '') + '</div>' +
           '<div class="muted small" style="margin-bottom:10px">' + esc(TYPE[d.document_type] || d.document_type) + '</div>' +
           '<p class="muted small">This printed copy is no longer valid. Ask Horse Cargo for the current document.</p>' +
           row('Revoked', fdt(d.revoked_at)) + row('Checked at', fdt(d.checked_at)));
      return;
    }
    var html = '<div class="vstat ' + cls + '">' + esc(label) + '</div>';
    if (d.retired) html += '<p class="muted small">Historical document — retired from the active workflow.</p>';
    if (d.superseded) {
      html += '<p class="muted small" style="margin:12px 0 0">This document was changed after it was approved. ' +
              'The printed copy is out of date — ask Horse Cargo for the current version.</p>';
    }
    html += '<div class="vbig" style="margin:16px 0 4px">' + esc(d.document_no || '') + '</div>' +
            '<div class="muted small" style="margin-bottom:10px">' + esc(TYPE[d.document_type] || d.document_type) + '</div>' +
            (d.shipment_ref ? row('Shipment', d.shipment_ref) : '') +
            row('Issued', fdt(d.issued_at)) +
            row('Version', d.version) +
            (d.approved_by ? row('Approved by', d.approved_by) : '') +
            (d.approved_at ? row('Approved at', fdt(d.approved_at)) : '') +
            row('Checked at', fdt(d.checked_at)) +
            '<p class="muted small" style="margin-top:14px">' + esc(d.company || 'Horse Cargo') +
            ' · This page confirms the document exists and its current status. ' +
            'Amounts and customer details are not shown here.</p>' +
            '<a class="btn" style="margin-top:12px" href="track.html">Track a shipment</a>';
    show(html);
  }).catch(function () {
    show('<div class="vstat no">Could not connect</div><p class="muted small" style="margin-top:12px">Please try again.</p>');
  });
})();
