const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,AREAS=['records','ledger','bank','inventory','team'];
// GET /api/audit?business=&demo=&area=&at=&key= — one page of the business audit trail (newest first).
export async function auditGET(req,{json,sb,identity}){
 const user=await identity(req);if(!user)return json({error:'Sign in to view the audit trail'},401);
 const p=new URL(req.url).searchParams,business=p.get('business'),area=p.get('area')||null,at=p.get('at'),key=p.get('key');
 if(!UUID.test(business||''))return json({error:'Select a business'},400);
 if(area&&!AREAS.includes(area))return json({error:'Choose a valid audit area'},400);
 if(!!at!==!!key||(at&&!Number.isFinite(Date.parse(at)))||(key&&key.length>80))return json({error:'Invalid audit cursor'},400);
 const r=await sb('/rest/v1/rpc/billing_audit_trail',user.access,{method:'POST',body:JSON.stringify({business,data_mode:p.get('demo')==='true',area,cursor_at:at||null,cursor_key:key||null,page_size:50})});
 if(!r.ok)return json({error:r.data?.code==='42501'?'You do not have access to this business':'Unable to load the audit trail'},r.data?.code==='42501'?403:400);
 return json(r.data);
}
