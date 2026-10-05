import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import pg from 'pg';
const url='http://127.0.0.1:8787';
const as=async name=>{const c=createClient(url,'anon',{auth:{persistSession:false}});const {error}=await c.auth.signInWithPassword({email:name+'@hc.test',password:'Pass1234!'});assert.ifError(error);return c;};
const [admin,wh,cashier,viewer]=await Promise.all(['admin','warehouse','cashier','release'].map(as));
const anon=createClient(url,'anon',{auth:{persistSession:false}});
let checks=0;
const good=(r,label='RPC')=>{assert.ifError(r.error);checks++;return r.data;};
const bad=(r,pattern)=>{assert(r.error,'Expected server refusal');if(pattern)assert.match(r.error.message,pattern);checks++;};
const eq=(a,b)=>{assert.equal(a,b);checks++;};
const rpc=async(c,name,args)=>good(await c.rpc(name,args),name);
const create=async(desc,qty=20,unit='PCS',n=1)=>rpc(admin,'create_shipment',{p:{mode:'sea',origin_branch:'DXB',destination_branch:'DAR',
 sender:{name:'V5 Test '+desc,phone:'0754123456'},receiver:{name:'Receiver '+desc,phone:'0713123456'},
 items:Array.from({length:n},(_,i)=>({description:desc+' '+(i+1),qty,unit,category_id:1})),category_id:1,cbm:2,rate:300,rate_note:'test agreed rate'}});
const a=await create('Abaya'), b=await create('Phones',10);
for(const s of [a,b])await rpc(wh,'record_grn',{p_shipment:s.id,p_lines:[{pieces:20,weight_kg:15}]});
const ai=good(await wh.from('shipment_items').select('*').eq('shipment_id',a.id))[0];
const bi=good(await wh.from('shipment_items').select('*').eq('shipment_id',b.id))[0];
const stock=async(item)=>good(await wh.from('v_storage_items').select('*').eq('item_id',item).single());
const list=await rpc(wh,'create_packing_list',{p_token:'v5-list-one'});
eq((await rpc(wh,'create_packing_list',{p_token:'v5-list-one'})).id,list.id);
assert.match(list.ref,/^HC-PL-\d{4}-\d{4,}$/);
const box1=await rpc(wh,'add_packing_box',{p_list:list.id,p_token:'v5-box1'});
eq((await rpc(wh,'add_packing_box',{p_list:list.id,p_token:'v5-box1'})).id,box1.id);
const box2=await rpc(wh,'add_packing_box',{p_list:list.id,p_token:'v5-box2'});eq(box2.box_no,2);
const set=(box,item,qty)=>rpc(wh,'set_packing_box_item',{p_box:box,p_item:item,p_qty:qty});
await set(box1.id,ai.id,10);await set(box1.id,bi.id,3);await set(box2.id,ai.id,5);
eq(Number((await stock(ai.id)).remaining_qty),5);
eq(good(await wh.from('v_packing_box_items').select('*').eq('box_id',box1.id)).length,2);
await bad(await wh.rpc('set_packing_box_item',{p_box:box2.id,p_item:ai.id,p_qty:11}),/available/);
for(const qty of [-1,0.5,'NaN','Infinity',null])bad(await wh.rpc('set_packing_box_item',{p_box:box2.id,p_item:ai.id,p_qty:qty}));
bad(await wh.rpc('remove_packing_box',{p_box:box1.id}),/items first/);
await set(box2.id,ai.id,4);await set(box2.id,ai.id,4);eq(Number((await stock(ai.id)).packed_qty),14);
const line=good(await wh.from('v_packing_box_items').select('*').eq('box_id',box2.id).single());
await rpc(wh,'move_packing_box_item',{p_line:line.id,p_box:box1.id});eq(Number((await stock(ai.id)).packed_qty),14);
eq(Number(good(await wh.from('v_packing_box_items').select('*').eq('box_id',box1.id).eq('item_id',ai.id).single()).qty),14);
await rpc(wh,'remove_packing_box',{p_box:box2.id});
const box3=await rpc(wh,'add_packing_box',{p_list:list.id,p_token:'v5-box3'});eq(box3.box_no,3);
await set(box1.id,bi.id,0);eq(Number((await stock(bi.id)).packed_qty),0);
await set(box1.id,bi.id,3);

// Existing storage packing shares availability with every draft list.
await rpc(wh,'record_packing',{p:{shipment_id:a.id,lines:[{item_id:ai.id,qty:2}],client_token:'legacy-v5'}});
eq(Number((await stock(ai.id)).remaining_qty),4);
const other=await rpc(wh,'create_packing_list',{p_token:'v5-other'});
const otherBox=await rpc(wh,'add_packing_box',{p_list:other.id,p_token:'other-box'});
const race=await Promise.all([
 wh.rpc('set_packing_box_item',{p_box:box3.id,p_item:ai.id,p_qty:3}),
 admin.rpc('set_packing_box_item',{p_box:otherBox.id,p_item:ai.id,p_qty:3}),
]);
eq(race.filter(r=>!r.error).length,1);eq(Number((await stock(ai.id)).packed_qty),19);
bad(await wh.rpc('record_packing',{p:{shipment_id:a.id,lines:[{item_id:ai.id,qty:2}]}}));
const concurrentLists=await Promise.all(Array.from({length:8},(_,i)=>rpc(wh,'create_packing_list',{p_token:'parallel-'+i})));
eq(new Set(concurrentLists.map(l=>l.ref)).size,8);
const boxes=await Promise.all(Array.from({length:5},(_,i)=>rpc(wh,'add_packing_box',{p_list:other.id,p_token:'parallel-box-'+i})));
eq(new Set(boxes.map(b=>b.box_no)).size,5);

// Permissions apply at the database, including direct table calls.
for(const c of [cashier,viewer,anon]) {
  bad(await c.rpc('create_packing_list',{p_token:crypto.randomUUID()}));
  bad(await c.rpc('set_packing_box_item',{p_box:box1.id,p_item:bi.id,p_qty:4}));
}
bad(await wh.from('packing_lists').insert({ref:'fake'}));
bad(await wh.from('packing_list_boxes').insert({packing_list_id:list.id,box_no:99}));
bad(await wh.from('packing_lines').insert({entry_id:line.entry_id,item_id:ai.id,qty:99}));
bad(await anon.from('v_packing_lists').select('*'));
good(await viewer.from('v_packing_lists').select('*'));

// Item IDs and history survive ordinary edits; amounts/payment accounting stay intact.
const before=good(await admin.from('v_shipments').select('*').eq('id',a.id).single());
await rpc(admin,'update_shipment',{p:{id:a.id,notes:'updated safely',items:[{...ai,description:'Abaya edited'}]}});
eq(good(await admin.from('shipment_items').select('*').eq('shipment_id',a.id))[0].id,ai.id);
eq(Number((await stock(ai.id)).packed_qty),19);
const after=good(await admin.from('v_shipments').select('*').eq('id',a.id).single());
eq(Number(before.invoice_total_txn),Number(after.invoice_total_txn));
bad(await admin.rpc('update_shipment',{p:{id:a.id,items:[{...ai,qty:10}]}}),/already packed/);
bad(await admin.rpc('update_shipment',{p:{id:a.id,items:[{...ai,unit:'KG'}]}}),/units/);
bad(await admin.rpc('update_shipment',{p:{id:a.id,items:[{description:'Replacement',qty:20,unit:'PCS',category_id:1}]}}),/history/);
const entries=good(await wh.from('packing_entries').select('*').eq('packing_list_box_id',box1.id));
bad(await admin.rpc('void_packing_entry',{p_entry:entries[0].id,p_reason:'test'}),/draft packing list/);
await rpc(wh,'finalize_packing_list',{p_list:list.id});
bad(await wh.rpc('set_packing_box_item',{p_box:box1.id,p_item:bi.id,p_qty:1}),/finalized/);
bad(await wh.rpc('add_packing_box',{p_list:list.id,p_token:'locked'}),/finalized/);
bad(await wh.rpc('remove_packing_box',{p_box:box3.id}),/finalized/);

// Approval-free registration and version changes, with public minimal verification.
for(const [type,docid] of [['invoice',after.invoice_id],['grn',after.grn_id]]) {
  const d=await rpc(wh,'doc_register',{p_type:type,p_doc_id:docid});eq(d.status,'issued');eq(d.approval_required,false);
  bad(await admin.rpc('approve_document',{p_token:d.token,p_approve:true}),/does not use approvals/);
  const v=await rpc(anon,'verify_document',{p_token:d.token});eq(v.status,'issued');eq(v.approved_by,null);assert(!('customer_phone' in v));
}
bad(await admin.rpc('doc_register',{p_type:'waybill',p_doc_id:a.id}),/unsupported/);
const doc=await rpc(wh,'doc_register',{p_type:'invoice',p_doc_id:after.invoice_id});
await rpc(admin,'add_charge',{p_shipment:a.id,p_charge_type:'delivery',p_description:'V5 delivery',p_qty:1,p_unit_price:10,p_currency:'USD'});
const refreshed=await rpc(anon,'verify_document',{p_token:doc.token});eq(refreshed.status,'issued');assert(refreshed.version>doc.version);
const charged=good(await admin.from('v_shipments').select('*').eq('id',a.id).single());
eq(Number(charged.invoice_total_txn),Number(before.invoice_total_txn)+26000);
await rpc(cashier,'record_payment',{p_shipment:a.id,p_amount:100000,p_currency:'TZS',p_method:'bank'});
const paid=good(await admin.from('v_shipments').select('*').eq('id',a.id).single());eq(Number(paid.balance_txn),Number(charged.invoice_total_txn)-100000);

// Reapply the migration with live data: IDs, totals, stock/history are unchanged.
const db=new pg.Client({connectionString:process.env.HC_TEST_DATABASE_URL||'postgres://postgres:local-test-only@127.0.0.1:55439/hc'});await db.connect();
// Historical confirmation and previous approval audit rows survive migration.
await db.query("insert into documents(doc_type,doc_id,shipment_id,doc_ref,status) values('waybill',$1::text,$1::uuid,'historical','approved')",[a.id]);
const historicalInvoice=await rpc(wh,'doc_register',{p_type:'invoice',p_doc_id:after.invoice_id});
await db.query("update documents set status='pending' where token=$1",[historicalInvoice.token]);
await db.query("insert into document_approvals(document_id,version,action,note) select id,version,'approved','historical audit' from documents where token=$1",[historicalInvoice.token]);
await db.query(await fs.readFile('supabase/documents-packing-v5.sql','utf8'));await db.end();
eq(Number((await stock(ai.id)).packed_qty),19);
eq(good(await wh.from('v_packing_lists').select('*').eq('id',list.id).single()).status,'finalized');
eq((await rpc(anon,'verify_document',{p_token:historicalInvoice.token})).status,'issued');
eq(good(await wh.from('v_documents').select('*').eq('doc_type','waybill')).length,0);
eq(good(await wh.from('document_approvals').select('*').eq('note','historical audit')).length,1);

// Browser fixtures: real data for 1, 5 and 25 items, including long descriptions.
const fixtures=[];
for(const n of [1,5,25]) {
  const s=await create(n===25?'Long cargo '+('long wrapping description '.repeat(15)):'Cargo',2,'PCS',n);
  await rpc(wh,'record_grn',{p_shipment:s.id,p_lines:[{pieces:2*n,weight_kg:10}]});fixtures.push({...s,count:n});
}
const longList=await rpc(wh,'create_packing_list',{p_token:'long-report'});
const longBoxes=[];for(let i=0;i<3;i++)longBoxes.push(await rpc(wh,'add_packing_box',{p_list:longList.id,p_token:'long-box-'+i}));
const longItems=good(await wh.from('shipment_items').select('*').eq('shipment_id',fixtures[2].id).order('id'));
for(const [i,item] of longItems.entries())await set(longBoxes[Math.floor(i/10)].id,item.id,1);
await rpc(wh,'finalize_packing_list',{p_list:longList.id});
const threshold=new pg.Client({connectionString:process.env.HC_TEST_DATABASE_URL||'postgres://postgres:local-test-only@127.0.0.1:55439/hc'});await threshold.connect();
await threshold.query("insert into counters(key,value) values('PL-'||public.yymm(),9999),('INV-'||public.yymm(),9999),('GRN-DXB-'||public.yymm(),9999) on conflict(key) do update set value=9999");await threshold.end();
const beyond=await rpc(wh,'create_packing_list',{p_token:'beyond9999'});assert(beyond.ref.endsWith('-10000'));
const beyondShipment=await create('Beyond counter');assert(beyondShipment.invoice_ref.endsWith('-10000'));
const beyondGRN=await rpc(wh,'record_grn',{p_shipment:beyondShipment.id,p_lines:[{pieces:20}]});assert(beyondGRN.grn_ref.endsWith('-10000'));
await fs.mkdir('work',{recursive:true});
await fs.writeFile('work/v5-fixtures.json',JSON.stringify({shipments:fixtures,list:list.id,longList:longList.id,otherList:other.id,a:a.id,b:b.id}));
console.log(`PASS: ${checks} database/RPC/RLS checks, including real concurrent packing and numbering.`);
