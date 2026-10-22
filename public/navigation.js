const catalog=await fetch('/service-catalog.json').then(r=>r.json());
const key=u=>u.hostname.replace(/^www\./,'')+u.pathname.replace(/\/$/,'');
const routes=new Map(catalog.map(s=>[key(new URL(s.source)),s.document?'/free-online-invoice-generator/?'+new URLSearchParams({document:s.document,...(s.id==='consulting-invoice'?{template:'consulting'}:{})}):'/services/?service='+s.id]));
export function normalize(root=document){
 const links=[...(root.matches?.('a[href]')?[root]:[]),...root.querySelectorAll('a[href]')];
 for(const a of links){let u;try{u=new URL(a.getAttribute('href'),location.href)}catch{continue}
  const target=routes.get(key(u));if(target){a.href=target;a.removeAttribute('target');a.removeAttribute('rel');continue}
  if(['refrens.com','www.refrens.com'].includes(u.hostname)){
   if(u.pathname==='/'&&!u.search)a.href='/'+u.hash;
   else if(['/login','/register','/signup'].includes(u.pathname))a.href='/services/?service=invoicing';
   else{a.dataset.referenceLink='true';a.title='Reference website — opens externally';a.target='_blank';a.rel='noopener noreferrer';}
  }
 }
}
window.RefrensNavigation={normalize,catalog,routes};normalize();
let pending=false;new MutationObserver(()=>{if(!pending){pending=true;queueMicrotask(()=>{pending=false;normalize()})}}).observe(document.documentElement,{childList:true,subtree:true});
