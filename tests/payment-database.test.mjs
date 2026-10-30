import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {paymentDatabase} from './helpers/payment-db.mjs';

test('payment SQL migrations, commands and database boundary',async t=>{
 const f=await paymentDatabase(),{db,owner,viewer,outsider,business,as,invoice,record,reverse}=f;
 t.after(()=>f.close());
 const count=async(table)=>(await db.query('select count(*)::int n from public.'+table)).rows[0].n;
 await t.test('record atomically creates event, compatibility row, receipt, audit and outbox',async()=>{
  const source=await invoice(),before=await count('billing_audit'),r=await record(source);
  assert.equal(r.record.data.amount,'25.00');assert.equal(r.record.data.kind,'receipt');assert.equal(r.record.data.currency,'INR');assert.equal(r.record.data.seller.name,'Seller snapshot');assert.match(r.record.data.number,/^RCT-\d{6}$/);
  assert.equal(await count('billing_payment_events'),1);assert.equal(await count('billing_payment_outbox'),1);assert.equal(await count('billing_audit'),before+1);
 });
 await t.test('same-key replay succeeds even after invoice version changes; altered payload conflicts',async()=>{
  const source=await invoice(),key=randomUUID(),first=await record(source,{},key);
  await as(owner,db=>db.query("update public.billing_records set data=data||'{\"template\":\"modern\"}'::jsonb where id=$1",[source.id]));
  const replay=await record(source,{},key);assert.equal(replay.replayed,true);assert.equal(replay.record.id,first.record.id);
  await assert.rejects(()=>record(source,{amount:'26.00'},key),/different payment/);
  await assert.rejects(()=>record(source),/invoice changed/);
 });
 await t.test('direct authenticated inserts, edits and archives cannot bypass commands',async()=>{
  const source=await invoice(),r=await record(source);
  await assert.rejects(()=>as(owner,db=>db.query("insert into public.billing_records(business_id,collection,data,created_by) values($1,'payments',$2,$3)",[business,{documentId:source.id,date:'2026-10-10',amount:5,method:'Cash'},owner])),/payment command/);
  for(const fragment of ["data=data||'{\"amount\":1}'::jsonb","archived=true"]){await assert.rejects(()=>as(owner,db=>db.query('update public.billing_records set '+fragment+' where id=$1',[r.record.id])),/cannot be edited or archived/)}
  await assert.rejects(()=>as(owner,db=>db.query('update public.billing_payment_events set amount=1 where id=$1',[r.record.id])),/permission denied/);
  await assert.rejects(()=>as(owner,db=>db.query('insert into public.billing_payment_commands(business_id,demo,command_id,actor_id,request) values($1,false,$2,$3,$4)',[business,randomUUID(),owner,{}])),/permission denied/);
 });
 await t.test('viewer and foreign tenant cannot record or reverse or allocate a number',async()=>{
  const source=await invoice(),r=await record(source),before=await count('billing_payment_commands');
  for(const actor of [viewer,outsider]){await assert.rejects(()=>record(source,{},randomUUID(),actor),/cannot record/);await assert.rejects(()=>reverse(r.record,{},randomUUID(),actor),/cannot reverse/)}
  assert.equal(await count('billing_payment_commands'),before);
  const rows=await as(outsider,db=>db.query('select * from public.billing_payment_events'));assert.equal(rows.rows.length,0);
 });
 await t.test('malformed amount, real date, method, unknown or forged snapshot fields reject atomically',async()=>{
  const source=await invoice(),before=await count('billing_payment_events');
  for(const amount of ['0','-1','1.001','2e3','10000000000.01',null,true])await assert.rejects(()=>record(source,{amount}));
  for(const patch of [{date:'2026-02-30'},{method:''},{method:{}},{seller:{name:'Forged'}},{number:'FORGED'},{currency:'USD'},{reference:null},{notes:[]},{direction:'outgoing'}])await assert.rejects(()=>record(source,patch));
  assert.equal(await count('billing_payment_events'),before);
  const large=await record(source,{amount:'10000000000.00'});assert.equal(large.record.data.amount,'10000000000.00');
 });
 await t.test('draft, cancelled, quote, wrong mode and wrong business parents reject',async()=>{
  for(const patch of [{status:'draft'},{status:'cancelled'},{type:'quotation'}])await assert.rejects(async()=>record(await invoice(patch)),/issued invoice/);
  const source=await invoice({},true);await assert.rejects(()=>record({...source,demo:false}),/data mode/);
  const otherBusiness=randomUUID();await db.query("insert into public.billing_businesses(id,owner_id,name) values($1,$2,'Other business')",[otherBusiness,owner]);
  await as(owner,db=>db.query('update public.billing_records set data=data where id=$1',[source.id]));
  await assert.rejects(()=>as(owner,db=>db.query('select public.billing_record_payment($1,$2,$3,$4,$5,true)',[otherBusiness,source.id,source.version,randomUUID(),{amount:'1',date:'2026-10-29',method:'Cash'}])),/data mode/);
 });
 await t.test('demo receipts use separate numbering and cannot reverse real payments',async()=>{
  const source=await invoice({},true),r=await record(source);assert.match(r.record.data.number,/^DEMO-RCT-000001$/);
  await assert.rejects(()=>reverse({...r.record,demo:false}),/data mode/);
 });
 await t.test('report-invalid parent dates, numbers and parties cannot accept a new receipt',async()=>{
  for(const patch of [{dueDate:'bad'},{dueDate:'2026-09-01'},{number:''},{seller:{}},{buyer:{name:''}}])await assert.rejects(async()=>record(await invoice(patch)));
 });
 await t.test('retained legacy payment is reversible without rewriting or fabricating a receipt snapshot',async()=>{
  const source=await invoice();
  // Simulate a row retained from before this migration in this disposable test DB only.
  await db.exec('alter table public.billing_records disable trigger billing_05_payment_projection');
  let legacy;
  try{legacy=await as(owner,async db=>(await db.query("insert into public.billing_records(business_id,collection,data,created_by) values($1,'payments',$2,$3) returning *",[business,{documentId:source.id,date:'2026-10-10',amount:10,method:'Cash'},owner])).rows[0])}finally{await db.exec('alter table public.billing_records enable trigger billing_05_payment_projection')}
  const rev=await reverse(legacy);assert.equal(rev.record.data.reversalOf,legacy.id);assert.equal(rev.record.data.amount,'10.00');assert.equal(rev.record.data.currency,'INR');
  assert.equal((await db.query('select data from public.billing_records where id=$1',[legacy.id])).rows[0].data.kind,undefined);
 });
 await t.test('issued invoice financial identity freezes after receipt while adjustment bookkeeping works',async()=>{
  const source=await invoice();await record(source);
  for(const patch of [{status:'cancelled'},{currency:'USD'},{clientId:randomUUID()},{dueDate:'2026-11-01'},{items:[{name:'Changed',quantity:1,rate:90}]}])await assert.rejects(()=>as(owner,db=>db.query('update public.billing_records set data=data||$1::jsonb where id=$2',[patch,source.id])),/recorded payments/);
  await assert.rejects(()=>as(owner,db=>db.query('update public.billing_records set archived=true where id=$1',[source.id])),/recorded payments/);
  await as(owner,db=>db.query("update public.billing_records set data=data||'{\"lastAdjustmentId\":\"synthetic\"}'::jsonb where id=$1",[source.id]));
 });
 await t.test('reversal is positive full dated event, original immutable; duplicate reversal and predate reject',async()=>{
  const source=await invoice(),r=await record(source),key=randomUUID();
  await assert.rejects(()=>reverse(r.record,{date:'2026-10-09'}),/predate/);
  const rev=await reverse(r.record,{},key);assert.equal(rev.record.data.kind,'reversal');assert.equal(rev.record.data.reversalOf,r.record.id);assert.equal(rev.record.data.amount,'25.00');
  assert.equal((await reverse(r.record,{},key)).record.id,rev.record.id);
  await assert.rejects(()=>reverse(r.record),/already reversed/);
  await assert.rejects(()=>reverse(rev.record),/unavailable/);
  assert.equal((await db.query('select data from public.billing_records where id=$1',[r.record.id])).rows[0].data.kind,'receipt');
 });
 await t.test('failure after command insert rolls back key, sequence, projection and event',async()=>{
  const source=await invoice(),before={commands:await count('billing_payment_commands'),events:await count('billing_payment_events'),outbox:await count('billing_payment_outbox')};
  await db.exec("create function public.synthetic_fail_outbox() returns trigger language plpgsql as $$begin raise exception 'Synthetic failure';end$$; create trigger synthetic_fail_outbox before insert on public.billing_payment_outbox for each row execute function public.synthetic_fail_outbox();");
  await assert.rejects(()=>record(source),/Synthetic failure/);
  assert.equal(await count('billing_payment_commands'),before.commands);assert.equal(await count('billing_payment_events'),before.events);assert.equal(await count('billing_payment_outbox'),before.outbox);
  await db.exec('drop trigger synthetic_fail_outbox on public.billing_payment_outbox;drop function public.synthetic_fail_outbox();');
 });
});
