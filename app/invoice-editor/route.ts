import {identity,refreshToken,sb,sessionResponse} from '../../lib/supabase';
import html from '../../public/invoice-editor-shell.html?raw';
export async function GET(req:Request){
 let user=await identity(req),session:Response|null=null;
 if(!user&&refreshToken(req)){const r=await sb('/auth/v1/token?grant_type=refresh_token','',{method:'POST',body:JSON.stringify({refresh_token:refreshToken(req)})});if(r.ok&&r.data?.user?.id){user={id:r.data.user.id,email:r.data.user.email,access:r.data.access_token};session=sessionResponse(req,r.data)}}
 if(!user)return Response.redirect(new URL('/services/?'+new URLSearchParams({account:'login',returnTo:new URL(req.url).pathname+new URL(req.url).search}),req.url),302);
 const response=new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store'}});if(session)for(const cookie of session.headers.getSetCookie())response.headers.append('Set-Cookie',cookie);return response;
}
