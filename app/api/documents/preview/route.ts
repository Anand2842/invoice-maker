import {identity,json,uuid} from '../../../../lib/supabase';
import {renderSavedDocument} from '../../../../lib/document-render';
export async function GET(req:Request){
 const user=await identity(req);if(!user)return json({error:'Sign in to preview saved documents'},401);
 const p=new URL(req.url).searchParams,business=p.get('business'),id=p.get('id');if(!uuid(business)||!uuid(id))return json({error:'Select a valid business and document'},400);
 try{const rendered=await renderSavedDocument(user.access,business,id,p.get('template'));if(!rendered)return json({error:'Document not found'},404);const {pdf}=rendered;return new Response(pdf.bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':`${p.get('download')==='true'?'attachment':'inline'}; filename="${pdf.filename}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}catch(e){return json({error:e instanceof Error?e.message:'Unable to render PDF'},422)}
}
