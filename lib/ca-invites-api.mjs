// Accountants invite clients by link. The database functions do the real checks; this layer validates input,
// keeps the secret out of the stored data and out of URLs sent to the server (the link uses the # fragment).
const hex64=/^[a-f0-9]{64}$/;
function failure(r,json){
 const code=r.data?.code;
 if(code==='42501')return json({error:r.data?.message||'You cannot do that with this account'},403);
 if(code==='22023')return json({error:r.data?.message||'That request is not valid'},400);
 return json({error:'The request could not be completed. Try again.'},502);
}
export async function caInvitesGET(req,{identity,json,sb}){
 const user=await identity(req);if(!user)return json({error:'Sign in to see your client links'},401);
 try{const r=await sb('/rest/v1/rpc/billing_ca_invite_list',user.access,{method:'POST',body:'{}'});return r.ok?json({invites:r.data}):failure(r,json)}catch{return json({error:'Client links could not be loaded'},502)}
}
export async function caInvitesPOST(req,{identity,json,sb,uuid,originAllowed,readObject,randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}){
 if(!originAllowed(req))return json({error:'Origin is not allowed'},403);
 const user=await identity(req);if(!user)return json({error:'Sign in first'},401);
 let data;try{data=await readObject(req)}catch{return json({error:'Invalid request'},400)}
 let rpc,args,token;
 if(data.action==='create'){token=randomToken();rpc='billing_ca_invite_create';args={raw_token:token}}
 else if(data.action==='info'||data.action==='redeem'){
  if(typeof data.token!=='string'||!hex64.test(data.token))return json({error:'This link is not valid'},400);
  if(data.action==='info'){rpc='billing_ca_invite_info';args={raw_token:data.token}}
  else{if(!uuid(data.business))return json({error:'Choose a business'},400);rpc='billing_ca_invite_redeem';args={raw_token:data.token,business:data.business}}
 }else if(data.action==='revoke'){if(!uuid(data.invite))return json({error:'Choose a link'},400);rpc='billing_ca_invite_revoke';args={invite:data.invite}}
 else return json({error:'Unknown request'},400);
 try{
  const r=await sb('/rest/v1/rpc/'+rpc,user.access,{method:'POST',body:JSON.stringify(args)});
  if(!r.ok)return failure(r,json);
  if(token){const link=new URL('/start/',req.url);link.hash='ca='+token;return json({invite:r.data,link:link.href,message:'Send this link to your client. It works once and expires in 7 days. No email has been sent.'},201)}
  return json(data.action==='info'?r.data:data.action==='redeem'?{shared:true,...r.data}:{revoked:r.data===true});
 }catch{return json({error:'The result could not be confirmed. Refresh and check before trying again.'},502)}
}
