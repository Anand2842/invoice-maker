import{visibleInvoices,invoiceURL,statementURL,settlementLabels}from'../receivables/view.mjs';
export{visibleInvoices,invoiceURL,statementURL,settlementLabels};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function clientContext(value={}){
 const get=key=>value instanceof URLSearchParams?value.get(key):value[key];
 const business=get('business')||'',client=get('client')||'',date=get('date')||'',currency=get('currency')||'';
 if(!uuid.test(business)||!uuid.test(client))throw Error('Choose a client from your business client directory.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('Choose a valid balance date.');
 if(!/^[A-Z]{3}$/.test(currency))throw Error('Choose a three-letter currency code.');
 return{business,client,date,currency,demo:get('demo')===true||get('demo')==='true'};
}
export function clientWorkspaceURL(context){return'/clients/?'+new URLSearchParams(clientContext(context))}
export function clientStatementURL(context){return statementURL(context,context.client)}
export function clientRecordURL(context){return'/api/records?'+new URLSearchParams({business:context.business,collection:'clients',id:context.client,demo:String(context.demo)})}
export function clientReportURL(context){return'/api/reports/statement?'+new URLSearchParams({business:context.business,client:context.client,demo:String(context.demo),currency:context.currency,from:context.date,to:context.date})}
export function clientContact(record,context){
 if(!record||record.id!==context.client||record.business_id!==context.business||record.collection!=='clients'||record.archived||record.demo!==context.demo)throw Error('Client not found in this business and data mode. Return to the client directory.');
 const d=record.data||{};
 return{name:String(d.name||'Unnamed client'),fields:[['Email',d.email],['Phone',d.phone],['Address',d.address],['Tax ID',d.gstin]].map(([label,value])=>({label,value:String(value||'Not provided')}))};
}
export function clientSummary(report){return[
 {label:'Outstanding',amount:report.receivable,hint:'Issued balances still due'},
 {label:'Overdue',amount:report.aging.filter(r=>r.balance>0&&r.daysOverdue>0).reduce((sum,r)=>sum+Math.round(r.balance*100),0)/100,hint:'Due before '+report.to},
 {label:'Customer credits',amount:report.creditBalance,hint:'Kept separate from amounts due'},
 {label:'Net balance',amount:report.closing,hint:'Outstanding less customer credits'}
]}
