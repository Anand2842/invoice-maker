import{sampleMode}from'/workspace-shell.js';
import{loginURL}from'/auth-links.js';
const q=s=>document.querySelector(s),sample=sampleMode();
const ROLE={owner:'Owner',admin:'Admin',editor:'Editor',viewer:'Viewer'};
let data=null;
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
const money=(n,currency)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:currency||'INR'}).format(Number(n)||0);
const status=(text,error=false)=>{const s=q('#status');s.textContent=text;s.className=error?'error':'';s.hidden=!text};
function link(text,href){const a=el('a',text);a.href=href;return a}
const scoped=(path,id)=>path+'?business='+encodeURIComponent(id)+(sample?'&demo=true':'');

function totals(){
 const box=q('#totals');box.replaceChildren();
 for(const t of data.totals){
  const card=el('div','', 'total');
  card.append(el('span',data.totals.length>1?'Still to collect ('+t.currency+')':'Still to collect','label'),el('strong',money(t.stillToCollect,t.currency)));
  const od=el('div','','total');od.append(el('span',data.totals.length>1?'Overdue ('+t.currency+')':'Overdue','label'),el('strong',money(t.overdueAmount,t.currency)),el('small',t.businessesWithOverdue+(t.businessesWithOverdue===1?' business has':' businesses have')+' overdue invoices'));
  box.append(card,od);
 }
}

function visible(){
 const term=q('#search').value.trim().toLowerCase(),only=q('#only-overdue').checked,sort=q('#sort').value;
 const rows=data.businesses.filter(b=>(!term||b.name.toLowerCase().includes(term))&&(!only||b.overdueCount>0));
 // Amounts in different currencies are never compared with each other: overdue sorts by number of invoices first.
 const num=(b,k)=>b.error?-1:b[k],cur=(a,b)=>(a.currency||'').localeCompare(b.currency||'');
 rows.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='collect'?cur(a,b)||num(b,'stillToCollect')-num(a,'stillToCollect')||a.name.localeCompare(b.name):num(b,'overdueCount')-num(a,'overdueCount')||cur(a,b)||num(b,'overdueAmount')-num(a,'overdueAmount')||a.name.localeCompare(b.name));
 return rows;
}

function card(b){
 const c=el('article','','biz');
 const head=el('div','','biz-head');head.append(el('h2',b.name),el('span',ROLE[b.role]||b.role,'role'));c.append(head);
 if(b.error){c.append(el('p',b.error,'error'));}
 else{
  const facts=el('dl','','facts');
  const add=(label,value,cls)=>{const d=el('div');d.append(el('dt',label),el('dd',value,cls));facts.append(d)};
  add('Still to collect',money(b.stillToCollect,b.currency));
  add('Overdue',b.overdueCount>0?money(b.overdueAmount,b.currency)+' · '+b.overdueCount+(b.overdueCount===1?' invoice':' invoices'):'None','overdue-'+(b.overdueCount>0?'yes':'no'));
  add('Issued this month',money(b.issuedThisMonth,b.currency));
  add('Drafts',String(b.drafts));
  c.append(facts);
  if(b.needsReview)c.append(el('p','Some balances need a look. Open the business to review them.','note'));
 }
 const actions=el('div','','actions');
 const open=link('Open','/dashboard/'+(sample?'?demo=true':''));open.className='open';
 open.addEventListener('click',()=>{try{localStorage.setItem('billing-active-business',b.id)}catch{}});
 actions.append(open,link('Money to collect',scoped('/receivables/',b.id)),link('GST returns',scoped('/reports/gst/',b.id)));
 c.append(actions);
 return c;
}

function render(){
 const rows=visible(),list=q('#list');list.replaceChildren();
 if(!rows.length)list.append(el('p',data.businesses.length?'No business matches.':'You have no businesses yet.','muted'));
 for(const b of rows)list.append(card(b));
 const more=q('#more');more.hidden=!data.truncated;if(data.truncated)more.textContent='Showing the first '+data.limit+' businesses.';
}

async function load(){
 try{
  const r=await fetch('/api/overview'+(sample?'?demo=true':''));
  if(r.status===401){status('');const s=q('#status');s.hidden=false;s.textContent='Sign in to see your businesses. ';s.append(link('Sign in',loginURL('/businesses/')));return}
  if(!r.ok)throw Error((await r.json().catch(()=>({}))).error||'Could not load your businesses.');
  data=await r.json();
 }catch(e){status(e.message,true);return}
 status(sample?'Showing sample data. Real records are not included.':'');
 q('#overview').hidden=false;
 if(data.businesses.length===1)q('.lede').textContent='You have one business. This page is most useful once you work with several, for example as an accountant for your clients.';
 totals();render();
}
for(const id of['#search','#sort','#only-overdue'])q(id).addEventListener('input',()=>data&&render());

// Client links: the accountant makes a link, sends it themselves (nothing is emailed), and sees which have been used.
const when=d=>new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date(d));
async function inviteApi(body){const r=await fetch('/api/ca-invites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'That did not work. Try again.');return d}
async function loadInvites(){
 const list=q('#invites');
 try{
  const r=await fetch('/api/ca-invites');if(!r.ok)return;const{invites}=await r.json();list.replaceChildren();
  for(const i of invites){
   const li=el('li'),expired=!i.usedAt&&!i.revokedAt&&new Date(i.expiresAt)<=new Date();
   const label=i.usedAt?'Used'+(i.business?' · '+i.business:'')+' · '+when(i.usedAt):i.revokedAt?'Revoked':expired?'Expired '+when(i.expiresAt):'Open · expires '+when(i.expiresAt);
   li.append(el('span','Link made '+when(i.createdAt)+' · '+label));
   if(!i.usedAt&&!i.revokedAt&&!expired){const b=el('button','Revoke');b.type='button';b.addEventListener('click',async()=>{b.disabled=true;try{await inviteApi({action:'revoke',invite:i.id});await loadInvites()}catch(e){q('#link-note').textContent=e.message;b.disabled=false}});li.append(b)}
   list.append(li);
  }
 }catch{}
}
q('#make-link').addEventListener('click',async()=>{
 const btn=q('#make-link');btn.disabled=true;q('#link-note').textContent='';
 try{const d=await inviteApi({action:'create'});q('#link-url').value=d.link;q('#link-box').hidden=false;q('#link-note').textContent=d.message;await loadInvites()}
 catch(e){q('#link-note').textContent=e.message}finally{btn.disabled=false}
});
q('#copy-link').addEventListener('click',async()=>{const input=q('#link-url');try{await navigator.clipboard.writeText(input.value);q('#link-note').textContent='Copied. Send it to your client.'}catch{input.select();q('#link-note').textContent='Press Ctrl+C or Cmd+C to copy.'}});
load().then(()=>{if(data){q('#invite').hidden=false;loadInvites()}});
