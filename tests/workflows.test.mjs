import test from 'node:test';
import assert from 'node:assert/strict';
import {nextBillingDate,workflowDocument} from '../lib/workflows.mjs';
test('Billing calendar clamps month end and leap days',()=>{
 assert.equal(nextBillingDate('2026-01-31','Monthly'),'2026-02-28');
 assert.equal(nextBillingDate('2028-02-29','Yearly'),'2029-02-28');
 assert.equal(nextBillingDate('2026-11-30','Quarterly'),'2027-02-28');
});
test('Quotation conversion removes stale editor state and recalculates totals',()=>{
 const source={id:'abcd1234-0000-4000-8000-000000000001',collection:'documents',data:{type:'quotation',number:'Q1',date:'2026-10-20',currency:'INR',seller:{name:'Demo'},buyer:{name:'Client'},items:[{name:'Service',quantity:2,rate:100,taxRate:18}],taxType:'GST',editorSnapshot:{html:'old quotation'},totals:{total:1}}};
 const result=workflowDocument(source,{},'quotation-invoice').document;
 assert.equal(result.type,'invoice');assert.equal(result.editorSnapshot,undefined);assert.equal(result.totals.total,236);assert.equal(result.status,'draft');
});
test('Paused subscriptions cannot generate invoices',()=>assert.throws(()=>workflowDocument({id:'12345678',collection:'subscriptions',data:{status:'Paused'}},{},'subscription-invoice'),/active/));
