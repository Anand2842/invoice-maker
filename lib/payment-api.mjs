import{paymentReceiptPrintHTML}from'./print-document.mjs';
import{printResponse}from'./print-response.mjs';
import {paymentCommand,paymentError} from './payment-commands.mjs';
import {buildPaymentReceipt} from './payment-receipt.mjs';

export async function paymentPOST(req,{identity,json,sb,originAllowed,readObject}){
 if(!originAllowed(req))return json({error:'Origin is not allowed'},403);
 const user=await identity(req);if(!user)return json({error:'Sign in to record payments'},401);
 let command;
 try{command=paymentCommand(await readObject(req))}catch(error){return json({error:error.message||'Invalid payment command'},400)}
 try{
  const result=await sb('/rest/v1/rpc/'+command.rpc,user.access,{method:'POST',body:JSON.stringify(command.args)});
  if(!result.ok){const {status,...error}=paymentError(result);return json(error,status)}
  if(!result.data?.record?.id)return json({error:'Payment confirmation was incomplete. Retry with the same payment details.'},502);
  return json(result.data,result.data.replayed?200:201);
 }catch{return json({error:'Payment confirmation could not be checked. Retry with the same payment details.'},502)}
}

export async function paymentGET(req,{identity,json,sb,uuid}){
 const user=await identity(req);if(!user)return json({error:'Sign in to view payments'},401);
 const p=new URL(req.url).searchParams,business=p.get('business'),invoice=p.get('invoice'),payment=p.get('payment'),demo=p.get('demo')==='true';
 if(!uuid(business)||(!uuid(invoice)&&!uuid(payment))||(invoice&&!uuid(invoice))||(payment&&!uuid(payment)))return json({error:'Choose a valid invoice or receipt'},400);
 try{
  if(['pdf','print'].includes(p.get('format'))){
   if(!uuid(payment))return json({error:'Choose a recorded receipt'},400);
   const result=await sb('/rest/v1/billing_records?'+new URLSearchParams({business_id:'eq.'+business,id:'eq.'+payment,collection:'eq.payments',demo:'eq.'+demo,archived:'eq.false',select:'*'}),user.access);
   if(!result.ok)return json({error:'Unable to load this receipt'},502);
   const record=result.data?.[0];if(!record||record.data.kind!=='receipt')return json({error:'A numbered receipt is not available for this payment'},404);
   const reversals=await sb('/rest/v1/billing_records?'+new URLSearchParams({business_id:'eq.'+business,collection:'eq.payments',demo:'eq.'+demo,archived:'eq.false','data->>reversalOf':'eq.'+payment,'data->>kind':'eq.reversal',select:'data',limit:'2'}),user.access);
   if(!reversals.ok)return json({error:'Unable to verify receipt reversal status'},502);
   if(reversals.data.length>1)return json({error:'This receipt has conflicting reversals and needs review'},409);
   const reversal=reversals.data[0]?.data;
   if(p.get('format')==='print')return printResponse(paymentReceiptPrintHTML(reversal?{...record,data:{...record.data,reversal}}:record));
   const bytes=await buildPaymentReceipt(reversal?{...record,data:{...record.data,reversal}}:record);
   const filename=record.data.number.replace(/[^A-Za-z0-9_-]/g,'-').slice(0,80)||'receipt';
   return new Response(new Uint8Array(bytes).buffer,{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${filename}.pdf"`,'Cache-Control':'no-store'}});
  }
  if(!uuid(invoice))return json({error:'Choose an invoice'},400);
  const parent=await sb('/rest/v1/billing_records?'+new URLSearchParams({business_id:'eq.'+business,id:'eq.'+invoice,collection:'eq.documents',demo:'eq.'+demo,archived:'eq.false',select:'*'}),user.access);
  if(!parent.ok)return json({error:'Unable to load invoice payment history'},502);
  if(!parent.data?.[0])return json({error:'Invoice unavailable in this business and data mode'},404);
  const readiness=await sb('/rest/v1/rpc/billing_payment_readiness',user.access,{method:'POST',body:JSON.stringify({business})});
  if(!readiness.ok&&readiness.data?.code!=='PGRST202')return json({error:'Payment availability could not be checked. Try again.'},502);
  const ready=readiness.ok&&readiness.data?.apiVersion===1;
  const payments=await sb('/rest/v1/billing_records?'+new URLSearchParams({business_id:'eq.'+business,collection:'eq.payments',demo:'eq.'+demo,archived:'eq.false','data->>documentId':'eq.'+invoice,select:'*',order:'created_at.asc,id.asc',limit:'501'}),user.access);
  if(!payments.ok)return json({error:'Unable to load invoice payment history'},502);
  if(payments.data.length>500)return json({error:'This invoice has more than 500 payment events. No incomplete history is shown.'},422);
  return json({invoice:parent.data[0],payments:payments.data,available:ready,canWrite:ready&&readiness.data.canWrite===true});
 }catch(error){return json({error:error.message||'Unable to load payments'},400)}
}
