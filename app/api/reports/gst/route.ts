import {identity,json,sb,uuid} from '../../../../lib/supabase';
import {gstReport,gstCSV} from '../../../../lib/gst-reports.mjs';
export async function GET(req:Request){
 const user=await identity(req);if(!user)return json({error:'Sign in to view GST reports'},401);
 const p=new URL(req.url).searchParams,b=p.get('business'),from=p.get('from')||'',to=p.get('to')||'',type=p.get('type')||'gstr-1',format=p.get('format')||'json';
 if(!uuid(b)||!['json','csv'].includes(format))return json({error:'Select a business and JSON or CSV export'},400);
 const business=await sb('/rest/v1/billing_businesses?'+new URLSearchParams({id:'eq.'+b,select:'id,name,gstin,currency'}),user.access);if(!business.data?.[0])return json({error:'Business not found'},404);
 try{
  gstReport([],business.data[0],{from,to,type});
  const records:any[]=[];let complete=false;
  for(let offset=0;offset<=10000;offset+=500){const r=await sb('/rest/v1/billing_records?'+new URLSearchParams({business_id:'eq.'+b,collection:'in.(documents,expenses)',demo:'eq.'+(p.get('demo')==='true'),archived:'eq.false',select:'id,collection,data,archived',order:'id.asc',limit:'500',offset:String(offset)}),user.access);if(!r.ok)throw Error('Unable to load report records');records.push(...r.data);if(records.length>10000)throw Error('Report exceeds 10,000 records. No partial totals are shown.');if(r.data.length<500){complete=true;break}}
  if(!complete)throw Error('Report exceeds the aggregation limit');
  const report=gstReport(records,business.data[0],{from,to,type});
  if(format==='csv')return new Response(gstCSV(report),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${type}-${from}-${to}-workpaper.csv"`,'Cache-Control':'no-store'}});
  return json({...report,businessName:business.data[0].name,demo:p.get('demo')==='true'});
 }catch(e){return json({error:e instanceof Error?e.message:'Unable to generate report'},400)}
}
