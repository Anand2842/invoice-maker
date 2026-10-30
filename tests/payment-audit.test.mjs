import test from 'node:test';import assert from 'node:assert/strict';import{auditPaymentRecords}from'../lib/payment-audit.mjs';
const invoice={id:'invoice',business_id:'business',demo:false,collection:'documents',data:{type:'invoice',number:'INV-1',status:'paid',date:'2026-10-01',currency:'INR',seller:{name:'Private Seller'},buyer:{name:'Private Buyer'},taxType:'NONE',items:[{quantity:1,rate:100}]}};
const payment={id:'payment',business_id:'business',demo:false,collection:'payments',data:{documentId:'invoice',date:'2026-10-10',amount:25,currency:'INR',direction:'incoming'}};
test('read-only audit detects legacy settlement and context issues without exporting party values',()=>{
 const rows=[invoice,payment,{...payment,id:'bad',demo:true,archived:true,data:{...payment.data,amount:'1.001',date:'2026-02-30',currency:'USD'}}],before=JSON.stringify(rows),r=auditPaymentRecords(rows);
 for(const code of ['PAID_WITHOUT_SETTLEMENT','CROSS_CONTEXT_PAYMENT','ARCHIVED_PAYMENT','INVALID_PAYMENT_AMOUNT','INVALID_PAYMENT_DATE','MISMATCHED_PAYMENT_CURRENCY'])assert.ok(r.counts[code],code);
 assert.equal(JSON.stringify(rows),before);assert.ok(!JSON.stringify(r).includes('Private Seller'));assert.ok(!JSON.stringify(r).includes('Private Buyer'));
});
test('audit flags missing parents, inherited currency and report-invalid invoice date',()=>{
 const r=auditPaymentRecords([{...invoice,data:{...invoice.data,dueDate:'bad'}},{...payment,data:{...payment.data,currency:undefined}},{...payment,id:'orphan',data:{...payment.data,documentId:'missing'}}]);
 for(const code of ['INVALID_INVOICE','MISSING_PAYMENT_INVOICE','INHERITED_PAYMENT_CURRENCY'])assert.ok(r.counts[code],code);
});
