import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {paymentDatabase} from './helpers/payment-db.mjs';
import {cronGET,payPOST,webhookPOST,automationPOST} from '../lib/automation-api.mjs';

const SECRET='a'.repeat(48),json=(data,status=200)=>Response.json(data,{status});
// PostgREST stand-in: named-argument RPC as the anon role (publishable key only), errors as {code,message}.
function postgrest(f,calls=[]){return async(path,access,init)=>{const name=path.split('/').pop(),args=JSON.parse(init.body);calls.push({name,access,args});
 const keys=Object.keys(args);await f.db.exec('begin');try{await f.db.exec('set local role anon');
  const r=(await f.db.query(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) result`,keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]))).rows[0].result;
  await f.db.exec('commit');return{ok:true,status:200,data:r}}catch(e){await f.db.exec('rollback');return{ok:false,status:400,data:{code:e.code,message:e.message}}}}}
const cron=(sb,send,headers={authorization:'Bearer cron-token'},env={CRON_SECRET:'cron-token',FOLIO_AUTOMATION_SECRET:SECRET})=>cronGET(new Request('https://folio.test/api/cron/automation',{headers}),{json,sb,send,env,now:()=>new Date('2026-11-05T06:00:00Z')});

test('cron requires the Vercel bearer and a configured automation secret',async()=>{
 const sb=async()=>{throw Error('must not reach the database')};
 assert.equal((await cron(sb,null,{})).status,401);
 assert.equal((await cron(sb,null,{authorization:'Bearer wrong'})).status,401);
 assert.equal((await cron(sb,null,undefined,{CRON_SECRET:'cron-token',FOLIO_AUTOMATION_SECRET:'short'})).status,503);
 assert.equal((await cron(sb,null,{authorization:'Bearer '},{CRON_SECRET:''})).status,401);
});

test('one cron run catches up subscription periods, queues reminders and delivers mail with retries recorded',async()=>{const f=await paymentDatabase();try{
 await f.db.query("insert into billing_system_secrets(name,secret_hash) values('automation',sha256(convert_to($1,'UTF8')))",[SECRET]);
 await f.as(f.owner,db=>db.query('select public.billing_automation_configure($1,$2,$3)',[f.business,randomUUID(),{recurringEnabled:true,remindersEnabled:true,reminderDays:[1]}]));
 await f.as(f.owner,db=>db.query("insert into billing_records(business_id,collection,data,created_by) values($1,'subscriptions',$2,$3)",[f.business,{name:'Retainer',status:'Active',frequency:'Monthly',amount:250,nextDate:'2026-09-15'},f.owner]));
 await f.invoice({buyer:{name:'Late payer',email:'late@example.test'}});await f.invoice({buyer:{name:'Bounce',email:'bounce@example.test'}});
 const calls=[],sent=[];const send=async(m,id)=>{if(m.to.startsWith('bounce'))throw Error('Mailbox unavailable');sent.push([m.to,id]);return{id:'mock-'+sent.length}};
 const res=await cron(postgrest(f,calls),send),summary=await res.json();
 assert.equal(res.status,200);
 assert.deepEqual({...summary,generationErrors:summary.generationErrors.length},{remindersQueued:2,generated:2,generationErrors:0,sent:1,retrying:1,failed:0});
 assert.ok(calls.every(c=>c.access===''),'machine calls use only the publishable key');
 assert.deepEqual(calls.filter(c=>c.name==='billing_automation_generate').map(c=>c.args.next_date),['2026-10-15','2026-11-15']);
 assert.equal(sent[0][0],'late@example.test');assert.match(sent[0][1],/^outbox-[0-9a-f-]{36}$/);
 const statuses=(await f.db.query('select recipient,status,last_error from billing_email_outbox order by recipient')).rows;
 assert.deepEqual(statuses,[{recipient:'bounce@example.test',status:'queued',last_error:'Mailbox unavailable'},{recipient:'late@example.test',status:'sent',last_error:null}]);
 const again=await (await cron(postgrest(f),send)).json();assert.equal(again.generated,0);assert.equal(again.remindersQueued,0);assert.equal(again.retrying+again.sent,0,'a bounce waits for its backoff instead of retrying in the same run');
 await f.db.query("update billing_email_outbox set retry_at=now()-interval '1 second' where status='queued'");
 const later=await (await cron(postgrest(f),send)).json();assert.equal(later.remindersQueued,0,'reminders are never re-queued');assert.equal(later.retrying,1);
}finally{await f.close()}});

test('public pay and webhook handlers validate input, keep tokens out of URLs and map signature failures',async()=>{const f=await paymentDatabase();try{
 const sb=postgrest(f),post=(body,origin)=>new Request('https://folio.test/api/pay',{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(body)});
 const deps={json,sb,originAllowed:r=>!r.headers.get('origin')||r.headers.get('origin')==='https://folio.test',readObject:r=>r.json()};
 assert.equal((await payPOST(post({token:'abc',action:'open'}),deps)).status,404);
 assert.equal((await payPOST(post({token:'0'.repeat(64),action:'delete'}),deps)).status,404);
 assert.equal((await payPOST(post({token:'0'.repeat(64),action:'open'},'https://evil.test'),deps)).status,403);
 assert.equal((await payPOST(post({token:'0'.repeat(64),action:'open'}),deps)).status,404);
 const secret='w'.repeat(32);await f.as(f.owner,db=>db.query('select public.billing_gateway_configure($1,false,$2,$3)',[f.business,randomUUID(),{provider:'razorpay',webhookSecret:secret,enabled:true}]));
 await f.as(f.owner,db=>db.query('select public.billing_gateway_configure($1,true,$2,$3)',[f.business,randomUUID(),{provider:'mock',enabled:true}]));
 const demoInvoice=await f.invoice({},true),demoLink=(await f.as(f.owner,db=>db.query('select public.billing_payment_link_create($1,true,$2,$3) r',[f.business,randomUUID(),demoInvoice.id]))).rows[0].r;
 const open=await payPOST(post({token:demoLink.token,action:'open'}),deps);assert.equal(open.status,200);assert.equal((await open.json()).amount,'100.00');
 const invoice=await f.invoice(),link=(await f.as(f.owner,db=>db.query('select public.billing_payment_link_create($1,false,$2,$3) r',[f.business,randomUUID(),invoice.id]))).rows[0].r;
 const linkId=link.reference;
 const raw=JSON.stringify({event:'payment_link.paid',payload:{payment_link:{entity:{reference_id:linkId}},payment:{entity:{id:'pay_api00001',amount:10000,currency:'INR',status:'captured'}}}});
 const hook=signature=>webhookPOST(new Request('https://folio.test/api/gateway/webhook',{method:'POST',headers:signature?{'x-razorpay-signature':signature}:{},body:raw}),{json,sb});
 assert.equal((await hook()).status,401);
 assert.equal((await hook(createHmac('sha256','wrong-secret-value').update(raw).digest('hex'))).status,401);
 const ok=await hook(createHmac('sha256',secret).update(raw).digest('hex'));assert.equal(ok.status,200);assert.equal((await ok.json()).recorded,true);
 assert.equal((await f.db.query('select status from billing_payment_links where id=$1',[linkId])).rows[0].status,'paid');
 const authPost=await automationPOST(new Request('https://folio.test/api/automation',{method:'POST',body:'{}'}),{...deps,identity:async()=>null});assert.equal(authPost.status,401);
}finally{await f.close()}});
