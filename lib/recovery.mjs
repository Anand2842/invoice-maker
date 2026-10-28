const cookieName='folio_recovery';
const response=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const cookie=(req,value,age)=>`${cookieName}=${value}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${age}${new URL(req.url).protocol==='https:'?'; Secure':''}`;
function recoveryToken(req){return (req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||''}
export async function recoveryReady(req,sb){const access=recoveryToken(req);if(!access)return response({ready:false});const user=await sb('/auth/v1/user',access);return response({ready:!!(user.ok&&user.data?.id)})}
export async function recoveryAction(req,body,sb){
 if(body.action==='recovery-session'){
  let access='';
  if(body.type!=='recovery')return response({error:'Use a password recovery link from your email.'},400);
  if(typeof body.token_hash==='string'&&/^[a-zA-Z0-9_-]{32,256}$/.test(body.token_hash)){const r=await sb('/auth/v1/verify','',{method:'POST',body:JSON.stringify({token_hash:body.token_hash,type:'recovery'})});if(r.ok)access=r.data?.access_token||''}
  else if(typeof body.access_token==='string'&&body.access_token.length<8192&&/^[A-Za-z0-9._-]+$/.test(body.access_token))access=body.access_token;
  if(!access)return response({error:'This recovery link is invalid or expired. Request a new email.'},400);
  const user=await sb('/auth/v1/user',access);if(!user.ok||!user.data?.id)return response({error:'This recovery link is invalid or expired. Request a new email.'},401);
  const out=response({ready:true});out.headers.append('Set-Cookie',cookie(req,access,600));return out;
 }
 if(body.action==='reset-password'){
  const access=recoveryToken(req);if(!access)return response({error:'Your recovery session expired. Request a new email.'},401);
  if(typeof body.password!=='string'||body.password.length<8||body.password.length>128)return response({error:'Use a password between 8 and 128 characters.'},400);
  const user=await sb('/auth/v1/user',access);if(!user.ok||!user.data?.id)return response({error:'Your recovery session expired. Request a new email.'},401);
  const result=await sb('/auth/v1/user',access,{method:'PUT',body:JSON.stringify({password:body.password})});if(!result.ok)return response({error:'The password could not be updated. Use a different password or request a new recovery email.'},400);
  await sb('/auth/v1/logout',access,{method:'POST'});
  const out=response({updated:true,message:'Password updated. Sign in with your new password.'});out.headers.append('Set-Cookie',cookie(req,'',0));for(const name of ['billing_access','billing_refresh'])out.headers.append('Set-Cookie',`${name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);return out;
 }
 return response({error:'Unsupported recovery action'},400);
}
