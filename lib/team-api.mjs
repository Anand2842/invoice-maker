const roles=['admin','editor','viewer'];
function errorResponse(result,json){const denied=result.data?.code==='42501';return json({error:denied?'Only the business owner can manage this team':result.data?.code==='22023'?result.data.message:'Team request could not be completed. Refresh before retrying.'},denied?403:result.data?.code==='22023'?400:502)}
export async function teamGET(req,{identity,json,sb,uuid}){
 const user=await identity(req);if(!user)return json({error:'Sign in to manage your team'},401);
 const business=new URL(req.url).searchParams.get('business');if(!uuid(business))return json({error:'Choose a business'},400);
 try{const r=await sb('/rest/v1/rpc/billing_team_list',user.access,{method:'POST',body:JSON.stringify({business})});return r.ok?json(r.data):errorResponse(r,json)}catch{return json({error:'Team could not be loaded'},502)}
}
export async function teamPOST(req,{identity,json,sb,uuid,originAllowed,readObject,randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}){
 if(!originAllowed(req))return json({error:'Origin is not allowed'},403);
 const user=await identity(req);if(!user)return json({error:'Sign in to manage your team'},401);
 let data;try{data=await readObject(req)}catch{return json({error:'Invalid team command'},400)}
 let rpc,args,token;
 if(data.action==='accept'){
  if(typeof data.token!=='string'||!/^[a-f0-9]{64}$/.test(data.token))return json({error:'Invalid invitation link'},400);
  rpc='billing_team_accept';args={raw_token:data.token};
 }else{
  if(!uuid(data.business))return json({error:'Choose a business'},400);
  if(data.action==='invite'){
   if(typeof data.email!=='string'||data.email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())||!roles.includes(data.role))return json({error:'Enter an email and a valid role'},400);
   token=randomToken();rpc='billing_team_invite';args={business:data.business,invite_email:data.email.trim(),invite_role:data.role,raw_token:token};
  }else if(data.action==='role'||data.action==='remove'){
   if(!uuid(data.member)||data.action==='role'&&!roles.includes(data.role))return json({error:'Choose a member and valid role'},400);
   rpc='billing_team_change';args={business:data.business,member_id:data.member,member_role:data.action==='role'?data.role:null,remove_member:data.action==='remove'};
  }else if(data.action==='revoke'){
   if(!uuid(data.invitation))return json({error:'Choose an invitation'},400);
   rpc='billing_team_revoke';args={business:data.business,invitation_id:data.invitation};
  }else return json({error:'Unknown team command'},400);
 }
 try{const r=await sb('/rest/v1/rpc/'+rpc,user.access,{method:'POST',body:JSON.stringify(args)});if(!r.ok)return errorResponse(r,json);
  if(token){const link=new URL('/team/',req.url);link.hash='invite='+token;return json({invitation:r.data,link:link.href,delivery:'manual',message:'Copy this link and send it to the invited person. No email has been sent.'},201)}
  return json(data.action==='accept'?{business:r.data,accepted:true}:{updated:true});
 }catch{return json({error:'The result could not be confirmed. Refresh the team before retrying.'},502)}
}
