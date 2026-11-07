import {workflowDocument} from './workflows.mjs';
import {businessDate} from '../public/business-date.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,TOKEN=/^[0-9a-f]{64}$/;
const rpc=(sb,name,access,body)=>sb('/rest/v1/rpc/'+name,access,{method:'POST',body:JSON.stringify(body)});
function failure(r,json){const code=r.data?.code,status=code==='42501'?403:code==='P0002'?404:code==='28000'?401:code==='PGRST202'?503:['40001','23505'].includes(code)?409:code==='P0001'||code?.startsWith('22')?400:502;
 return json({error:status===503?'Automation and online payments have not been activated in this database.':status===502?'The data service did not confirm this request. Retry the same action.':r.data?.message||'Review this request.'},status)}
async function body(req,readObject){try{return await readObject(req)}catch{return null}}

export async function automationGET(req,{identity,json,sb}){
 const user=await identity(req);if(!user)return json({error:'Sign in first'},401);
 const p=new URL(req.url).searchParams,business=p.get('business')||'',demo=p.get('demo')||'false';
 if(!UUID.test(business)||!['true','false'].includes(demo))return json({error:'Choose a business and data mode'},400);
 const r=await rpc(sb,'billing_automation_read',user.access,{business,data_mode:demo==='true'});return r.ok?json(r.data):failure(r,json)}

export async function automationPOST(req,{identity,json,sb,originAllowed,readObject}){
 if(!originAllowed(req))return json({error:'Origin is not allowed'},403);
 const user=await identity(req);if(!user)return json({error:'Sign in first'},401);
 const b=await body(req,readObject);if(!b)return json({error:'Expected a JSON object'},400);
 if(!UUID.test(b.business||'')||!UUID.test(b.commandId||'')||typeof b.demo!=='boolean')return json({error:'Choose a business, data mode and retry key'},400);
 let r;
 if(b.action==='configure'){const s=b.settings||{};r=await rpc(sb,'billing_automation_configure',user.access,{business:b.business,command_id:b.commandId,settings:{recurringEnabled:s.recurringEnabled,remindersEnabled:s.remindersEnabled,reminderDays:s.reminderDays}})}
 else if(b.action==='gateway'){const g=b.gateway||{};r=await rpc(sb,'billing_gateway_configure',user.access,{business:b.business,data_mode:b.demo,command_id:b.commandId,gateway:{provider:g.provider,enabled:g.enabled,...(g.webhookSecret?{webhookSecret:g.webhookSecret}:{})}})}
 else if(b.action==='link'){if(!UUID.test(b.invoiceId||''))return json({error:'Choose an issued invoice'},400);r=await rpc(sb,'billing_payment_link_create',user.access,{business:b.business,data_mode:b.demo,command_id:b.commandId,invoice_id:b.invoiceId})}
 else return json({error:'Unknown automation action'},400);
 return r.ok?json(r.data,201):failure(r,json)}

// Public payment page: the token travels in the body (never the URL query) so it stays out of request logs.
export async function payPOST(req,{json,sb,originAllowed,readObject}){
 if(!originAllowed(req))return json({error:'Origin is not allowed'},403);
 const b=await body(req,readObject);if(!b||!TOKEN.test(b.token||'')||!['open','capture'].includes(b.action))return json({error:'Payment link unavailable'},404);
 const r=await rpc(sb,b.action==='open'?'billing_payment_link_open':'billing_gateway_mock_capture','',{token:b.token});return r.ok?json(r.data):failure(r,json)}

// Provider webhook: the raw body is verified in the database with the business HMAC secret before anything is trusted.
export async function webhookPOST(req,{json,sb}){
 const signature=req.headers.get('x-razorpay-signature')||'',raw=await req.text();
 if(raw.length>200000)return json({error:'Payload too large'},413);
 const r=await rpc(sb,'billing_gateway_webhook','',{body:raw,signature});
 if(r.ok)return json({ok:true,...r.data});
 const code=r.data?.code;return json({error:r.data?.message||'Webhook rejected'},code==='28000'?401:code==='P0002'?404:code==='PGRST202'?503:400)}

// Daily scheduler entry (Vercel Cron sends "Authorization: Bearer $CRON_SECRET").
export async function cronGET(req,{json,sb,send,env,now=()=>new Date()}){
 if(!env.CRON_SECRET||(req.headers.get('authorization')||'')!=='Bearer '+env.CRON_SECRET)return json({error:'Unauthorized'},401);
 const secret=env.FOLIO_AUTOMATION_SECRET||'';if(secret.length<32)return json({error:'FOLIO_AUTOMATION_SECRET is not configured'},503);
 const at=now(),summary={remindersQueued:0,generated:0,generationErrors:[],sent:0,retrying:0,failed:0};
 const due=await rpc(sb,'billing_automation_due','',{secret,at:at.toISOString()});if(!due.ok)return json({error:due.data?.message||'Automation tick failed'},502);
 summary.remindersQueued=due.data.remindersQueued;
 for(const {record,business} of due.data.subscriptions){
  let current=record;const today=businessDate(at,business.time_zone);
  // Catch up at most a year of missed periods per run; each period is its own idempotent command.
  for(let i=0;i<12&&current.data.nextDate<=today;i++){
   try{const {document,nextDate}=workflowDocument(current,business,'subscription-invoice',at);
    const r=await rpc(sb,'billing_automation_generate','',{secret,source_id:current.id,source_version:current.version,document_data:document,next_date:nextDate});
    if(!r.ok)throw Error(r.data?.message||'Generation failed');
    summary.generated++;current={...current,version:r.data.sourceVersion,data:{...current.data,nextDate}}}
   catch(e){const error=e instanceof Error?e.message:String(e);summary.generationErrors.push({subscription:current.id,error});
    // Back the subscription off so it cannot keep its place in every later batch; the owner sees it on the automation page.
    await rpc(sb,'billing_automation_failed','',{secret,source_id:current.id,error}).catch(()=>{});break}}}
 for(let round=0;round<4;round++){
  const claim=await rpc(sb,'billing_email_claim','',{secret,max_items:25});if(!claim.ok)return json({...summary,error:'Email claim failed'},502);
  if(!claim.data.length)break;
  const results=[];for(const m of claim.data){try{const out=await send({to:m.to,subject:m.subject,message:m.message},'outbox-'+m.id);results.push({id:m.id,attempt:m.attempt,ok:true,providerId:out.id})}catch(e){results.push({id:m.id,attempt:m.attempt,ok:false,error:e instanceof Error?e.message:'Delivery failed'})}}
  const done=await rpc(sb,'billing_email_complete','',{secret,results});
  if(!done.ok)return json({...summary,error:'Delivery results were not recorded; leased emails retry after 15 minutes'},502);
  summary.sent+=done.data.sent;summary.retrying+=done.data.retrying;summary.failed+=done.data.failed}
 return json(summary)}
