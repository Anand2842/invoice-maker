import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentMinor,paymentForInvoice} from '../lib/payments.mjs';
import {validateRecord} from '../lib/business.mjs';
import {clientStatement} from '../lib/statements.mjs';
import {dashboardSummary} from '../lib/dashboard.mjs';
import {visibleInvoices,invoiceURL,statementURL} from '../public/receivables/view.mjs';

const id='00000000-0000-4000-8000-000000000001',business='00000000-0000-4000-8000-000000000002';
const invoice=(patch={})=>({id,business_id:business,demo:false,archived:false,collection:'documents',updated_at:'2026-10-29',data:{type:'invoice',number:'INV-001',date:'2026-10-01',dueDate:'2026-10-20',currency:'INR',status:'sent',taxType:'NONE',seller:{name:'Studio'},buyer:{name:'Customer'},clientId:'client-1',items:[{name:'Work',quantity:1,rate:100}],...patch}});
const payment=(amount=25,patch={})=>({id:'payment',collection:'payments',data:{documentId:id,date:'2026-10-10',currency:'INR',method:'Bank transfer',amount,...patch}});
const statement=(rows,to='2026-10-29')=>clientStatement(rows,{name:'Studio',currency:'INR'},{from:'2026-10-01',to});

test('payment decimals match statement precision without floating-point rounding',()=>{
 for(const [value,expected]of [['0.01',1],[0.29,29],['12.30',1230],[100,10000]])assert.equal(paymentMinor(value),expected);
 for(const value of [null,undefined,NaN,Infinity,-1,0,'','1.001','2e3',true,'1.',' 1.00','90071992547409.92'])assert.throws(()=>paymentMinor(value));
});
test('generic payment validation rejects amounts statements cannot consume',()=>{
 for(const amount of ['1.001','2e3',10000000001])assert.throws(()=>validateRecord('payments',payment(amount).data));
 assert.equal(validateRecord('payments',payment('0.29').data).amount,0.29);
 assert.throws(()=>validateRecord('payments',payment(10,{documentId:'not-an-id'}).data),/saved invoice/);
 assert.throws(()=>validateRecord('payments',payment(10,{date:'2026-02-30'}).data),/real date/);
});
test('application payment contract requires same business, mode, issued invoice and currency',()=>{
 const data=payment().data,context={business,demo:false};
 assert.deepEqual(paymentForInvoice(data,invoice(),context),{...data,direction:'incoming'});
 assert.equal(paymentForInvoice({...data,currency:undefined},invoice(),context).currency,'INR');
 for(const parent of [null,{...invoice(),id:'other'},{...invoice(),business_id:'other'},{...invoice(),demo:true},{...invoice(),archived:true},{...invoice(),collection:'expenses'},invoice({status:'draft'}),invoice({status:'cancelled'}),invoice({type:'quotation'}),invoice({currency:'USD'})])assert.throws(()=>paymentForInvoice(data,parent,context));
 assert.throws(()=>paymentForInvoice({...data,direction:'outgoing'},invoice(),context),/incoming/);
});
test('dated invoice balances distinguish unpaid, partial, settled and customer credit',()=>{
 for(const [amount,status,balance]of [[0,'unpaid',100],[25,'partial',75],[100,'settled',0],[125,'credit',-25]]){
  const r=statement([invoice(),...(amount?[payment(amount)]:[])]),row=r.invoiceBalances[0];
  assert.equal(row.status,status);assert.equal(row.balance,balance);assert.equal(row.received,amount);assert.equal(row.charges,100);assert.equal(row.adjustments,0);assert.equal(row.balanceMinor,Math.round(balance*100));
  assert.equal(r.invoiceBalances.reduce((sum,v)=>sum+v.balanceMinor,0),Math.round(r.closing*100));
 }
});
test('future receipts and paid flag do not erase outstanding dated balances',()=>{
 const r=statement([invoice({status:'paid'}),payment(100,{date:'2026-11-01'})]);
 assert.equal(r.invoiceBalances[0].status,'unpaid');assert.equal(r.invoiceBalances[0].received,0);assert.equal(r.invoiceBalances[0].balance,100);
 assert.ok(r.invoiceBalances[0].issues.some(i=>i.code==='PAID_WITHOUT_SETTLEMENT'));
});
test('prepayment before future invoice is a separate credit with no premature charge',()=>{
 const r=statement([invoice({date:'2026-11-01',dueDate:'2026-11-15'}),payment()]);
 assert.equal(r.invoiceBalances[0].scheduled,true);assert.equal(r.invoiceBalances[0].charges,0);assert.equal(r.invoiceBalances[0].total,100);assert.equal(r.invoiceBalances[0].balance,-25);
 assert.equal(statement([invoice({date:'2026-11-01'})]).invoiceBalances.length,0);
});
test('credit/debit adjustments and receipts reconcile across receivables, statement and dashboard',()=>{
 const note=(type,rate,date)=>({...invoice(),id:type, data:{...invoice().data,type,number:type,originalDocumentId:id,originalDocumentNumber:'INV-001',originalDocumentDate:'2026-10-01',adjustmentReason:'Fixture',date,items:[{quantity:1,rate}]}});
 const rows=[invoice(),note('credit-note',20,'2026-10-12'),note('debit-note',10,'2026-10-15'),payment(25)];
 const report=statement(rows),dashboard=dashboardSummary(rows,'INR','2026-10-29');
 assert.equal(report.invoiceBalances[0].adjustments,-10);assert.equal(report.invoiceBalances[0].balance,65);assert.equal(report.closing,65);assert.equal(dashboard.totalPending,65);assert.equal(dashboard.totalOverdue,65);
 assert.equal(statement(rows,'2026-10-11').invoiceBalances[0].balance,75);
});
test('view filters do not conflate credits, zero balances, partial payment and overdue',()=>{
 const rows=[{number:'INV-01',clientName:'Northstar',status:'partial',balanceMinor:7500,daysOverdue:9},{number:'INV-02',clientName:'Other',status:'credit',balanceMinor:-2500,daysOverdue:0},{number:'INV-03',clientName:'Northstar',status:'settled',balanceMinor:0,daysOverdue:0}];
 assert.equal(visibleInvoices(rows,{state:'outstanding'}).length,1);assert.equal(visibleInvoices(rows,{state:'overdue'}).length,1);assert.equal(visibleInvoices(rows,{state:'partial'}).length,1);
 assert.equal(visibleInvoices(rows,{search:'  NORTHSTAR '}).length,2);assert.equal(visibleInvoices(rows,{search:'inv-02',state:'credit'}).length,1);assert.equal(rows.length,3);
});
test('invoice and statement links retain business, currency, date, client and demo context',()=>{
 const context={business,demo:'true',currency:'USD',date:'2026-10-29'},row={documentId:id,type:'commercial-invoice'};
 const invoiceLink=new URL(invoiceURL(row,context),'https://folio.example'),statementLink=new URL(statementURL(context,'customer'),'https://folio.example');
 assert.equal(invoiceLink.searchParams.get('business'),business);assert.equal(invoiceLink.searchParams.get('demo'),'true');assert.equal(invoiceLink.searchParams.get('id'),id);
 for(const [key,value]of Object.entries({business,demo:'true',currency:'USD',client:'customer',from:'2026-10-01',to:'2026-10-29'}))assert.equal(statementLink.searchParams.get(key),value);
});
