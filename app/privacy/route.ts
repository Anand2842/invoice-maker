import html from '../../public/privacy/index.html?raw';
export function GET(){return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})}
