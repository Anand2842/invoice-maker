import test from 'node:test';
import assert from 'node:assert/strict';
import {clientStatement} from '../lib/statements.mjs';
import {dashboardSummary} from '../lib/dashboard.mjs';
const invoice={id:'invoice',collection:'documents',updated_at:'2026-10-29',data:{type:'invoice',number:'INV-1',date:'2026-10-01',dueDate:'2026-10-20',status:'sent',currency:'INR',taxType:'NONE',seller:{name:'Seller'},buyer:{name:'Buyer'},items:[{name:'Work',quantity:1,rate:100}]}};
const receipt={id:'receipt',collection:'payments',data:{kind:'receipt',number:'RCT-1',documentId:'invoice',date:'2026-10-10',amount:'75.00',currency:'INR',direction:'incoming'}};
const reversal={id:'reversal',collection:'payments',data:{kind:'reversal',number:'REV-1',reversalOf:'receipt',documentId:'invoice',date:'2026-10-29',amount:'75.00',currency:'INR',direction:'incoming',reason:'Duplicate entry correction'}};
const run=(records,to='2026-10-29',from='2026-10-01')=>clientStatement(records,{name:'Test',currency:'INR'},{from,to});
test('reversal debits cash settlement on its date, keeps original receipt and reconciles dashboard',()=>{
 const records=[invoice,receipt,reversal],report=run(records);
 assert.equal(report.closing,100);assert.equal(report.credits,75);assert.equal(report.debits,175);assert.deepEqual(report.rows.map(r=>r.type),['Invoice','Payment','Payment reversal']);
 assert.equal(report.invoiceBalances[0].received,0);assert.equal(report.invoiceBalances[0].reversed,75);assert.equal(report.invoiceBalances[0].status,'unpaid');
 assert.equal(dashboardSummary(records,'INR','2026-10-29').totalPending,100);
 assert.equal(run(records,'2026-10-28').closing,25);
});
test('reversal after opening date restores balance without dropping historical receipt',()=>{
 const report=run([invoice,receipt,reversal],'2026-10-29','2026-10-20');
 assert.equal(report.opening,25);assert.equal(report.rows.length,1);assert.equal(report.rows[0].debit,75);assert.equal(report.closing,100);
});
test('valid legacy receipt without event kind can be fully reversed',()=>{
 const old={...receipt,data:{...receipt.data,kind:undefined,currency:undefined}};
 assert.equal(run([invoice,old,reversal]).closing,100);
});
test('reversal cannot fabricate cash by using another invoice, amount, currency, direction or original',()=>{
 for(const patch of [{reversalOf:'missing'},{amount:25},{currency:'USD'},{documentId:'other'},{direction:'outgoing'},{date:'2026-10-09'},{reason:''}]){
  const report=run([invoice,receipt,{...reversal,data:{...reversal.data,...patch}}]);
  assert.equal(report.closing,25);assert.ok(report.issues.some(i=>i.code==='INVALID_REVERSAL'));
 }
});
test('duplicate reversals are flagged and neither is silently chosen',()=>{
 const records=[invoice,receipt,reversal,{...reversal,id:'duplicate'}],a=run(records),b=run([...records].reverse());
 assert.equal(a.closing,25);assert.equal(a.issues.filter(i=>i.code==='INVALID_REVERSAL').length,2);assert.equal(a.closing,b.closing);
});
test('unknown payment kinds are review issues and never counted as cash',()=>{
 const report=run([invoice,{...receipt,data:{...receipt.data,kind:'refund'}}]);
 assert.equal(report.closing,100);assert.ok(report.issues.some(i=>i.code==='INVALID_PAYMENT'));
});
test('prepayment reversal before invoice date removes credit without posting future invoice',()=>{
 const report=run([{...invoice,data:{...invoice.data,date:'2026-11-01',dueDate:'2026-11-20'}},receipt,reversal]);
 assert.equal(report.closing,0);assert.equal(report.creditBalance,0);assert.equal(report.invoiceBalances.length,0);assert.equal(report.rows.filter(r=>r.type==='Payment reversal').length,1);
});
