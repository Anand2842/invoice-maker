import {businessDate} from '../public/business-date.js';
import {validateRecord} from './business.mjs';
export function nextBillingDate(date,frequency){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('Invalid billing date');
 const months={Monthly:1,Quarterly:3,Yearly:12}[frequency];if(!months)throw Error('Invalid billing frequency');
 const [y,m,d]=date.split('-').map(Number),first=new Date(Date.UTC(y,m-1+months,1));
 return new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(d,new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate()))).toISOString().slice(0,10);
}
export function workflowDocument(source,business,action,now=new Date()){
 const d=source.data,day=businessDate(now,business.time_zone),suffix=source.id.slice(0,8).toUpperCase();
 if(source.archived)throw Error('Restore this record first');
 let out,nextDate=null;
 if(action==='lead-quotation'&&source.collection==='leads'){
  out={type:'quotation',number:'QUO-'+suffix,date:day,currency:business.currency,seller:{name:business.name},buyer:{name:d.name,email:d.email||'',phone:d.phone||''},taxType:'NONE',gstMode:'split',items:[{name:'Proposed services',description:d.notes||'',quantity:1,rate:d.amount,taxRate:0}],notes:'Draft created from a lead. Review item descriptions, addresses and taxes before sending.'};
 }else if(action==='quotation-invoice'&&source.collection==='documents'&&d.type==='quotation'){
  const {editorSnapshot,totals,...details}=d;out={...details,type:'invoice',number:'INV-'+suffix,date:day,dueDate:'',status:'draft'};
 }else if(['invoice-credit-note','invoice-debit-note'].includes(action)&&source.collection==='documents'&&['invoice','gst-invoice','commercial-invoice'].includes(d.type)){
  if(!['sent','paid'].includes(d.status))throw Error('Issue the original invoice before creating an adjustment');
  const {editorSnapshot,totals,payments,einvoice,emailDelivery,lastDocumentId,sourceRecord,...details}=d;
  out={...details,type:action==='invoice-credit-note'?'credit-note':'debit-note',number:'DRAFT',date:day<d.date?d.date:day,dueDate:'',originalDocumentId:source.id,originalDocumentNumber:d.number,originalDocumentDate:d.date,adjustmentReason:'Review and enter the reason for this adjustment',status:'draft'};
 }else if(action==='subscription-invoice'&&source.collection==='subscriptions'){
  if(d.status!=='Active')throw Error('Only an active subscription can generate an invoice');
  nextDate=nextBillingDate(d.nextDate,d.frequency);
  out={type:'invoice',number:'SUB-'+suffix+'-'+d.nextDate.replaceAll('-',''),date:d.nextDate,currency:business.currency,seller:{name:business.name},buyer:{name:d.name},taxType:'NONE',gstMode:'split',items:[{name:d.name,description:d.frequency+' subscription',quantity:1,rate:d.amount,taxRate:0}],notes:'Draft generated from a subscription. Review customer details and taxes before sending.'};
 }else throw Error('This action does not apply to this record');
 out.status='draft';out.sourceRecord=source.id;
 return{document:validateRecord('documents',out),nextDate};
}
