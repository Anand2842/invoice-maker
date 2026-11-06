// Real multi-connection concurrency checks for financial commands (PostgreSQL 15+, never production).
// Usage: PGREHEARSAL_URL=postgres://postgres@127.0.0.1:55432 node scripts/pg-race-tests.mjs
// A "gate" connection holds the row lock each command needs, every contender queues behind it on its own
// connection, then the gate releases: this forces true overlap instead of relying on timing luck.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {connect,freshDatabase,apply,migrations} from './pg-rehearsal.mjs';

const db='rehearsal_races',admin=await freshDatabase(db);await apply(admin,migrations);
const owner=randomUUID(),editor=randomUUID(),business=randomUUID();
await admin`insert into auth.users(id) values(${owner}),(${editor})`;
await admin`insert into public.billing_businesses(id,owner_id,name) values(${business},${owner},'Race business')`;
await admin`insert into public.billing_members(business_id,user_id,role) values(${business},${editor},'editor')`;

// One dedicated connection per actor call; each call is its own transaction as an authenticated user.
const call=async(user,text,params)=>{const sql=connect(db);try{return await sql.begin(async tx=>{await tx.unsafe('set local role authenticated');await tx`select set_config('request.jwt.claim.sub',${user},true)`;return (await tx.unsafe(text,params))[0]?.result})}finally{await sql.end()}};
const settle=ps=>Promise.allSettled(ps).then(rs=>({ok:rs.filter(r=>r.status==='fulfilled').map(r=>r.value),failed:rs.filter(r=>r.status==='rejected').map(r=>r.reason.message)}));
// Hold `lockSql` on a superuser connection, start contenders, wait until they are all blocked, then release.
async function gated(lockSql,params,contenders,{beforeRelease}={}){const gate=connect(db);let release,started=0;const held=new Promise(r=>release=r);const done=gate.begin(async tx=>{await tx.unsafe(lockSql,params);started=1;await held;if(beforeRelease)await beforeRelease(tx)});while(!started)await new Promise(r=>setTimeout(r,5));const results=settle(contenders.map(f=>f()));
 for(let i=0;i<200;i++){const [w]=await admin`select count(*)::int n from pg_stat_activity where datname=${db} and wait_event_type='Lock'`;if(w.n>=contenders.length)break;await new Promise(r=>setTimeout(r,25))}
 const [blocked]=await admin`select count(*)::int n from pg_stat_activity where datname=${db} and wait_event_type='Lock'`;release();await done;await gate.end();return{...(await results),blocked:blocked.n}}
const report=[];const check=(name,fn)=>report.push(fn().then(r=>({name,pass:true,...r}),e=>({name,pass:false,error:e.message})));

const document=async(total=100)=>{const id=randomUUID(),data={type:'invoice',number:'RACE-'+id.slice(0,8),date:'2026-10-01',dueDate:'2026-10-20',currency:'INR',status:'sent',taxType:'NONE',seller:{name:'Seller'},buyer:{name:'Buyer'},items:[{name:'Work',quantity:1,rate:total}]};
 await call(owner,"insert into public.billing_records(id,business_id,collection,data,created_by) values($1,$2,'documents',$3,$4) returning id result",[id,business,data,owner]);return id};
const version=async id=>(await admin`select version from public.billing_records where id=${id}`)[0].version;
const pay=(invoice,v,key,amount)=>()=>call(owner,'select public.billing_record_payment($1,$2,$3,$4,$5,false) result',[business,invoice,v,key,{amount,date:'2026-10-10',method:'Bank transfer'}]);

// Run sequentially: each scenario owns the locks it needs.
const scenarios=[
 ['six concurrent 40.00 payments against a 100.00 invoice cannot overpay',async()=>{const inv=await document(100),v=await version(inv);const r=await gated("select 1 from public.billing_records where id=$1 for update",[inv],Array.from({length:6},()=>pay(inv,v,randomUUID(),'40.00')));
  const [paid]=await admin`select coalesce(sum((data->>'amount')::numeric),0)::text total,count(*)::int n from public.billing_records where collection='payments' and data->>'documentId'=${inv} and not archived`;
  assert.ok(Number(paid.total)<=100,'overpaid: '+paid.total);assert.equal(r.ok.length,paid.n);assert.ok(r.blocked>=5,'contenders did not overlap: '+r.blocked);return{succeeded:r.ok.length,rejected:r.failed.length,paid:paid.total,blocked:r.blocked,sampleRejection:r.failed[0]}}],
 ['six concurrent retries of one payment command create exactly one payment',async()=>{const inv=await document(100),v=await version(inv),key=randomUUID();const r=await gated("select 1 from public.billing_records where id=$1 for update",[inv],Array.from({length:6},()=>pay(inv,v,key,'25.00')));
  const [paid]=await admin`select count(*)::int n from public.billing_records where collection='payments' and data->>'documentId'=${inv}`;const ids=new Set(r.ok.map(x=>x?.record?.id));assert.equal(paid.n,1);assert.equal(ids.size,1);return{succeeded:r.ok.length,failed:r.failed.length,payments:paid.n,blocked:r.blocked}}],
 ['ten concurrent document numbers are distinct',async()=>{const r=await gated("select 1 from public.billing_businesses where id=$1 for update",[business],Array.from({length:10},()=>()=>call(owner,'select public.billing_next_document_number($1) result',[business])));
  assert.equal(r.failed.length,0,r.failed[0]);assert.equal(new Set(r.ok).size,10);return{numbers:r.ok.sort(),blocked:r.blocked}}],
];
// Inventory needs ledger + inventory setup.
const inv=(user,action,data,key=randomUUID())=>()=>call(user,'select public.billing_inventory_command($1,false,$2,$3,$4) result',[business,key,action,data]);
await call(owner,"select public.billing_ledger_setup($1,false,'2026-10-01') result",[business]);
await call(owner,"select public.billing_ledger_create_account($1,false,'1500','Inventory purchase clearing','asset') result",[business]);
const acct=Object.fromEntries((await admin`select code,id from public.billing_ledger_accounts where business_id=${business} and not demo`).map(a=>[a.code,a.id]));
await call(owner,"select public.billing_inventory_setup($1,false,'2026-10-01',$2,'FIFO',true) result",[business,{stock:acct['1200'],clearing:acct['1500'],cogs:acct['5100'],adjustment:acct['5000'],opening:acct['3000']}]);
const warehouse=(await inv(owner,'warehouse',{code:'MAIN',name:'Main warehouse'})()).warehouseId;
const item=await inv(owner,'item',{sku:'RACE-1',name:'Last unit item',kind:'stock',tracking:'none',baseUnit:'EA',barcode:'',reorderLevel:'0',overstockLevel:'100',reviewed:true})();
const line=quantity=>({itemId:item.itemId,unitId:item.baseUnitId,warehouseId:warehouse,quantity});
await inv(owner,'move',{kind:'receipt',date:'2026-10-05',reason:'Stock in',costReviewed:true,lines:[{...line('1'),cost:'10'}]})();
scenarios.push(
 ['five concurrent dispatches of the last unit post exactly one',async()=>{const r=await gated("select 1 from public.billing_businesses where id=$1 for no key update",[business],Array.from({length:5},()=>inv(owner,'move',{kind:'dispatch',date:'2026-10-06',reason:'Ship',costReviewed:true,lines:[line('1')]})));
  const [stock]=await admin`select coalesce(sum(quantity),0)::text q from public.billing_inventory_movements where item_id=${item.itemId}`;assert.equal(r.ok.length,1);assert.equal(Number(stock.q),0);return{succeeded:r.ok.length,rejected:r.failed.length,onHand:stock.q,blocked:r.blocked,sampleRejection:r.failed[0]}}],
 ['an editor removed while waiting for the writer lock cannot write',async()=>{const r=await gated("select 1 from public.billing_businesses where id=$1 for no key update",[business],[inv(editor,'move',{kind:'receipt',date:'2026-10-07',reason:'Late writer',costReviewed:true,lines:[{...line('1'),cost:'10'}]})],{beforeRelease:tx=>tx`delete from public.billing_members where business_id=${business} and user_id=${editor}`});
  assert.equal(r.ok.length,0);assert.match(r.failed[0],/no longer|role/i);return{rejection:r.failed[0],blocked:r.blocked}}],
);
for(const [name,fn] of scenarios){check(name,fn);await report.at(-1)}
const results=await Promise.all(report);console.log(JSON.stringify(results,null,1));await admin.end();
if(results.some(r=>!r.pass))process.exitCode=1;
