// inbill's invoice editor (version 2). State lives in one object (see model.mjs); the page is built from it by small
// component functions. It produces the same document the PDF engine and the save API already use.
import{api,selectedBusiness,sampleMode}from'/workspace-shell.js';
import{businessDate}from'/business-date.js';
import{DOC_TYPES,TEMPLATES,PAYMENT_TERMS,CURRENCIES,newDocument,newItem,toDocument,fromDocument,autoGst,setTerms,setDate,setDueDate,applyBusiness,problems}from'/editor/model.mjs';
import{GST_STATES,stateCodeOf}from'/editor/gst-states.mjs';

const params=new URLSearchParams(location.search),type=DOC_TYPES[params.get('document')]?params.get('document'):'invoice',sample=sampleMode();
const root=document.querySelector('#editor'),exportModule=import('/document-export.js');
const DRAFT_KEY='inbill-editor-v2:'+type;
let s,user=null,business=null,record=null,numberPreview='',loading=false,saving=false,hsn=null;
const bound=[]; // inputs kept in step with the state

// ---- tiny DOM helpers ----
const h=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(v===false||v==null)continue;if(k==='class')e.className=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(k==='text')e.textContent=v;else e.setAttribute(k,v===true?'':v)}for(const kid of kids.flat())if(kid!=null&&kid!==false)e.append(kid.nodeType?kid:document.createTextNode(kid));return e};
const get=(path)=>path.split('.').reduce((o,k)=>o?.[k],s);
const set=(path,value)=>{const keys=path.split('.'),last=keys.pop();keys.reduce((o,k)=>o[k],s)[last]=value};
const money=(minor,currency=s.currency)=>new Intl.NumberFormat(currency==='INR'?'en-IN':'en-US',{style:'currency',currency}).format(Number(minor)/100);
function say(text,error=false){const e=root.querySelector('#status');if(!e)return;e.textContent=text;e.className='status'+(error?' bad':'');e.setAttribute('role',error?'alert':'status')}

// ---- state changes ----
function touched(path){
 if(/\.gstin$|\.gstState$/.test(path)||path==='taxType')autoGst(s);
 syncInputs();paintTotals();paintGst();saveDraftSoon();
 const bad=root.querySelector('[aria-invalid=true]');if(bad&&!problems(s).some(p=>p.field===bad.dataset.path))bad.removeAttribute('aria-invalid');
}
function syncInputs(){for(const{el,path}of bound){if(document.activeElement===el)continue;const v=get(path)??'';if(el.type==='checkbox')el.checked=Boolean(v);else if(el.value!==String(v))el.value=v}}
let draftTimer;function saveDraftSoon(){clearTimeout(draftTimer);draftTimer=setTimeout(()=>{if(record||loading)return;try{localStorage.setItem(DRAFT_KEY,JSON.stringify({savedAt:Date.now(),state:s}))}catch{}},400)}

// ---- field components ----
function input(label,path,{kind='text',attrs={},wide=false,hint='',list=''}={}){
 const el=h('input',{type:kind,name:path,'data-path':path,autocomplete:'off',list,...attrs});el.value=get(path)??'';
 el.addEventListener('input',()=>{set(path,el.value);if(path==='dueDate')setDueDate(s,el.value);if(path==='date')setDate(s,el.value);touched(path)});
 bound.push({el,path});
 return h('label',{class:'field'+(wide?' wide':'')},h('span',{text:label}),el,hint&&h('small',{text:hint}));
}
function select(label,path,options,{onChange}={}){
 const el=h('select',{name:path,'data-path':path},options.map(([v,t])=>h('option',{value:v,text:t})));el.value=get(path)??'';
 el.addEventListener('change',()=>{set(path,el.value);onChange?.(el.value);touched(path)});bound.push({el,path});
 return h('label',{class:'field'},h('span',{text:label}),el);
}
function area(label,path,{rows=3,wide=true,placeholder=''}={}){
 const el=h('textarea',{rows,name:path,'data-path':path,maxlength:5000,placeholder});el.value=get(path)??'';el.addEventListener('input',()=>{set(path,el.value);touched(path)});bound.push({el,path});
 return h('label',{class:'field'+(wide?' wide':'')},h('span',{text:label}),el);
}
function imageField(label,path){
 const preview=h('img',{alt:'',class:'thumb',hidden:!get(path)});if(get(path))preview.src=get(path);
 const file=h('input',{type:'file',accept:'image/png,image/jpeg,image/webp'});
 file.addEventListener('change',async()=>{const f=file.files[0];if(!f)return;try{const url=await shrink(f,path==='logo'?600:500);set(path,url);preview.src=url;preview.hidden=false;remove.hidden=false;saveDraftSoon()}catch(e){say(e.message,true)}});
 const remove=h('button',{type:'button',class:'link',hidden:!get(path),onclick:()=>{set(path,'');preview.hidden=true;remove.hidden=true;file.value='';saveDraftSoon()},text:'Remove'});
 return h('div',{class:'field image-field'},h('span',{text:label}),preview,file,remove);
}
async function shrink(file,max){
 if(file.size>5*1024*1024)throw Error('Choose an image under 5 MB.');
 const bmp=await createImageBitmap(file),k=Math.min(1,max/Math.max(bmp.width,bmp.height)),c=document.createElement('canvas');c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);
 c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);return c.toDataURL(file.type==='image/jpeg'?'image/jpeg':'image/png',0.9);
}

// ---- sections ----
function detailsCard(){
 return h('section',{class:'card'},h('h2',{text:'Document details'}),
  h('div',{class:'grid'},
   input('Title','title'),input(type==='quotation'?'Quotation number':'Number','number',{attrs:{required:true},hint:numberPreview?'Next number in your series':''}),
   input('Issue date','date',{kind:'date'}),
   select('Payment terms','paymentTerms',PAYMENT_TERMS,{onChange:v=>setTerms(s,v)}),
   input('Due date','dueDate',{kind:'date'}),
   select('Currency','currency',CURRENCIES.map(c=>[c,c]))),
  h('div',{class:'grid'},imageField('Business logo','logo')));
}
function partyCard(who,key,{picker=false}={}){
 const f=(label,name,opts)=>input(label,key+'.'+name,opts);
 return h('section',{class:'card'},h('h2',{text:who}),picker&&clientPicker(),
  h('div',{class:'grid'},f('Business or client name','name',{wide:true,attrs:{required:true}}),f('GSTIN','gstin',{attrs:{maxlength:15,autocapitalize:'characters'},hint:'Leave empty if not registered. The first two digits set the state.'}),
   f('PAN','panNumber',{attrs:{maxlength:10}}),f('Address','street',{wide:true}),f('City','city'),
   h('label',{class:'field'},h('span',{text:'State'}),stateSelect(key)),f('PIN code','pincode',{attrs:{maxlength:10,inputmode:'numeric'}}),f('Country','country'),f('Email','email',{kind:'email'}),f('Phone','phone',{kind:'tel'}))
 );
}
function stateSelect(key){
 const path=key+'.gstState',el=h('select',{name:path,'data-path':path},h('option',{value:'',text:'Choose a state'}),Object.values(GST_STATES).map(n=>h('option',{value:n,text:n})),h('option',{value:'Other',text:'Other / outside India'}));
 el.value=get(path)||'';el.addEventListener('change',()=>{set(path,el.value);touched(path)});bound.push({el,path});return el;
}
let clients=[];
function clientPicker(){
 const sel=h('select',{'aria-label':'Choose a saved client'},h('option',{value:'',text:user?'Choose a saved client':'Sign in to use saved clients'}),clients.map(c=>h('option',{value:c.id,text:c.data.name})));
 sel.disabled=!user||!clients.length;
 sel.addEventListener('change',()=>{const c=clients.find(x=>x.id===sel.value);if(!c)return;const d=c.data;s.clientId=c.id;s.buyer={...s.buyer,name:d.name||'',email:d.email||'',phone:d.phone||'',gstin:d.gstin||'',street:d.address||d.street||'',city:d.city||'',pincode:d.pincode||''};autoGst(s);syncInputs();paintTotals();paintGst();saveDraftSoon()});
 return h('div',{class:'picker'},sel);
}
function itemsCard(){
 const body=h('div',{class:'items',id:'items'});
 const card=h('section',{class:'card'},h('h2',{text:'Items'}),h('div',{class:'items-head','aria-hidden':'true'},['#','Item','HSN / SAC','Qty','Rate','GST %','Discount','Amount',''].map(t=>h('span',{text:t}))),body,
  h('div',{class:'row-actions'},h('button',{type:'button',class:'secondary',onclick:()=>{s.items.push(newItem());paintItems();body.querySelector('.item:last-child input')?.focus()},text:'+ Add a line'})),
  h('datalist',{id:'hsn-list'}));
 paintItems(body);return card;
}
function paintItems(body=root.querySelector('#items')){
 for(let i=bound.length-1;i>=0;i--)if(/^items\./.test(bound[i].path))bound.splice(i,1);
 body.replaceChildren(...s.items.map((it,n)=>{
  const p=k=>`items.${n}.${k}`,cell=(label,path,attrs={},kind='text')=>{const el=h('input',{type:kind,name:path,'data-path':path,'aria-label':label+' for item '+(n+1),autocomplete:'off',...attrs});el.value=get(path)??'';
   el.addEventListener('input',()=>{set(path,el.value);if(/\.hsn$/.test(path))suggestHsn(n,el.value);touched(path)});bound.push({el,path});return el};
  const disc=h('div',{class:'disc'},cell('Discount',p('discount'),{inputmode:'decimal',placeholder:'0'}),(()=>{const t=h('select',{'aria-label':'Discount type'},h('option',{value:'fixed',text:'₹'}),h('option',{value:'percent',text:'%'}));t.value=it.discountType;t.addEventListener('change',()=>{it.discountType=t.value;touched(p('discountType'))});return t})());
  const desc=h('textarea',{rows:2,placeholder:'Description (optional)','aria-label':'Description for item '+(n+1),hidden:!it.description});desc.value=it.description||'';desc.addEventListener('input',()=>{it.description=desc.value;saveDraftSoon()});
  return h('div',{class:'item'},
   h('span',{class:'num',text:String(n+1)}),
   h('div',{class:'cell name','data-label':'Item'},cell('Item name',p('name'),{placeholder:'Item or service',maxlength:300}),h('button',{type:'button',class:'link',onclick:()=>{desc.hidden=!desc.hidden;if(!desc.hidden)desc.focus()},text:'Description'}),desc),
   h('div',{class:'cell','data-label':'HSN / SAC'},cell('HSN or SAC code',p('hsn'),{list:'hsn-list',inputmode:'numeric',maxlength:8})),
   h('div',{class:'cell','data-label':'Qty'},cell('Quantity',p('quantity'),{inputmode:'decimal'})),
   h('div',{class:'cell','data-label':'Rate'},cell('Rate',p('rate'),{inputmode:'decimal',placeholder:'0.00'})),
   h('div',{class:'cell','data-label':'GST %'},cell('GST rate',p('taxRate'),{inputmode:'decimal'})),
   h('div',{class:'cell','data-label':'Discount'},disc),
   h('output',{class:'amount','data-item':String(n),'aria-label':'Amount for item '+(n+1)},'—'),
   h('button',{type:'button',class:'remove','aria-label':'Remove item '+(n+1),disabled:s.items.length===1,onclick:()=>{s.items.splice(n,1);paintItems();paintTotals();saveDraftSoon()},text:'×'}));
 }));
 paintTotals();
}
async function suggestHsn(n,text){
 const q=String(text||'').trim();if(q.length<2)return;
 if(!hsn)try{hsn=(await fetch('/data/hsn-sac.json').then(r=>r.json())).entries||[]}catch{hsn=[];}
 const{searchHsn}=await import('/hsn-search.js');const list=root.querySelector('#hsn-list');if(!list)return;
 list.replaceChildren(...searchHsn(hsn,q,12).map(r=>h('option',{value:r.code,text:r.description})));
 const exact=hsn.find(r=>r.code===q);if(exact&&exact.gstRate!==null&&exact.gstRate!==undefined&&s.taxType==='GST'&&!s.items[n].rate_touched){s.items[n].taxRate=String(exact.gstRate);syncInputs();paintTotals()}
}
function totalsCard(){
 return h('section',{class:'card totals'},h('h2',{text:'Totals'}),
  h('div',{class:'grid'},select('Tax','taxType',[['GST','GST'],['NONE','No tax']]),
   h('label',{class:'field check'},(()=>{const c=h('input',{type:'checkbox','data-path':'roundOff'});c.checked=s.roundOff;c.addEventListener('change',()=>{s.roundOff=c.checked;touched('roundOff')});bound.push({el:c,path:'roundOff'});return c})(),h('span',{text:'Round the total to the nearest rupee'}))),
  h('p',{id:'gst-note',class:'note'}),h('dl',{id:'totals',class:'sums'}),h('p',{id:'words',class:'note'}));
}
function paintGst(){const n=root.querySelector('#gst-note');if(!n)return;
 if(s.taxType!=='GST'){n.textContent='No tax is added to this document.';return}
 const name=GST_STATES[s.placeOfSupply],both=name&&GST_STATES[(s.seller.gstin||'').slice(0,2)]&&GST_STATES[(s.buyer.gstin||'').slice(0,2)];
 n.textContent=s.gstMode==='igst'?'Different states, so IGST applies'+(name?' (place of supply: '+name+').':'.'):both?'Same state ('+name+'), so CGST and SGST apply.':'CGST and SGST are used. Add both GSTINs and this switches to IGST when the states differ.';
}
async function paintTotals(){
 const box=root.querySelector('#totals');if(!box)return;
 const m=await exportModule;let r=null;
 let why='';
 // Totals do not depend on the due date, so a wrong date never blanks them.
 try{r=m.calculate({...toDocument(s),dueDate:'',items:toDocument(s).items.map(i=>({...i,name:i.name||'Item',quantity:Number(i.quantity)>0?i.quantity:1,rate:i.rate===''?0:i.rate}))})}catch(e){r=null;why=e.message}
 const rows=[];
 if(r){const t=r.totals.minor;rows.push(['Subtotal',t.subtotal]);if(t.discount)rows.push(['Discount','-'+t.discount]);rows.push(['Taxable value',t.taxable]);
  if(s.taxType==='GST'){if(t.igst)rows.push(['IGST',t.igst]);else{rows.push(['CGST',t.cgst]);rows.push(['SGST',t.sgst]);}}
  if(t.cess)rows.push(['Cess',t.cess]);if(t.roundOff)rows.push(['Round off',t.roundOff]);rows.push(['Total',t.total,true]);
  r.document.items.forEach((it,n)=>{const o=root.querySelector(`output[data-item="${n}"]`);if(o)o.textContent=money(it.minor.total)});
  root.querySelector('#words').textContent=m.rupeesInWords(t.total);}
 else{rows.push(['Total','—',true]);root.querySelector('#words').textContent=why||'Fill in the items to see the total.';root.querySelectorAll('output[data-item]').forEach(o=>o.textContent='—')}
 box.replaceChildren(...rows.flatMap(([k,v,strong])=>[h('dt',{class:strong?'strong':''},k),h('dd',{class:strong?'strong':''},typeof v==='string'&&v.startsWith('-')?'−'+money(v.slice(1)):typeof v==='string'&&v==='—'?'—':money(v))]));
}
function extrasCard(){
 return h('section',{class:'card'},h('h2',{text:'Notes, terms and signature'}),
  h('div',{class:'grid'},area('Notes','notes',{placeholder:'Thank you for your business.'}),area('Terms and conditions','terms',{placeholder:'Payment due within 15 days.'}),
   area('Bank and UPI details','bankText',{rows:3}),imageField('Signature','signature')));
}

// ---- page ----
function toolbar(){
 const tpl=h('select',{'aria-label':'PDF design'},TEMPLATES.map(t=>h('option',{value:t,text:t[0].toUpperCase()+t.slice(1)})));tpl.value=s.template;tpl.addEventListener('change',()=>{s.template=tpl.value;saveDraftSoon()});
 return h('div',{class:'toolbar'},h('div',{class:'bar'},h('strong',{text:DOC_TYPES[type]}),
  h('button',{type:'button',class:'secondary',onclick:()=>start(true),text:'New document'}),h('button',{type:'button',class:'secondary',onclick:loadSample,text:'Load sample data'}),
  h('label',{class:'inline'},h('span',{text:'PDF design'}),tpl),
  h('button',{type:'button',class:'secondary',onclick:()=>output('preview'),text:'Preview PDF'}),h('button',{type:'button',class:'primary',onclick:()=>output('download'),text:'Download PDF'}),
  user&&business&&h('button',{type:'button',class:'secondary',onclick:save,text:record?'Save changes':'Save to account'})),
  h('p',{id:'status',class:'status',role:'status'}));
}
function build(){
 bound.length=0;
 root.replaceChildren(h('h1',{text:DOC_TYPES[type]}),h('p',{class:'lede',text:user?'Fill in the details, then preview, download or save.':'Fill in the details and download a PDF. Sign in to save your documents.'}),
  toolbar(),detailsCard(),h('div',{class:'two'},partyCard('Billed by (you)','seller'),partyCard('Billed to (client)','buyer',{picker:true})),itemsCard(),totalsCard(),extrasCard());
 // The bank box is a plain-text view of the bank fields.
 const bank=root.querySelector('[data-path=bankText]');if(bank){bank.value=s.bank?Object.entries(s.bank).filter(([,v])=>v).map(([k,v])=>k+': '+v).join('\n'):'';bank.addEventListener('input',()=>{const o={};for(const line of bank.value.split('\n')){const i=line.indexOf(':');if(i>0)o[line.slice(0,i).trim()]=line.slice(i+1).trim()}s.bank=Object.keys(o).length?o:null;saveDraftSoon()})}
 const i=bound.findIndex(b=>b.path==='bankText');if(i>=0)bound.splice(i,1);
 paintGst();paintTotals();
}
function focusProblem(p){const el=root.querySelector(`[data-path="${p.field}"]`);if(el){el.setAttribute('aria-invalid','true');el.scrollIntoView({block:'center',behavior:'smooth'});el.focus({preventScroll:true})}say(p.message,true)}
function checked(){const list=problems(s);if(list.length){focusProblem(list[0]);return false}return true}
async function output(kind){
 if(!checked())return;
 try{const m=await exportModule,doc=toDocument(s);
  if(kind==='download'){const r=await m.download(doc);say('Downloaded '+r.filename+(r.warnings?.length?' — '+r.warnings.join(' '):''))}
  else await m.preview(doc,t=>{s.template=t;const sel=root.querySelector('.toolbar select[aria-label="PDF design"]');if(sel)sel.value=t;saveDraftSoon()});
 }catch(e){say(e.message,true)}
}
async function save(){
 if(saving||!checked())return;saving=true;say('Saving…');
 try{const data=toDocument(s);(await exportModule).calculate(data);if(!record&&numberPreview&&data.number===numberPreview)data.numberAuto=true;
  const payload={business:business.id,collection:'documents',demo:sample,data,...(record?{id:record.id,version:record.version}:{})};
  const r=await api('/api/records',{method:record?'PATCH':'POST',body:JSON.stringify(payload)});record=r.record;if(record.data?.number&&record.data.number!==s.number){s.number=record.data.number;syncInputs()}
  numberPreview='';try{localStorage.removeItem(DRAFT_KEY)}catch{}say('Saved '+record.data.number+' to your business.'+(sample?' Sample record.':''));
 }catch(e){say(e.message,true)}finally{saving=false}
}
function loadSample(){
 const n=Math.floor(Math.random()*900+100);
 Object.assign(s,{number:'SAMPLE-'+n,notes:'Thank you for working with us.',terms:'Payment due within 15 days.'});
 s.seller={...s.seller,name:s.seller.name||'Studio Paper',gstin:s.seller.gstin||'27AAAAA0000A1Z5',street:s.seller.street||'18 Sample Lane',city:s.seller.city||'Mumbai',pincode:s.seller.pincode||'400001'};
 s.buyer={...s.buyer,name:'Cedar & Co.',gstin:'29BBBBB1111B1Z6',street:'42 Example Road',city:'Bengaluru',pincode:'560001',email:'billing@example.test'};
 s.items=[{...newItem(),name:'Consulting',description:'Project planning and design direction',hsn:'998313',quantity:'2',rate:'2500',taxRate:'18'},{...newItem(),name:'Support',description:'Project handover and follow-up',hsn:'998314',quantity:'1',rate:'1250',taxRate:'18'}];
 autoGst(s);record=null;build();say('Sample data loaded. Change anything, or download the PDF.');
}
async function start(fresh=false){
 const today=businessDate(new Date(),business?.time_zone||'Asia/Kolkata');
 if(fresh)try{localStorage.removeItem(DRAFT_KEY)}catch{}
 let restored=null;if(!fresh&&!params.get('id'))try{restored=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null')}catch{}
 s=restored?.state?{...newDocument(type,{today}),...restored.state}:newDocument(type,{today,business});
 record=null;numberPreview='';
 if(business&&!restored){applyBusiness(s,business);autoGst(s);await previewNumber()}
 build();if(restored)say('Your unsaved draft from this browser was restored. Choose “New document” to start again.');
}
async function previewNumber(){
 if(!business||s.number)return;
 try{const r=await api('/api/documents/number',{method:'POST',body:JSON.stringify({business:business.id,type,demo:sample,preview:true})});numberPreview=r.number;s.number=r.number}catch{}
}
async function loadSaved(id){
 loading=true;say('Loading your saved document…');
 try{const r=await api('/api/records?'+new URLSearchParams({business:business.id,collection:'documents',id,demo:String(sample)}));record=r.records?.[0];if(!record)throw Error('This document was not found.');
  s=fromDocument(record.data,{today:businessDate(new Date(),business.time_zone)});build();say('')}
 catch(e){await start(true);say(e.message,true)}finally{loading=false}
}
(async()=>{
 try{const auth=await fetch('/api/auth').then(r=>r.ok?r.json():{});user=auth.user||null}catch{}
 if(user){try{const ws=await api('/api/workspace');if(ws.businesses?.length){business=selectedBusiness(ws.businesses);
   const c=await api('/api/records?'+new URLSearchParams({business:business.id,collection:'clients',demo:String(sample),limit:'200'}));clients=(c.records||[]).filter(x=>x.data?.name)}}catch{}}
 if(params.get('id')&&business){await start(true);await loadSaved(params.get('id'))}else await start(params.get('fresh')==='true');
})();
