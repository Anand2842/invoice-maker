import{dateISO}from'../public/banking/model.mjs';
import{exactMinor}from'../public/reports/vendor-statement-model.mjs';
function scopedBill(b,business,demo,uuid){
 if(!b||!uuid(b.id)||b.business_id!==business||b.demo!==demo||!Number.isSafeInteger(b.version)||b.version<1||!['draft','issued'].includes(b.status)||!uuid(b.vendor_id)||!b.data||b.data.vendorId!==b.vendor_id||!Array.isArray(b.data.items)||!b.data.items.length||b.data.items.length>100||b.status==='issued'&&!uuid(b.issued_batch))throw Error('Incomplete vendor bill');
 const d=b.data;dateISO(d.date);dateISO(d.dueDate);if(d.dueDate<d.date||!uuid(d.accountId)||typeof d.currency!=='string'||!/^[A-Z]{3}$/.test(d.currency))throw Error('Invalid vendor bill details');
 let subtotal=0n;for(const item of d.items){const line=(exactMinor(item.quantity)*exactMinor(item.rate)+50n)/100n;if(exactMinor(item.amount)!==line)throw Error('Bill item did not reconcile');subtotal+=line}
 if(exactMinor(d.subtotal)!==subtotal||exactMinor(d.total)!==subtotal+exactMinor(d.taxAmount)||exactMinor(d.total)<=0n)throw Error('Bill totals did not reconcile');
 return b;
}
function scopedPayment(p,bill,business,demo,uuid){if(!p||!uuid(p.id)||p.business_id!==business||p.demo!==demo||p.bill_id!==bill||!uuid(p.batch_id)||exactMinor(p.amount)<=0n)throw Error('Incomplete vendor payment');dateISO(p.date);return p}

function failure(result,json){
 const code=result.data?.code;
 if(code==='P0002')return json({error:'Vendor bill unavailable in this business and data mode'},404);
 if(code==='PGRST202')return json({error:'Vendor bills are not activated in this database yet. Existing expenses remain separate.'},503);
 if(code==='42501')return json({error:'You do not have permission for these vendor bills'},403);
 if(code==='40001'||code==='23505')return json({error:result.data?.message||'This vendor bill changed. Reload before retrying.'},409);
 if(code==='P0001'||code?.startsWith('22'))return json({error:result.data?.message||'Review the vendor bill details'},400);
 return json({error:'Vendor bill result could not be confirmed. Retry the same saved command.'},502);
}
export async function vendorBillsGET(req,{identity,json,sb,uuid}){
 const user=await identity(req);if(!user)return json({error:'Sign in to view vendor bills'},401);
 const params=new URL(req.url).searchParams,business=params.get('business')?.toLowerCase(),demo=params.get('demo')||'false',bill=params.get('bill')?.toLowerCase();let date;
 try{if(!uuid(business)||!['true','false'].includes(demo)||bill&&!uuid(bill))throw Error('Choose a business and data mode');date=dateISO(params.get('date'))}catch(error){return json({error:error.message},400)}
 try{
  const result=await sb('/rest/v1/rpc/'+(bill?'billing_vendor_bill_detail':'billing_vendor_bills_read'),user.access,{method:'POST',body:JSON.stringify({business,data_mode:demo==='true',as_of:date,...(bill?{bill_id:bill}:{})})});
  if(!result.ok)return failure(result,json);
  if(typeof result.data?.configured!=='boolean'||!['bills','vendors','accounts'].every(k=>Array.isArray(result.data[k])))return json({error:'Payables results were incomplete. Reload before continuing.'},502);
  try{
   const r=result.data;if(r.asOf!==date||typeof r.canWrite!=='boolean'||exactMinor(r.overdue)>exactMinor(r.totalDue)||!Number.isSafeInteger(r.billCount)||r.billCount<0||new Set(r.bills.map(b=>b.id)).size!==r.bills.length||r.bills.length>(bill?1:500)||bill&&(r.bills.length!==1||r.bills[0].id!==bill))throw Error('Invalid report scope');
   for(const b of r.bills){scopedBill(b,business,demo==='true',uuid);if(b.data.currency!==r.currency)throw Error('Bill currency mismatch');if(exactMinor(b.balance)>exactMinor(b.data.total))throw Error('Invalid bill balance');for(const payment of b.payments||[])scopedPayment(payment,b.id,business,demo==='true',uuid)}
  }catch{return json({error:'Payables results were incomplete or did not reconcile. No partial balances are shown.'},502)}
  return json(result.data);
 }catch{return json({error:'Vendor bills could not be loaded. Try again.'},502)}
}
export async function vendorBillsPOST(req,{identity,json,sb,uuid,originAllowed,readObject}){
 if(!originAllowed(req))return json({error:'Origin is not allowed'},403);
 const user=await identity(req);if(!user)return json({error:'Sign in to change vendor bills'},401);
 let data;try{data=await readObject(req)}catch{return json({error:'Invalid vendor bill command'},400)}
 if(!data||!uuid(data.business)||!uuid(data.bill)||typeof data.demo!=='boolean'||!Number.isInteger(data.version)||data.version<0||!uuid(data.command))return json({error:'Choose a business, data mode, versioned bill and stable command key'},400);
 data={...data,business:data.business.toLowerCase(),bill:data.bill.toLowerCase(),command:data.command.toLowerCase(),...(typeof data.payment==='string'?{payment:data.payment.toLowerCase()}:{})};
 let rpc,args={business:data.business,data_mode:data.demo,bill_id:data.bill,expected_version:data.version,command_id:data.command};
 if(data.action==='save'){
  if(!data.data||typeof data.data!=='object'||Array.isArray(data.data))return json({error:'Enter the vendor bill draft'},400);
  rpc='billing_vendor_bill_save';args.bill_data=data.data;
 }else if(data.action==='issue'){
  if(data.version<1)return json({error:'Save the draft before issuing'},400);
  rpc='billing_vendor_bill_issue';
 }else if(data.action==='pay'){
  if(data.version<1||!data.data||typeof data.data!=='object'||Array.isArray(data.data))return json({error:'Choose an issued bill and enter the payment details'},400);
  rpc='billing_vendor_bill_pay';args.payment_data=data.data;
 }else if(data.action==='reverse-payment'){
  if(!uuid(data.payment)||typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>1000)return json({error:'Choose a vendor payment and enter a correction reason'},400);
  try{dateISO(data.date)}catch(error){return json({error:error.message},400)}
  rpc='billing_vendor_payment_reverse';args={business:data.business,data_mode:data.demo,bill_id:data.bill,payment_id:data.payment,command_id:data.command,reversal_date:data.date,reason:data.reason};
 }else return json({error:'Unknown vendor bill command'},400);
 try{
  const result=await sb('/rest/v1/rpc/'+rpc,user.access,{method:'POST',body:JSON.stringify(args)});
  if(!result.ok)return failure(result,json);
  if(!uuid(result.data?.[['pay','reverse-payment'].includes(data.action)?'payment':'bill']?.id)||typeof result.data?.replayed!=='boolean'||data.action!=='save'&&!uuid(result.data?.journal?.id))return json({error:'Vendor bill confirmation was incomplete. Retry the same saved command.'},502);
  try{
   const r=result.data;if(['save','issue'].includes(data.action)){const b=scopedBill(r.bill,data.business,data.demo,uuid);if(b.id!==data.bill||b.version!==data.version+1||data.action==='issue'&&b.issued_batch!==r.journal.id)throw Error('Wrong bill confirmation')}
   else{const p=scopedPayment(r.payment,data.bill,data.business,data.demo,uuid);if(data.action==='pay'?p.batch_id!==r.journal.id:p.id!==data.payment||r.journal.reverses_id!==p.batch_id)throw Error('Wrong payment confirmation')}
  }catch{return json({error:'Vendor bill confirmation did not match the saved command. Retry the same saved command.'},502)}
  return json(result.data);
 }catch{return json({error:'Vendor bill result could not be confirmed. Retry the same saved command.'},502)}
}
