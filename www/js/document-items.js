import { esc, num } from './ui.js';

// Cargo items have quantities/descriptions, but freight is charged per shipment
// (KG/CBM). Never fabricate per-item rates or allocate freight across cargo rows.
export function shipmentItemTable(items) {
  return `<table class="cargo-items"><thead><tr><th style="width:13%">ITEM NO.</th><th>ITEM DESCRIPTION</th><th class="num" style="width:19%">QTY</th></tr></thead>
    <tbody>${items.map((i,n) => `<tr><td>${n+1}</td><td>${esc(i.description)}</td><td class="num">${num(i.qty,2)} ${esc(i.unit || '')}</td></tr>`).join('')}</tbody></table>`;
}

export const paymentInformation = () => `<section class="payment-info">
  <h2>PAYMENT INFORMATION</h2><div class="payment-grid">
  <div><h3>CRDB</h3><p>Account Name:<br><b>Horse Cargo Company Ltd.</b></p><p>Account Number:<br><b class="mono">015C00064HQ00</b></p><p>Bank: <b>CRDB</b></p></div>
  <div><h3>NMB</h3><p>Account Name:<br><b>Horse Cargo Company Ltd</b></p><p>Account Number:<br><b class="mono">20410069001</b></p><p>Bank: <b>NMB</b></p></div>
  <div><h3>TIGO LIPA NAMBA</h3><p>Lipa Namba:<br><b class="mono">44463499</b></p><p>Name:<br><b>Horse Cargo Company</b></p></div>
  </div></section>`;
