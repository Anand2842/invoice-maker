import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac,randomBytes} from 'node:crypto';
import {paymentDatabase} from './helpers/payment-db.mjs';
import {workflowDocument} from '../lib/workflows.mjs';

const SECRET='s'.repeat(40);
async function fixture(){const f=await paymentDatabase();
 await f.db.query("insert into public.billing_system_secrets(name,secret_hash) values('automation',sha256(convert_to($1,'UTF8')))",[SECRET]);
 const call=(name,args,actor=f.owner)=>f.as(actor,async db=>(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args)).rows[0].result);
 const anon=async(name,args)=>{await f.db.exec('begin');try{await f.db.exec('set local role anon');const r=(await f.db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args)).rows[0].result;await f.db.exec('commit');return r}catch(e){await f.db.exec('rollback');throw e}};
 const configure=(settings,key=randomUUID(),actor=f.owner)=>call('billing_automation_configure',[f.business,key,{recurringEnabled:false,remindersEnabled:true,reminderDays:[1,7],...settings}],actor);
 const outbox=async()=>(await f.db.query('select * from billing_email_outbox order by created_at,dedupe_key')).rows;
 return{...f,call,anon,configure,outbox}}

test('HMAC-SHA256 in SQL matches Node for short, block-size and long keys',async()=>{const f=await paymentDatabase();try{
 for(const key of [Buffer.from('k'),randomBytes(64),randomBytes(100)])for(const msg of ['', '{"event":"payment_link.paid"}','x'.repeat(5000)]){
  const sql=(await f.db.query('select encode(public.billing_hmac_sha256($1,convert_to($2,\'UTF8\')),\'hex\') h',[key,msg])).rows[0].h;
  assert.equal(sql,createHmac('sha256',key).update(msg).digest('hex'))}
}finally{await f.close()}});

test('only the owner configures automation; settings validate and replay exactly',async()=>{const f=await fixture();try{
 const key=randomUUID(),saved=await f.configure({reminderDays:[14,1,7]},key);assert.deepEqual(saved.reminderDays,[1,7,14]);
 assert.equal((await f.configure({reminderDays:[14,1,7]},key)).replayed,true);
 await assert.rejects(f.configure({reminderDays:[2]},key),/different automation command/);
 for(const bad of [{reminderDays:[]},{reminderDays:[366]},{reminderDays:[1,1]},{reminderDays:[1.5]},{remindersEnabled:'yes'},{extra:1}])await assert.rejects(f.configure(bad));
 await assert.rejects(f.configure({},randomUUID(),f.viewer),/Only the business owner/);
 const read=await f.call('billing_automation_read',[f.business,false],f.viewer);assert.equal(read.owner,false);assert.equal(read.automation.remindersEnabled,true);
 await assert.rejects(f.call('billing_automation_read',[f.business,false],f.outsider),/cannot view/);
}finally{await f.close()}});

test('daily tick queues one reminder per reached offset for unpaid real invoices only, gated by the secret',async()=>{const f=await fixture();try{
 await f.configure({});
 const buyer={name:'Buyer snapshot',email:'buyer@example.test'};
 const due=await f.invoice({buyer}),paid=await f.invoice({buyer}),noEmail=await f.invoice(),demo=await f.invoice({buyer},true),early=await f.invoice({buyer,dueDate:'2026-12-30'});
 await f.record(paid,{amount:'100.00'});
 await assert.rejects(f.anon('billing_automation_due',['wrong-secret'.repeat(4),'2026-10-22T06:00:00Z']),/secret rejected/);
 assert.equal((await f.anon('billing_automation_due',[SECRET,'2026-10-22T06:00:00Z'])).remindersQueued,1);
 assert.equal((await f.anon('billing_automation_due',[SECRET,'2026-10-23T06:00:00Z'])).remindersQueued,0);
 assert.equal((await f.anon('billing_automation_due',[SECRET,'2026-10-28T06:00:00Z'])).remindersQueued,1);
 const rows=await f.outbox();assert.deepEqual(rows.map(r=>r.dedupe_key),['reminder:'+due.id+':1','reminder:'+due.id+':7']);
 assert.equal(rows[0].recipient,'buyer@example.test');assert.match(rows[0].body,/INR 100\.00 remains unpaid/);
 for(const other of [paid,noEmail,demo,early])assert.ok(rows.every(r=>r.document_id!==other.id));
 await f.record({...due,version:(await f.db.query('select version from billing_records where id=$1',[due.id])).rows[0].version},{amount:'40.00'});
 assert.equal((await f.anon('billing_automation_due',[SECRET,'2026-11-10T06:00:00Z'])).remindersQueued,0,'14 is not configured, so no third reminder');
 await f.configure({reminderDays:[1,7,14]});
 assert.equal((await f.anon('billing_automation_due',[SECRET,'2026-11-10T06:00:00Z'])).remindersQueued,1);
 assert.match((await f.outbox()).at(-1).body,/INR 60\.00 remains unpaid/);
}finally{await f.close()}});

test('email dispatch leases rows, retries failures and gives up after five attempts',async()=>{const f=await fixture();try{
 for(let i=0;i<3;i++)await f.db.query("insert into billing_email_outbox(business_id,kind,dedupe_key,recipient,subject,body) values($1,'reminder',$2,'a@example.test','S','B')",[f.business,'k'+i]);
 const first=await f.anon('billing_email_claim',[SECRET,2]);assert.equal(first.length,2);
 assert.equal((await f.anon('billing_email_claim',[SECRET,10])).length,1,'leased rows are not claimed twice');
 assert.deepEqual(await f.anon('billing_email_complete',[SECRET,[{id:first[0].id,attempt:1,ok:true,providerId:'mock-1'},{id:first[1].id,attempt:1,ok:false,error:'Timeout'}]]),{sent:1,retrying:1,failed:0});
 assert.equal((await f.anon('billing_email_claim',[SECRET,10])).length,0,'a failed row waits for its backoff');
 await f.db.query("update billing_email_outbox set attempts=4,retry_at=now()-interval '1 second' where id=$1",[first[1].id]);
 const again=await f.anon('billing_email_claim',[SECRET,10]);assert.deepEqual(again.map(x=>x.id),[first[1].id]);
 assert.deepEqual(await f.anon('billing_email_complete',[SECRET,[{id:first[1].id,attempt:5,ok:false,error:'Bounced'}]]),{sent:0,retrying:0,failed:1});
 await f.db.query("update billing_email_outbox set claimed_at=now()-interval '20 minutes' where status='sending'");
 const stale=(await f.db.query("select id from billing_email_outbox where status='sending'")).rows[0].id;
 const reclaimed=await f.anon('billing_email_claim',[SECRET,10]);assert.deepEqual(reclaimed.map(x=>[x.id,x.attempt]),[[stale,2]],'an expired lease is reclaimed as a new attempt');
 assert.deepEqual(await f.anon('billing_email_complete',[SECRET,[{id:stale,attempt:1,ok:false,error:'Late failure from the expired worker'}]]),{sent:0,retrying:0,failed:0},'an expired lease cannot overwrite the newer one');
 await assert.rejects(f.anon('billing_email_complete',[SECRET,[{id:stale,ok:true}]]),/Malformed/,'the lease attempt is required');
 const status=(await f.outbox()).map(r=>r.status).sort();assert.deepEqual(status,['failed','sending','sent']);
 await assert.rejects(f.anon('billing_email_claim',['x'.repeat(40),1]),/secret rejected/);
}finally{await f.close()}});

test('recurring automation generates each due period through the existing workflow as the owner',async()=>{const f=await fixture();try{
 const sub=(await f.as(f.owner,db=>db.query("insert into billing_records(business_id,collection,data,created_by) values($1,'subscriptions',$2,$3) returning *",[f.business,{name:'Support plan',status:'Active',frequency:'Monthly',amount:500,nextDate:'2026-10-01'},f.owner]))).rows[0];
 assert.equal((await f.anon('billing_automation_due',[SECRET,'2026-11-05T06:00:00Z'])).subscriptions.length,0,'disabled until the owner opts in');
 await f.configure({recurringEnabled:true,remindersEnabled:false});
 let due=(await f.anon('billing_automation_due',[SECRET,'2026-11-05T06:00:00Z'])).subscriptions;assert.equal(due.length,1);
 let {record,business}=due[0];const generated=[];
 while(record.data.nextDate<='2026-11-05'){const {document,nextDate}=workflowDocument(record,business,'subscription-invoice');const r=await f.anon('billing_automation_generate',[SECRET,record.id,record.version,document,nextDate]);generated.push(r.document.data.number);record={...record,version:r.sourceVersion,data:{...record.data,nextDate}}}
 assert.equal(generated.length,2);assert.match(generated[0],/-20261001$/);assert.match(generated[1],/-20261101$/);
 assert.equal((await f.db.query('select data->>\'nextDate\' d from billing_records where id=$1',[sub.id])).rows[0].d,'2026-12-01');
 const docs=(await f.db.query("select data,created_by from billing_records where collection='documents' and data->>'sourceRecord'=$1",[sub.id])).rows;assert.equal(docs.length,2);assert.ok(docs.every(d=>d.data.status==='draft'&&d.created_by===f.owner));
 assert.equal((await f.anon('billing_automation_due',[SECRET,'2026-11-05T06:00:00Z'])).subscriptions.length,0);
 const {document}=workflowDocument({...record,data:{...record.data,nextDate:'2026-11-01'}},business,'subscription-invoice');
 await assert.rejects(f.anon('billing_automation_generate',[SECRET,record.id,record.version,document,'2026-12-01']),/Invalid workflow|Record changed|duplicate/i,'a period cannot be generated twice');
 await assert.rejects(f.anon('billing_automation_generate',['x'.repeat(40),record.id,record.version,document,'2027-01-01']),/secret rejected/);
 assert.equal((await f.db.query("select current_setting('request.jwt.claim.sub',true) s")).rows[0].s||'', '','owner context does not leak');
}finally{await f.close()}});

test('simulated checkout is demo-only, verifies its own signature and records exactly one receipt',async()=>{const f=await fixture();try{
 await assert.rejects(f.call('billing_gateway_configure',[f.business,false,randomUUID(),{provider:'mock',enabled:true}]),/demo data mode/);
 await assert.rejects(f.call('billing_gateway_configure',[f.business,true,randomUUID(),{provider:'mock',enabled:true}],f.viewer),/Only the business owner/);
 const cfg=await f.call('billing_gateway_configure',[f.business,true,randomUUID(),{provider:'mock',enabled:true}]);assert.equal(cfg.simulated,true);
 const invoice=await f.invoice({},true);
 assert.deepEqual((await f.call('billing_automation_read',[f.business,true])).openInvoices.map(i=>[i.id,i.outstanding]),[[invoice.id,'100.00']]);
 await assert.rejects(f.call('billing_payment_link_create',[f.business,true,randomUUID(),invoice.id],f.viewer),/cannot create payment links/);
 const key=randomUUID(),link=await f.call('billing_payment_link_create',[f.business,true,key,invoice.id]);assert.match(link.token,/^[0-9a-f]{64}$/);assert.equal(link.amount,'100.00');
 assert.equal((await f.call('billing_payment_link_create',[f.business,true,key,invoice.id])).token,link.token);
 const view=await f.anon('billing_payment_link_open',[link.token]);assert.equal(view.amount,'100.00');assert.equal(view.simulated,true);assert.equal(view.status,'open');
 await assert.rejects(f.anon('billing_payment_link_open',['0'.repeat(64)]),/unavailable/);
 const paid=await f.anon('billing_gateway_mock_capture',[link.token]);assert.equal(paid.recorded,true);assert.equal(paid.amount,'100.00');
 const receipts=(await f.db.query("select amount::text,snapshot->>'method' method,actor_id from billing_payment_events where document_id=$1",[invoice.id])).rows;
 assert.deepEqual(receipts,[{amount:'100.00',method:'Mock gateway (simulated)',actor_id:f.owner}]);
 assert.equal((await f.anon('billing_payment_link_open',[link.token])).status,'paid');
 await assert.rejects(f.anon('billing_gateway_mock_capture',[link.token]),/no longer open/);
 await assert.rejects(f.call('billing_payment_link_create',[f.business,true,randomUUID(),invoice.id]),/no balance/);
}finally{await f.close()}});

test('real-provider webhooks need the business HMAC, deduplicate payment ids and park mismatches for review',async()=>{const f=await fixture();try{
 const secret='whsec_'+'r'.repeat(30);await f.call('billing_gateway_configure',[f.business,false,randomUUID(),{provider:'razorpay',webhookSecret:secret,enabled:true}]);
 const read=await f.call('billing_automation_read',[f.business,false]);assert.equal(read.gateway.secretHint,'…rrrr');assert.ok(!JSON.stringify(read).includes(secret));
 const stored=(await f.db.query('select request::text r from billing_automation_commands')).rows.map(r=>r.r).join();assert.ok(!stored.includes(secret),'command history never stores the raw secret');
 const invoice=await f.invoice(),link=await f.call('billing_payment_link_create',[f.business,false,randomUUID(),invoice.id]);
 assert.equal(link.token,undefined,'a real link has no Folio checkout token');assert.equal(link.provider,'razorpay');
 const linkId=(await f.db.query('select id from billing_payment_links where document_id=$1',[invoice.id])).rows[0].id;assert.equal(link.reference,linkId);
 const event=(id,paise,extra={})=>JSON.stringify({event:'payment_link.paid',payload:{payment_link:{entity:{id:'plink_x',reference_id:linkId}},payment:{entity:{id,amount:paise,currency:'INR',status:'captured',...extra}}}});
 const sign=body=>createHmac('sha256',secret).update(body).digest('hex');
 const part=event('pay_part0001',4000);
 await assert.rejects(f.anon('billing_gateway_webhook',[part,sign(part+' ')]),/signature rejected/);
 await assert.rejects(f.anon('billing_gateway_webhook',[part,'zz']),/missing or malformed/);
 assert.equal((await f.anon('billing_gateway_webhook',[part,sign(part)])).recorded,true);
 assert.equal((await f.anon('billing_gateway_webhook',[part,sign(part)])).duplicate,true);
 const over=event('pay_over0001',7000);const review=await f.anon('billing_gateway_webhook',[over,sign(over)]);assert.equal(review.needsReview,true);assert.match(review.detail,/exceeds the invoice balance/);
 const usd=event('pay_usd00001',100,{currency:'USD'});assert.match((await f.anon('billing_gateway_webhook',[usd,sign(usd)])).detail,/currency differs/);
 const rest=event('pay_rest0001',6000);assert.equal((await f.anon('billing_gateway_webhook',[rest,sign(rest)])).recorded,true);
 assert.equal((await f.db.query('select status from billing_payment_links where id=$1',[linkId])).rows[0].status,'paid');
 const events=(await f.call('billing_automation_read',[f.business,false])).events.map(e=>e.status).sort();assert.deepEqual(events,['needs-review','needs-review','recorded','recorded']);
 assert.equal((await f.db.query("select sum(amount)::text s from billing_payment_events where document_id=$1 and kind='receipt'",[invoice.id])).rows[0].s,'100.00');
 const ignored=JSON.stringify({event:'payment.failed',payload:{payment_link:{entity:{reference_id:linkId}}}});assert.equal((await f.anon('billing_gateway_webhook',[ignored,sign(ignored)])).ignored,true);
}finally{await f.close()}});

test('gateway retries are idempotent, real links are INR only and a failed posting is kept for review',async()=>{const f=await fixture();try{
 const secret='whsec_'+'q'.repeat(30),key=randomUUID(),cfg={provider:'razorpay',webhookSecret:secret,enabled:true};
 const first=await f.call('billing_gateway_configure',[f.business,false,key,cfg]);assert.equal(first.replayed,false);
 assert.equal((await f.call('billing_gateway_configure',[f.business,false,key,cfg])).replayed,true,'the identical command replays');
 await assert.rejects(f.call('billing_gateway_configure',[f.business,false,key,{...cfg,webhookSecret:'whsec_'+'z'.repeat(30)}]),/different automation command/);
 const usd=await f.invoice({currency:'USD'});await assert.rejects(f.call('billing_payment_link_create',[f.business,false,randomUUID(),usd.id]),/INR invoices only/);
 const invoice=await f.invoice();await f.call('billing_payment_link_create',[f.business,false,randomUUID(),invoice.id]);
 const linkId=(await f.db.query('select id from billing_payment_links where document_id=$1',[invoice.id])).rows[0].id;
 // A capture whose posting fails (simulated closed period) is preserved as needs-review, dated on the capture day.
 await f.db.exec("create function test_closed_period() returns trigger language plpgsql as $$begin raise exception 'Posting date is outside the open ledger period';end$$;create trigger test_closed_period before insert on billing_payment_events for each row execute function test_closed_period()");
 const body=JSON.stringify({event:'payment_link.paid',payload:{payment_link:{entity:{reference_id:linkId}},payment:{entity:{id:'pay_closed001',amount:10000,currency:'INR',status:'captured',created_at:Math.floor(Date.parse('2026-10-05T06:00:00Z')/1000)}}}});
 const r=await f.anon('billing_gateway_webhook',[body,createHmac('sha256',secret).update(body).digest('hex')]);
 assert.equal(r.recorded,false);assert.equal(r.needsReview,true);assert.match(r.detail,/Receipt dated 2026-10-05 could not be posted/);
 assert.equal((await f.db.query("select count(*)::int n from billing_gateway_events where provider_payment_id='pay_closed001' and status='needs-review'")).rows[0].n,1);
 assert.equal((await f.db.query("select count(*)::int n from billing_payment_events where document_id=$1",[invoice.id])).rows[0].n,0);
}finally{await f.close()}});

test('reminders use what is due today and are re-checked when delivered',async()=>{const f=await fixture();try{
 await f.configure({reminderDays:[1]});const buyer={name:'B',email:'buyer@example.test'};
 const future=await f.invoice({buyer});await f.record(future,{amount:'100.00',date:'2026-12-01'});
 const later=await f.invoice({buyer}),part=await f.invoice({buyer});
 assert.equal((await f.anon('billing_automation_due',[SECRET,'2026-10-22T06:00:00Z'])).remindersQueued,3,'a future-dated receipt does not settle what is due today');
 await f.record(later,{amount:'100.00',date:'2026-10-21'});
 await f.record(part,{amount:'30.00',date:'2026-10-21'});
 const claimed=await f.anon('billing_email_claim',[SECRET,10]);
 assert.deepEqual(claimed.map(c=>c.message.match(/INR (\S+) remains/)[1]).sort(),['100.00','70.00'],'the paid reminder is cancelled and the part-paid one re-worded');
 assert.equal((await f.db.query("select status from billing_email_outbox where document_id=$1",[later.id])).rows[0].status,'cancelled');
 await f.configure({remindersEnabled:false});await f.db.query("update billing_email_outbox set status='queued',claimed_at=null where status='sending'");
 assert.equal((await f.anon('billing_email_claim',[SECRET,10])).length,0,'turning reminders off cancels queued ones');
}finally{await f.close()}});

test('failing subscriptions back off and cannot starve other businesses',async()=>{const f=await fixture();try{
 await f.configure({recurringEnabled:true,remindersEnabled:false});
 const other=randomUUID(),otherOwner=randomUUID();await f.db.query('insert into auth.users(id) values($1)',[otherOwner]);
 await f.db.query("insert into billing_businesses(id,owner_id,name) values($1,$2,'Other business')",[other,otherOwner]);
 await f.db.query("insert into billing_automation_settings(business_id,recurring_enabled,updated_by) values($1,true,$2)",[other,otherOwner]);
 for(let i=0;i<30;i++)await f.db.query("insert into billing_records(business_id,collection,data,created_by) values($1,'subscriptions',$2,$3)",[f.business,{name:'Broken '+i,status:'Active',frequency:'Never',nextDate:'2026-01-01'},f.owner]);
 const good=(await f.db.query("insert into billing_records(business_id,collection,data,created_by) values($1,'subscriptions',$2,$3) returning id",[other,{name:'Fine',status:'Active',frequency:'Monthly',amount:10,nextDate:'2026-11-01'},otherOwner])).rows[0].id;
 let due=(await f.anon('billing_automation_due',[SECRET,'2026-11-05T06:00:00Z'])).subscriptions;
 assert.equal(due.filter(d=>d.business.id===f.business).length,25,'at most 25 per business per run');assert.ok(due.some(d=>d.record.id===good),'the other business is still served');
 const broken=due.find(d=>d.business.id===f.business).record.id;
 assert.equal((await f.anon('billing_automation_failed',[SECRET,broken,'Invalid frequency'])).attempts,1);
 due=(await f.anon('billing_automation_due',[SECRET,new Date(Date.now()+3600e3).toISOString()])).subscriptions;assert.ok(!due.some(d=>d.record.id===broken),'a failed subscription waits for its backoff');
 assert.equal((await f.anon('billing_automation_failed',[SECRET,broken,'Invalid frequency'])).attempts,2);
 assert.deepEqual((await f.call('billing_automation_read',[f.business,false])).generationFailures.map(x=>[x.name,x.attempts,x.error]),[[(await f.db.query("select data->>'name' n from billing_records where id=$1",[broken])).rows[0].n,2,'Invalid frequency']]);
 await assert.rejects(f.anon('billing_automation_failed',['x'.repeat(40),broken,'x']),/secret rejected/);
}finally{await f.close()}});
