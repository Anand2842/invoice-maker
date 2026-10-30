import{statementPrintHTML}from'../../../../lib/print-document.mjs';
import{printResponse}from'../../../../lib/print-response.mjs';
import{identity,json,sb,uuid}from'../../../../lib/supabase';
import{clientStatement,statementCSV}from'../../../../lib/statements.mjs';
import{statementPDF}from'../../../../lib/statement-pdf.mjs';
export async function GET(req:Request){
 const user=await identity(req);if(!user)return json({error:'Sign in to view statements'},401);
 const p=new URL(req.url).searchParams,b=p.get('business'),client=p.get('client')||'',from=p.get('from')||'',to=p.get('to')||'',format=p.get('format')||'json';
 if(!uuid(b)||(client&&!uuid(client))||!['json','csv','pdf','print'].includes(format))return json({error:'Select a valid business, client and export format'},400);
 const response=await sb('/rest/v1/billing_businesses?'+new URLSearchParams({id:'eq.'+b,select:'id,name,currency'}),user.access);const business=response.data?.[0];if(!business)return json({error:'Business not found'},404);
 try{
  const options={from,to,client,currency:p.get('currency')||business.currency};clientStatement([],business,options);
  const records:any[]=[];for(let offset=0;offset<=10000;offset+=500){const r=await sb('/rest/v1/billing_records?'+new URLSearchParams({business_id:'eq.'+b,collection:'in.(documents,payments,clients)',demo:'eq.'+(p.get('demo')==='true'),archived:'eq.false',select:'id,collection,data,archived',order:'id.asc',limit:'500',offset:String(offset)}),user.access);if(!r.ok)throw Error('Unable to load statement records');records.push(...r.data);if(records.length>10000)throw Error('Report exceeds 10,000 records. No partial balances are shown.');if(r.data.length<500)break}
  if(client&&!records.some(r=>r.id===client&&r.collection==='clients'))return json({error:'Client not found in the selected business and data mode'},404);
  const report={...clientStatement(records,business,options),demo:p.get('demo')==='true'};
  if(format==='json')return json(report);
  if(format==='print')return printResponse(statementPrintHTML(report));
  const content=format==='csv'?statementCSV(report):await statementPDF(report);
  return new Response(typeof content==='string'?content:new Uint8Array(content).buffer,{headers:{'Content-Type':format==='csv'?'text/csv; charset=utf-8':'application/pdf','Content-Disposition':`attachment; filename="client-statement-${from}-${to}.${format}"`,'Cache-Control':'no-store'}});
 }catch(e){return json({error:e instanceof Error?e.message:'Unable to generate statement'},400)}
}
