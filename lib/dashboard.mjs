import {clientStatement} from './statements.mjs';
import {calculate} from '../public/document-export.js';
export function dashboardSummary(records,currency,today){
 const [year,month]=today.split('-').map(Number),period=today.slice(0,7);
 const months=Array.from({length:12},(_,i)=>new Date(Date.UTC(year,month-12+i,1)).toISOString().slice(0,7));
 const revenue=Object.fromEntries(months.map(m=>[m,0])),expenses=Object.fromEntries(months.map(m=>[m,0]));
 const all=records.filter(r=>!r.archived),documents=all.filter(r=>r.collection==='documents');
 const invoices=documents.filter(r=>['invoice','gst-invoice','commercial-invoice'].includes(r.data.type)&&['sent','paid','partially_paid'].includes(r.data.status));
 const settlement=clientStatement(all,{name:'Business',currency},{from:today,to:today,currency});
 const byId=new Map(documents.map(r=>[r.id,r]));
 const adjustments=documents.filter(r=>['credit-note','debit-note'].includes(r.data.type)&&r.data.status==='sent'&&r.data.currency===currency&&invoices.some(i=>i.id===r.data.originalDocumentId&&i.data.currency===currency));
 const invalid=new Set(settlement.issues.filter(i=>['INVALID_INVOICE','INVALID_ADJUSTMENT'].includes(i.code)).map(i=>i.recordId));
 for(const r of [...invoices,...adjustments]){const d=r.data;if(d.currency!==currency||d.date>today||invalid.has(r.id))continue;try{const net=calculate(d).totals.minor.taxable*(d.type==='credit-note'?-1:1),m=d.date.slice(0,7);if(m in revenue)revenue[m]+=net}catch{}}
 for(const r of all.filter(r=>r.collection==='expenses')){const d=r.data;if((d.currency&&d.currency!==currency)||d.date>today)continue;const m=d.date?.slice(0,7),value=Math.round(Number(d.amount)*100);if(m in expenses&&Number.isSafeInteger(value)&&value>=0)expenses[m]+=value;}
 const overdueDocuments=settlement.aging.filter(r=>r.balance>0&&r.daysOverdue>0).map(r=>{const source=byId.get(r.documentId);return{id:r.documentId,number:r.number,buyer:r.clientName,dueDate:r.dueDate,currency,balance:r.balance,daysOverdue:r.daysOverdue,type:source.data.type,demo:source.demo}}).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
 const through=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
 const upcoming=all.filter(r=>r.collection==='subscriptions'&&r.data.status==='Active'&&r.data.nextDate<=through).sort((a,b)=>a.data.nextDate.localeCompare(b.data.nextDate)).map(r=>({id:r.id,...r.data}));
 return{currency,today,period,totalRevenue:(revenue[period]||0)/100,totalPending:settlement.receivable,totalOverdue:Math.round(overdueDocuments.reduce((s,r)=>s+r.balance,0)*100)/100,creditBalance:settlement.creditBalance,balanceIssues:settlement.issues,netBalance:settlement.closing,totalExpenses:(expenses[period]||0)/100,monthlyRevenue:months.map(month=>({month,amount:revenue[month]/100})),monthlyExpenses:months.map(month=>({month,amount:expenses[month]/100})),recentDocuments:documents.sort((a,b)=>b.updated_at.localeCompare(a.updated_at)).slice(0,5).map(r=>({id:r.id,type:r.data.type,number:r.data.number,buyer:r.data.buyer?.name,date:r.data.date,currency:r.data.currency,total:r.data.totals?.total||0,status:r.data.status,demo:r.demo})),overdueDocuments,upcomingSubscriptions:upcoming,excludedForeignInvoices:invoices.filter(r=>r.data.currency!==currency).length,draftCount:documents.filter(r=>r.data.status==='draft').length,definitions:{revenue:'Issued revenue before tax through today, adjusted by dated credit/debit notes.',pending:'Dated receivables through today, using the same settlement calculation as client statements. Credit balances are shown separately.',expenses:'Expenses through today in this business currency.'}};
}
