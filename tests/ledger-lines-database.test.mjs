import test from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{paymentDatabase}from'./helpers/payment-db.mjs';
test('per-account ledger pages retain complete running balances, dated originals and scoped authorization',async t=>{
 const f=await paymentDatabase();t.after(()=>f.close());const{db,business,owner,viewer,outsider,as}=f;
 const call=(name,args,actor=owner)=>as(actor,async db=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result);
 await call('billing_ledger_setup',[business,false,'2026-10-01']);
 const accounts=(await db.query('select id,code from public.billing_ledger_accounts where business_id=$1 and not demo',[business])).rows,id=code=>accounts.find(a=>a.code===code).id;
 const post=(date,entries,description='Synthetic ledger page fixture',kind='manual')=>call('billing_ledger_post',[business,false,randomUUID(),{date,description,kind,entries}]);
 const entry=(code,debit,credit)=>({account_id:id(code),debit,credit});
 const read=(patch={},actor=owner)=>call('billing_ledger_lines',[business,false,id('1000'),'2026-10-10','2026-10-30',patch.date??null,patch.batch??null,patch.line??null,patch.size??2,patch.snapshot??null],actor);
 await post('2026-10-01',[entry('1000','100.01','0'),entry('3000','0','100.01')],'Opening', 'opening');
 const original=await post('2026-10-10',[entry('1000','0.10','0'),entry('1000','0.20','0'),entry('4000','0','0.30')],'Two account lines in one batch');
 await post('2026-10-10',[entry('1000','0','0.07'),entry('5000','0.07','0')]);
 await post('2026-10-20',[entry('1000','2.00','0'),entry('4000','0','2.00')]);
 let before;
 await t.test('cursor includes same-day batch and same-batch line, with exact opening and page-independent closing',async()=>{
  const first=await read(),rows=[...first.rows];assert.equal(first.rows.length,2);assert.ok(first.next);assert.equal(first.opening,'100.01');assert.equal(first.closing,'102.24');let next=first.next;
  while(next){const page=await read(next);assert.equal(page.opening,first.opening);assert.equal(page.closing,first.closing);rows.push(...page.rows);next=page.next}
  assert.equal(rows.length,4);assert.equal(new Set(rows.map(r=>r.batchId+':'+r.line)).size,4);assert.deepEqual(rows.map(r=>r.date),['2026-10-10','2026-10-10','2026-10-10','2026-10-20']);
  const full=await read({size:200});assert.deepEqual(rows,full.rows);assert.equal(rows.at(-1).balance,'102.24');let cents=10001;for(const row of rows){cents+=Math.round(Number(row.debit)*100)-Math.round(Number(row.credit)*100);assert.equal(row.balance,(cents/100).toFixed(2))}before=full;
 });
 await t.test('later reversal does not erase original or change earlier as-of page totals',async()=>{
  await call('billing_ledger_reverse',[business,false,randomUUID(),original.batch.id,'2026-10-25','Correction']);
  const historical=await call('billing_ledger_lines',[business,false,id('1000'),'2026-10-10','2026-10-20',null,null,null,200]);assert.deepEqual(historical.rows,before.rows);assert.equal(historical.closing,before.closing);
  const current=await read({size:200});assert.equal(current.rows.length,6);assert.equal(current.closing,'101.94');assert.equal(current.rows.filter(r=>r.batchId===original.batch.id).length,2);assert.equal(current.rows.at(-1).balance,'101.94');
 });

 await t.test('continuation retains the original sequence ceiling after a new backdated journal',async()=>{
  const first=await read(),snapshot=first.snapshotNumber;await post('2026-10-10',[entry('1000','0.01','0'),entry('4000','0','0.01')],'New backdated posting');
  let next=first.next,rows=[...first.rows];while(next){const page=await read(next);assert.equal(page.snapshotNumber,snapshot);assert.equal(page.opening,first.opening);assert.equal(page.closing,first.closing);rows.push(...page.rows);next=page.next}assert.equal(rows.length,6);assert.equal(rows.at(-1).balance,first.closing);const fresh=await read({size:200});assert.equal(fresh.rows.length,7);assert.equal(fresh.closing,'101.95');assert.notEqual(fresh.snapshotNumber,snapshot);await assert.rejects(()=>read({date:first.next.date,batch:first.next.batch,line:first.next.line}),/original snapshot/);await assert.rejects(()=>read({snapshot:'999999999'}),/outside the posted sequence/);
 });
 await t.test('empty periods retain true opening and closing without manufacturing rows',async()=>{const result=await call('billing_ledger_lines',[business,false,id('1000'),'2026-10-02','2026-10-09']);assert.deepEqual(result.rows,[]);assert.equal(result.next,null);assert.equal(result.opening,'100.01');assert.equal(result.closing,'100.01')});
 await t.test('viewer reads; outsider and anonymous cannot use definer to read another business',async()=>{assert.equal((await read({},viewer)).account.id,id('1000'));await assert.rejects(()=>read({},outsider),/unavailable/);await db.exec('begin;set local role anon');try{await assert.rejects(()=>db.query('select public.billing_ledger_lines($1,false,$2,$3,$4)',[business,id('1000'),'2026-10-01','2026-10-30']),/permission denied/)}finally{await db.exec('rollback')}});
 await t.test('cross-mode and foreign accounts never return rows',async()=>{await call('billing_ledger_setup',[business,true,'2026-10-01']);await assert.rejects(()=>call('billing_ledger_lines',[business,true,id('1000'),'2026-10-01','2026-10-30']),/business and data mode/);const foreign=randomUUID();await db.query("insert into billing_businesses(id,owner_id,name) values($1,$2,'Foreign fixture')",[foreign,outsider]);await call('billing_ledger_setup',[foreign,false,'2026-10-01'],outsider);const foreignAccount=(await db.query('select id from billing_ledger_accounts where business_id=$1 limit 1',[foreign])).rows[0].id;await assert.rejects(()=>call('billing_ledger_lines',[business,false,foreignAccount,'2026-10-01','2026-10-30']),/business and data mode/)});
 await t.test('incomplete, nonexistent, wrong-account and out-of-period cursors reject; page bounds are enforced',async()=>{await assert.rejects(()=>read({date:'2026-10-10'}),/complete/);await assert.rejects(()=>read({date:'2026-10-10',batch:randomUUID(),line:1,snapshot:'5'}),/cursor is invalid/);await assert.rejects(()=>read({date:'2026-10-10',batch:original.batch.id,line:3,snapshot:'5'}),/cursor is invalid/);await assert.rejects(()=>read({date:'2026-10-01',batch:original.batch.id,line:1,snapshot:'5'}),/cursor is invalid/);for(const size of[0,201])await assert.rejects(()=>read({size}),/between 1 and 200/);await assert.rejects(()=>call('billing_ledger_lines',[business,false,id('1000'),'infinity','infinity']),/valid report date/)});
});
