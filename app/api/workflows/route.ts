import {readObject,identity,json,sb,uuid,originAllowed} from '../../../lib/supabase';
import {workflowDocument} from '../../../lib/workflows.mjs';
export async function POST(req:Request){
 if(!originAllowed(req))return json({error:'Origin is not allowed'},403);
 const user=await identity(req);if(!user)return json({error:'Sign in first'},401);
 try{
  const body=await readObject(req);if(!uuid(body.id)||!uuid(body.business)||!Number.isInteger(body.version))return json({error:'Select a valid record'},400);
  const source=await sb('/rest/v1/billing_records?'+new URLSearchParams({id:'eq.'+body.id,business_id:'eq.'+body.business,select:'*'}),user.access);
  const business=await sb('/rest/v1/billing_businesses?'+new URLSearchParams({id:'eq.'+body.business,select:'*'}),user.access);
  if(!source.data?.[0]||!business.data?.[0])return json({error:'Record not found or access denied'},404);
  const {document,nextDate}=workflowDocument(source.data[0],business.data[0],body.action);
  const r=await sb('/rest/v1/rpc/billing_generate_document',user.access,{method:'POST',body:JSON.stringify({source_id:body.id,source_version:body.version,document_data:document,next_date:nextDate})});
  if(!r.ok)return json({error:r.data?.code==='23505'?'A document was already generated for this record or period. Open it from Invoicing.':'The record changed or you cannot edit it. Reload and try again.'},409);
  return json({record:r.data},201);
 }catch(e){return json({error:e instanceof Error?e.message:'Unable to generate document'},400)}
}
