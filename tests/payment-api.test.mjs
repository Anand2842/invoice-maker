import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {paymentPOST,paymentGET} from '../lib/payment-api.mjs';
const business=randomUUID(),invoice=randomUUID(),payment=randomUUID(),commandId=randomUUID();
const json=(body,status=200)=>Response.json(body,{status});
const uuid=v=>typeof v==='string'&&/^[0-9a-f-]{36}$/.test(v);
const deps={identity:async()=>({id:randomUUID(),access:'test-session'}),json,uuid,originAllowed:req=>!req.headers.get('origin')||req.headers.get('origin')===new URL(req.url).origin,readObject:req=>req.json()};
const body={action:'record',business,invoice,demo:false,version:1,commandId,date:'2026-10-29',amount:'25.00',method:'Cash'};
const req=(data=body,origin)=>new Request('https://folio.example/api/payments',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(data)});
test('payment POST origin and authentication fail before any RPC call',async()=>{
 let calls=0;const sb=async()=>{calls++;return{ok:true}};
 assert.equal((await paymentPOST(req(body,'https://other.example'),{...deps,sb})).status,403);
 assert.equal((await paymentPOST(req(),{...deps,sb,identity:async()=>null})).status,401);assert.equal(calls,0);
});
test('payment validation fails before RPC; no caller snapshots or actor are forwarded',async()=>{
 let args;
 const sb=async(path,access,init)=>{assert.equal(path,'/rest/v1/rpc/billing_record_payment');args=JSON.parse(init.body);return{ok:true,data:{record:{id:payment},replayed:false}}};
 assert.equal((await paymentPOST(req({...body,amount:'1.001'}),{...deps,sb})).status,400);
 assert.equal((await paymentPOST(req({...body,seller:{name:'Forged'},actor:'forged'}),{...deps,sb})).status,201);
 assert.deepEqual(Object.keys(args.payment_data).sort(),['amount','date','method','notes','reference']);assert.equal(args.command_id,commandId);assert.equal(args.expected_version,1);
});
test('payment replay preserves original key and returns 200; SQL permission/conflict remain distinct',async()=>{
 for(const [result,status]of [[{ok:true,data:{record:{id:payment},replayed:true}},200],[{ok:false,status:403,data:{code:'42501',message:'You cannot record payments for this business'}},403],[{ok:false,status:400,data:{code:'40001',message:'This retry key was used for a different payment'}},409],[{ok:false,status:404,data:{code:'PGRST202'}},503]]){
  const r=await paymentPOST(req(),{...deps,sb:async()=>result});assert.equal(r.status,status);
 }
});
test('ambiguous transport or incomplete confirmation remains retryable, never a definite validation error',async()=>{
 for(const sb of [async()=>{throw Error('transport lost')},async()=>({ok:true,data:{}}),async()=>({ok:false,status:503,data:{message:'timeout'}})])assert.equal((await paymentPOST(req(),{...deps,sb})).status,502);
});
test('history stays read-only when command migration is absent; context filters always forwarded',async()=>{
 const sb=async(path)=>{if(path.includes('/rpc/'))return{ok:false,status:404,data:{code:'PGRST202'}};const u=new URL(path,'https://db.example');assert.equal(u.searchParams.get('business_id'),'eq.'+business);assert.equal(u.searchParams.get('demo'),'eq.true');return{ok:true,data:u.searchParams.get('collection')==='eq.documents'?[{id:invoice}]:[]}};
 const r=await paymentGET(new Request('https://folio.example/api/payments?'+new URLSearchParams({business,invoice,demo:'true'})),{...deps,sb});assert.equal(r.status,200);const data=await r.json();assert.equal(data.available,false);assert.equal(data.canWrite,false);
});
test('payment history cannot bypass missing parent visibility',async()=>{
 let calls=0;const r=await paymentGET(new Request('https://folio.example/api/payments?'+new URLSearchParams({business,invoice})),{...deps,sb:async()=>{calls++;return{ok:true,data:[]}}});assert.equal(r.status,404);assert.equal(calls,1);
});
test('receipt PDF uses saved snapshot and checks reversal status before download',async()=>{
 const snapshot={id:payment,business_id:business,demo:false,data:{kind:'receipt',number:'RCT-000001',date:'2026-10-29',amount:'25.00',currency:'INR',invoiceNumber:'INV-001',seller:{name:'Snapshot Seller'},buyer:{name:'Snapshot Buyer'},method:'Cash'}};
 let calls=0;const sb=async path=>{calls++;return{ok:true,data:path.includes('reversalOf')?[]:[snapshot]}};
 const r=await paymentGET(new Request('https://folio.example/api/payments?'+new URLSearchParams({business,payment,format:'pdf'})),{...deps,sb});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/pdf');assert.ok((await r.arrayBuffer()).byteLength>1000);assert.equal(calls,2);
});
