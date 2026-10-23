// Only the publishable key is needed at runtime. User JWTs keep RLS active.
export const SUPABASE_URL='https://digewoxoqblxlfnekjmc.supabase.co';
export const SUPABASE_KEY='sb_publishable_LpqjFoIBeIsyExLv9mF2zQ_60GTF8tr';
export const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export function originAllowed(req:Request){const origin=req.headers.get('origin');return !origin||origin===new URL(req.url).origin;}
export function token(req:Request){const cookie=req.headers.get('cookie')||'';return cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('billing_access='))?.slice(15)||'';}
export function refreshToken(req:Request){return(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('billing_refresh='))?.slice(16)||'';}
export async function sb(path:string,access:string,init:RequestInit={}){
 const headers=new Headers(init.headers);headers.set('apikey',SUPABASE_KEY);if(access)headers.set('Authorization','Bearer '+access);if(init.body&&typeof init.body==='string')headers.set('Content-Type','application/json');
 let response;try{response=await fetch(SUPABASE_URL+path,{...init,headers,signal:init.signal||AbortSignal.timeout(25000)});}catch{return{ok:false,status:503,data:{message:'The data service did not respond. Please try again.'}}}const raw=await response.text();let data;try{data=raw?JSON.parse(raw):null}catch{data=null}
 return {ok:response.ok,status:response.status,data};
}
export async function identity(req:Request){const access=token(req);if(!access)return null;const r=await sb('/auth/v1/user',access);return r.ok&&r.data?.id?{id:r.data.id,email:r.data.email,access}:null;}
export function sessionResponse(req:Request,data:any){const out=json({user:{id:data.user?.id,email:data.user?.email},authenticated:true});const secure=new URL(req.url).protocol==='https:'?'; Secure':'';
 out.headers.append('Set-Cookie',`billing_access=${data.access_token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.min(data.expires_in||3600,86400)}${secure}`);
 out.headers.append('Set-Cookie',`billing_refresh=${data.refresh_token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure}`);return out;}
export const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function readObject(req:Request):Promise<Record<string,any>>{const value:unknown=await req.json();if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected a JSON object');return value as Record<string,any>;}
