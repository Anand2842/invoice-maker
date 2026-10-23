import {sb,SUPABASE_URL,SUPABASE_KEY} from './supabase';
import {buildWithImages} from '../public/document-export.js';
export async function renderSavedDocument(access:string,business:string,id:string,template?:string|null){
 const source=await sb('/rest/v1/billing_records?'+new URLSearchParams({business_id:'eq.'+business,id:'eq.'+id,collection:'eq.documents',select:'*'}),access);
 if(!source.ok)throw Error('Unable to load document');
 if(!source.data?.[0])return null;
 const record=source.data[0],data={...record.data};
 const profile=await sb('/rest/v1/billing_businesses?'+new URLSearchParams({id:'eq.'+business,select:'*'}),access);
 if(!profile.ok||!profile.data?.[0])return null;
 const b=profile.data[0];data.brandColor||=b.brand_color;data.bank||={Bank:b.bank_name,Account:b.bank_account,IFSC:b.bank_ifsc,UPI:b.bank_upi};if(template)data.template=template;
 if(!data.logo&&b.logo_path){
  if(!b.logo_path.startsWith(business+'/')||b.logo_path.includes('..')||!/^[a-zA-Z0-9/._-]+$/.test(b.logo_path))throw Error('Invalid business logo path');
  const image=await fetch(SUPABASE_URL+'/storage/v1/object/authenticated/billing-files/'+b.logo_path,{headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+access},signal:AbortSignal.timeout(20000)});
  if(!image.ok)throw Error('Business logo could not be loaded. Re-upload it in Settings.');
  if(Number(image.headers.get('Content-Length'))>2097152)throw Error('Use a business logo smaller than 2 MB.');
  data.logoBytes=new Uint8Array(await image.arrayBuffer());
 }
 return {record,business:b,pdf:await buildWithImages(data)};
}
export function bytesToBase64(bytes:Uint8Array){let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary)}
