import html from '../../../public/accounting/general-ledger.html?raw';
export function GET(){return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})}
