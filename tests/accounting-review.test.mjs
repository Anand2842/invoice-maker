import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {paymentDatabase} from './helpers/payment-db.mjs';

async function ledgerFixture(){
 const f=await paymentDatabase();
 const call=(sql,args=[],actor=f.owner)=>f.as(actor,async db=>(await db.query(sql,args)).rows[0]);
 await call('select billing_ledger_setup($1,false,$2::date)',[f.business,'2026-10-01']);
 const accounts=(await f.db.query('select id,code from billing_ledger_accounts where business_id=$1 and not demo',[f.business])).rows;
 const id=code=>accounts.find(a=>a.code===code).id;
 const opening=amount=>({kind:'opening',date:'2026-10-01',description:'Synthetic opening',entries:[{account_id:id('1000'),debit:String(amount),credit:'0'},{account_id:id('3000'),debit:'0',credit:String(amount)}]});
 const post=async journal=>(await call('select billing_ledger_post($1,false,$2,$3) result',[f.business,randomUUID(),journal])).result;
 return{...f,call,opening,post};
}

test('configured ledger freezes business base currency',async()=>{
 const f=await ledgerFixture();
 try{
  await f.post(f.opening(100));
  await assert.rejects(f.call("update billing_businesses set currency='USD' where id=$1 returning currency",[f.business]),/currency|ledger/i);
  assert.equal((await f.db.query('select currency from billing_businesses where id=$1',[f.business])).rows[0].currency,'INR');
 }finally{await f.close()}
});

test('a later dated opening reversal cannot authorize retroactive duplicate opening balances',async()=>{
 const f=await ledgerFixture();
 try{
  const original=await f.post(f.opening(100));
  await f.call('select billing_ledger_reverse($1,false,$2,$3,$4::date,$5)',[f.business,randomUUID(),original.batch.id,'2026-10-20','Correct opening']);
  await assert.rejects(f.post(f.opening(120)),/opening|start date|reversal/i);
 }finally{await f.close()}
});

test('only the owner can reverse an opening journal, including writable editors',async()=>{
 const f=await ledgerFixture();
 try{
  const original=await f.post(f.opening(100));
  const reverse=actor=>f.call('select billing_ledger_reverse($1,false,$2,$3,$4::date,$5)',[f.business,randomUUID(),original.batch.id,'2026-10-01','Correct opening'],actor);
  await assert.rejects(reverse(f.viewer),/cannot reverse|owner|opening/i);
  await f.db.query("update billing_members set role='editor' where business_id=$1 and user_id=$2",[f.business,f.viewer]);
  await assert.rejects(reverse(f.viewer),/owner|opening/i);
  await reverse(f.owner);
  await f.post(f.opening(120));
 }finally{await f.close()}
});

test('demo configuration preserves its currency without freezing the real business default',async()=>{
 const f=await paymentDatabase();
 try{
  const call=(sql,args=[])=>f.as(f.owner,async db=>(await db.query(sql,args)).rows[0]);
  await call('select billing_ledger_setup($1,true,$2::date)',[f.business,'2026-10-01']);
  await call("update billing_businesses set currency='USD' where id=$1",[f.business]);
  const existing=await call('select billing_ledger_setup($1,true,$2::date) result',[f.business,'2026-10-01']);
  assert.equal(existing.result.currency,'INR');
  const real=await call('select billing_ledger_setup($1,false,$2::date) result',[f.business,'2026-10-01']);
  assert.equal(real.result.currency,'USD');
 }finally{await f.close()}
});

test('ledger cutover requires a finite calendar date',async()=>{
 const f=await paymentDatabase();
 try{
  await assert.rejects(f.as(f.owner,db=>db.query("select billing_ledger_setup($1,false,'-infinity'::date)",[f.business])),/date|finite/i);
 }finally{await f.close()}
});
