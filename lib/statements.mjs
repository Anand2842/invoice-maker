import{calculate}from'../public/document-export.js';
import{csv}from'../public/csv.js';
const invoiceTypes=['invoice','gst-invoice','commercial-invoice'];
const activeStatuses=['sent','paid','partially_paid'];
export function reportDate(value,label){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error(label+' must be a real date');return value}
function cents(value){if(!['number','string'].includes(typeof value)||!/^\d+(\.\d{1,2})?$/.test(String(value)))throw Error('Payment amount must have at most two decimal places');const [whole,fraction='']=String(value).split('.');const n=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));if(!Number.isSafeInteger(n)||n<=0)throw Error('Payment amount must be positive and within the supported range');return n}
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
  if(!activeStatuses.includes(d.status)){skip(r,'Draft or cancelled invoice');continue}
  if(d.currency!==currency){skip(r,'Different currency');continue}
  try{reportDate(d.date,'Invoice date');const total=calculate(d).totals.minor.total;if(d.dueDate)reportDate(d.dueDate,'Due date');
   invoices.set(r.id,{record:r,total,balance:0,paid:0,adjusted:0});
   if(d.date<=to)events.push({date:d.date,id:r.id,documentId:r.id,number:d.number||r.id,type:'Invoice',clientId:d.clientId||'',clientName:d.buyer?.name||'',debitMinor:total,creditMinor:0});
   if(!d.clientId&&d.date<=to)issue(r,'UNLINKED_CLIENT','Invoice has no saved client link. It appears under All clients only.');
  }catch(e){issue(r,'INVALID_INVOICE',e.message)}
 }
 for(const r of active.filter(r=>r.collection==='documents'&&['credit-note','debit-note'].includes(r.data.type)&&r.data.status==='sent')){const d=r.data,parent=invoices.get(d.originalDocumentId);if(!parent)continue;
  try{reportDate(d.date,'Adjustment date');if(d.date>to)continue;if(d.currency!==currency)throw Error('Adjustment currency differs from its invoice');if(d.date<parent.record.data.date)throw Error('Adjustment predates its invoice');const amount=calculate(d).totals.minor.total,credit=d.type==='credit-note';parent.adjusted=add(parent.adjusted,credit?-amount:amount);events.push({date:d.date,id:r.id,documentId:d.originalDocumentId,number:d.number||r.id,type:credit?'Credit note':'Debit note',clientId:parent.record.data.clientId||'',clientName:parent.record.data.buyer?.name||'',debitMinor:credit?0:amount,creditMinor:credit?amount:0})}catch(e){issue(r,'INVALID_ADJUSTMENT',e.message)}
 }
 for(const r of active.filter(r=>r.collection==='payments')){const d=r.data,parent=invoices.get(d.documentId);if(!parent){if(!client)skip(r,'Payment is not linked to an included issued invoice');continue}
  try{reportDate(d.date,'Payment date');if(d.date>to)continue;if(d.currency&&d.currency!==currency)throw Error('Payment currency differs from its invoice');if(d.direction&&d.direction!=='incoming')throw Error('Only incoming invoice payments are supported');const amount=cents(d.amount);parent.paid=add(parent.paid,amount);events.push({date:d.date,id:r.id,documentId:d.documentId,number:d.number||d.reference||r.id,type:'Payment',clientId:parent.record.data.clientId||'',clientName:parent.record.data.buyer?.name||'',debitMinor:0,creditMinor:amount});if(!d.currency)issue(r,'INHERITED_PAYMENT_CURRENCY','Payment has no currency; its linked invoice currency is used.')}catch(e){issue(r,'INVALID_PAYMENT',e.message)}
 }
 const order={Invoice:0,'Debit note':1,'Credit note':2,Payment:3};events.sort((a,b)=>a.date.localeCompare(b.date)||order[a.type]-order[b.type]||a.id.localeCompare(b.id));
 let opening=0,debits=0,credits=0,running=0;const rows=[];
 for(const e of events){const movement=e.debitMinor-e.creditMinor;running=add(running,movement);if(e.date<from){opening=running;continue}debits=add(debits,e.debitMinor);credits=add(credits,e.creditMinor);rows.push({...e,debit:e.debitMinor/100,credit:e.creditMinor/100,balance:running/100,balanceMinor:running})}
 const buckets={current:0,days1to30:0,days31to60:0,days61to90:0,daysOver90:0,undated:0},aging=[];let creditBalance=0;
 for(const [id,entry]of invoices){const d=entry.record.data,balance=add(add(d.date<=to?entry.total:0,entry.adjusted),-entry.paid);entry.balance=balance;
  if(d.date<=to&&d.status==='paid'&&balance>0)issue(entry.record,'PAID_WITHOUT_SETTLEMENT','Invoice is marked paid but dated payments and notes do not settle it. Its recorded balance remains outstanding.');
  if(balance<0){creditBalance=add(creditBalance,-balance);aging.push({documentId:id,number:d.number,clientName:d.buyer?.name||'',dueDate:d.dueDate||'',daysOverdue:0,bucket:'credit',balance:balance/100});continue}
  if(balance===0)continue;
  const days=d.dueDate?Math.max(0,Math.floor((Date.parse(to+'T00:00:00Z')-Date.parse(d.dueDate+'T00:00:00Z'))/86400000)):null;
  const bucket=days===null?'undated':days===0?'current':days<=30?'days1to30':days<=60?'days31to60':days<=90?'days61to90':'daysOver90';buckets[bucket]=add(buckets[bucket],balance);aging.push({documentId:id,number:d.number,clientName:d.buyer?.name||'',dueDate:d.dueDate||'',daysOverdue:days,bucket,balance:balance/100});if(days===null)issue(entry.record,'MISSING_DUE_DATE','Outstanding invoice has no due date and is shown as undated.');
 }
 const receivable=Object.values(buckets).reduce(add,0);if(add(receivable,-creditBalance)!==running)throw Error('Statement and aging totals do not reconcile');
 return{businessName:business.name,clientId:client,clientName:client?clients.find(c=>c.id===client)?.name||'Selected client':'All clients',clients,currency,from,to,opening:opening/100,debits:debits/100,credits:credits/100,closing:running/100,rows,aging,buckets:Object.fromEntries(Object.entries(buckets).map(([k,v])=>[k,v/100])),receivable:receivable/100,creditBalance:creditBalance/100,issues,excluded,limitations:['Based on current active records and their transaction dates. Archived records and current cancellations are excluded; this is not a historical ledger snapshot.','Invoices, issued credit/debit notes and recorded incoming payments only. A paid status never creates a payment.','Currencies are reported separately without exchange-rate conversion. Credit balances remain visible and are not allocated to other invoices.','Vendor payables, opening-balance entries, refunds and automatic payment reconciliation are not implemented in this report.']};
}
export function statementCSV(report){return csv([{date:report.from,type:'Opening balance',reference:'',client:report.clientName,currency:report.currency,debit:0,credit:0,balance:report.opening},...report.rows.map(r=>({date:r.date,type:r.type,reference:r.number,client:r.clientName,currency:report.currency,debit:r.debit,credit:r.credit,balance:r.balance})),{date:report.to,type:'Closing balance',reference:'',client:report.clientName,currency:report.currency,debit:report.debits,credit:report.credits,balance:report.closing}])}
