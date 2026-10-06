import { t, getLang } from '../i18n.js';
import { from, run, rpc, can, errText, verifyUrl } from '../api.js';
import { icon, esc, num, fdate, busy, toast, confirmDialog, qrSVG, $ } from '../ui.js';

const T = (en, sw) => getLang() === 'sw' ? sw : en;
const whole = unit => ['PCS','CTN','BOX','BAG','PALLET','ROLL','SET','DRUM'].includes(unit.toUpperCase());
const token = () => crypto.randomUUID();

export async function render({ el, params, setTitle, rerender }) {
  setTitle(t('packing_list'));
  const id = params[0];
  const mayEdit = can('storage.pack');
  if (!id) {
    const rows = await run(from('v_packing_lists').select('*').order('created_at',{ascending:false}).limit(300));
    el.innerHTML = `<div class="page-head"><div class="grow"><h1>${esc(t('packing_list'))}</h1></div>
      ${mayEdit ? `<button class="btn primary" id="new-list">${icon('plus')}${T('New Packing List','Orodha Mpya ya Upakiaji')}</button>` : ''}</div>
      <div class="stack">${rows.map(l=>`<a class="card card-b pl-list-card" href="#/packing-list/${l.id}">
        <b class="mono">${esc(l.ref)}</b><span>${fdate(l.packing_date)} · ${esc(l.prepared_by || '—')}</span>
        <span>${l.total_boxes} ${T('boxes','masanduku')} · ${num(l.total_qty,2)} · ${esc(l.status)}</span></a>`).join('') || `<div class="card card-b">${esc(t('nothing_here'))}</div>`}</div>`;
    const createToken = token();
    const create = $('#new-list',el);
    if (create) create.onclick = ()=>busy(create, async()=>{
      try { const list = await rpc('create_packing_list',{p_token:createToken}); location.hash=`#/packing-list/${list.id}`; }
      catch(err) { toast(errText(err),'err'); }
    });
    return;
  }
  const [list,boxes,items] = await Promise.all([
    run(from('v_packing_lists').select('*').eq('id',id).single()),
    run(from('packing_list_boxes').select('*').eq('packing_list_id',id).order('box_no')),
    run(from('v_packing_box_items').select('*').eq('packing_list_id',id).order('id')),
  ]);
  setTitle(list.ref);
  const editable = mayEdit && list.status === 'draft';
  // every packing list carries its own registry token (issued when the list was created)
  const reg = await rpc('doc_register', { p_type: 'packing_list', p_doc_id: id }).catch(() => null);
  el.innerHTML = `<div class="page-head"><div class="grow"><a href="#/packing-list">${esc(t('back'))}</a>
    <h1 class="mono">${esc(list.ref)}</h1><p>${fdate(list.packing_date)} · ${esc(list.prepared_by || '—')} · ${esc(list.status)}</p></div>
    <div class="row"><a class="btn" href="#/doc/packing/${id}">${icon('print')}${T('Report / PDF','Ripoti / PDF')}</a>
      ${editable ? `<button class="btn" id="add-box">${icon('plus')}${T('Add Box','Ongeza Sanduku')}</button>
      <button class="btn primary" id="finalize">${T('Finalize','Kamilisha')}</button>` : ''}</div></div>
    ${reg ? `<div class="card pl-qr"><div class="card-b row" style="gap:14px;flex-wrap:nowrap">
      <div class="qr-box" style="width:96px;flex:none">${qrSVG(verifyUrl(reg.token), 3)}</div>
      <div><b class="mono">${esc(list.ref)}</b><div class="muted small">${esc(t('scan_to_identify'))}</div>
      <div class="small">${list.status === 'draft' ? esc(t('dst_draft')) : esc(t('dst_issued'))}</div></div></div></div>` : ''}
    <p class="muted small">${T('Draft quantities reserve storage stock across all packing lists and existing packing entries. Removing an item restores its availability.','Kiasi katika rasimu kinahifadhi nafasi kwenye stock pamoja na upakiaji wa zamani. Kuondoa item kunarudisha kiasi kinachopatikana.')}</p>
    <div class="stack">${boxes.map(box=>{
      const rows=items.filter(i=>i.box_id===box.id);
      return `<section class="card pl-box" data-box="${box.id}"><div class="card-h"><h2>BOX ${box.box_no}</h2>
        ${editable ? `<div class="row"><button class="btn sm" data-add-item="${box.id}">${icon('plus')}${T('Add Item','Ongeza Item')}</button>
          ${!rows.length ? `<button class="btn sm" data-remove-box="${box.id}">${icon('trash')}${T('Remove empty box','Ondoa sanduku tupu')}</button>` : ''}</div>` : ''}</div>
        <div class="card-b"><div class="pl-add" id="add-${box.id}"></div>
        ${rows.map(i=>`<div class="pl-item" data-line="${i.id}"><div><b class="mono">${esc(i.shipment_ref)}</b><p>${esc(i.description)}</p>
          <span class="muted small">${T('Quantity','Kiasi')}: ${num(i.qty,2)} ${esc(i.unit)}</span></div>
          ${editable ? `<div class="pl-item-actions"><label>${T('Quantity','Kiasi')}<input class="input" aria-label="${T('Packed quantity','Kiasi kilichopakiwa')}" type="number" min="${whole(i.unit)?1:0.001}" step="${whole(i.unit)?1:'any'}" value="${i.qty}"></label>
            <button class="btn sm" data-save-item="${i.id}">${esc(t('save'))}</button><button class="btn sm" data-remove-item="${i.id}">${icon('trash')}${T('Remove','Ondoa')}</button>
            ${boxes.length>1 ? `<label>${T('Move to','Hamishia')}<select class="input" aria-label="${T('Move to box','Hamishia sanduku')}" data-move-item="${i.id}"><option value="">—</option>
              ${boxes.filter(b=>b.id!==box.id).map(b=>`<option value="${b.id}">BOX ${b.box_no}</option>`).join('')}</select></label>`:''}</div>`:''}</div>`).join('') || `<p class="muted">${T('No items in this box','Hakuna items katika sanduku hili')}</p>`}
        <p><b>${T('Total Qty in Box','Jumla ya Kiasi katika Sanduku')}: ${num(rows.reduce((n,i)=>n+Number(i.qty),0),2)}</b></p></div></section>`;
    }).join('') || `<div class="card card-b">${T('Add a box to start packing.','Ongeza sanduku kuanza kupakia.')}</div>`}</div>
    <p><b>${T('Total Boxes','Jumla ya Masanduku')}: ${boxes.length} · ${T('Total Packed Quantity','Jumla ya Kiasi Kilichopakiwa')}: ${num(list.total_qty,2)}</b></p>`;

  const change = async(btn,fn)=>busy(btn,async()=>{
    try { await fn(); toast(t('saved')); await rerender(); } catch(err) { toast(errText(err),'err'); }
  });
  const boxToken = token();
  const addBox=$('#add-box',el);
  if(addBox) addBox.onclick=()=>change(addBox,()=>rpc('add_packing_box',{p_list:id,p_token:boxToken}));
  const finalize=$('#finalize',el);
  if(finalize) finalize.onclick=async()=>{
    if(await confirmDialog(T('Finalize this packing list? It will become read-only.','Kamilisha orodha hii? Haitaweza kuhaririwa tena.')))
      change(finalize,()=>rpc('finalize_packing_list',{p_list:id}));
  };
  el.addEventListener('click', async e=>{
    const add=e.target.closest('[data-add-item]'); if(add) return addItemForm(add.dataset.addItem);
    const removeBox=e.target.closest('[data-remove-box]');
    if(removeBox) return change(removeBox,()=>rpc('remove_packing_box',{p_box:removeBox.dataset.removeBox}));
    const save=e.target.closest('[data-save-item]'), remove=e.target.closest('[data-remove-item]');
    const btn=save||remove; if(!btn) return;
    const item=items.find(i=>String(i.id)===(save?.dataset.saveItem||remove?.dataset.removeItem));
    const input=btn.closest('[data-line]').querySelector('input');
    if(save && (!input.reportValidity() || !(Number(input.value)>0))) return;
    change(btn,()=>rpc('set_packing_box_item',{p_box:item.box_id,p_item:item.item_id,p_qty:remove?0:Number(input.value)}));
  });
  el.addEventListener('change',e=>{
    const select=e.target.closest('[data-move-item]');
    if(select?.value) {
      const boxId=select.value;
      change(select,()=>rpc('move_packing_box_item',{p_line:Number(select.dataset.moveItem),p_box:boxId}));
    }
  });

  async function addItemForm(boxId) {
    const host=$(`#add-${boxId}`,el);
    host.innerHTML=`<form class="pl-item-form"><label>${T('Search shipment number','Tafuta namba ya shipment')}
      <div class="row"><input class="input grow" name="search" placeholder="HC-…"><button class="btn" type="button" data-search>${esc(t('search'))}</button></div></label>
      <label>${esc(t('shipment'))}<select class="input" name="shipment" required><option value="">—</option></select></label>
      <label>${T('Item Description','Maelezo ya Item')}<select class="input" name="item" required><option value="">—</option></select></label>
      <p class="small" data-availability></p><label>${T('Quantity to Pack','Kiasi cha Kupakia')}<input class="input" name="qty" type="number" min="1" step="1" required></label>
      <div class="row"><button class="btn primary" type="submit">${T('Add','Ongeza')}</button><button class="btn" type="button" data-cancel>${esc(t('cancel'))}</button></div>
      <p class="small muted" data-error></p></form>`;
    const f=host.querySelector('form'); let available=[]; let searchVersion=0; let itemVersion=0;
    const error=err=>{ f.querySelector('[data-error]').textContent=errText(err); };
    const search=async()=>{
      const version=++searchVersion; ++itemVersion;
      f.shipment.innerHTML='<option value="">—</option>'; f.item.innerHTML='<option value="">—</option>'; available=[]; showAvailability();
      try {
        let q=from('v_storage').select('shipment_id,shipment_ref,customer_name').neq('shipment_status','cancelled').order('created_at',{ascending:false}).limit(50);
        const value=f.search.value.trim(); if(value) q=q.ilike('shipment_ref',`%${value}%`);
        const rows=await run(q); if(version!==searchVersion || !f.isConnected) return;
        f.shipment.innerHTML='<option value="">—</option>'+rows.map(s=>`<option value="${s.shipment_id}">${esc(s.shipment_ref)} · ${esc(s.customer_name)}</option>`).join('');
      } catch(err) {error(err);}
    };
    f.querySelector('[data-search]').onclick=search;
    f.querySelector('[data-cancel]').onclick=()=>{++searchVersion;++itemVersion;host.innerHTML='';};
    f.shipment.onchange=async()=>{
      const version=++itemVersion; available=[]; f.item.innerHTML='<option value="">—</option>'; showAvailability();
      if(!f.shipment.value) return;
      try {
        const [rows,declared]=await Promise.all([
          run(from('v_storage_items').select('*').eq('shipment_id',f.shipment.value).order('item_id')),
          run(from('shipment_items').select('id,qty').eq('shipment_id',f.shipment.value)),
        ]);
        if(version!==itemVersion || !f.isConnected) return;
        available=rows.map(i=>({...i,original_qty:declared.find(d=>d.id===i.item_id)?.qty,
          remaining:Math.max(0,Math.min(Number(i.received_qty),Number(declared.find(d=>d.id===i.item_id)?.qty||0))-Number(i.packed_qty))}));
        f.item.innerHTML='<option value="">—</option>'+available.map(i=>`<option value="${i.item_id}" ${i.remaining<=0||items.some(x=>x.box_id===boxId&&x.item_id===i.item_id)?'disabled':''}>${esc(i.description)} · ${num(i.remaining,2)} ${esc(i.unit)} ${i.remaining<=0?T('(Fully Packed)','(Imepakiwa Yote)'):''}</option>`).join('');
      } catch(err) {error(err);}
    };
    function showAvailability() {
      const item=available.find(i=>String(i.item_id)===f.item.value);
      f.querySelector('[data-availability]').textContent=item
        ? `${T('Original','Awali')}: ${item.original_qty} · ${T('Received','Imepokelewa')}: ${item.received_qty} · ${T('Packed','Imepakiwa')}: ${item.packed_qty} · ${T('Remaining','Imebaki')}: ${item.remaining} ${item.unit}` : '';
      f.qty.max=item?.remaining??0; f.qty.min=item&&whole(item.unit)?1:0.001; f.qty.step=item&&whole(item.unit)?1:'any';
      f.querySelector('[type=submit]').disabled=!item||item.remaining<=0;
    }
    f.item.onchange=showAvailability;
    f.onsubmit=e=>{
      e.preventDefault(); if(!f.reportValidity()) return;
      const item=available.find(i=>String(i.item_id)===f.item.value); if(!item) return;
      const btn=f.querySelector('[type=submit]');
      change(btn,()=>rpc('set_packing_box_item',{p_box:boxId,p_item:item.item_id,p_qty:Number(f.qty.value)}));
    };
    await search();
  }
}
