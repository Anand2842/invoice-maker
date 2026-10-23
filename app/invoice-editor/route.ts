import {identity} from '../../lib/supabase';
import html from '../../public/free-online-invoice-generator/index.html?raw';
export async function GET(req:Request) {
  if (!await identity(req)) return Response.redirect(new URL('/services/?'+new URLSearchParams({service:'invoicing',returnTo:new URL(req.url).pathname+new URL(req.url).search}),req.url),302);
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store'}});
}
