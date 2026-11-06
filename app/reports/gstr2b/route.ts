import html from '../../../public/reports/gstr2b.html?raw';
export function GET(){return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})}
