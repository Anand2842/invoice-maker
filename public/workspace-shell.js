import {loginURL} from '/auth-links.js';

// Grouped like the work a small business does, in plain words. Pages not listed (developer and test tools) stay reachable by URL.
export const navGroups=[
 ['',[['Dashboard','/dashboard/'],['Getting started','/start/']]],
 ['Sales',[['Invoices & documents','/services/?service=invoicing'],['Quotations','/services/?service=quotation-software'],['Sales orders','/orders/'],['Clients','/services/?service=clients'],['Leads','/crm/'],['Money to collect','/receivables/'],['Client statements','/reports/statements/']]],
 ['Purchases',[['Vendors','/services/?service=vendors'],['Bills to pay','/payables/'],['Expenses','/services/?service=expenses'],['Vendor statements','/reports/vendor-statement/']]],
 ['Money',[['Bank matching','/banking/'],['Advances & unapplied cash','/cash/'],['Credits & refunds','/credits/'],['Cash statements','/reports/cash-statement/'],['Reminders & payment links','/automation/']]],
 ['Stock',[['Items','/services/?service=inventory'],['Stock & valuation','/inventory/']]],
 ['Accounting',[['Books','/accounting/'],['General ledger','/accounting/general-ledger/'],['Automatic postings','/accounting/source-postings/'],['Month-end check','/accounting/review/']]],
 ['GST & tax',[['GST returns','/reports/gst/'],['Match purchases (GSTR-2B)','/reports/gstr2b/'],['e-Invoice & e-Way Bill','/compliance/'],['TDS','/tds/']]],
 ['Business',[['Settings','/settings/'],['Team','/team/'],['Import data','/import/'],['Activity log','/audit/']]]];
export const navItems=navGroups.flatMap(([,items])=>items);

const slash=p=>p.endsWith('/')?p:p+'/';
function isCurrent(href){const u=new URL(href,location.origin),here=slash(location.pathname);if(u.search){const want=new URLSearchParams(u.search).get('service');return here===u.pathname&&new URLSearchParams(location.search).get('service')===want}return here===u.pathname}

// Sample-data mode: one switch for every page. The URL is the source of truth while browsing; the session flag carries it between pages.
export function sampleMode(){const p=new URLSearchParams(location.search);if(p.has('demo')){const on=p.get('demo')==='true';try{sessionStorage.setItem('billing-demo-mode',String(on))}catch{}return on}try{return sessionStorage.getItem('billing-demo-mode')==='true'}catch{return false}}
export function setSampleMode(on){try{sessionStorage.setItem('billing-demo-mode',String(on))}catch{}const u=new URL(location.href);u.searchParams.set('demo',String(on));location.assign(u)}
function syncSampleParam(){const p=new URLSearchParams(location.search);if(!p.has('demo')&&sampleMode()){const u=new URL(location.href);u.searchParams.set('demo','true');history.replaceState(history.state,'',u)}}

function ensureStyles(){if(document.querySelector('link[data-shell-css]'))return;const l=document.createElement('link');l.rel='stylesheet';l.href='/workspace-shell.css';l.dataset.shellCss='true';document.head.append(l)}

export function brandHeader(){const header=document.querySelector('body>header');if(!header)return;header.classList.add('folio-header');const brand=header.querySelector('.brand');if(brand){brand.innerHTML='inbill.<small>Billing workspace</small>';brand.href='/';brand.setAttribute('aria-label','inbill home')}const links=[...header.querySelectorAll('a[data-account-link],a[href*="returnTo="]')];links.forEach(a=>a.href=loginURL());
 // Signed-in visitors should not be offered "Log in".
 if(links.length)fetch('/api/auth').then(r=>r.ok?r.json():null).then(d=>{if(d?.user)links.forEach(a=>{a.textContent='Workspace';a.href='/services/'})}).catch(()=>{})}

export function addWorkspaceNav(){
 if(document.querySelector('[data-workspace-nav]'))return;ensureStyles();
 const aside=document.createElement('aside');aside.dataset.workspaceNav='true';aside.className='folio-sidebar';aside.id='folio-sidebar';aside.setAttribute('aria-label','Workspace');
 let open={};try{open=JSON.parse(localStorage.getItem('folio-nav-open')||'{}')}catch{}
 const top=document.createElement('div');top.className='folio-sidebar-top';top.innerHTML='<a class="folio-sidebar-brand" href="/dashboard/">inbill.</a><a class="folio-sidebar-new" href="/free-online-invoice-generator/?document=invoice&fresh=true">+ New invoice</a>';aside.append(top);
 const nav=document.createElement('nav');nav.setAttribute('aria-label','Workspace sections');
 for(const[group,items]of navGroups){const current=items.some(([,h])=>isCurrent(h));
  const list=document.createElement('div');list.className='folio-sidebar-links';
  for(const[label,href]of items){const a=document.createElement('a');a.href=href;a.textContent=label;if(isCurrent(href))a.setAttribute('aria-current','page');list.append(a)}
  if(!group){nav.append(list);continue}
  const d=document.createElement('details');d.open=current||open[group]!==false;const s=document.createElement('summary');s.textContent=group;d.append(s,list);
  d.addEventListener('toggle',()=>{if(current)return;open[group]=d.open;try{localStorage.setItem('folio-nav-open',JSON.stringify(open))}catch{}});nav.append(d)}
 aside.append(nav);
 // Anyone who can open two or more businesses (an accountant) gets a link to the all-businesses overview.
 fetch('/api/workspace').then(r=>r.ok?r.json():null).then(d=>{if((d?.businesses?.length||0)<2)return;const first=nav.querySelector('.folio-sidebar-links');if(!first||first.querySelector('[data-all-businesses]'))return;const a=document.createElement('a');a.href='/businesses/';a.textContent='All businesses';a.dataset.allBusinesses='true';if(isCurrent('/businesses/'))a.setAttribute('aria-current','page');first.prepend(a)}).catch(()=>{});
 const help=document.createElement('button');help.type='button';help.className='folio-sidebar-help';help.textContent='How this page works';help.addEventListener('click',()=>openGuide());aside.append(help);
 // Signed-in people get Sign out at the bottom of the menu, the same place on every page.
 fetch('/api/auth').then(r=>r.ok?r.json():null).then(d=>{if(!d?.user||aside.querySelector('[data-sign-out]'))return;const out=document.createElement('button');out.type='button';out.className='folio-sidebar-signout';out.dataset.signOut='true';out.textContent='Sign out';out.title=d.user.email||'';out.addEventListener('click',async()=>{out.disabled=true;try{await signOut(d.user.id)}finally{location.assign('/')}});aside.append(out)}).catch(()=>{});
 document.body.prepend(aside);document.documentElement.classList.add('folio-has-sidebar');
 // Phone and tablet: the sidebar becomes a drawer behind a Menu button in the page header.
 const header=document.querySelector('body>header')||document.querySelector('header');const menu=document.createElement('button');menu.type='button';menu.className='folio-menu-button';menu.textContent='Menu';menu.setAttribute('aria-controls','folio-sidebar');menu.setAttribute('aria-expanded','false');
 const scrim=document.createElement('div');scrim.className='folio-scrim';scrim.hidden=true;document.body.append(scrim);
 const toggle=on=>{document.documentElement.classList.toggle('folio-nav-open',on);menu.setAttribute('aria-expanded',String(on));scrim.hidden=!on};
 menu.addEventListener('click',()=>toggle(!document.documentElement.classList.contains('folio-nav-open')));scrim.addEventListener('click',()=>toggle(false));document.addEventListener('keydown',e=>{if(e.key==='Escape')toggle(false)});
 (header||aside).prepend(menu);
 addSampleBanner();addGuideButton();
}

function addSampleBanner(){if(!sampleMode()||document.querySelector('[data-sample-banner]'))return;const b=document.createElement('div');b.dataset.sampleBanner='true';b.className='folio-sample-banner';b.setAttribute('role','status');
 b.innerHTML='<span><strong>Sample data.</strong> You are exploring a demo copy of your business. Nothing here touches your real records.</span><button type="button">Back to my records</button>';b.querySelector('button').addEventListener('click',()=>setSampleMode(false));
 const header=document.querySelector('body>header')||document.querySelector('header');(header||document.body.firstElementChild).after(b)}

function addGuideButton(){if(document.querySelector('[data-guide-button]'))return;const b=document.createElement('button');b.type='button';b.dataset.guideButton='true';b.className='folio-guide-button';b.innerHTML='<span aria-hidden="true">?</span> Help &amp; demo';b.addEventListener('click',()=>openGuide());document.body.append(b)}

// Payment method fields stay free text, but offer the usual choices as a dropdown list.
function paymentMethodSuggestions(){const attach=e=>{const input=e.target;if(!(input instanceof HTMLInputElement)||input.name!=='method'||input.getAttribute('list'))return;
 if(!document.getElementById('folio-payment-methods')){const list=document.createElement('datalist');list.id='folio-payment-methods';for(const m of ['UPI','Bank transfer (NEFT/RTGS/IMPS)','Cash','Cheque','Debit or credit card','Payment link / gateway','Other'])list.append(new Option(m));document.body.append(list)}
 input.setAttribute('list','folio-payment-methods');input.autocomplete='off'};document.addEventListener('focusin',attach);document.addEventListener('pointerdown',attach)}

export async function openGuide(){const{showGuide}=await import('/guides.js');showGuide()}

export async function api(path,options={},retried=false){const r=await fetch(path,{...options,headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...options.headers}});const data=await r.json();if(!r.ok){if(r.status===401&&!retried&&path!=='/api/auth'){const refresh=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'refresh'})});if(refresh.ok)return api(path,options,true)}throw Object.assign(Error(data.error||'Request failed'),{status:r.status})}return data}
// Signs the user out and clears what belongs to their account on this device (the same steps the Tools page used to run).
export async function signOut(userId){
 const{clearAccountDrafts,announceAuthChange}=await import('/drafts.js');
 await api('/api/auth',{method:'POST',body:JSON.stringify({action:'logout'})});
 if(userId){announceAuthChange(userId,'logout');await clearAccountDrafts(userId)}
 try{sessionStorage.removeItem('folio-guest-drafts');localStorage.removeItem('billing-active-business');
  // Unsent drafts of the new editor belong to the account that wrote them.
  if(userId)for(const k of Object.keys(localStorage))if(k.startsWith('inbill-editor-v2:'+userId+':'))localStorage.removeItem(k)}catch{}
}
export function selectedBusiness(businesses){const explicit=new URLSearchParams(location.search).get('business'),selected=explicit||localStorage.getItem('billing-active-business'),b=businesses.find(b=>b.id===selected)||(!explicit?businesses[0]:null);if(explicit&&!b)throw Error('This business is unavailable to your account.');if(b)localStorage.setItem('billing-active-business',b.id);return b}
syncSampleParam();brandHeader();addWorkspaceNav();paymentMethodSuggestions();
