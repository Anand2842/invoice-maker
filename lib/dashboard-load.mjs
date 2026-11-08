// Loads one business's records and returns the same figures the dashboard shows. Shared by the dashboard and the
// all-businesses overview so both always agree. Reads only, through the signed-in user's own token.
import{businessDate}from'../public/business-date.js';
import{cashReportRecords}from'./cash-report-records.mjs';
import{dashboardSummary}from'./dashboard.mjs';
const SELECT='id,collection,demo,updated_at,type:data->>type,number:data->>number,date:data->>date,dueDate:data->>dueDate,currency:data->>currency,status:data->>status,totals:data->totals,lifecycle:data->lifecycle,accounting:data->accounting,buyer:data->buyer,seller:data->seller,items:data->items,taxType:data->>taxType,gstMode:data->>gstMode,discount:data->discount,roundOff:data->roundOff,shipping:data->shipping,clientId:data->>clientId,documentId:data->>documentId,originalDocumentId:data->>originalDocumentId,originalDocumentNumber:data->>originalDocumentNumber,originalDocumentDate:data->>originalDocumentDate,adjustmentReason:data->>adjustmentReason,amount:data->>amount,direction:data->>direction,kind:data->>kind,reversalOf:data->>reversalOf,reason:data->>reason,name:data->>name,nextDate:data->>nextDate';
export async function loadDashboard(sb,access,business,demo){
 const records=[];
 for(let offset=0;offset<10000;offset+=1000){
  const query=new URLSearchParams({business_id:'eq.'+business.id,collection:'in.(documents,expenses,payments,subscriptions)',archived:'eq.false',demo:'eq.'+demo,select:SELECT,order:'id.asc',offset:String(offset),limit:'1000'});
  const r=await sb('/rest/v1/billing_records?'+query,access);
  if(!r.ok)return{ok:false,status:502,error:'Unable to load dashboard records'};
  records.push(...r.data.map(({id,collection,demo,updated_at,...data})=>({id,collection,demo,updated_at,data:Object.fromEntries(Object.entries(data).filter(([,value])=>value!==null))})));
  if(r.data.length<1000){
   try{records.push(...await cashReportRecords(sb,access,business.id,demo))}catch(error){return{ok:false,status:503,error:error instanceof Error?error.message:'Cash allocation balances are unavailable'}}
   const today=businessDate(new Date(),business.time_zone);
   return{ok:true,summary:{...dashboardSummary(records,business.currency,today),business,demo}};
  }
 }
 return{ok:false,status:422,error:'This business exceeds the dashboard aggregation limit. No partial totals are shown.'};
}
