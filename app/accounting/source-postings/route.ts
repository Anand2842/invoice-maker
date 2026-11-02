import html from '../../../public/accounting/source-postings.html?raw';
export function GET(){return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})}
