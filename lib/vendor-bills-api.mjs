function failure(result,json){
 const code=result.data?.code;
 if(code==='PGRST202')return json({error:'Vendor bills are not activated in this database yet. Existing expenses remain separate.'},503);
 if(code==='42501')return json({error:'You do not have permission for these vendor bills'},403);
 if(code==='40001')return json({error:result.data?.message||'This vendor bill changed. Reload before retrying.'},409);
 if(code==='P0001'||code?.startsWith('22'))return json({error:result.data?.message||'Review the vendor bill details'},400);
 return json({error:'Vendor bill result could not be confirmed. Reload the list before retrying the same command.'},502);
}
export async function vendorBillsGET(req,{identity,json,sb,uuid}){
 const user=await identity(req);if(!user)return json({error:'Sign in to view vendor bills'},401);
 const params=new URL(req.url).searchParams,business=params.get('business'),demo=params.get('demo')==='true',date=params.get('date');
 if(!uuid(business)||!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return json({error:'Choose a business and payables date'},400);
 try{const result=await sb('/rest/v1/rpc/billing_vendor_bills_read',user.access,{method:'POST',body:JSON.stringify({business,data_mode:demo,as_of:date})});return result.ok?json(result.data):failure(result,json)}catch{return json({error:'Vendor bills could not be loaded. Try again.'},502)}
}
export async function vendorBillsPOST(req,{identity,json,sb,uuid,originAllowed,readObject}){
 if(!originAllowed(req))return json({error:'Origin is not allowed'},403);
 const user=await identity(req);if(!user)return json({error:'Sign in to change vendor bills'},401);
 let data;try{data=await readObject(req)}catch{return json({error:'Invalid vendor bill command'},400)}
 if(!uuid(data.business)||!uuid(data.bill)||typeof data.demo!=='boolean'||!Number.isInteger(data.version)||data.version<0)return json({error:'Choose a business, data mode and versioned vendor bill'},400);
 let rpc,args={business:data.business,data_mode:data.demo,bill_id:data.bill,expected_version:data.version};
 if(data.action==='save'){
  if(!data.data||typeof data.data!=='object'||Array.isArray(data.data))return json({error:'Enter the vendor bill draft'},400);
  rpc='billing_vendor_bill_save';args.bill_data=data.data;
 }else if(data.action==='issue'){
  if(data.version<1||!uuid(data.command))return json({error:'A saved draft and stable issue command are required'},400);
  rpc='billing_vendor_bill_issue';args.command_id=data.command;
 }else return json({error:'Unknown vendor bill command'},400);
 try{const result=await sb('/rest/v1/rpc/'+rpc,user.access,{method:'POST',body:JSON.stringify(args)});return result.ok?json(result.data):failure(result,json)}catch{return json({error:'Vendor bill result could not be confirmed. Reload the list before retrying the same command.'},502)}
}
