import {identity,json,sb,uuid,SUPABASE_URL,SUPABASE_KEY} from '../../../../lib/supabase';
import {buildWithImages} from '../../../../public/document-export.js';

export async function GET(req:Request) {
  const user = await identity(req);
  if (!user) return json({error:'Sign in to preview saved documents'},401);
  const p = new URL(req.url).searchParams, business = p.get('business'), id = p.get('id');
  if (!uuid(business) || !uuid(id)) return json({error:'Select a valid business and document'},400);
  const source = await sb('/rest/v1/billing_records?' + new URLSearchParams({business_id:'eq.'+business,id:'eq.'+id,collection:'eq.documents',select:'data'}),user.access);
  if (!source.ok) return json({error:'Unable to load document'},502);
  if (!source.data?.[0]) return json({error:'Document not found'},404);
  try {
    const data = {...source.data[0].data};
    const profile = await sb('/rest/v1/billing_businesses?' + new URLSearchParams({id:'eq.'+business,select:'*'}),user.access);
    if (!profile.ok || !profile.data?.[0]) return json({error:'Business not found'},404);
    const b = profile.data[0];
    data.brandColor ||= b.brand_color;
    data.bank ||= {Bank:b.bank_name,Account:b.bank_account,IFSC:b.bank_ifsc,UPI:b.bank_upi};
    if (p.has('template')) data.template = p.get('template');
    if (!data.logo && b.logo_path) {
      if (!b.logo_path.startsWith(business + '/') || b.logo_path.includes('..') || !/^[a-zA-Z0-9/._-]+$/.test(b.logo_path)) throw Error('Invalid business logo path');
      const image = await fetch(SUPABASE_URL+'/storage/v1/object/authenticated/billing-files/'+b.logo_path,{headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+user.access}});
      if (!image.ok) throw Error('Business logo could not be loaded. Re-upload it in settings.');
      if (Number(image.headers.get('Content-Length')) > 2097152) throw Error('Use a business logo smaller than 2 MB.');
      data.logoBytes = new Uint8Array(await image.arrayBuffer());
    }
    const pdf = await buildWithImages(data);
    return new Response(pdf.bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':`${p.get('download')==='true'?'attachment':'inline'}; filename="${pdf.filename}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  } catch(e) { return json({error:e instanceof Error?e.message:'Unable to render PDF'},422); }
}
