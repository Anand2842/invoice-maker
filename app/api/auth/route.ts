import{identity,json,sb,originAllowed,token,refreshToken,sessionResponse}from'../../../lib/supabase';
export async function GET(req:Request){const user=await identity(req);if(user)return json({user:{id:user.id,email:user.email}});if(refreshToken(req)){const r=await sb('/auth/v1/token?grant_type=refresh_token','',{method:'POST',body:JSON.stringify({refresh_token:refreshToken(req)})});if(r.ok)return sessionResponse(req,r.data)}return json({user:null});}
export async function POST(req:Request){
 if(!originAllowed(req))return json({error:'Origin is not allowed'},403);
 try{const body=await req.json();const action=body.action;
 if(action==='logout'){if(token(req))await sb('/auth/v1/logout',token(req),{method:'POST'});const r=json({signedOut:true});for(const name of ['billing_access','billing_refresh'])r.headers.append('Set-Cookie',name+'=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');return r;}
 if(action==='refresh'){const refresh=refreshToken(req);if(!refresh)return json({error:'Please sign in again'},401);const r=await sb('/auth/v1/token?grant_type=refresh_token','',{method:'POST',body:JSON.stringify({refresh_token:refresh})});return r.ok?sessionResponse(req,r.data):json({error:'Your session has expired. Sign in again.'},401);}
 if(!['login','signup','recover'].includes(action))return json({error:'Unsupported action'},400);
 const email=String(body.email||'').trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return json({error:'Enter a valid email address'},400);
 if(action!=='recover'&&(typeof body.password!=='string'||body.password.length<8||body.password.length>128))return json({error:'Use a password between 8 and 128 characters'},400);
 const paths={login:'/auth/v1/token?grant_type=password',signup:'/auth/v1/signup',recover:'/auth/v1/recover'};
 const r=await sb(paths[action as keyof typeof paths],'',{method:'POST',body:JSON.stringify({email,...(action==='recover'?{}:{password:body.password}),...(action==='signup'?{data:{name:String(body.name||'').slice(0,180)}}:{})})});
 if(!r.ok)return json({error:action==='login'?'Sign-in failed. Check your email/password or confirm your email.':String(r.data?.msg||r.data?.message||'The request could not be completed')},r.status>=500?502:400);
 if(r.data?.access_token)return sessionResponse(req,r.data);
 return json({message:action==='signup'?'Check your email to confirm your account, then sign in.':'If the account exists, a recovery email has been requested.'});
 }catch{return json({error:'The request could not be completed'},400)}
}
