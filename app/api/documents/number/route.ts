import {readObject,identity,json,sb,uuid,originAllowed} from '../../../../lib/supabase';
// With a document type: the next number of that type's series. preview:true only shows it; the number is taken when
// the document is saved with numberAuto. Without a type (older clients): reserves the next invoice number.
export async function POST(req:Request){if(!originAllowed(req))return json({error:'Origin is not allowed'},403);const user=await identity(req);if(!user)return json({error:'Sign in first'},401);try{const body=await readObject(req);if(!uuid(body.business))return json({error:'Select a business'},400);
 const typed=typeof body.type==='string';if(typed&&(!/^[a-z-]{1,40}$/.test(body.type)||typeof body.demo!=='boolean'))return json({error:'Choose a document type and data mode'},400);
 const r=typed?await sb('/rest/v1/rpc/billing_document_number_for',user.access,{method:'POST',body:JSON.stringify({business:body.business,data_mode:body.demo,doc_type:body.type,consume:body.preview!==true})}):await sb('/rest/v1/rpc/billing_next_document_number',user.access,{method:'POST',body:JSON.stringify({business:body.business})});
 return r.ok?json({number:r.data,preview:typed&&body.preview===true}):json({error:'You cannot reserve a number for this business'},403)}catch{return json({error:'Invalid request'},400)}}
