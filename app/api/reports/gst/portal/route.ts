import {identity,json,sb,uuid} from '../../../../../lib/supabase';
import {buildGstr1,buildGstr3b} from '../../../../../lib/gst-portal.mjs';

export async function GET(req:Request){
 const user=await identity(req);if(!user)return json({error:'Sign in to view GST returns'},401);
 const p=new URL(req.url).searchParams,b=p.get('business'),fp=p.get('fp')||'',type=p.get('type')||'gstr-1',demo=p.get('demo')==='true';
 if(!uuid(b)||!['gstr-1','gstr-3b'].includes(type)||!/^(0[1-9]|1[0-2])\d{4}$/.test(fp))return json({error:'Choose a business, return type and period (MMYYYY)'},400);
 try{
  const business=await sb('/rest/v1/billing_businesses?'+new URLSearchParams({id:'eq.'+b,select:'id,name,gstin,currency'}),user.access);
  if(!business.ok)throw Error('Unable to load business');if(!business.data?.[0])return json({error:'Business not found'},404);
  const records:any[]=[];
  for(const table of ['billing_records','billing_vendor_bills']){
   let complete=false;
   for(let offset=0;offset<=10000;offset+=500){
    const query:Record<string,string>={business_id:'eq.'+b,demo:'eq.'+demo,order:'id.asc',limit:'500',offset:String(offset)};
    if(table==='billing_records')Object.assign(query,{collection:'in.(documents,expenses)',archived:'eq.false',select:'id,collection,data,archived'});
    else Object.assign(query,{status:'eq.issued',select:'id,data,status'});
    const response=await sb('/rest/v1/'+table+'?'+new URLSearchParams(query),user.access);
    if(!response.ok||!Array.isArray(response.data))throw Error('Unable to load return records');
    records.push(...response.data.map((r:any)=>table==='billing_vendor_bills'?{...r,collection:'vendor_bills'}:r));
    if(records.length>10000)throw Error('Return exceeds 10,000 records. No partial totals are shown.');
    if(response.data.length<500){complete=true;break}
   }
   if(!complete)throw Error('Return exceeds the aggregation limit');
  }
  const result=(type==='gstr-1'?buildGstr1:buildGstr3b)(records,business.data[0],{fp,demo});
  return json({...result,businessName:business.data[0].name,demo});
 }catch(e){return json({error:e instanceof Error?e.message:'Unable to generate return'},400)}
}
