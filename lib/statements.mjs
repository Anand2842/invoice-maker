import{documentLifecycle}from'../public/document-lifecycle.mjs';
import{calculate}from'../public/document-export.js';
import{csv}from'../public/csv.js';
import{paymentMinor,invoiceTypes,issuedStatuses as activeStatuses}from'./payments.mjs';
export function reportDate(value,label){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error(label+' must be a real date');return value}
function add(a,b){const v=a+b;if(!Number.isSafeInteger(v))throw Error('Report total exceeds the supported monetary range');return v}
export function clientStatement(records,business,{from,to,currency=business.currency||'INR',client=''}={}){
 reportDate(from,'From');reportDate(to,'To');if(from>to)throw Error('From must be on or before To');if(!/^[A-Z]{3}$/.test(currency))throw Error('Choose a three-letter currency code');
 const active=records.filter(r=>!r.archived),issues=[],excluded=[],events=[],invoices=new Map();
 const issue=(r,code,message)=>issues.push({recordId:r.id,collection:r.collection,code,message});
 const skip=(r,reason)=>excluded.push({recordId:r.id,reason});
 const clients=active.filter(r=>r.collection==='clients').map(r=>({id:r.id,name:r.data.name}));
 // Read current records and reconstruct dated movements. Status changes are not historical snapshots.
 for(const r of active.filter(r=>r.collection==='documents'&&invoiceTypes.includes(r.data.type))){const d=r.data;
  if(client&&d.clientId!==client)continue;
  if(d.currency!==currency){skip(r,'Different currency');continue}
  try{const lifecycle=documentLifecycle(d);if(!lifecycle.issued){skip(r,'Draft or undated legacy cancellation');continue}reportDate(d.date,'Invoice date');const total=calculate(d).totals.minor.total;if(d.dueDate)reportDate(d.dueDate,'Due date');
   invoices.set(r.id,{record:r,total,balance:0,paid:0,reversed:0,refunded:0,adjusted:0,cancelled:lifecycle.cancelledOn&&lifecycle.cancelledOn<=to?total:0});
   if(d.date<=to)events.push({date:d.date,id:r.id,documentId:r.id,number:d.number||r.id,type:'Invoice',clientId:d.clientId||'',clientName:d.buyer?.name||'',debitMinor:total,creditMinor:0});
   if(lifecycle.cancelledOn&&lifecycle.cancelledOn<=to)events.push({date:lifecycle.cancelledOn,id:r.id+'-cancel',documentId:r.id,number:d.number||r.id,type:'Invoice cancellation',clientId:d.clientId||'',clientName:d.buyer?.name||'',debitMinor:0,creditMinor:total});
   if(!d.clientId&&d.date<=to)issue(r,'UNLINKED_CLIENT','Invoice has no saved client link. It appears under All clients only.');
  }catch(e){issue(r,'INVALID_INVOICE',e.message)}
 }
 for(const r of active.filter(r=>r.collection==='documents'&&['credit-note','debit-note'].includes(r.data.type))){const d=r.data,parent=invoices.get(d.originalDocumentId);if(!parent)continue;
  try{const lifecycle=documentLifecycle(d);if(!lifecycle.issued)continue;reportDate(d.date,'Adjustment date');if(d.date>to)continue;if(d.currency!==currency)throw Error('Adjustment currency differs from its invoice');if(d.date<parent.record.data.date)throw Error('Adjustment predates its invoice');const amount=calculate(d).totals.minor.total,credit=d.type==='credit-note';parent.adjusted=add(parent.adjusted,credit?-amount:amount);events.push({date:d.date,id:r.id,documentId:d.originalDocumentId,number:d.number||r.id,type:credit?'Credit note':'Debit note',clientId:parent.record.data.clientId||'',clientName:parent.record.data.buyer?.name||'',debitMinor:credit?0:amount,creditMinor:credit?amount:0});if(lifecycle.cancelledOn&&lifecycle.cancelledOn<=to){parent.adjusted=add(parent.adjusted,credit?amount:-amount);events.push({date:lifecycle.cancelledOn,id:r.id+'-cancel',documentId:d.originalDocumentId,number:d.number||r.id,type:credit?'Credit note cancellation':'Debit note cancellation',clientId:parent.record.data.clientId||'',clientName:parent.record.data.buyer?.name||'',debitMinor:credit?amount:0,creditMinor:credit?0:amount})}}catch(e){issue(r,'INVALID_ADJUSTMENT',e.message)}
 }
 const includedPayments=new Map(),reversalGroups=new Map();
 for(const r of active.filter(r=>r.collection==='payments'&&r.data.kind!=='reversal')){
  const d=r.data,parent=invoices.get(d.documentId);
  if(!parent){if(!client)skip(r,'Payment is not linked to an included issued invoice');continue}
  try{
   reportDate(d.date,'Payment date');if(d.date>to)continue;
   if(d.kind&&d.kind!=='receipt')throw Error('Unsupported payment event kind');
   if(d.currency&&d.currency!==currency)throw Error('Payment currency differs from its invoice');
   if(d.direction&&d.direction!=='incoming')throw Error('Only incoming invoice payments are supported');
   const amount=paymentMinor(d.amount);parent.paid=add(parent.paid,amount);
   includedPayments.set(r.id,{record:r,amount,parent});
   events.push({date:d.date,id:r.id,documentId:d.documentId,number:d.number||d.reference||r.id,type:'Payment',clientId:parent.record.data.clientId||'',clientName:parent.record.data.buyer?.name||'',debitMinor:0,creditMinor:amount});
   if(!d.currency)issue(r,'INHERITED_PAYMENT_CURRENCY','Payment has no currency; its linked invoice currency is used.');
  }catch(e){issue(r,'INVALID_PAYMENT',e.message)}
 }
 // Reversals debit the original receipt on their own date. Never drop the original event.
 for(const r of active.filter(r=>r.collection==='payments'&&r.data.kind==='reversal')){
  const d=r.data;
  if(client&&!invoices.has(d.documentId))continue;
  try{reportDate(d.date,'Reversal date');if(d.date>to)continue;
   if(!reversalGroups.has(d.reversalOf))reversalGroups.set(d.reversalOf,[]);
   reversalGroups.get(d.reversalOf).push(r);
  }catch(e){issue(r,'INVALID_REVERSAL',e.message)}
 }
 for(const group of reversalGroups.values())for(const r of group){
  const d=r.data,original=includedPayments.get(d.reversalOf);
  try{
   if(group.length!==1)throw Error('Multiple reversals reference the same payment; review before relying on this balance');
   if(!original)throw Error('Reversal has no valid original incoming payment in this view');
   if(d.documentId!==original.record.data.documentId||d.currency!==currency||d.direction!=='incoming')throw Error('Reversal invoice, direction or currency differs from its payment');
   if(d.date<original.record.data.date)throw Error('Reversal predates its payment');
   if(paymentMinor(d.amount)!==original.amount)throw Error('Reversal must match the full original payment amount');
   if(typeof d.reason!=='string'||!d.reason.trim())throw Error('Reversal needs a reason');
   original.parent.paid=add(original.parent.paid,-original.amount);original.parent.reversed=add(original.parent.reversed,original.amount);
   events.push({date:d.date,id:r.id,documentId:d.documentId,number:d.number||r.id,type:'Payment reversal',clientId:original.parent.record.data.clientId||'',clientName:original.parent.record.data.buyer?.name||'',debitMinor:original.amount,creditMinor:0});
  }catch(e){issue(r,'INVALID_REVERSAL',e.message)}
 }
 // Allocation movements settle AR without inventing additional cash receipts.
 for(const r of active.filter(r=>r.collection==='cash-allocations')){
  const d=r.data,parent=invoices.get(d.documentId);if(!parent){if(!client)skip(r,'Allocation is not linked to an included invoice');continue}
  try{reportDate(d.date,'Allocation date');if(d.date>to)continue;
   if(!['allocate','release'].includes(d.kind)||d.direction!=='incoming'||d.currency!==currency||d.clientId!==parent.record.data.clientId||d.target?.currency!==currency||d.target?.clientId!==d.clientId||d.date<parent.record.data.date)throw Error('Allocation context differs from its issued invoice');
   const amount=paymentMinor(d.amount),release=d.kind==='release';parent.paid=add(parent.paid,release?-amount:amount);
   events.push({date:d.date,id:r.id,documentId:d.documentId,number:d.number||r.id,type:release?'Allocation release':'Cash allocation',clientId:d.clientId,clientName:parent.record.data.buyer?.name||'',debitMinor:release?amount:0,creditMinor:release?0:amount});
  }catch(e){issue(r,'INVALID_ALLOCATION',e.message)}
 }
 const customerRefunds=new Map(),refundReversals=new Set();
 for(const r of active.filter(r=>r.collection==='customer-refunds'&&r.data.kind==='refund')){const d=r.data,parent=invoices.get(d.documentId);if(!parent){if(!client)skip(r,'Customer refund is not linked to an included issued invoice');continue}try{reportDate(d.date,'Customer refund date');if(d.date>to)continue;const source=active.find(n=>n.id===d.sourceId&&n.collection==='documents'&&n.data.type==='credit-note');if(!source||source.data.originalDocumentId!==d.documentId||source.data.currency!==currency||d.direction!=='outgoing'||d.currency!==currency||d.clientId!==parent.record.data.clientId||d.date<source.data.date||d.date<parent.record.data.date)throw Error('Customer refund differs from its credit note/invoice source');const amount=paymentMinor(d.amount);if(amount>calculate(source.data).totals.minor.total)throw Error('Customer refund exceeds its source credit note');parent.refunded=add(parent.refunded,amount);customerRefunds.set(r.id,{record:r,parent,amount});events.push({date:d.date,id:r.id,documentId:d.documentId,number:d.number||r.id,type:'Customer refund',clientId:d.clientId,clientName:parent.record.data.buyer?.name||'',debitMinor:amount,creditMinor:0})}catch(e){issue(r,'INVALID_CUSTOMER_REFUND',e.message)}}
 for(const r of active.filter(r=>r.collection==='customer-refunds'&&r.data.kind==='reversal')){const d=r.data;if(client&&!invoices.has(d.documentId))continue;try{reportDate(d.date,'Customer refund correction date');if(d.date>to)continue;const original=customerRefunds.get(d.reversalOf);if(!original||refundReversals.has(d.reversalOf)||original.record.data.documentId!==d.documentId||original.record.data.sourceId!==d.sourceId||original.record.data.currency!==d.currency||d.currency!==currency||d.direction!=='outgoing'||d.date<original.record.data.date||paymentMinor(d.amount)!==original.amount)throw Error('Customer refund correction differs from its original record');refundReversals.add(d.reversalOf);original.parent.refunded=add(original.parent.refunded,-original.amount);events.push({date:d.date,id:r.id,documentId:d.documentId,number:d.number||r.id,type:'Customer refund correction',clientId:original.record.data.clientId,clientName:original.parent.record.data.buyer?.name||'',debitMinor:0,creditMinor:original.amount})}catch(e){issue(r,'INVALID_CUSTOMER_REFUND_REVERSAL',e.message)}}
 const order={Invoice:0,'Debit note':1,'Credit note':2,'Credit note cancellation':3,'Debit note cancellation':3,'Invoice cancellation':4,Payment:5,'Cash allocation':5,'Payment reversal':6,'Allocation release':6,'Customer refund':7,'Customer refund correction':8};events.sort((a,b)=>a.date.localeCompare(b.date)||order[a.type]-order[b.type]||a.id.localeCompare(b.id));
 let opening=0,debits=0,credits=0,running=0;const rows=[];
 for(const e of events){const movement=e.debitMinor-e.creditMinor;running=add(running,movement);if(e.date<from){opening=running;continue}debits=add(debits,e.debitMinor);credits=add(credits,e.creditMinor);rows.push({...e,debit:e.debitMinor/100,credit:e.creditMinor/100,balance:running/100,balanceMinor:running})}
 const buckets={current:0,days1to30:0,days31to60:0,days61to90:0,daysOver90:0,undated:0},aging=[];let creditBalance=0;
 for(const [id,entry]of invoices){const d=entry.record.data,balance=add(add(d.date<=to?entry.total:0,entry.adjusted),-entry.paid-entry.cancelled+entry.refunded);entry.balance=balance;
  if(d.date<=to&&d.status==='paid'&&balance>0)issue(entry.record,'PAID_WITHOUT_SETTLEMENT','Invoice is marked paid but dated payments and notes do not settle it. Its recorded balance remains outstanding.');
  if(balance<0){creditBalance=add(creditBalance,-balance);aging.push({documentId:id,number:d.number,clientName:d.buyer?.name||'',dueDate:d.dueDate||'',daysOverdue:0,bucket:'credit',balance:balance/100});continue}
  if(balance===0)continue;
  const days=d.dueDate?Math.max(0,Math.floor((Date.parse(to+'T00:00:00Z')-Date.parse(d.dueDate+'T00:00:00Z'))/86400000)):null;
  const bucket=days===null?'undated':days===0?'current':days<=30?'days1to30':days<=60?'days31to60':days<=90?'days61to90':'daysOver90';buckets[bucket]=add(buckets[bucket],balance);aging.push({documentId:id,number:d.number,clientName:d.buyer?.name||'',dueDate:d.dueDate||'',daysOverdue:days,bucket,balance:balance/100});if(days===null)issue(entry.record,'MISSING_DUE_DATE','Outstanding invoice has no due date and is shown as undated.');
 }
 const agingById=new Map(aging.map(row=>[row.documentId,row])),issuesById=new Map();
 for(const issue of issues){
  if(!issuesById.has(issue.recordId))issuesById.set(issue.recordId,[]);
  issuesById.get(issue.recordId).push(issue);
 }
 const invoiceBalances=[...invoices.entries()]
  .filter(([,entry])=>entry.record.data.date<=to||entry.paid>0)
  .map(([id,entry])=>{
   const d=entry.record.data,aged=agingById.get(id);
   return{
    documentId:id,type:d.type,number:d.number||id,date:d.date,dueDate:d.dueDate||'',
    clientId:d.clientId||'',clientName:d.buyer?.name||'',currency,
    total:entry.total/100,charges:((d.date<=to?entry.total:0)-entry.cancelled)/100,cancelled:entry.cancelled/100,
    adjustments:entry.adjusted/100,received:entry.paid/100,reversed:entry.reversed/100,refunded:entry.refunded/100,netReceived:(entry.paid-entry.refunded)/100,balance:entry.balance/100,balanceMinor:entry.balance,
    status:entry.cancelled>0?'cancelled':entry.balance<0?'credit':entry.balance===0?'settled':entry.paid>0?'partial':'unpaid',
    daysOverdue:aged?.daysOverdue??0,scheduled:d.date>to,legacyPaid:d.status==='paid',issues:issuesById.get(id)||[]
   };
  }).sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||a.documentId.localeCompare(b.documentId));
 const receivable=Object.values(buckets).reduce(add,0);if(add(receivable,-creditBalance)!==running)throw Error('Statement and aging totals do not reconcile');
 return{businessName:business.name,clientId:client,clientName:client?clients.find(c=>c.id===client)?.name||'Selected client':'All clients',clients,currency,from,to,invoiceBalances,opening:opening/100,debits:debits/100,credits:credits/100,closing:running/100,rows,aging,buckets:Object.fromEntries(Object.entries(buckets).map(([k,v])=>[k,v/100])),receivable:receivable/100,creditBalance:creditBalance/100,issues,excluded,limitations:['Managed issues retain frozen contents and dated cancellations. Legacy archived/current cancellations have no invented history and remain excluded; this is not a complete GL statement.','Invoices, issued credit/debit notes, recorded incoming payments, explicit allocations/releases, customer credit-note refunds/corrections and linked full reversals. Unapplied advances stay outside invoice aging. A paid status never creates a payment.','Currencies are reported separately without exchange-rate conversion. Credit balances remain visible and are not allocated to other invoices.','Vendor payables, opening-balance entries, cash advances and their refunds stay separate from invoice balances; automatic bank reconciliation is not represented here.']};
}
export function statementCSV(report){return csv([{date:report.from,type:'Opening balance',reference:'',client:report.clientName,currency:report.currency,debit:0,credit:0,balance:report.opening},...report.rows.map(r=>({date:r.date,type:r.type,reference:r.number,client:r.clientName,currency:report.currency,debit:r.debit,credit:r.credit,balance:r.balance})),{date:report.to,type:'Closing balance',reference:'',client:report.clientName,currency:report.currency,debit:report.debits,credit:report.credits,balance:report.closing}])}
