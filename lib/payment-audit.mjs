import {businessDate} from '../public/business-date.js';
import {paymentMinor,invoiceTypes,issuedStatuses} from './payments.mjs';
import {reportDate,clientStatement} from './statements.mjs';
import {calculate} from '../public/document-export.js';
// Read-only classification. Output deliberately excludes party/contact values and raw data.
export function auditPaymentRecords(records,{asOf=businessDate()}={}){
 reportDate(asOf,'Audit date');const issues=[],byId=new Map(records.map(r=>[r.id,r])),groups=new Map();
 const add=(r,code)=>issues.push({id:r.id,business:r.business_id,demo:r.demo,code});
 for(const r of records){
  if(r.collection==='documents'&&invoiceTypes.includes(r.data.type)&&issuedStatuses.includes(r.data.status)){
   try{reportDate(r.data.date,'Invoice date');if(r.data.dueDate)reportDate(r.data.dueDate,'Due date');calculate(r.data)}catch{add(r,'INVALID_INVOICE')}
   if(!r.data.number||!r.data.seller?.name||!r.data.buyer?.name)add(r,'INCOMPLETE_INVOICE_SNAPSHOT');
  }
  if(r.collection!=='payments')continue;const d=r.data,parent=byId.get(d.documentId);
  if(r.archived)add(r,'ARCHIVED_PAYMENT');
  if(!parent||parent.collection!=='documents')add(r,'MISSING_PAYMENT_INVOICE');
  else{
   if(parent.business_id!==r.business_id||parent.demo!==r.demo)add(r,'CROSS_CONTEXT_PAYMENT');
   if(parent.archived||!invoiceTypes.includes(parent.data.type)||!issuedStatuses.includes(parent.data.status))add(r,'UNAVAILABLE_PAYMENT_INVOICE');
   if(!d.currency)add(r,'INHERITED_PAYMENT_CURRENCY');else if(d.currency!==parent.data.currency)add(r,'MISMATCHED_PAYMENT_CURRENCY');
  }
  try{paymentMinor(d.amount);if(Number(d.amount)>1e10)throw Error()}catch{add(r,'INVALID_PAYMENT_AMOUNT')}
  try{reportDate(d.date,'Payment date')}catch{add(r,'INVALID_PAYMENT_DATE')}
  if(d.direction&&d.direction!=='incoming')add(r,'INVALID_PAYMENT_DIRECTION');
  if(d.kind&&!['receipt','reversal'].includes(d.kind))add(r,'INVALID_PAYMENT_KIND');
 }
 for(const r of records){const currency=r.collection==='documents'?r.data.currency:byId.get(r.data.documentId)?.data.currency;if(!currency)continue;const key=JSON.stringify([r.business_id,r.demo,currency]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)}
 for(const [key,rows]of groups){const [business,demo,currency]=JSON.parse(key);try{
  const report=clientStatement(rows,{name:'Audit',currency},{from:asOf,to:asOf,currency});
  for(const issue of report.issues)if(['PAID_WITHOUT_SETTLEMENT','INVALID_REVERSAL'].includes(issue.code))issues.push({id:issue.recordId,business,demo,code:issue.code});
 }catch{issues.push({business,demo,code:'UNRECONCILED_REPORT'})}}
 return{asOf,records:records.length,payments:records.filter(r=>r.collection==='payments').length,issues,counts:issues.reduce((out,i)=>(out[i.code]=(out[i.code]||0)+1,out),{})};
}
