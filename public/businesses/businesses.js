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
load();
