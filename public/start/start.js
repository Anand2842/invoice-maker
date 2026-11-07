import {api,selectedBusiness,setSampleMode} from '/workspace-shell.js';

const q=s=>document.querySelector(s);
const STATES={'01':'Jammu and Kashmir','02':'Himachal Pradesh','03':'Punjab','04':'Chandigarh','05':'Uttarakhand','06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh','10':'Bihar','11':'Sikkim','12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur','15':'Mizoram','16':'Tripura','17':'Meghalaya','18':'Assam','19':'West Bengal','20':'Jharkhand','21':'Odisha','22':'Chhattisgarh','23':'Madhya Pradesh','24':'Gujarat','26':'Dadra and Nagar Haveli and Daman and Diu','27':'Maharashtra','29':'Karnataka','30':'Goa','31':'Lakshadweep','32':'Kerala','33':'Tamil Nadu','34':'Puducherry','35':'Andaman and Nicobar Islands','36':'Telangana','37':'Andhra Pradesh','38':'Ladakh','97':'Other Territory'};
const status=(m,error=false)=>{const s=q('#start-status');s.textContent=m;s.className=error?'error':''};

function wireBusinessForm(onSaved){
 const f=q('#business-form');
 f.gstin.addEventListener('input',()=>{f.gstin.value=f.gstin.value.toUpperCase();const st=STATES[f.gstin.value.slice(0,2)];q('#gstin-state').textContent=f.gstin.value.length>=2?(st?'State: '+st:'The first two digits should be your state code.'):''});
 f.invoice_prefix.addEventListener('input',()=>q('#prefix-example').textContent=(f.invoice_prefix.value||'INV')+'-000001');
 f.addEventListener('submit',async e=>{e.preventDefault();const b=f.querySelector('button');b.disabled=true;status('Saving your business…');
  try{let ws=await api('/api/workspace'),business=ws.businesses[0];
   if(!business)business=(await api('/api/workspace',{method:'POST',body:JSON.stringify({name:f.name.value.trim(),currency:'INR',time_zone:'Asia/Kolkata'})})).business;
   ws=await api('/api/workspace');business=ws.businesses.find(x=>x.id===business.id);
   const profile={name:f.name.value.trim(),gstin:f.gstin.value.trim(),address:f.address.value.trim(),phone:f.phone.value.trim(),email:f.email.value.trim(),invoice_prefix:f.invoice_prefix.value.trim()||'INV',default_tax_rate:business.default_tax_rate||18};
   await api('/api/workspace',{method:'PATCH',body:JSON.stringify({business:business.id,version:business.profile_version,profile})});
   localStorage.setItem('billing-active-business',business.id);status('Saved. Next, add a client.');onSaved()}
  catch(error){status(error.message,true)}finally{b.disabled=false}});
}

async function count(business,collection,filter=()=>true){const r=await api('/api/records?'+new URLSearchParams({business,collection,demo:'false',limit:'200'}));return r.records.filter(filter).length}

async function checklist(business){
 const [clients,items,issued,payments]=await Promise.all([count(business.id,'clients'),count(business.id,'items'),count(business.id,'documents',r=>r.data.type==='invoice'&&r.data.lifecycle),count(business.id,'payments')]);
 const steps=[
  {done:Boolean(business.gstin||business.address),title:'Add your business details',hint:'Name, GSTIN, address and bank details print on every invoice.',href:'/settings/',cta:'Open settings'},
  {done:clients>0,title:'Add your first client',hint:'Save a client once and pick them on every invoice.',href:'/services/?service=clients',cta:'Add a client'},
  {done:items>0,title:'Add an item you sell',hint:'Price, HSN/SAC code and GST rate fill in automatically.',href:'/services/?service=inventory',cta:'Add an item'},
  {done:issued>0,title:'Create and issue your first invoice',hint:'Issue it when it is final; then it counts as money to collect.',href:'/free-online-invoice-generator/?document=invoice&fresh=true',cta:'Create invoice'},
  {done:payments>0,title:'Record a payment',hint:'When the client pays, record it against the invoice.',href:'/receivables/',cta:'Record payment'}];
 const done=steps.filter(s=>s.done).length;
 q('#progress-text').textContent=done===steps.length?'All done. Your billing is set up.':done+' of '+steps.length+' done';q('#progress-bar').style.width=(done/steps.length*100)+'%';
 q('#checklist').replaceChildren(...steps.map(s=>{const li=document.createElement('li');li.dataset.done=String(s.done);
  li.innerHTML='<span class="start-check" aria-hidden="true">'+(s.done?'✓':'')+'</span><div><strong></strong><span class="start-hint"></span></div><a></a>';
  li.querySelector('strong').textContent=s.title+(s.done?' (done)':'');li.querySelector('.start-hint').textContent=s.hint;const a=li.querySelector('a');a.href=s.href;a.textContent=s.done?'Open':s.cta;return li}));
}

q('#sample-button').addEventListener('click',async e=>{const b=e.currentTarget,s=q('#sample-status');b.disabled=true;
 try{const ws=await api('/api/workspace');if(!ws.businesses.length)throw Error('Save your business details first.');const business=selectedBusiness(ws.businesses);
  const{seedSampleBusiness}=await import('/demo-seed.js');await seedSampleBusiness(business.id,m=>s.textContent=m);
  sessionStorage.setItem('billing-demo-mode','true');location.assign('/dashboard/?demo=true')}
 catch(error){s.textContent='Sample data could not be prepared: '+error.message;b.disabled=false}});

(async()=>{try{
 const auth=await fetch('/api/auth').then(r=>r.ok?r.json():{});
 if(!auth.user){status('');q('#start-signin').hidden=false;return}
 // This page is about the user's own setup, so it always reads real records.
 if(new URLSearchParams(location.search).get('demo')==='true'){setSampleMode(false);return}
 const ws=await api('/api/workspace');
 wireBusinessForm(()=>location.reload());
 if(!ws.businesses.length){status('');q('#start-business').hidden=false;q('#start-title').textContent='Welcome to Folio';q('#start-lede').textContent='Start with your business details. It takes about a minute.';return}
 const business=selectedBusiness(ws.businesses);status('');q('#start-grid').hidden=false;
 await checklist(business);
}catch(error){status(error.message,true)}})();
