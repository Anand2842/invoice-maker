import{dateISO}from'../public/banking/model.mjs';
import{statementSequence,validateVendorStatement}from'../public/reports/vendor-statement-model.mjs';
import{vendorStatementCSV,vendorStatementPrint}from'./vendor-statement.mjs';
import{printResponse}from'./print-response.mjs';
export async function vendorStatementGET(req,{identity,json,sb,uuid}){
 const user=await identity(req);if(!user)return json({error:'Sign in to view vendor statements'},401);
 const p=new URL(req.url).searchParams,format=p.get('format')||'json';let args;
 try{
  const business=p.get('business')?.toLowerCase(),vendor=p.get('vendor')?.toLowerCase(),demo=p.get('demo')||'false';if(!uuid(business)||!uuid(vendor)||!['true','false'].includes(demo)||!['json','csv','print'].includes(format))throw Error('Choose a business, vendor, data mode and supported format');
  const from=dateISO(p.get('from')),to=dateISO(p.get('to'));if(from>to)throw Error('From must be on or before To');
  const size=p.has('limit')?Number(p.get('limit')):100;if(!Number.isInteger(size)||size<1||size>200)throw Error('Page size must be between 1 and 200');
  args={business,data_mode:demo==='true',vendor_id:vendor,from_date:from,to_date:to,after_date:null,after_sequence:null,page_size:size,snapshot_number:null};
  if(p.has('snapshot')){statementSequence(p.get('snapshot'));args.snapshot_number=p.get('snapshot')}
  const cursor=['afterDate','afterSequence'].filter(k=>p.has(k));if(cursor.length&&cursor.length!==2)throw Error('Provide the complete vendor statement cursor');
  if(cursor.length){if(args.snapshot_number===null)throw Error('Continue with the original statement snapshot');const day=dateISO(p.get('afterDate'));if(day<from||day>to)throw Error('Statement cursor is outside the selected period');statementSequence(p.get('afterSequence'));args.after_date=day;args.after_sequence=p.get('afterSequence')}
 }catch(error){return json({error:error.message},400)}
 try{
  const result=await sb('/rest/v1/rpc/billing_vendor_statement',user.access,{method:'POST',body:JSON.stringify(args)});
  if(!result.ok){const code=result.data?.code,status=code==='PGRST202'?503:code==='42501'?403:code==='P0001'||code?.startsWith('22')?400:502;return json({error:status===503?'Vendor statements are not activated in this database yet.':status===403?'This vendor statement is unavailable to your account.':status===400&&typeof result.data?.message==='string'&&result.data.message.length<1000?result.data.message:'The vendor statement could not be loaded. Try again.'},status)}
  let report;try{report=validateVendorStatement(result.data,args)}catch{return json({error:'Vendor statement results were incomplete or did not reconcile. No partial balances are shown.'},502)}
  if(format==='print')return printResponse(vendorStatementPrint(report));
  if(format==='csv')return new Response(vendorStatementCSV(report),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="vendor-statement-${args.from_date}-${args.to_date}-page.csv"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  return json(report);
 }catch{return json({error:'The vendor statement could not be generated. Try again.'},502)}
}
