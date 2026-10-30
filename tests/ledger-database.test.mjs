import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';import{paymentDatabase}from'./helpers/payment-db.mjs';

test('posted ledger preserves dates, balances, permissions and atomic command behavior',async t=>{
 const f=await paymentDatabase();t.after(()=>f.close());const {db,business,owner,viewer,outsider,as}=f;
 const call=(name,args,actor=owner)=>as(actor,async db=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result);
 const setup=()=>call('billing_ledger_setup',[business,false,'2026-10-01']);
 await setup();await setup();
 const accounts=(await db.query('select * from billing_ledger_accounts where business_id=$1',[business])).rows;
 const id=code=>accounts.find(a=>a.code===code).id;
 const line=(code,debit,credit)=>({account_id:id(code),debit:String(debit),credit:String(credit)});
 const journal=(date,entries,kind='manual')=>({date,description:'Synthetic ledger fixture',kind,entries});
 const post=(j,key=randomUUID(),actor=owner)=>call('billing_ledger_post',[business,false,key,j],actor);
 const read=(from,to,actor=owner)=>call('billing_ledger_read',[business,false,from,to],actor);
 const count=async table=>(await db.query('select count(*)::int n from '+table)).rows[0].n;
 await t.test('setup is idempotent and never imports the legacy record store',async()=>{assert.equal(accounts.length,12);assert.equal(await count('billing_ledger_batches'),0);assert.equal(await count('billing_ledger_audit'),1)});
 await t.test('opening, sales, partial cash and expense postings reconcile by date',async()=>{
  await post(journal('2026-10-01',[line('1000',1000,0),line('3000',0,1000)],'opening'));
  await post(journal('2026-10-10',[line('1100',118,0),line('4000',0,100),line('2100',0,18)]));
  await post(journal('2026-10-15',[line('1000',50,0),line('1100',0,50)]));
  await post(journal('2026-10-20',[line('5000',30,0),line('1000',0,30)]));
  const r=await read('2026-10-10','2026-10-20'),net=code=>{const a=r.balances.find(x=>x.account_id===id(code));return Number(a.debit)-Number(a.credit)};
  assert.equal(net('1000'),1020);assert.equal(net('1100'),68);assert.equal(net('2100'),-18);assert.equal(net('3000'),-1000);assert.equal(net('4000'),-100);assert.equal(net('5000'),30);
  assert.equal(r.balances.reduce((s,a)=>s+Math.round(Number(a.debit)*100)-Math.round(Number(a.credit)*100),0),0);
  assert.equal(r.balances.find(x=>x.account_id===id('1000')).opening,'1000.00');assert.equal(r.journals.length,3);
 });
 await t.test('dated reversal leaves earlier balances intact and retains original',async()=>{
  const before=await read('2026-10-01','2026-10-20'),original=before.journals.find(x=>x.date==='2026-10-10');
  const key=randomUUID();const reversal=await call('billing_ledger_reverse',[business,false,key,original.id,'2026-10-21','Synthetic correction']);
  assert.equal(reversal.batch.reverses_id,original.id);assert.equal((await call('billing_ledger_reverse',[business,false,key,original.id,'2026-10-21','Synthetic correction'])).replayed,true);
  assert.deepEqual((await read('2026-10-01','2026-10-20')).balances,before.balances);
  await assert.rejects(()=>call('billing_ledger_reverse',[business,false,randomUUID(),original.id,'2026-10-22','Duplicate']),/already reversed/);
 });
 await t.test('invalid and cross-context accounts, malformed lines and money cannot partially post',async()=>{
  const before=await count('billing_ledger_batches');
  const invalid=[journal('2026-10-22',[line('1000',1,0),line('4000',0,2)]),journal('2026-10-22',[line('1000','1.001',0),line('4000',0,1)]),journal('2026-10-22',[line('1000',1,1),line('4000',0,1)]),journal('2026-10-22',[line('1000',1,0),line('1000',0,1)]),journal('2026-10-22',[{account_id:randomUUID(),debit:'1',credit:'0'},line('4000',0,1)]),journal('2026-02-30',[line('1000',1,0),line('4000',0,1)])];
  for(const j of invalid)await assert.rejects(()=>post(j));
  await call('billing_ledger_setup',[business,true,'2026-10-01']);
  const demo=(await db.query('select id from billing_ledger_accounts where business_id=$1 and demo limit 1',[business])).rows[0].id;
  await assert.rejects(()=>post(journal('2026-10-22',[{account_id:demo,debit:'1',credit:'0'},line('4000',0,1)])),/business and data mode/);
  assert.equal(await count('billing_ledger_batches'),before);
 });
 await t.test('viewer reads but cannot write; foreign tenants and direct commands cannot bypass',async()=>{
  assert.equal((await read('2026-10-01','2026-10-30',viewer)).canWrite,false);
  for(const actor of [viewer,outsider])await assert.rejects(()=>post(journal('2026-10-22',[line('1000',1,0),line('4000',0,1)]),randomUUID(),actor),/cannot post/);
  await assert.rejects(()=>read('2026-10-01','2026-10-30',outsider),/unavailable/);
  assert.equal((await as(outsider,db=>db.query('select * from billing_ledger_entries'))).rows.length,0);
  await assert.rejects(()=>as(owner,db=>db.exec("update billing_ledger_entries set debit=0")),/permission denied/);
  await assert.rejects(()=>as(owner,db=>db.exec("truncate billing_ledger_batches cascade")),/permission denied/);
  await assert.rejects(()=>as(owner,db=>db.query('select billing_ledger_batch_json($1)',[randomUUID()])),/permission denied/);
 });
 await t.test('failure in outbox rolls back lines, sequence, batch and audit',async()=>{
  const before={batches:await count('billing_ledger_batches'),audit:await count('billing_ledger_audit'),outbox:await count('billing_ledger_outbox'),next:(await db.query('select next_number from billing_ledger_configs where business_id=$1 and not demo',[business])).rows[0].next_number};
  await db.exec("create function ledger_fail_test() returns trigger language plpgsql as $$begin raise exception 'Synthetic outbox failure';end$$;create trigger ledger_fail_test before insert on billing_ledger_outbox for each row execute function ledger_fail_test();");
  await assert.rejects(()=>post(journal('2026-10-22',[line('1000',1,0),line('4000',0,1)])),/Synthetic outbox failure/);
  assert.equal(await count('billing_ledger_batches'),before.batches);assert.equal(await count('billing_ledger_audit'),before.audit);assert.equal(await count('billing_ledger_outbox'),before.outbox);assert.equal((await db.query('select next_number from billing_ledger_configs where business_id=$1 and not demo',[business])).rows[0].next_number,before.next);
  await db.exec('drop trigger ledger_fail_test on billing_ledger_outbox;drop function ledger_fail_test();');
 });
 await t.test('stable replay survives period closure while fresh and altered commands reject',async()=>{
  const key=randomUUID(),j=journal('2026-10-22',[line('1000',1,0),line('4000',0,1)]),first=await post(j,key);
  await call('billing_ledger_close',[business,false,'2026-10-22']);
  assert.equal((await post(j,key)).batch.id,first.batch.id);assert.equal((await post(j,key)).replayed,true);
  await assert.rejects(()=>post(j),/open ledger period/);await assert.rejects(()=>post({...j,description:'Changed'},key),/different journal/);
  await assert.rejects(()=>call('billing_ledger_close',[business,false,'2026-10-01']),/cannot reopen/);
  await assert.rejects(()=>call('billing_ledger_close',[business,false,'2026-10-23'],viewer),/Only the owner/);
 });
});
