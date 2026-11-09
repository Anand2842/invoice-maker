// inbill's invoice editor. State lives in one object (see model.mjs); the page is built from it by small component
// functions. It produces the same document the PDF engine and the save API use.
import{api,selectedBusiness,sampleMode}from'/workspace-shell.js';
import{businessDate}from'/business-date.js';
import{DOC_TYPES,OPEN_ONLY_TYPES,TEMPLATES,PAYMENT_TERMS,CURRENCIES,REASON_UNSET,newDocument,newLine,toDocument,fromDocument,copyAsInvoice,modeOf,isIssued,autoGst,setTerms,setDate,setDueDate,applyBusiness,applyDiscountToAll,addColumn,removeColumn,problems}from'/editor/model.mjs';
import{GST_STATES}from'/editor/gst-states.mjs';

const params=new URLSearchParams(location.search),wanted=params.get('document')||'invoice',type=DOC_TYPES[wanted]?wanted:'invoice',sample=sampleMode();
const root=document.querySelector('#editor'),exportModule=import('/document-export.js');
let s,user=null,business=null,record=null,numberPreview='',loading=false,saving=false,pending=false,hsn=null,clients=[],savedItems=[],lifecycle=null,showCess=false,rememberClient=true;
const draftKey=()=>'inbill-editor-v2:'+(user?.id||'guest')+':'+type;
const bound=[]; // inputs kept in step with the state

// ---- tiny DOM helpers ----
const h=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(v===false||v==null)continue;if(k==='class')e.className=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(k==='text')e.textContent=v;else e.setAttribute(k,v===true?'':v)}for(const kid of kids.flat())if(kid!=null&&kid!==false)e.append(kid.nodeType?kid:document.createTextNode(kid));return e};
const get=path=>path.split('.').reduce((o,k)=>o?.[k],s);
const set=(path,value)=>{const keys=path.split('.'),last=keys.pop();let o=s;for(const k of keys){if(o[k]==null)o[k]={};o=o[k]}o[last]=value};
const money=(minor,currency=s.currency)=>new Intl.NumberFormat(currency==='INR'?'en-IN':'en-US',{style:'currency',currency}).format(Number(minor)/100);
const mode=()=>modeOf(s),frozen=()=>isIssued(s)||pending;
function say(text,error=false){const e=root.querySelector('#status');if(!e)return;e.textContent=text;e.className='status'+(error?' bad':'');e.setAttribute('role',error?'alert':'status')}

// ---- state changes ----
function touched(path=''){
 if(/\.gstin$|\.gstState$/.test(path)||path==='taxType')autoGst(s);
 syncInputs();paintTotals();paintGst();saveDraftSoon();
 const bad=root.querySelector('[aria-invalid=true]');if(bad&&!problems(s).some(p=>p.field===bad.dataset.path))bad.removeAttribute('aria-invalid');
}
function syncInputs(){for(const{el,path}of bound){if(document.activeElement===el)continue;const v=get(path)??'';if(el.type==='checkbox')el.checked=Boolean(v);else if(el.value!==String(v))el.value=v}}
let draftTimer;function saveDraftSoon(){clearTimeout(draftTimer);draftTimer=setTimeout(()=>{if(record||loading||s.source)return;try{localStorage.setItem(draftKey(),JSON.stringify({savedAt:Date.now(),state:s}))}catch{}},400)}

// ---- field components ----
function input(label,path,{kind='text',attrs={},wide=false,hint='',list=''}={}){
 const el=h('input',{type:kind,name:path,'data-path':path,autocomplete:'off',list,...attrs});el.value=get(path)??'';
 el.addEventListener('input',()=>{set(path,el.value);if(path==='dueDate')setDueDate(s,el.value);if(path==='date')setDate(s,el.value);touched(path)});
 bound.push({el,path});
 return h('label',{class:'field'+(wide?' wide':'')},h('span',{text:label}),el,hint&&h('small',{text:hint}));
}
function select(label,path,options,{onChange,wide=false}={}){
 const el=h('select',{name:path,'data-path':path},options.map(([v,t])=>h('option',{value:v,text:t})));el.value=get(path)??'';
 el.addEventListener('change',()=>{set(path,el.value);onChange?.(el.value);touched(path)});bound.push({el,path});
 return h('label',{class:'field'+(wide?' wide':'')},h('span',{text:label}),el);
}
function area(label,path,{rows=3,wide=true,placeholder=''}={}){
 const el=h('textarea',{rows,name:path,'data-path':path,maxlength:5000,placeholder});el.value=get(path)??'';el.addEventListener('input',()=>{set(path,el.value);touched(path)});bound.push({el,path});
 return h('label',{class:'field'+(wide?' wide':'')},h('span',{text:label}),el);
}
function checkbox(label,path,onChange){
 const c=h('input',{type:'checkbox','data-path':path});c.checked=Boolean(get(path));c.addEventListener('change',()=>{set(path,c.checked);onChange?.(c.checked);touched(path)});bound.push({el:c,path});
 return h('label',{class:'field check'},c,h('span',{text:label}));
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
const card=(part,...kids)=>h('fieldset',{class:'card','data-part':part},...kids);

// ---- sections ----
function banners(){
 const out=[];
 if(isIssued(s))out.push(h('p',{class:'banner'},'This document is final, so its details can no longer be changed. You can still preview and download it.'));
 if(mode()==='conversion')out.push(h('p',{class:'banner'},'This draft comes from a sales order. Its lines, quantities and tax are fixed; change them in Sales orders. You can still edit the notes, terms and design.'));
 if(mode()==='adjustment'){const x=s.extra;out.push(h('p',{class:'banner'},'This '+DOC_TYPES[s.type].toLowerCase()+' adjusts '+(x.originalDocumentNumber?'invoice '+x.originalDocumentNumber:'an earlier invoice')+(x.originalDocumentDate?' dated '+x.originalDocumentDate:'')+'. The parties come from that invoice and cannot be changed.'))}
 return out;
}
function detailsCard(){
 const items=[input('Title','title'),input(type==='quotation'?'Quotation number':'Number','number',{attrs:{required:true},hint:numberPreview?'Next number in your series':''}),input('Issue date','date',{kind:'date'}),
  select('Payment terms','paymentTerms',PAYMENT_TERMS,{onChange:v=>setTerms(s,v)}),input('Due date','dueDate',{kind:'date'}),select('Currency','currency',CURRENCIES.map(c=>[c,c]))];
 return card('details',h('h2',{text:'Document details'}),h('div',{class:'grid'},items),h('div',{class:'grid'},imageField('Business logo','logo')));
}
function reasonField(){
 if(mode()!=='adjustment')return null;
 const el=h('textarea',{rows:2,maxlength:1000,'data-path':'reason',placeholder:'For example: goods returned, or a rate correction'});el.value=s.extra.adjustmentReason===REASON_UNSET?'':(s.extra.adjustmentReason||'');
 el.addEventListener('input',()=>{s.extra.adjustmentReason=el.value.trim()?el.value:REASON_UNSET;if(el.getAttribute('aria-invalid'))el.removeAttribute('aria-invalid')});
 return card('reason',h('h2',{text:'Reason'}),h('label',{class:'field wide'},h('span',{text:'Why is this '+DOC_TYPES[s.type].toLowerCase()+' being issued?'}),el));
}
function partyCard(who,key,{picker=false}={}){
 const f=(label,name,opts)=>input(label,key+'.'+name,opts);
 return card('party',h('h2',{text:who}),picker&&clientPicker(),
  h('div',{class:'grid'},f('Business or client name','name',{wide:true,attrs:{required:true}}),f('GSTIN','gstin',{attrs:{maxlength:15,autocapitalize:'characters'},hint:'Leave empty if not registered. The first two digits set the state.'}),
   f('PAN','panNumber',{attrs:{maxlength:10}}),f('Address','street',{wide:true}),f('City','city'),
   h('label',{class:'field'},h('span',{text:'State'}),stateSelect(key)),f('PIN code','pincode',{attrs:{maxlength:10,inputmode:'numeric'}}),f('Country','country'),f('Email','email',{kind:'email'}),f('Phone','phone',{kind:'tel'})));
}
function stateSelect(key){
 const path=key+'.gstState',el=h('select',{name:path,'data-path':path},h('option',{value:'',text:'Choose a state'}),Object.values(GST_STATES).map(n=>h('option',{value:n,text:n})),h('option',{value:'Other',text:'Other / outside India'}));
 el.value=get(path)||'';el.addEventListener('change',()=>{set(path,el.value);touched(path)});bound.push({el,path});return el;
}
function clientPicker(){
 const label=type==='purchase-order'?'vendor':'client';
 const sel=h('select',{'aria-label':'Choose a saved '+label},h('option',{value:'',text:user?(clients.length?'Choose a saved '+label:'No saved '+label+'s yet'):'Sign in to use saved '+label+'s'}),clients.map(c=>h('option',{value:c.id,text:c.data.name})));
 sel.disabled=!user||!clients.length;
 sel.addEventListener('change',()=>{const c=clients.find(x=>x.id===sel.value);if(!c)return;const d=c.data;s.clientId=c.id;s.buyer={...s.buyer,name:d.name||'',email:d.email||'',phone:d.phone||'',gstin:d.gstin||'',street:d.address||d.street||'',city:d.city||'',pincode:d.pincode||''};autoGst(s);syncInputs();paintTotals();paintGst();saveDraftSoon()});
 return h('div',{class:'picker'},sel,user&&business&&!isIssued(s)?h('label',{class:'field check remember'},(()=>{const c=h('input',{type:'checkbox'});c.checked=rememberClient;c.addEventListener('change',()=>{rememberClient=c.checked});return c})(),h('span',{text:'Save this '+label+' for next time'})):null);
}
function itemsCard(){
 const body=h('div',{class:'items',id:'items'});
 const itemPicker=savedItems.length?h('select',{'aria-label':'Add a saved item',onchange:e=>{const it=savedItems.find(x=>x.id===e.target.value);e.target.value='';if(!it)return;const d=it.data,blank=s.items.length===1&&!s.items[0].name&&!s.items[0].rate;const line={...newLine(s),name:d.name||'',description:d.description||'',hsn:d.hsn||'',uqc:d.uqc||d.unit||'',rate:d.rate!==undefined?String(d.rate):'',taxRate:d.taxRate!==undefined&&d.taxRate!==''?String(d.taxRate):'18'};if(blank)s.items[0]=line;else s.items.push(line);paintItems();saveDraftSoon()}},h('option',{value:'',text:'+ Add a saved item'}),savedItems.map(i=>h('option',{value:i.id,text:i.data.name}))):null;
 return card('items',h('h2',{text:'Items'}),h('div',{class:'items-head','aria-hidden':'true'},['#','Item','HSN / SAC','Qty','Rate','GST %','Discount','Amount',''].map(t=>h('span',{text:t}))),body,
  h('div',{class:'row-actions'},h('button',{type:'button',class:'secondary',onclick:()=>{s.items.push(newLine(s));paintItems();body.querySelector('.item:last-child input')?.focus()},text:'+ Add a line'}),itemPicker),
  h('datalist',{id:'hsn-list'}));
}
function paintItems(body=root.querySelector('#items')){
 for(let i=bound.length-1;i>=0;i--)if(/^items\./.test(bound[i].path))bound.splice(i,1);
 const cess=showCess||s.items.some(i=>Number(i.cessRate)>0);
 body.className='items'+(cess?' with-cess':'')+(s.itemColumns.length?' with-extra':'');body.style.setProperty('--extra',s.itemColumns.length);
 const head=root.querySelector('.items-head');if(head){head.className='items-head'+(cess?' with-cess':'')+(s.itemColumns.length?' with-extra':'');head.style.setProperty('--extra',s.itemColumns.length);head.replaceChildren(...['#','Item','HSN / SAC','Qty','Rate','GST %',cess&&'Cess %','Discount',...s.itemColumns,'Amount',''].filter(Boolean).map(t=>h('span',{text:t})))}
 body.replaceChildren(...s.items.map((it,n)=>{
  const p=k=>`items.${n}.${k}`,cell=(label,path,attrs={},kind='text')=>{const el=h('input',{type:kind,name:path,'data-path':path,'aria-label':label+' for item '+(n+1),autocomplete:'off',...attrs});el.value=get(path)??'';
   el.addEventListener('input',()=>{set(path,el.value);if(/\.hsn$/.test(path))suggestHsn(n,el.value);touched(path)});bound.push({el,path});return el};
  const disc=h('div',{class:'disc'},cell('Discount',p('discount'),{inputmode:'decimal',placeholder:'0'}),(()=>{const t=h('select',{'aria-label':'Discount type'},h('option',{value:'fixed',text:'₹'}),h('option',{value:'percent',text:'%'}));t.value=it.discountType;t.addEventListener('change',()=>{it.discountType=t.value;touched(p('discountType'))});return t})());
  const desc=h('textarea',{rows:2,placeholder:'Description (optional)','aria-label':'Description for item '+(n+1),hidden:!it.description});desc.value=it.description||'';desc.addEventListener('input',()=>{it.description=desc.value;saveDraftSoon()});
  const extra=s.itemColumns.map((label,c)=>{const el=h('input',{type:'text','aria-label':label+' for item '+(n+1),autocomplete:'off'});el.value=it.customFields?.[c]?.value??'';el.addEventListener('input',()=>{(it.customFields=it.customFields||[])[c]={label,value:el.value};saveDraftSoon()});return h('div',{class:'cell extra','data-label':label},el)});
  return h('div',{class:'item'},
   h('span',{class:'num',text:String(n+1)}),
   h('div',{class:'cell name','data-label':'Item'},cell('Item name',p('name'),{placeholder:'Item or service',maxlength:300}),h('button',{type:'button',class:'link',onclick:()=>{desc.hidden=!desc.hidden;if(!desc.hidden)desc.focus()},text:'Description'}),desc),
   h('div',{class:'cell','data-label':'HSN / SAC'},cell('HSN or SAC code',p('hsn'),{list:'hsn-list',inputmode:'numeric',maxlength:8})),
   h('div',{class:'cell','data-label':'Qty'},cell('Quantity',p('quantity'),{inputmode:'decimal'})),
   h('div',{class:'cell','data-label':'Rate'},cell('Rate',p('rate'),{inputmode:'decimal',placeholder:'0.00'})),
   h('div',{class:'cell','data-label':'GST %'},cell('GST rate',p('taxRate'),{inputmode:'decimal'})),
   cess&&h('div',{class:'cell','data-label':'Cess %'},cell('Cess rate',p('cessRate'),{inputmode:'decimal'})),
   h('div',{class:'cell','data-label':'Discount'},disc),
   extra,
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
 const exact=hsn.find(r=>r.code===q);if(exact&&exact.gstRate!==null&&exact.gstRate!==undefined&&s.taxType==='GST'&&s.items[n]){s.items[n].taxRate=String(exact.gstRate);syncInputs();paintTotals()}
}
function taxCard(){
 const stateNames=Object.entries(GST_STATES).map(([code,n])=>[code,n+' ('+code+')']);
 const dAll=h('input',{type:'text',inputmode:'decimal',placeholder:'0','aria-label':'Discount for every line'}),tAll=h('select',{'aria-label':'Discount type for every line'},h('option',{value:'fixed',text:'₹'}),h('option',{value:'percent',text:'%'}));
 return card('tax',h('h2',{text:'Tax and totals'}),
  h('div',{class:'grid'},select('Tax','taxType',[['GST','GST (India)'],['VAT','VAT'],['NONE','No tax']],{onChange:()=>{autoGst(s);const keep=root.querySelector('#status')?.textContent;setTimeout(()=>{build();if(keep)say(keep)},0)}}),
   s.taxType==='GST'&&select('Tax split','gstMode',[['split','CGST + SGST (same state)'],['igst','IGST (different states)']]),
   s.taxType==='GST'&&select('Place of supply','placeOfSupply',[['','Not set'],...stateNames]),
   checkbox('Round the total to the nearest rupee','roundOff'),
   s.taxType==='GST'&&checkbox('Reverse charge applies','reverseCharge'),
   s.taxType==='GST'&&h('label',{class:'field check'},(()=>{const c=h('input',{type:'checkbox'});c.checked=showCess||s.items.some(i=>Number(i.cessRate)>0);c.addEventListener('change',()=>{showCess=c.checked;paintItems()});return c})(),h('span',{text:'Add a cess column'}))),
  h('div',{class:'all-discount'},h('span',{text:'Same discount on every line'}),dAll,tAll,h('button',{type:'button',class:'secondary',onclick:()=>{applyDiscountToAll(s,dAll.value.trim(),tAll.value);paintItems();syncInputs();saveDraftSoon()},text:'Apply'})),
  s.taxType==='GST'&&h('details',{class:'more'},h('summary',{text:'GST reporting details'}),h('p',{class:'note',text:'These choices label the supply for your GST reports. They do not change the tax calculation.'}),
   h('div',{class:'grid'},select('Supply classification','gstReporting.category',[['','Select classification'],['taxable','Taxable domestic supply'],['zero-rated','Export / zero-rated (review)'],['nil-rated','Nil-rated'],['exempt','Exempt'],['non-gst','Non-GST']]),
    input('Place of supply code','gstReporting.placeOfSupply',{attrs:{maxlength:2,inputmode:'numeric',placeholder:'e.g. 29 for Karnataka'}}))),
  h('p',{id:'gst-note',class:'note'}),h('dl',{id:'totals',class:'sums'}),h('p',{id:'words',class:'note'}));
}
function paintGst(){const n=root.querySelector('#gst-note');if(!n)return;
 if(s.taxType==='NONE'){n.textContent='No tax is added to this document.';return}
 if(s.taxType==='VAT'){n.textContent='VAT is added at the rate on each line.';return}
 const name=GST_STATES[s.placeOfSupply],both=name&&GST_STATES[(s.seller.gstin||'').slice(0,2)]&&GST_STATES[(s.buyer.gstin||'').slice(0,2)];
 n.textContent=s.gstMode==='igst'?'Different states, so IGST applies'+(name?' (place of supply: '+name+').':'.'):both?'Same state ('+name+'), so CGST and SGST apply.':'CGST and SGST are used. Add both GSTINs and this switches to IGST when the states differ.';
}
async function paintTotals(){
 const box=root.querySelector('#totals');if(!box)return;
 const m=await exportModule;let r=null,why='';
 const doc=toDocument(s);
 // Totals do not depend on the due date, so a wrong date never blanks them.
 try{r=m.calculate({...doc,dueDate:'',items:doc.items.map(i=>({...i,name:i.name||'Item',quantity:Number(i.quantity)>0?i.quantity:1,rate:i.rate===''?0:i.rate}))})}catch(e){r=null;why=e.message}
 const rows=[];
 if(r){const t=r.totals.minor;rows.push(['Subtotal',t.subtotal]);if(t.discount)rows.push(['Discount','-'+t.discount]);rows.push(['Taxable value',t.taxable]);
  if(s.taxType==='GST'){if(t.igst)rows.push(['IGST',t.igst]);else{rows.push(['CGST',t.cgst]);rows.push(['SGST',t.sgst]);}}
  if(s.taxType==='VAT'&&t.vat)rows.push(['VAT',t.vat]);
  if(t.cess)rows.push(['Cess',t.cess]);if(t.roundOff)rows.push(['Round off',t.roundOff]);rows.push(['Total',t.total,true]);
  r.document.items.forEach((it,n)=>{const o=root.querySelector(`output[data-item="${n}"]`);if(o)o.textContent=money(it.minor.total)});
  root.querySelector('#words').textContent=m.rupeesInWords(t.total);}
 else{rows.push(['Total','—',true]);root.querySelector('#words').textContent=why||'Fill in the items to see the total.';root.querySelectorAll('output[data-item]').forEach(o=>o.textContent='—')}
 box.replaceChildren(...rows.flatMap(([k,v,strong])=>[h('dt',{class:strong?'strong':''},k),h('dd',{class:strong?'strong':''},typeof v==='string'&&v.startsWith('-')?'−'+money(v.slice(1)):v==='—'?'—':money(v))]));
}
function pairs(part,title,names){return h('div',{class:'grid'},names.map(([k,label,opts])=>input(label,part+'.'+k,opts)))}
function moreCard(){
 const cf=h('div',{class:'cf',id:'custom-fields'});
 const paintCf=()=>{cf.replaceChildren(...s.customFields.map((f,n)=>{const l=h('input',{type:'text',placeholder:'Label, e.g. PO number','aria-label':'Field label '+(n+1),value:f.label}),v=h('input',{type:'text',placeholder:'Value','aria-label':'Field value '+(n+1),value:f.value});l.addEventListener('input',()=>{f.label=l.value;saveDraftSoon()});v.addEventListener('input',()=>{f.value=v.value;saveDraftSoon()});return h('div',{class:'cf-row'},l,v,h('button',{type:'button',class:'remove','aria-label':'Remove field',onclick:()=>{s.customFields.splice(n,1);paintCf();saveDraftSoon()},text:'×'}))}))};paintCf();
 const col=h('input',{type:'text',placeholder:'New column, e.g. Batch','aria-label':'New item column name',maxlength:40});
 const cols=h('div',{class:'chips',id:'columns'});
 const paintCols=()=>cols.replaceChildren(...s.itemColumns.map(c=>h('span',{class:'chip'},c,h('button',{type:'button','aria-label':'Remove column '+c,onclick:()=>{removeColumn(s,c);paintCols();paintItems();saveDraftSoon()},text:'×'}))));paintCols();
 const att=h('ul',{class:'attachments',id:'attachments'});
 const paintAtt=()=>att.replaceChildren(...s.attachments.map((a,n)=>h('li',{},h('a',{href:'/api/files?'+new URLSearchParams({path:a.path}),target:'_blank',rel:'noopener',text:a.name||'Attachment'}),h('button',{type:'button',class:'link',onclick:()=>{s.attachments.splice(n,1);paintAtt();saveDraftSoon()},text:'Remove'}))));paintAtt();
 const upload=h('input',{type:'file',disabled:!user||!business});
 upload.addEventListener('change',async()=>{const f=upload.files[0];if(!f)return;if(f.size>10*1024*1024){say('Choose a file under 10 MB.',true);return}
  try{say('Uploading '+f.name+'…');const fd=new FormData();fd.set('business',business.id);fd.set('file',f);const r=await fetch('/api/files',{method:'POST',body:fd}),b=await r.json();if(!r.ok)throw Error(b.error||'The file could not be uploaded.');s.attachments.push({path:b.path,name:f.name});paintAtt();say('Attached '+f.name+'.');saveDraftSoon()}catch(e){say(e.message,true)}finally{upload.value=''}});
 return card('more',h('h2',{text:'Notes, terms and more'}),
  h('div',{class:'grid'},area('Notes','notes',{placeholder:'Thank you for your business.'}),area('Terms and conditions','terms',{placeholder:'Payment due within 15 days.'}),area('Bank and UPI details','bankText',{rows:3}),imageField('Signature','signature')),
  h('details',{class:'more'},h('summary',{text:'Shipping details'}),pairs('shipping','',[['name','Ship to name'],['street','Address',{wide:true}],['city','City'],['state','State'],['pincode','PIN code'],['country','Country'],['phone','Phone']])),
  h('details',{class:'more'},h('summary',{text:'Transport details'}),pairs('transport','',[['transporter','Transporter'],['vehicleNumber','Vehicle number'],['lrNumber','LR / docket number'],['mode','Mode (road, rail, air, ship)'],['distanceKm','Distance (km)',{attrs:{inputmode:'numeric'}}]])),
  h('details',{class:'more'},h('summary',{text:'Extra fields and columns'}),h('p',{class:'note',text:'Extra fields print on the document. Columns add a value to every line.'}),cf,
   h('button',{type:'button',class:'secondary',onclick:()=>{s.customFields.push({label:'',value:''});paintCf();cf.querySelector('.cf-row:last-child input')?.focus();saveDraftSoon()},text:'+ Add a field'}),
   h('div',{class:'col-add'},col,h('button',{type:'button',class:'secondary',onclick:()=>{addColumn(s,col.value);col.value='';paintCols();paintItems();saveDraftSoon()},text:'+ Add a column'})),cols),
  h('details',{class:'more'},h('summary',{text:'Attachments'}),h('p',{class:'note',text:user&&business?'Files are stored with this business and linked from the document record. They are not printed on the PDF.':'Sign in to attach files.'}),att,upload));
}

// ---- page ----
function toolbar(){
 const tpl=h('select',{'aria-label':'PDF design',disabled:pending},TEMPLATES.map(t=>h('option',{value:t,text:t[0].toUpperCase()+t.slice(1)})));tpl.value=s.template;tpl.addEventListener('change',()=>{s.template=tpl.value;saveDraftSoon()});
 const open=type=>OPEN_ONLY_TYPES.includes(type);
 const convertible=record&&['quotation','proforma'].includes(record.data?.type);
 return h('div',{class:'toolbar'},h('div',{class:'bar'},h('strong',{text:DOC_TYPES[s.type]}),
  !isIssued(s)&&!open(s.type)&&h('button',{type:'button',class:'secondary','data-act':'new',onclick:()=>start(true),text:'New document'}),
  !isIssued(s)&&mode()==='edit'&&!open(s.type)&&h('button',{type:'button',class:'secondary','data-act':'sample',onclick:loadSample,text:'Load sample data'}),
  h('label',{class:'inline'},h('span',{text:'PDF design'}),tpl),
  h('button',{type:'button',class:'secondary',onclick:()=>output('preview'),text:'Preview PDF'}),h('button',{type:'button',class:'primary',onclick:()=>output('download'),text:'Download PDF'}),
  user&&business&&!isIssued(s)&&h('button',{type:'button',class:'secondary','data-act':'save',onclick:save,text:record?'Save changes':'Save to account'}),
  user&&business&&h('button',{type:'button',class:'secondary','data-act':'share',onclick:share,text:'Share & send'}),
  convertible&&h('a',{class:'button-link','data-act':'convert',href:location.pathname+'?'+new URLSearchParams({document:'invoice',fresh:'true',from:record.id,business:record.business_id,demo:String(record.demo)}),text:'Convert to invoice'})),
  h('p',{id:'status',class:'status',role:'status'}),h('div',{id:'lifecycle'}));
}
function build(){
 bound.length=0;
 root.replaceChildren(h('h1',{text:DOC_TYPES[s.type]}),h('p',{class:'lede',text:user?'Fill in the details, then preview, download or save.':'Fill in the details and download a PDF. Sign in to save your documents.'}),
  toolbar(),...banners(),detailsCard(),reasonField(),h('div',{class:'two'},partyCard('Billed by (you)','seller'),partyCard(type==='purchase-order'?'Vendor':'Billed to (client)','buyer',{picker:true})),itemsCard(),taxCard(),moreCard());
 const bank=root.querySelector('[data-path=bankText]');if(bank){bank.value=s.bank?Object.entries(s.bank).filter(([,v])=>v).map(([k,v])=>k+': '+v).join('\n'):'';bank.addEventListener('input',()=>{const o={};for(const line of bank.value.split('\n')){const i=line.indexOf(':');if(i>0)o[line.slice(0,i).trim()]=line.slice(i+1).trim()}s.bank=Object.keys(o).length?o:null;saveDraftSoon()})}
 const bi=bound.findIndex(b=>b.path==='bankText');if(bi>=0)bound.splice(bi,1);
 paintItems();paintGst();applyLocks();mountLifecycle();
}
// Locked parts are disabled as groups (a disabled fieldset disables everything inside it).
function applyLocks(){
 const m=mode(),all=frozen();
 for(const f of root.querySelectorAll('fieldset.card')){
  const part=f.dataset.part;
  f.disabled=all||(m==='conversion'&&part!=='more')||(m==='adjustment'&&part==='party');
 }
 if(m==='conversion'&&!all)for(const el of root.querySelectorAll('[data-part=more] input,[data-part=more] textarea,[data-part=more] select,[data-part=more] button'))el.disabled=!['notes','terms'].includes(el.dataset.path);
 for(const b of root.querySelectorAll('.toolbar [data-act=new],.toolbar [data-act=sample],.toolbar [data-act=save]'))b.disabled=pending||(b.dataset.act!=='save'&&mode()!=='edit')||(b.dataset.act==='save'&&isIssued(s));
}
async function mountLifecycle(){
 const box=root.querySelector('#lifecycle');if(!box||!user)return;
 try{const{mountDocumentActions}=await import('/document-actions.js');if(!box.isConnected)return;
  lifecycle=mountDocumentActions(box,{getRecord:()=>record,isLoading:()=>loading,save:async()=>save({quiet:true}),user,timeZone:business?.time_zone||'Asia/Kolkata',
   onUpdated:rec=>{record=rec;const keepStatus=root.querySelector('#status')?.textContent;s=fromDocument(rec.data,{today:today()});build();if(keepStatus)say(keepStatus)},
   onPending:v=>{if(pending!==v){pending=v;applyLocks()}}});
 }catch(e){say(e.message,true)}
}
const today=()=>businessDate(new Date(),business?.time_zone||'Asia/Kolkata');
function focusProblem(p){const el=root.querySelector(`[data-path="${p.field}"]`);if(el){el.removeAttribute('disabled');el.setAttribute('aria-invalid','true');el.scrollIntoView({block:'center',behavior:'smooth'});el.focus({preventScroll:true})}say(p.message,true)}
function checked(){const list=problems(s);if(list.length){focusProblem(list[0]);return false}return true}
async function output(kind){
 if(!checked())return;
 try{const m=await exportModule,doc=toDocument(s);
  if(kind==='download'){const r=await m.download(doc);say('Downloaded '+r.filename+(r.warnings?.length?' — '+r.warnings.join(' '):''))}
  else await m.preview(doc,t=>{s.template=t;const sel=root.querySelector('.toolbar select[aria-label="PDF design"]');if(sel)sel.value=t;saveDraftSoon()});
 }catch(e){say(e.message,true)}
}
// A client typed in by hand becomes a saved client (or is matched to one already saved), so the invoice is linked to it.
async function ensureClient(){
 if(!rememberClient||s.clientId||!s.buyer.name.trim()||s.source||OPEN_ONLY_TYPES.includes(s.type))return;
 const b=s.buyer,name=b.name.trim().toLowerCase(),gstin=(b.gstin||'').trim().toUpperCase();
 const match=clients.find(c=>(gstin&&String(c.data.gstin||'').toUpperCase()===gstin)||String(c.data.name||'').trim().toLowerCase()===name);
 if(match){s.clientId=match.id;return}
 const address=[b.street,b.city,b.gstState,b.pincode].filter(Boolean).join(', ');
 const r=await api('/api/records',{method:'POST',body:JSON.stringify({business:business.id,collection:type==='purchase-order'?'vendors':'clients',demo:sample,data:{name:b.name.trim(),email:b.email||'',phone:b.phone||'',address,gstin}})});
 s.clientId=r.record.id;clients.push(r.record);
}
async function save({quiet=false}={}){
 if(isIssued(s))return record;
 if(saving||!checked())return null;saving=true;if(!quiet)say('Saving…');
 try{await ensureClient();const data=toDocument(s);(await exportModule).calculate({...data,dueDate:data.dueDate});if(!record&&numberPreview&&data.number===numberPreview)data.numberAuto=true;
  const payload={business:business.id,collection:'documents',demo:sample,data,...(record?{id:record.id,version:record.version}:{})};
  const r=await api('/api/records',{method:record?'PATCH':'POST',body:JSON.stringify(payload)});record=r.record;if(record.data?.number&&record.data.number!==s.number){s.number=record.data.number;syncInputs()}
  if(record.data?.extra)s.extra=record.data.extra;numberPreview='';try{localStorage.removeItem(draftKey())}catch{}
  if(!quiet)say('Saved '+record.data.number+' to your business.'+(sample?' Sample record.':''));
  lifecycle?.refresh?.();return record;
 }catch(e){say(e.message,true);return null}finally{saving=false}
}
async function share(){const r=await save({quiet:true});if(!r)return;const{openDelivery}=await import('/document-delivery.js');await openDelivery(r,x=>{record=x})}
function loadSample(){
 const n=Math.floor(Math.random()*900+100);
 Object.assign(s,{number:'SAMPLE-'+n,notes:'Thank you for working with us.',terms:'Payment due within 15 days.'});
 s.seller={...s.seller,name:s.seller.name||'Studio Paper',gstin:s.seller.gstin||'27AAAAA0000A1Z5',street:s.seller.street||'18 Sample Lane',city:s.seller.city||'Mumbai',pincode:s.seller.pincode||'400001'};
 s.buyer={...s.buyer,name:'Cedar & Co.',gstin:'29BBBBB1111B1Z6',street:'42 Example Road',city:'Bengaluru',pincode:'560001',email:'billing@example.test'};
 s.items=[{...newLine(s),name:'Consulting',description:'Project planning and design direction',hsn:'998313',quantity:'2',rate:'2500',taxRate:'18'},{...newLine(s),name:'Support',description:'Project handover and follow-up',hsn:'998314',quantity:'1',rate:'1250',taxRate:'18'}];
 autoGst(s);record=null;build();say('Sample data loaded. Change anything, or download the PDF.');
}
async function start(fresh=false){
 if(fresh)try{localStorage.removeItem(draftKey())}catch{}
 let restored=null;if(!fresh&&!params.get('id')&&!params.get('from'))try{restored=JSON.parse(localStorage.getItem(draftKey())||'null')}catch{}
 s=restored?.state?{...newDocument(type,{today:today()}),...restored.state}:newDocument(type,{today:today(),business});
 record=null;numberPreview='';
 if(business&&!restored){applyBusiness(s,business);autoGst(s);await previewNumber()}
 build();if(restored)say('Your unsent draft from this browser was restored. Choose “New document” to start again.');
}
async function previewNumber(){
 if(!business||s.number)return;
 try{const r=await api('/api/documents/number',{method:'POST',body:JSON.stringify({business:business.id,type:s.type,demo:sample,preview:true})});numberPreview=r.number;s.number=r.number}catch{}
}
async function fetchRecord(id,demo){const r=await api('/api/records?'+new URLSearchParams({business:business.id,collection:'documents',id,demo:String(demo)}));return r.records?.[0]||null}
async function loadSaved(id){
 loading=true;say('Loading your saved document…');
 try{const rec=await fetchRecord(id,params.get('demo')==='true'||sample);if(!rec)throw Error('This document was not found in this business. Return to Workspace and select its business.');
  record=rec;s=fromDocument(rec.data,{today:today()});build();say('Opened '+(rec.data.number||'your document')+' from your business.')}
 catch(e){await start(true);say(e.message,true)}finally{loading=false;lifecycle?.refresh?.()}
}
async function copyFrom(id){
 say('Copying the quotation…');
 try{const rec=await fetchRecord(id,params.get('demo')==='true'||sample);if(!rec)throw Error('The quotation could not be found. Open it from Invoices & documents and try again.');
  if(!['quotation','proforma'].includes(rec.data.type))throw Error('Only quotations and proforma invoices can be converted to an invoice.');
  s=copyAsInvoice({...rec.data,__sourceId:rec.id},{today:today(),type});s.extra.sourceQuotationId=rec.id;record=null;numberPreview='';await previewNumber();build();
  params.delete('from');history.replaceState(history.state,'',location.pathname+'?'+params);
  say('Copied from '+(rec.data.number||'the quotation')+'. Check the details, then click Save to account.')}
 catch(e){await start(true);say(e.message,true)}
}
(async()=>{
 try{const auth=await fetch('/api/auth').then(r=>r.ok?r.json():{});user=auth.user||null}catch{}
 if(user){try{const ws=await api('/api/workspace');if(ws.businesses?.length){business=selectedBusiness(ws.businesses);
   const q=c=>api('/api/records?'+new URLSearchParams({business:business.id,collection:c,demo:String(sample),limit:'200'})).then(r=>r.records||[]).catch(()=>[]);
   [clients,savedItems]=await Promise.all([q(type==='purchase-order'?'vendors':'clients'),q('items')]);clients=clients.filter(x=>x.data?.name);savedItems=savedItems.filter(x=>x.data?.name)}}catch{}}
 if(params.get('id')&&business){await start(true);await loadSaved(params.get('id'))}
 else if(params.get('from')&&business){await start(true);await copyFrom(params.get('from'))}
 else await start(params.get('fresh')==='true');
})();
