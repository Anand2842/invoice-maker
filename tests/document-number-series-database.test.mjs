import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentDatabase} from './helpers/payment-db.mjs';

const draft=(type,patch={})=>({type,number:'',date:'2026-11-07',dueDate:'',currency:'INR',status:'draft',taxType:'NONE',seller:{name:'Seller snapshot'},buyer:{name:'Buyer snapshot'},items:[{name:'Work',quantity:1,rate:100}],...patch});

test('Document numbers are previewed without being used, taken on save, and kept per document type',async()=>{
 const f=await paymentDatabase();
 try{
  const number=(type,consume,mode=false,actor=f.owner)=>f.as(actor,async db=>(await db.query('select public.billing_document_number_for($1,$2,$3,$4) n',[f.business,mode,type,consume])).rows[0].n);
  const save=(type,patch={},mode=false)=>f.as(f.owner,async db=>(await db.query("insert into public.billing_records(business_id,collection,data,demo,created_by) values($1,'documents',$2,$3,$4) returning data",[f.business,draft(type,{numberAuto:true,...patch}),mode,f.owner])).rows[0].data);
  await f.db.query("update public.billing_businesses set invoice_prefix='INV',invoice_next_number=1 where id=$1",[f.business]);

  // Opening the editor many times does not burn numbers.
  for(let i=0;i<3;i++)assert.equal(await number('invoice',false),'INV-000001');
  const first=await save('invoice',{number:'INV-000001'});
  assert.equal(first.number,'INV-000001');assert.equal(first.numberAuto,undefined);
  assert.equal(await number('invoice',false),'INV-000002');
  // Tax and commercial invoices share the invoice series; other types have their own.
  assert.equal((await save('gst-invoice')).number,'INV-000002');
  assert.equal((await save('quotation')).number,'QUO-000001');
  assert.equal((await save('quotation')).number,'QUO-000002');
  assert.equal((await save('delivery-challan')).number,'DC-000001');
  assert.equal((await save('purchase-order')).number,'PO-000001');
  assert.equal(await number('invoice',false),'INV-000003');
  // Sample documents never move the real series.
  assert.equal((await save('invoice',{},true)).number,'INV-000001');
  assert.equal(await number('invoice',false),'INV-000003');
  // A number typed by hand is kept as typed.
  const typed=await f.as(f.owner,async db=>(await db.query("insert into public.billing_records(business_id,collection,data,demo,created_by) values($1,'documents',$2,false,$3) returning data",[f.business,draft('invoice',{number:'CUSTOM-7'}),f.owner])).rows[0].data);
  assert.equal(typed.number,'CUSTOM-7');
  // The Settings counter still controls the invoice series.
  const settings=(await f.db.query('select invoice_next_number n from public.billing_businesses where id=$1',[f.business])).rows[0].n;
  assert.equal(Number(settings),3);
  // Viewers can preview; only editors can take a number; outsiders see nothing.
  assert.equal(await number('quotation',false,false,f.viewer),'QUO-000003');
  await assert.rejects(number('quotation',true,false,f.viewer),/Business unavailable/);
  await assert.rejects(number('invoice',false,false,f.outsider),/Business unavailable/);
 }finally{await f.close()}
});
