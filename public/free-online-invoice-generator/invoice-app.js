(() => {
  'use strict';
  const base='/free-online-invoice-generator/';
  let mount=document.getElementById('invoice-editor-mount');
  const params=new URLSearchParams(location.search);
  const documentTypes={'invoice':'Invoice','gst-invoice':'Tax Invoice','quotation':'Quotation','proforma':'Proforma Invoice','purchase-order':'Purchase Order','delivery-challan':'Delivery Challan','commercial-invoice':'Commercial Invoice'};
  const documentType=documentTypes[params.get('document')]?params.get('document'):'invoice';
  const draftKey='independent-billing-draft-v2-'+documentType;
  const exportModule=import('/document-export.js'),confirmationModule=import('/confirm.js');
  let savedRecord=null,isDemo=false,documentLoading=Boolean(params.get('id')),documentLoadError='';
  const initialState={currency:'INR',taxType:documentType==='delivery-challan'?'NONE':'GST',gstMode:'split',discount:0,discountType:'amount',template:'classic',brandColor:'#6040a0',bank:null,clientId:null};
  const q=(selector,scope=document)=>scope.querySelector(selector);
  const qa=(selector,scope=document)=>[...scope.querySelectorAll(selector)];
  const cl=name=>`[class*="${name}__"]`;
  const state={...initialState,saving:null,options:{}};
  let form, originalLine, templates={},selectTemplates={},discountSource={},classMaps={},extras={};
  const layout=()=>innerWidth<=568?'mobile':'desktop';
  const adapt=(node,target)=>{const mapping=target==='mobile'?classMaps.desktopToMobile:classMaps.mobileToDesktop;node.querySelectorAll('[class]').forEach(e=>{const replacement=mapping?.[e.getAttribute('class')];if(replacement)e.setAttribute('class',replacement)});return node};
  const sourceStyles=new Set();
  function sanitize(node){
    if(!node)return node;
    node.querySelectorAll('script,iframe,object,embed,style,link,meta,base,foreignObject').forEach(e=>e.remove());
    for(const e of [node,...node.querySelectorAll('*')]){for(const a of [...e.attributes]){
      if(/^on/i.test(a.name)||['srcdoc','formaction'].includes(a.name))e.removeAttribute(a.name);
      if(['href','xlink:href','action'].includes(a.name)){const clean=a.value.replace(/[\u0000-\u0020\u007f]/g,'');if(/^[a-z][a-z0-9+.-]*:/i.test(clean)&&!/^https?:|^mailto:|^tel:/i.test(clean))e.removeAttribute(a.name)}
      if(a.name==='style'&&/url\(|expression\(|@import/i.test(a.value))e.removeAttribute(a.name);
    }if(e.tagName==='FORM'){e.removeAttribute('method');e.removeAttribute('action')}}return node;
  }
  async function loadStyle(name){if(sourceStyles.has(name))return;await new Promise(resolve=>{const link=document.createElement('link');link.rel='stylesheet';link.href=base+name;link.onload=resolve;link.onerror=resolve;const first=document.head.querySelector('link[rel="stylesheet"]');document.head.insertBefore(link,first)});sourceStyles.add(name)}
  const parse=html=>{const t=document.createElement('template');t.innerHTML=html.trim();return t.content.firstElementChild};
  const value=name=>q(`[name="${CSS.escape(name)}"]`,form)?.value||'';
  const money=amount=>new Intl.NumberFormat('en-IN',{style:'currency',currency:state.currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(amount);
  const finite=x=>Number.isFinite(Number(x))?Number(x):0;
  const txt=(root,selector,text)=>{const e=q(selector,root);if(e)e.textContent=text};
  function update(){
    if(!form)return;
    let amount=0,gst=0,quantity=0,cgst=0,sgst=0;
    qa(cl('LineItems_lineItemContainer'),form).forEach(row=>{
      const field=suffix=>q(`input[name$=".${suffix}"]`,row);
      const qty=finite(field('quantity')?.value),rate=finite(field('rate')?.value);
      const gross=Math.round(qty*rate*100)/100;const itemDiscount=finite(field('discount.amount')?.value);const discountType=field('discount.discountType')?.value||'PERCENTAGE';const subtotal=Math.max(0,Math.round((gross-(discountType==='PERCENTAGE'?gross*Math.min(100,itemDiscount)/100:itemDiscount))*100)/100);
      const tax=state.taxType==='NONE'?0:Math.round(subtotal*finite(field('gstRate')?.value)/100*100)/100;
      const first=Math.floor(Math.round(tax*100)/2)/100,second=Math.round(tax*100)/100-first;amount+=subtotal;gst+=tax;cgst+=first;sgst+=second;quantity+=qty;
      qa(cl('LineItems_computedField'),row).forEach((e,i)=>e.textContent=money([subtotal,state.gstMode==='igst'||state.taxType==='VAT'?tax:first,second,subtotal+tax][i]||0));
      const name=q('input[name$=".name"]',row);const label=q('[contenteditable][data-item-name]',row);if(name&&label)name.value=label.textContent.trim();
    });
    amount=Math.round(amount*100)/100;gst=Math.round(gst*100)/100;
    const discount=0;
    const total=Math.max(0,Math.round((amount+gst-discount)*100)/100);
    txt(form,`${cl('InvoiceBalance_balanceRow')} .bxCORq`,money(amount));
    const taxRows=qa(cl('InvoiceBalance_taxRow'),form);
    taxRows.forEach((row,i)=>{const children=qa(':scope > span',row);if(children[0])children[0].textContent=money(i===0?gst:i===1?sgst:cgst);row.hidden=state.taxType==='NONE';row.style.display=state.taxType==='NONE'?'none':''});
    txt(form,`${cl('InvoiceBalance_totalAmountWrapper')} .bjbOAY`,money(total));
    txt(form,`${cl('InvoiceBalance_totalLabelRow')} .gwbZMU`,`(${state.currency})`);
    txt(form,cl('InvoiceBalance_totalInWordsValue'),toWords(total));
    qa('[data-currency-sign],.fHnneQ',form).forEach(e=>e.textContent=new Intl.NumberFormat('en',{style:'currency',currency:state.currency,currencyDisplay:'narrowSymbol'}).formatToParts(0).find(p=>p.type==='currency')?.value||state.currency);
    const quantityRow=q('[data-total-quantity]',form);if(quantityRow)quantityRow.textContent=`Total Quantity: ${quantity}`;
    const discountRow=q('[data-discount-summary]',form);if(discountRow)discountRow.textContent=`Discount −${money(discount)}`;
    state.total=total;state.amount=amount;state.gst=gst;syncTaxStructure();
    clearTimeout(state.saving);state.saving=setTimeout(saveDraft,300);
  }
  function toWords(number){
    const ones=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
    const tens=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
    const spell=n=>{if(n<20)return ones[n];if(n<100)return tens[Math.floor(n/10)]+(n%10?' '+ones[n%10]:'');if(n<1000)return ones[Math.floor(n/100)]+' Hundred'+(n%100?' '+spell(n%100):'');for(const [unit,label] of [[10000000,'Crore'],[100000,'Lakh'],[1000,'Thousand']])if(n>=unit)return spell(Math.floor(n/unit))+' '+label+(n%unit?' '+spell(n%unit):'');return ''};
    let main=Math.floor(number),fraction=Math.round((number-main)*100);if(fraction===100){main++;fraction=0}
    const unit=state.currency==='INR'?(main===1?'Rupee':'Rupees'):state.currency;
    return `${spell(main)||'Zero'} ${unit}${fraction?' And '+spell(fraction)+(state.currency==='INR'?' Paise':' Cents'):''} Only`;
  }
  function serializeEditor(){
    if(!form)return '';
    const clone=form.parentElement.cloneNode(true);
    const original=qa('input,textarea,select',form.parentElement),copy=qa('input,textarea,select',clone);
    copy.forEach((e,i)=>{const source=original[i];if(!source||e.type==='file')return;if(e.type==='checkbox'||e.type==='radio'){e.toggleAttribute('checked',source.checked)}else if(e.tagName==='TEXTAREA')e.textContent=source.value;else e.setAttribute('value',source.value);});
    clone.querySelectorAll('.local-select-overlay,.disco-select__menu,.disco-select-creatable__menu,.react-tooltip,.local-quantity-summary').forEach(e=>e.remove());clone.querySelectorAll('[data-local-select-ready],[data-date-ready],[data-editable-label],[data-local-editor-ready],[data-source-signature-ready],[data-local-upload-ready],[data-item-select-ready]').forEach(e=>{e.removeAttribute('data-local-select-ready');e.removeAttribute('data-date-ready');e.removeAttribute('data-editable-label');e.removeAttribute('data-local-editor-ready');e.removeAttribute('data-source-signature-ready');e.removeAttribute('data-local-upload-ready');e.removeAttribute('data-item-select-ready')});
    sanitize(clone);return clone.outerHTML;
  }
  function saveDraft(){
    if(!form)return;
    try{localStorage.setItem(draftKey,JSON.stringify({html:serializeEditor(),template:state.template,brandColor:state.brandColor,bank:state.bank,clientId:state.clientId,currency:state.currency,taxType:state.taxType,gstMode:state.gstMode,discount:state.discount,discountType:state.discountType,cess:state.cess,placeOfSupply:state.placeOfSupply,reverseCharge:state.reverseCharge,isDemo,savedRecord:savedRecord?{id:savedRecord.id,version:savedRecord.version,business_id:savedRecord.business_id,data:{status:savedRecord.data?.status}}:null,layout:layout(),updatedAt:new Date().toISOString()}));q('[data-draft-error]',form)?.remove()}catch{if(!q('[data-draft-error]',form)){const message=document.createElement('p');message.dataset.draftError='true';message.setAttribute('role','alert');message.className='local-storage-error';message.textContent='Your browser could not save this draft. Keep this page open to retain your changes.';form.prepend(message)}}
  }
  async function openEditor(){
    if(form)return;
    const button=q('button[title="Create Your First Invoice"]');if(button)button.disabled=true;
    try{
      const currentLayout=layout();
      const sourceHead=await fetch(base+(currentLayout==='mobile'?'form-head-mobile.html':'form-head.html')).then(r=>r.text());const appHead=qa('[data-independent-app]',document.head).map(e=>e.cloneNode(true));document.head.innerHTML=sourceHead;appHead.forEach(e=>document.head.append(e));sourceStyles.clear();
      if(!document.getElementById('invoice-optional-source')){const stylesheet=document.createElement('link');stylesheet.id='invoice-optional-source';stylesheet.rel='stylesheet';stylesheet.href=base+'optional-source.css';const first=document.head.querySelector('link[rel="stylesheet"]');document.head.insertBefore(stylesheet,first)}
      const [html,options,selects,discounts,mapping,body,sourceExtras]=await Promise.all([fetch(base+(currentLayout==='mobile'?'form-mobile.html':'form.html')).then(r=>{if(!r.ok)throw Error('Unable to load invoice');return r.text()}),fetch(base+(currentLayout==='mobile'?'optionals-mobile.json':'optionals.json')).then(r=>r.json()),fetch(base+'selects.json').then(r=>r.json()),fetch(base+'discount-source.json').then(r=>r.json()),fetch(base+'responsive-classes.json').then(r=>r.json()),fetch(base+'body-open-'+currentLayout+'.html').then(r=>r.text()),fetch(base+'extras.json').then(r=>r.json())]);extras=sourceExtras;await loadStyle('extras-source.css');classMaps=mapping;document.body.innerHTML=body;mount=document.getElementById('invoice-editor-mount');templates=options;selectTemplates=selects;discountSource=discounts;await loadStyle('selects-source.css');await loadStyle('interaction-source.css');
      let draft;try{const candidate=JSON.parse((params.get('id')||params.get('fresh')==='true')?'null':localStorage.getItem(draftKey));if(typeof candidate?.html==='string'&&candidate.html.length<2000000){const parsed=parse(candidate.html);sanitize(parsed);if(q('form',parsed)&&q('[name="invoiceNumber"]',parsed)&&q('input[name$=".rate"]',parsed)&&q(cl('LineItems_lineItemContainer'),parsed)&&q('[name="billedBy.name"]',parsed)&&q('[name="billedTo.name"]',parsed)){adapt(parsed,currentLayout);qa(cl('LineItems_lineItemDescriptionCell'),parsed).forEach(cell=>{const oldEditor=q('.toastui-editor-contents[contenteditable]',cell);if(oldEditor){const fresh=adapt(parse(extras[currentLayout==='mobile'?'description-mobile':'description']),currentLayout);q('.toastui-editor-contents[contenteditable]',fresh).innerHTML=oldEditor.innerHTML;cell.replaceWith(fresh)}});const oldNote=q(cl('Notes_wrapper')+' .toastui-editor-contents[contenteditable]',parsed);if(oldNote&&options.notes){let section=oldNote;while(section.parentElement&&section.parentElement.tagName!=='FORM')section=section.parentElement;if(section.parentElement?.tagName==='FORM'){const freshNote=adapt(parse(options.notes),currentLayout);const editor=q('.toastui-editor-contents[contenteditable]',freshNote);if(editor)editor.innerHTML=oldNote.innerHTML;section.replaceWith(freshNote)}}candidate.html=parsed.outerHTML;draft=candidate}}}catch{}
      const card=document.createElement('div');card.className='InvoiceFormLite_invoiceCard__DqVlk';const wrapper=document.createElement('div');wrapper.className='InvoiceFormLite_invoiceFormWrapper__myyU0';
      card.innerHTML=draft?.html||html;wrapper.append(card);mount.replaceChildren(wrapper);form=q('form',mount);
      if(draft){for(const key of ['template','brandColor','bank','clientId','currency','taxType','gstMode','discount','discountType','cess','placeOfSupply','reverseCharge'])if(draft[key]!==undefined)state[key]=draft[key];isDemo=draft.isDemo===true;savedRecord=draft.savedRecord||null}
      if(!/^[A-Z]{3}$/.test(state.currency))state.currency='INR';
      templates.signatureButton=q(cl('Signature_wrapper'),parse(html)).outerHTML;templates.attachmentsButton=qa('button',parse(html)).find(e=>e.textContent.trim()==='Add Attachments')?.outerHTML;
      originalLine=q(cl('LineItems_lineItemContainer'),parse(q('input[name$=".discount.amount"]',form)?discountSource.lines:html)).cloneNode(true);
      if(!draft){const number=q('[name="invoiceNumber"]',form);number.value=documentType.toUpperCase().replace(/[^A-Z]/g,'').slice(0,4)+'-'+new Date().getFullYear()+'-001';const date=q('[name="invoiceDate"]',form);date.value=new Intl.DateTimeFormat('en-US',{month:'short',day:'2-digit',year:'numeric',timeZone:'Asia/Kolkata'}).format(new Date())}
      bindForm();
      setupToolbar();applyDocumentLabels();if(!draft&&!params.get('id'))await applyBusinessDefaults();if(params.get('id'))await loadSavedDocument(params.get('id'));update();if(params.get('fresh')){params.delete('fresh');history.replaceState(null,'',location.pathname+'?'+params)}const heading=qa('h2').find(e=>e.textContent.includes('generator'));if(heading){const top=heading.getBoundingClientRect().top+scrollY-(layout()==='mobile'?12:16);scrollTo({top,behavior:'smooth'})}
    }catch(error){status(error.message,true);if(button){button.disabled=false;button.title=error.message}}
  }
  function bindForm(){
      form.removeAttribute('method');form.addEventListener('submit',e=>{e.preventDefault();continueSignup()});
      qa('input[name$=".rate"]',form).forEach(e=>{e.min='0';e.step='0.01'});
      qa('input[name$=".gstRate"],input[name$=".quantity"]',form).forEach(e=>{e.inputMode='decimal'});
      for(const name of ['invoiceNumber','invoiceDate','billedBy.name','billedTo.name']){const input=q(`[name="${name}"]`,form);if(input)input.required=true}
      prepareNames();prepareSelects();prepareDates();qa('.toastui-editor-defaultUI',form).forEach(e=>wireRichEditor(e,e.closest(cl('Notes_wrapper'))?'Additional Notes':'Description'));const signature=q(cl('Signature_wrapper'),form);if(signature&&q('input[type="file"]',signature))wireSignature(signature);
      qa('.fHnneQ',form).forEach(e=>e.dataset.currencySign='true');
      form.addEventListener('paste',e=>{if(e.target.closest('[contenteditable]')){e.preventDefault();const text=e.clipboardData.getData('text/plain');document.execCommand('insertText',false,text)}});
      form.addEventListener('input',e=>{if(e.target.dataset.allItemDiscount!==undefined){state.discount=Math.max(0,finite(e.target.value));qa('input[name$=".discount.amount"]',form).forEach(input=>input.value=state.discount)}update()});form.addEventListener('change',changed);form.addEventListener('click',clicked);
      form.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('[contenteditable]')){e.preventDefault();e.target.blur()}});
  }
  function prepareNames(){
    qa('input[name$=".name"][type="hidden"]',form).forEach(hidden=>{
      const container=hidden.closest('.disco-select-creatable');if(!container||container.dataset.itemSelectReady)return;container.dataset.itemSelectReady='true';
      const label=q('.disco-select-creatable__single-value',container),search=q('.disco-select-creatable__input input',container),control=q('.disco-select-creatable__control',container);if(!search||!label)return;
      label.removeAttribute('contenteditable');label.removeAttribute('role');label.removeAttribute('aria-label');label.removeAttribute('data-item-name');label.style.display='';label.style.pointerEvents='';search.tabIndex=0;search.value='';search.setAttribute('aria-label','Item name');search.style.width='2px';
      let chosen=hidden.value||'Item Name';const focused='disco-select-creatable__control disco-select-creatable__control--is-focused css-1pahdxg-control',plain='disco-select-creatable__control css-yk16xz-control';control.className=plain;
      const close=()=>{q('.disco-select-creatable__menu',container)?.remove();search.value='';search.style.width='2px';label.style.display='';control.className=document.activeElement===search?focused:plain};
      const choose=name=>{chosen=name;hidden.value=name;label.textContent=name||'Item Name';close();update()};
      const open=()=>{qa('.disco-select__menu,.disco-select-creatable__menu',document).forEach(e=>e.remove());const term=search.value.trim(),menu=sanitize(parse(term?extras.itemTyped:extras.itemFocused));const wrapper=q('.sc-ccxkmA',menu)||q('[class*="__menu-list"]',menu),options=qa('.disco-select-creatable__option',menu),prototype=options.at(-1).cloneNode(true);wrapper.replaceChildren();
        if(term){const create=options[0].cloneNode(true);const text=q('span',create);if(text)text.textContent=' Create New- '+term;create.setAttribute('role','option');create.addEventListener('mousedown',e=>{e.preventDefault();choose(term)});wrapper.append(create)}
        const names=[...new Set(['Item Name',...qa('input[name$=".name"][type="hidden"]',form).map(e=>e.value).filter(Boolean)])];names.forEach(name=>{const option=prototype.cloneNode(true);q('span',option).textContent=name;option.setAttribute('role','option');option.setAttribute('aria-selected',String(name===chosen));option.addEventListener('mousedown',e=>{e.preventDefault();choose(name)});wrapper.append(option)});container.append(menu);control.className=focused+' disco-select-creatable__control--menu-is-open';label.style.display=term?'none':'';
      };
      control.addEventListener('mousedown',e=>{if(e.target.closest('.disco-select-creatable__clear-indicator')){e.preventDefault();choose('');search.focus();return}if(e.target.closest('.disco-select-creatable__menu'))return;e.preventDefault();search.focus();open()});
      search.addEventListener('input',()=>{const measure=document.createElement('span');measure.style.cssText='position:absolute;visibility:hidden;white-space:pre';measure.style.font=getComputedStyle(search).font;measure.textContent=search.value;document.body.append(measure);search.style.width=Math.max(2,Math.ceil(measure.getBoundingClientRect().width))+'px';measure.remove();open()});search.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close()}if(e.key==='Enter'){e.preventDefault();choose(search.value.trim()||chosen)}if(e.key==='ArrowDown'&&!q('.disco-select-creatable__menu',container)){e.preventDefault();open()}});search.addEventListener('blur',()=>setTimeout(close,100));
      document.addEventListener('mousedown',e=>{if(!container.contains(e.target))close()});
    });
    qa('[role="button"][name]',form).forEach(e=>{if(e.dataset.editableLabel)return;e.dataset.editableLabel='true';e.addEventListener('click',()=>{e.contentEditable='true';e.focus()});e.addEventListener('blur',()=>{e.contentEditable='false';update()})});
  }
  function prepareSelects(){
    qa('input[type="hidden"]',form).forEach(input=>{
      let key;if(input.name.endsWith('.country'))key='countries';else if(input.name.endsWith('.gstState'))key='states';else if(input.name==='currency')key='currencies';else if(extras.shippingMenus?.[input.name])key=input.name;else return;
      const source=selectTemplates[key]||extras.shippingMenus?.[key];const container=input.closest('.disco-select');if(!container||!source?.menu||container.dataset.localSelectReady)return;container.dataset.localSelectReady='true';
      const control=q('.disco-select__control',container),search=q('.disco-select__input input',container);control.tabIndex=0;control.setAttribute('role','combobox');control.setAttribute('aria-label',input.name==='currency'?'Currency':input.name.replace('.',' '));control.setAttribute('aria-expanded','false');
      const close=()=>{q('.disco-select__menu',container)?.remove();control.setAttribute('aria-expanded','false');control.classList.remove('disco-select__control--is-focused','disco-select__control--menu-is-open');if(search){search.value='';search.style.width='2px'}};
      const open=()=>{qa('.disco-select__menu',document).forEach(e=>e.remove());const menu=parse(source.menu);qa('[id]',menu).forEach(e=>e.removeAttribute('id'));control.setAttribute('aria-expanded','true');control.classList.add('disco-select__control--is-focused','disco-select__control--menu-is-open');const current=q('[class*="__single-value"],[class*="__placeholder"]',container)?.textContent;qa('.disco-select__option',menu).forEach(option=>{option.className='disco-select__option css-yt9ioa-option';option.setAttribute('role','option');option.setAttribute('aria-selected',String(option.textContent===current));option.tabIndex=-1;option.addEventListener('mouseenter',()=>{qa('.disco-select__option',menu).forEach(n=>n.className='disco-select__option css-yt9ioa-option');option.className='disco-select__option disco-select__option--is-focused css-1n7v3ny-option'});option.addEventListener('mousedown',e=>{e.preventDefault();const text=option.textContent;let label=q('[class*="__single-value"],[class*="__placeholder"]',container);if(label){label.textContent=text;label.className='disco-select__single-value css-1uccc91-singleValue'}input.value=key==='currencies'?(text.match(/\(([A-Z]{3}),/)?.[1]||'INR'):text;if(input.name==='currency')state.currency=input.value;close();update()})});container.append(menu);if(search)search.focus();};
      control.addEventListener('mousedown',e=>{if(e.target.closest('.disco-select__menu'))return;e.preventDefault();if(q('.disco-select__menu',container))close();else open()});
      control.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close()}if(e.key==='ArrowDown'||e.key==='Enter'){e.preventDefault();if(!q('.disco-select__menu',container))open();else if(e.key==='Enter')q('.disco-select__option:not([hidden])',container)?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))}});
      if(search)search.addEventListener('input',()=>{if(!q('.disco-select__menu',container))open();const term=search.value.toLowerCase();search.style.width=Math.max(2,search.value.length*8)+'px';qa('.disco-select__option',container).forEach(e=>e.hidden=!e.textContent.toLowerCase().includes(term))});
      document.addEventListener('mousedown',e=>{if(!container.contains(e.target))close()});
    });
  }
  function wireRichEditor(root,label){qa('.toastui-editor-tooltip',root).forEach(e=>e.style.display='none');
    const editor=q('.toastui-editor-contents[contenteditable]',root);if(!editor)return;editor.setAttribute('role','textbox');editor.setAttribute('aria-label',label);let selection;
    const remember=()=>{const range=getSelection();if(range?.rangeCount&&editor.contains(range.anchorNode))selection=range.getRangeAt(0).cloneRange()};editor.addEventListener('keyup',remember);editor.addEventListener('mouseup',remember);
    qa('.toastui-editor-toolbar button',root).forEach(button=>{if(button.dataset.localEditorReady)return;button.dataset.localEditorReady='true';button.addEventListener('mousedown',e=>e.preventDefault());button.addEventListener('click',e=>{e.preventDefault();editor.focus();if(selection){const range=getSelection();range.removeAllRanges();range.addRange(selection)}const commands={bold:'bold',italic:'italic',strike:'strikeThrough','bullet-list':'insertUnorderedList','ordered-list':'insertOrderedList',hrline:'insertHorizontalRule',quote:'formatBlock'};const kind=Object.keys(commands).find(name=>button.classList.contains(name));if(kind)document.execCommand(commands[kind],false,kind==='quote'?'blockquote':null);if(button.classList.contains('more')){const menu=q('.toastui-editor-dropdown-toolbar',root);if(menu)menu.style.display=menu.style.display==='none'?'flex':'none'}remember();update()})});
    const close=q('[aria-label="Close editor"]',root);if(close)close.addEventListener('click',()=>{const toolbar=q('.toastui-editor-toolbar',root);if(toolbar)toolbar.style.display=toolbar.style.display==='none'?'':'none';editor.blur()});
  }
  function wireSignature(section){
    const input=q('input[type="file"]',section);if(input&&!input.dataset.sourceSignatureReady){input.dataset.sourceSignatureReady='true';input.name='signature';input.addEventListener('change',()=>{if(!input.files?.[0])return;normalizedImage(input.files[0]).then(setSignature).catch(e=>status(e.message,true))})}
    const upload=q('[data-clickable]',section);if(upload&&!upload.dataset.localUploadReady){upload.dataset.localUploadReady='true';upload.addEventListener('click',()=>input?.click())}
  }
  function setSignature(url){
    const area=q(cl('Signature_wrapper'),form),target=q('[data-clickable]',area);if(!target)return;const image=new Image();image.src=url;image.alt='Signature';image.dataset.sourceSignature='true';image.style.cssText='max-width:100%;max-height:140px;object-fit:contain';target.replaceChildren(image);update();
  }
  async function signaturePad(){
    const overlay=await sourceOverlay(extras['signature-pad'],'extras-source.css','Draw Signature'),canvas=q('canvas',overlay);const width=Math.floor(canvas.getBoundingClientRect().width);canvas.width=width;canvas.height=Math.floor(width*9/16);canvas.style.width=width+'px';canvas.style.height=canvas.height+'px';const context=canvas.getContext('2d');let drawing=false;
    const placeholder=qa('span,div',overlay).find(e=>e.textContent.trim()==='Draw your Signature Here'&&e.children.length===0);context.lineWidth=2;context.lineCap='round';context.lineJoin='round';
    const point=e=>{const rect=canvas.getBoundingClientRect();return[(e.clientX-rect.left)*canvas.width/rect.width,(e.clientY-rect.top)*canvas.height/rect.height]};
    canvas.addEventListener('pointerdown',e=>{e.preventDefault();drawing=true;canvas.setPointerCapture(e.pointerId);context.beginPath();context.moveTo(...point(e));if(placeholder)placeholder.style.visibility='hidden'});canvas.addEventListener('pointermove',e=>{if(!drawing)return;e.preventDefault();context.lineTo(...point(e));context.stroke()});canvas.addEventListener('pointerup',()=>drawing=false);canvas.addEventListener('pointercancel',()=>drawing=false);
    qa('button',overlay).forEach(button=>{const text=button.textContent.trim();if(text==='Cancel')button.addEventListener('click',overlay.closeSource);if(text==='Reset')button.addEventListener('click',()=>{context.clearRect(0,0,canvas.width,canvas.height);if(placeholder)placeholder.style.visibility='' });if(text==='Upload Signature')button.addEventListener('click',()=>{setSignature(canvas.toDataURL('image/png'));overlay.closeSource()})});
  }
  async function cessDialog(){
    const overlay=await sourceOverlay(extras.cessDialog,'extras-source.css','Configure Additional Cess');const name=q('[name="cessName"]',overlay);if(state.cess?.name)name.value=state.cess.name;
    qa('button',overlay).forEach(button=>{const text=button.textContent.trim();if(text==='Cancel')button.addEventListener('click',overlay.closeSource);if(text==='Save')button.addEventListener('click',()=>{state.cess={name:name.value,type:q('[name="cessType"]',overlay)?.value||'CENTRAL'};overlay.closeSource();saveDraft()})});
  }
  function showCalendar(input){
    qa('.react-datepicker-popper[data-local-calendar]',document).forEach(e=>e.remove());const popup=sanitize(parse(extras.calendar));popup.dataset.localCalendar='true';popup.classList.add('gnxKCA');popup.style.cssText='position:absolute;width:auto;z-index:1201;transform:none;';
    const parsed=new Date(input.value),selected=Number.isFinite(parsed.getTime())?parsed:new Date();let year=selected.getFullYear(),month=selected.getMonth();document.body.append(popup);
    const position=()=>{const rect=(input.closest('.react-datepicker-wrapper')||input).getBoundingClientRect(),width=popup.getBoundingClientRect().width||314;popup.style.left=Math.max(8,Math.min(Math.floor(rect.left+(rect.width-width)/2),innerWidth-width-8))+scrollX+'px';popup.style.top=rect.bottom+scrollY+'px';};
    const close=()=>{popup.remove();document.removeEventListener('mousedown',outside);document.removeEventListener('keydown',key)};const outside=e=>{if(e.target!==input&&!popup.contains(e.target))close()};const key=e=>{if(e.key==='Escape')close()};
    const render=()=>{const weeks=q('.react-datepicker__month',popup),week=q('.react-datepicker__week',popup).cloneNode(false),day=q('.react-datepicker__day',popup).cloneNode(false);weeks.replaceChildren();const first=new Date(year,month,1),start=new Date(year,month,1-first.getDay()),last=new Date(year,month+1,0);let date=new Date(start);while(date<=last||date.getDay()!==0){const row=week.cloneNode(false);for(let index=0;index<7;index++){const current=new Date(date),item=day.cloneNode(false);item.textContent=current.getDate();item.className='react-datepicker__day react-datepicker__day--'+String(current.getDate()).padStart(3,'0');if(current.getMonth()!==month)item.classList.add('react-datepicker__day--outside-month');if(current.getDay()===0||current.getDay()===6)item.classList.add('react-datepicker__day--weekend');if(current.toDateString()===selected.toDateString())item.classList.add('react-datepicker__day--selected');if(current.toDateString()===new Date().toDateString())item.classList.add('react-datepicker__day--today');item.setAttribute('role','button');const dayNumber=current.getDate(),ordinal=(dayNumber%100>=11&&dayNumber%100<=13)?'th':({1:'st',2:'nd',3:'rd'}[dayNumber%10]||'th');item.setAttribute('aria-label','Choose '+new Intl.DateTimeFormat('en-US',{weekday:'long'}).format(current)+', '+new Intl.DateTimeFormat('en-US',{month:'long'}).format(current)+' '+dayNumber+ordinal+', '+current.getFullYear());item.tabIndex=0;const choose=()=>{input.value=new Intl.DateTimeFormat('en-US',{month:'short',day:'2-digit',year:'numeric'}).format(current);input.dispatchEvent(new Event('input',{bubbles:true}));close()};item.addEventListener('click',choose);item.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose()}});row.append(item);date.setDate(date.getDate()+1)}weeks.append(row)}for(const [selector,text]of [['[aria-controls="disco-datepicker-month-menu"]',new Intl.DateTimeFormat('en-US',{month:'short'}).format(new Date(year,month,1)).toUpperCase()],['[aria-controls="disco-datepicker-year-menu"]',String(year)]]){const button=q(selector,popup);const node=q('span',button)||[...button.childNodes].find(e=>e.nodeType===3);if(node){if(node.nodeType===3)node.nodeValue=text;else node.textContent=text}}position()};
    for(const kind of ['month','year']){const button=q('[aria-controls="disco-datepicker-'+kind+'-menu"]',popup);button.addEventListener('click',()=>{const existing=q('#disco-datepicker-'+kind+'-menu',popup);qa('[role="menu"]',popup).forEach(e=>e.remove());qa('[aria-controls]',popup).forEach(e=>e.setAttribute('aria-expanded','false'));if(existing)return;const menu=parse(extras.calendarMenus[kind]);button.setAttribute('aria-expanded','true');qa('[role="menuitemradio"]',menu).forEach((option,index)=>{const selected=kind==='month'?index===month:Number(option.textContent)===year;option.setAttribute('aria-checked',String(selected));option.className='sc-hUZldv '+(selected?'bEmKEa':'gMZjyC');option.addEventListener('click',()=>{if(kind==='month')month=index;else year=Number(option.textContent);menu.remove();button.setAttribute('aria-expanded','false');render()})});button.parentElement.append(menu);if(kind==='year')q('[aria-checked="true"]',menu)?.scrollIntoView({block:'center'})})}
    q('[aria-label="Previous month"]',popup).addEventListener('click',()=>{month--;if(month<0){month=11;year--}render()});q('[aria-label="Next month"]',popup).addEventListener('click',()=>{month++;if(month>11){month=0;year++}render()});render();setTimeout(()=>{document.addEventListener('mousedown',outside);document.addEventListener('keydown',key)},0);
  }
  function prepareDates(){
    qa('input[name="invoiceDate"],input[name="dueDate"]',form).forEach(input=>{if(input.dataset.dateReady)return;input.dataset.dateReady='true';input.addEventListener('click',()=>showCalendar(input));const wrapper=input.closest('.react-datepicker__input-container');q('button',wrapper)?.addEventListener('click',()=>showCalendar(input))});
  }
  function changed(e){
    const input=e.target;
    if(input.dataset.allItemDiscount!==undefined){state.discount=Math.max(0,finite(input.value));qa('input[name$=".discount.amount"]',form).forEach(e=>e.value=state.discount)}
    if(input.type==='file'&&input.closest('[data-source-attachments]')){const section=input.closest('[data-source-attachments]');qa('[data-attachment-name]',section).forEach(e=>e.remove());for(const file of input.files||[]){const line=document.createElement('span');line.className='sc-kCuUfV gEdDqI';line.dataset.attachmentName=file.name;line.textContent=file.name;section.append(line)}update();return}
    if(input.type==='file'&&input.name!=='signature'&&input.name!=='attachments'&&input.files?.length){normalizedImage(input.files[0]).then(src=>{if(input.name==='logo'){setBusinessLogo(src);return}const image=new Image();image.src=src;image.alt='Item image';image.style.cssText='max-width:150px;max-height:110px;object-fit:contain';const area=input.closest('[class*="itemImageUploadWrapper"]')||input.parentElement;q('img[data-local-upload]',area)?.remove();image.dataset.localUpload='true';area.prepend(image);update()}).catch(e=>status(e.message,true))}
    if(input.name==='showTotalsRow'){if(input.nextElementSibling)input.nextElementSibling.className='sc-ezuuWm '+(input.checked?'RXXMG':'iXxWJx')}
    if(input.closest(cl('ShippingDetails_shippingCheckboxWrapper'))){
      const after=input.closest(cl('ShippingDetails_shippingCheckboxWrapper'));if(input.nextElementSibling)input.nextElementSibling.className='sc-ezuuWm '+(input.checked?'iegBmO':'egubbp');
      qa('[data-source-shipping]',form).forEach(e=>e.remove());
      if(input.checked){let reference=after;for(const html of (layout()==='mobile'?extras.shippingMobile:extras.shipping)){const section=sanitize(adapt(parse(html),layout()));section.dataset.sourceShipping='true';reference.after(section);reference=section}prepareSelects()}
    }
    const shipping=input.closest('[data-source-shipping]');
    if(shipping&&input.type==='checkbox'){
      const source=input.closest('label')?.textContent.includes('your business')?'billedBy':'billedTo';const target=source==='billedBy'?'shippedFrom':'shippedTo';
      if(input.checked){for(const field of ['name','street','city','pincode','country','state']){const from=value(source+'.'+(field==='state'?'gstState':field)),to=q(`[name="${target}.${field}"]`,form);if(to){to.value=from;const label=q('.disco-select__single-value,.disco-select__placeholder',to.closest('.disco-select'));if(label&&from){label.textContent=from;label.className=label.className.replace('__placeholder','__single-value')}}}update()}
    }
    update();
  }
  function reindex(){qa(cl('LineItems_lineItemContainer'),form).forEach((row,index)=>{qa('[name]',row).forEach(e=>e.name=e.name.replace(/items\[\d+\]/,`items[${index}]`));const serial=q('.single-lineitem',row);if(serial)serial.style.setProperty('--item-number',index+1);qa('[id]',row).forEach(e=>e.id=e.id.replace(/-\d+$/,`-${index}`))})}
  function addLine(after,duplicate=false){
    const row=(after&&duplicate?after:originalLine).cloneNode(true);
    if(!duplicate){qa('input',row).forEach(e=>{if(e.name.endsWith('.name'))e.value='Item Name';else if(e.name.endsWith('.quantity')||e.name.endsWith('.rate'))e.value='1';else if(e.name.endsWith('.gstRate'))e.value='18';else if(e.type!=='hidden'&&e.type!=='file')e.value=''});const name=q('[data-item-name],.disco-select-creatable__single-value',row);if(name)name.textContent='Item Name';qa('.toastui-editor-contents[contenteditable]',row).forEach(e=>e.textContent='')}
    if(after)after.after(row);else q(cl('LineItems_lineItemContainer'),form).parentElement.append(row);
    qa('[data-local-select-ready],[data-item-select-ready]',row).forEach(e=>{e.removeAttribute('data-local-select-ready');e.removeAttribute('data-item-select-ready')});qa('.fHnneQ',row).forEach(e=>e.dataset.currencySign='true');reindex();prepareNames();prepareSelects();update();
  }
  function optional(button,key){
    if(!templates[key])return;const e=adapt(parse(templates[key]),layout());
    if(key==='dueDate'){button.closest(cl('Headers_fieldRowLg')).replaceWith(e);prepareDates()}
    else if(key.includes('.')){const card=button.closest(cl('BusinessDetails_cardWrapper'));const grid=q(':scope > div',card)||card;grid.append(e);button.remove()}
    else{q(cl('FormButtons_buttonWrapper'),form).before(e);button.remove();if(key==='notes'){qa('.ProseMirror',e).forEach(n=>n.setAttribute('contenteditable','true'));wireRichEditor(e,'Additional Notes')}}
    prepareNames();prepareSelects();update();
  }
  function customFields(button){
    const current=button.closest(cl('CustomFieldsContainer_addRow'));if(!current)return;const select=sanitize(parse(extras.customSelect));select.dataset.sourceAddRow=current.outerHTML;current.replaceWith(select);select.dataset.sourceCustom='true';
    
  }
  async function customDialog(select){
    const overlay=await sourceOverlay(extras.customDialog,'extras-source.css','Add Custom Field');const label=q('input[placeholder="Enter field label"]',overlay),field=q('[name="newFieldValue"]',overlay);const save=qa('button',overlay).find(e=>e.textContent.trim()==='Save');
    label.addEventListener('input',()=>{save.disabled=!label.value.trim();save.classList.toggle('VXhYA',save.disabled);save.classList.toggle('kezjCO',!save.disabled)});
    qa('button',overlay).forEach(button=>{if(button.textContent.trim()==='Cancel')button.addEventListener('click',overlay.closeSource)});
    save.addEventListener('click',()=>{if(!label.value.trim())return;const container=select.previousElementSibling;let row;if(extras.customResult){row=parse(extras.customResult);if(row.className.includes('CustomFieldsContainer_fieldWrapper'))row=row.firstElementChild}else{row=q(cl('Headers_fieldWithError'),form).cloneNode(true);qa('button',row).forEach(e=>e.remove())}
      qa('input',row).forEach(input=>{input.value=field.value;input.name='customHeaders['+qa('[data-source-custom-field]',form).length+'].value';input.placeholder=''});const text=q('label,[name$=".label"]',row);if(text)text.textContent=label.value.trim();row.dataset.sourceCustomField='true';container?.append(row);overlay.closeSource();if(select.dataset.sourceAddRow)select.replaceWith(parse(select.dataset.sourceAddRow));else q('.disco-select__menu',select)?.remove();update()});
  }
  function clicked(e){
    const customControl=e.target.closest('[data-source-custom] .disco-select__control');if(customControl){const select=customControl.closest('[data-source-custom]');const menu=q('.disco-select__menu',select);if(menu)menu.remove();else q('.disco-select',select)?.append(q('.disco-select__menu',parse(extras.customSelect)));return}
    const button=e.target.closest('button');if(!button)return;const label=(button.getAttribute('aria-label')||button.textContent).trim().replace(/\s+/g,' ');const row=button.closest(cl('LineItems_lineItemContainer'));
    if(label==='Save & Continue'){e.preventDefault();continueSignup();return}
    if(label==='Add New Line'){addLine();return}
    if(label==='Duplicate Item'){addLine(row,true);return}
    if(label==='Remove Item'){if(qa(cl('LineItems_lineItemContainer'),form).length>1){row.remove();reindex();update()}return}
    if(label==='Add due date'){optional(button,'dueDate');return}
    if(label==='Add Email'||label==='Add PAN'){const party=button.closest(cl('BusinessDetails_billerContainer'))?'billedBy':'billedTo';optional(button,party+'.'+(label==='Add Email'?'email':'panNumber'));return}
    const optionalButtons={'Add Notes':'notes','Add Terms & Conditions':'terms','Add Additional Info':'additional','Add Contact Details':'contact'};if(optionalButtons[label]){optional(button,optionalButtons[label]);return}
    if(label==='Add More Fields'&&button.closest('[data-source-shipping]')){let card=button.parentElement;while(card&&!q('input[name^="shippedFrom."],input[name^="shippedTo."]',card))card=card.parentElement;const from=Boolean(q('input[name^="shippedFrom."]',card)),prefix=from?'shippedFrom':'shippedTo',row=sanitize(parse(extras[from?'shippingMoreFrom':'shippingMoreTo']));const index=qa('input[name^="'+prefix+'.customHeaders"][name$=".label"]',card).length;qa('[name]',row).forEach(input=>input.name=input.name.replace(/customHeaders\[\d+\]/,'customHeaders['+index+']'));button.before(row);q('button',row)?.addEventListener('click',()=>{row.remove();update()});q('input',row)?.focus();update();return}
    if(label==='Add Mode of Transport'){const html=extras.shippingMenus?.['transportDetails.transportMode']?.field;if(html){const field=sanitize(parse(html));qa('.disco-select__menu',field).forEach(e=>e.remove());button.replaceWith(field);prepareSelects();update()}return}
    if(label==='Add Custom Fields'){customFields(button);return}
    if(label==='Add New Custom Field'){customDialog(button.closest(cl('CustomFieldsContainer_addRow')));return}
    if(button.className.includes('CustomFieldsContainer_cancelButton')){button.closest(cl('CustomFieldsContainer_formInputRow'))?.parentElement.remove();update();return}
    if(label==='Add Description'){const cell=button.closest(cl('LineItems_lineItemDescriptionCell'));const editor=sanitize(parse(extras[layout()==='mobile'?'description-mobile':'description']));cell.replaceWith(editor);wireRichEditor(editor,'Description');update();return}
    if(label==='Add Thumbnail'||label==='Add Image'||label==='Upload Image'){const cell=button.closest(cl('LineItems_lineItemImageCell'));q('input[type="file"]',cell)?.click();return}
    if(label.startsWith('Add Business Logo')){q('input[name="logo"]',form)?.click();return}
    if(label==='Add Attachments'){const section=sanitize(parse(extras.attachments));section.dataset.sourceAttachments='true';q(cl('FormButtons_buttonWrapper'),form).before(section);button.remove();update();return}
    if(label==='Remove Attachments'){button.closest('[data-source-attachments]')?.remove();if(templates.attachmentsButton){const group=q('[data-test-id="add-additional-info-btn"]',form)?.parentElement||q('[class*="ButtonGroup_wrapper"]',form);const restored=parse(templates.attachmentsButton),additional=q('[data-test-id="add-additional-info-btn"]',group);if(additional)additional.before(restored);else group?.append(restored)}update();return}
    if(button.closest('[data-source-attachments]')){q('input[type="file"]',button.closest('[data-source-attachments]'))?.click();return}
    if(label==='Add Signature'){const old=q(cl('Signature_wrapper'),form),section=sanitize(parse(extras.signature));old.replaceWith(section);wireSignature(section);update();return}
    if(label==='Use Signature Pad'){signaturePad();return}
    if(label==='Upload Signature'){q('input[type="file"]',button.closest(cl('Signature_wrapper')))?.click();return}
    if(button.closest(cl('Signature_signatureHeader'))){const area=button.closest(cl('Signature_wrapper'));const clean=parse(templates.signatureButton||'<div></div>');if(templates.signatureButton)area.replaceWith(clean);else area.remove();update();return}
    if(label==='Add Transport Document Number'||label==='Add Transport Doc No.'){const field=document.createElement('label');field.className='independent-extra-field';field.textContent='Transport document number';const input=document.createElement('input');input.name='transportDetails.documentNumber';input.placeholder='Transport document number';field.append(input);button.replaceWith(field);input.focus();update();return}
    if(label==='Remove Notes'){const note=button.closest(cl('Notes_wrapper'));if(note)note.remove();else{let block=button.parentElement;while(block.parentElement&&block.parentElement!==form)block=block.parentElement;block.remove()}restoreOptionalButton('Add Notes');update();return}
    if(label==='Remove Term'){const term=button.closest('.css-rxk9pl')||button.parentElement;if(q('input',term)){term.remove();update()}return}
    if(label==='Add New Group'){const wrapper=button.parentElement;const group=document.createElement('div');group.className='independent-term-group';group.innerHTML='<label>Group title<input name="termGroupTitle" value="Additional terms"></label><input name="terms[1].terms[0]" placeholder="Enter a term">';wrapper.before(group);update();return}
    if(label==='Add New Term'){const input=q('input[name^="terms["]',form);if(input){const clone=input.closest('.css-rxk9pl')?.cloneNode(true)||input.cloneNode();const text=q('input',clone)||clone;text.value='';text.name='terms[0].terms['+qa('input[name^="terms["]',form).length+']';button.before(clone);text.focus();update()}return}
    if(label==='Add Discounts'){discountDialog();return}
    if(label==='Edit GST'){taxDialog();return}
    if(label==='Remove GST'){state.taxType='NONE';qa('input[name$=".gstRate"]',form).forEach(input=>input.value='0');update();return}
    if(button.id.startsWith('show-pdf-visibility')){const section=button.closest(cl('InvoiceBalance_totalSectionWrapper'));const box=q(cl('InvoiceBalance_hideTotalsWrapper'),section);box?.classList.toggle('InvoiceBalance_hidden__XCD0G');button.setAttribute('aria-pressed',String(box?.classList.contains('InvoiceBalance_hidden__XCD0G')));update();return}
    if(label==='Edit Columns/Formulas'){columnDialog();return}
    if((label==='Fixed'||label==='%')&&button.closest(cl('InvoiceBalance_discountButtonGroup'))){state.discountType=label==='%'?'percent':'amount';qa(cl('InvoiceBalance_discountButton'),form).forEach(b=>b.classList.toggle('InvoiceBalance_buttonSelected__VdQse',b===button));qa('input[name$=".discount.discountType"]',form).forEach(input=>input.value=state.discountType==='percent'?'PERCENTAGE':'FIXED');update();return}
    if(label==='Remove Discount'){qa('input[name$=".discount.amount"]',form).forEach(input=>input.value='0');const all=q('[data-all-item-discount]',form);if(all)all.value='0';update();return}
  }
  async function sourceOverlay(name,cssName,label){
    await loadStyle(cssName);
    const html=name.trim().startsWith('<')?name:await fetch(base+name).then(r=>{if(!r.ok)throw new Error('Unable to load '+label);return r.text()});
    const overlay=sanitize(parse(html));overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label',label);
    const previous=document.activeElement,oldOverflow=document.documentElement.style.overflow;document.documentElement.style.overflow='hidden';document.body.append(overlay);overlay.addEventListener('change',e=>{if(e.target.type==='checkbox'&&e.target.nextElementSibling?.className.includes('sc-ezuuWm'))e.target.nextElementSibling.className='sc-ezuuWm '+(e.target.checked?'RXXMG':'iXxWJx')});
    const close=()=>{document.removeEventListener('keydown',key);document.documentElement.style.overflow=oldOverflow;overlay.remove();previous?.focus()};
    const key=e=>{if(qa('[role="dialog"]').at(-1)!==overlay)return;if(e.key==='Escape'){e.preventDefault();close()}if(e.key==='Tab'){const fields=qa('button,input,select,textarea,a[href],[tabindex="0"]',overlay).filter(e=>!e.disabled&&e.getClientRects().length);if(!fields.length)return;const first=fields[0],last=fields[fields.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};
    document.addEventListener('keydown',key);q('.cYoVIW',overlay)?.addEventListener('click',close);const first=q('button',overlay);if(first){first.setAttribute('aria-label','Close');first.addEventListener('click',close);first.focus()}
    overlay.closeSource=close;return overlay;
  }
  async function taxDialog(){
    const overlay=await sourceOverlay('tax-dialog.html','dynamic-source.css','Configure Tax');let taxType=state.taxType;
    const tags=qa('[role="radio"]',overlay);const selectType=tag=>{taxType=tag.title==='GST (India)'?'GST':tag.title;tags.forEach(t=>{const selected=t===tag;t.setAttribute('aria-checked',String(selected));t.classList.toggle('InvoiceTypeAndCurrency_chipTagSelected__4slqW',selected)})};
    tags.forEach(tag=>{if((tag.title==='GST (India)'?'GST':tag.title)===taxType)selectType(tag);tag.addEventListener('click',()=>selectType(tag));tag.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectType(tag)}})});
    qa('input[type="radio"]',overlay).forEach(input=>{input.name='source-gst-mode';input.checked=input.value===(state.gstMode==='split'?'cgst':'igst');input.addEventListener('change',()=>qa('input[type="radio"]',overlay).forEach(r=>{const ring=r.nextElementSibling;if(ring)ring.className='sc-gLivYR '+(r.checked?'etTtLK':'gRDnP')}))});
    const supply=q('input[name="placeOfSupply"]',overlay);if(supply&&selectTemplates.states){const container=supply.closest('.disco-select'),control=q('.disco-select__control',container);control.tabIndex=0;control.addEventListener('click',()=>{if(q('.disco-select__menu',container)){q('.disco-select__menu',container).remove();return}const menu=parse(selectTemplates.states.menu);qa('.disco-select__option',menu).forEach(option=>option.addEventListener('click',e=>{e.stopPropagation();q('.disco-select__single-value',container).textContent=option.textContent;supply.value=option.textContent;menu.remove()}));container.append(menu)})}
    qa('button',overlay).forEach(button=>{const label=button.textContent.trim();if(label==='Cancel')button.addEventListener('click',overlay.closeSource);if(label==='Save Changes')button.addEventListener('click',()=>{state.taxType=taxType;state.gstMode=q('input[type="radio"]:checked',overlay)?.value==='igst'?'igst':'split';state.placeOfSupply=supply?.value;state.reverseCharge=q('input[type="checkbox"]',overlay)?.checked||false;if(taxType!=='NONE')qa('input[name$=".gstRate"]',form).forEach(input=>{if(!finite(input.value))input.value=18});overlay.closeSource();update()});if(label==='Add Cess')button.addEventListener('click',()=>cessDialog())});
  }
  function discountDialog(){
    const holder=q(cl('InvoiceBalance_totalDiscountWrapper'),form);if(!holder)return;
    const existing=q(cl('InvoiceBalance_discountDropdownWrapper'),holder);if(existing){existing.remove();return}
    const dropdown=parse('<div class="InvoiceBalance_discountDropdownWrapper__77xQF"><div class="InvoiceBalance_discountOption__F__y2" id="item-wise-discount"><button variant="neutral" data-test-id="item-wise-discount-btn" type="button" data-ignore-dir="ltr" data-layout="horizontal" class="sc-jaXbil ktZcZP">Give Item Wise Discount</button></div></div>');holder.append(dropdown);q('button',dropdown).addEventListener('click',()=>{dropdown.remove();enableDiscounts()});
  }
  function enableDiscounts(){
    const old=q('.invoice-lineitems-wrapper',form);const rows=qa(cl('LineItems_lineItemContainer'),old).map(row=>({inputs:qa('input[name]',row).map(i=>({suffix:i.name.replace(/^items\[\d+\]\./,''),value:i.value})),description:q('.toastui-editor-contents[contenteditable]',row)?.innerHTML||q('textarea',row)?.value||''}));
    const block=adapt(parse(discountSource.lines),layout()),template=q(cl('LineItems_lineItemContainer'),block).cloneNode(true),parent=q(cl('LineItems_lineItemContainer'),block).parentElement;parent.replaceChildren();
    rows.forEach(data=>{const row=template.cloneNode(true);data.inputs.forEach(({suffix,value})=>{const field=q(`input[name$=".${CSS.escape(suffix)}"]`,row);if(field)field.value=value});const label=q('.disco-select-creatable__single-value',row);if(label)label.textContent=data.inputs.find(i=>i.suffix==='name')?.value||'Item Name';if(data.description){const cell=q(cl('LineItems_lineItemDescriptionCell'),row),editor=sanitize(parse(extras[layout()==='mobile'?'description-mobile':'description']));q('.toastui-editor-contents[contenteditable]',editor).innerHTML=data.description;cell.replaceWith(editor);wireRichEditor(editor,'Description')}parent.append(row)});old.replaceWith(block);
    const balance=parse(discountSource.balance);q(cl('InvoiceBalance_balanceWrapper'),form).replaceWith(balance);const all=q(cl('InvoiceBalance_itemWiseDiscountWrapper'),balance);const amount=q('input[type="number"]',all);if(amount){amount.dataset.allItemDiscount='true';amount.name='allItemDiscount';amount.min='0'}
    const options=qa(cl('InvoiceBalance_discountButton'),balance);state.discountType='percent';options.forEach(button=>button.addEventListener('click',()=>{state.discountType=button.textContent.trim()==='%'?'percent':'amount';options.forEach(b=>b.classList.toggle('InvoiceBalance_buttonSelected__VdQse',b===button));qa('input[name$=".discount.discountType"]',form).forEach(e=>e.value=state.discountType==='percent'?'PERCENTAGE':'FIXED');update()}));
    q('button[aria-label="Remove Discount"]',balance)?.addEventListener('click',()=>{qa('input[name$=".discount.amount"]',form).forEach(input=>input.value='0');if(amount)amount.value='0';update()});
    originalLine=template.cloneNode(true);reindex();prepareNames();prepareSelects();update();
  }
  async function signupDialog(){location.assign('/services/?service=invoicing')}
  async function columnDialog(){
    const overlay=await sourceOverlay('columns-dialog.html','columns-source.css','Customize Columns & Formulas');const headers=qa(`${cl('LineItems_lineItemHeader')} > span`,form);const original=headers.map(e=>e.textContent.trim());
    const rows=qa('[data-rbd-draggable-id]',overlay);rows.forEach(row=>{const input=q('input[placeholder]',row);if(input){const index=original.indexOf(input.placeholder);if(index>=0)input.value=headers[index].textContent.trim();input.dataset.columnOriginal=input.placeholder}});
    qa('button',overlay).forEach(button=>{const label=button.textContent.trim();if(label==='Cancel')button.addEventListener('click',overlay.closeSource);if(label==='Reset to Default')button.addEventListener('click',()=>qa('input[data-column-original]',overlay).forEach(input=>input.value=input.dataset.columnOriginal));if(label==='Save Changes')button.addEventListener('click',()=>{qa('input[data-column-original]',overlay).forEach(input=>{const index=original.indexOf(input.dataset.columnOriginal);if(index>=0&&input.value.trim()){headers[index].textContent=input.value.trim();qa(cl('LineItems_lineItemContainer'),form).forEach(row=>{const labels=qa(cl('LineItems_lineItemLabel'),row);if(labels[index])labels[index].textContent=input.value.trim()})}});qa('input[data-new-column]',overlay).forEach(input=>{if(input.value.trim())addCustomColumn(input.value.trim())});overlay.closeSource();update()});if(label==='Add New Column')button.addEventListener('click',()=>{const originalRow=rows.find(row=>row.dataset.rbdDraggableId==='hsn');if(originalRow){const row=originalRow.cloneNode(true);row.dataset.rbdDraggableId='custom-'+Date.now();const input=q('input[placeholder]',row);input.placeholder='Column Name';input.value='';delete input.dataset.columnOriginal;input.dataset.newColumn='true';originalRow.parentElement.append(row);input.focus()}})});
  }
  function continueSignup(){previewDocument()}
  function restoreOptionalButton(text){const group=q('[class*="ButtonGroup_wrapper"]',form);if(group&&!qa('button',group).some(b=>b.textContent.trim()===text)){const b=document.createElement('button');b.type='button';b.textContent=text;group.append(b)}}
  function addCustomColumn(label){
    const header=q(cl('LineItems_lineItemHeader'),form);const span=document.createElement('span');span.className='independent-custom-heading';span.textContent=label;header.append(span);
    qa(cl('LineItems_lineItemContainer'),form).forEach((row,i)=>{const cell=document.createElement('label');cell.className='independent-extra-field';cell.textContent=label;const input=document.createElement('input');input.name='items['+i+'].custom.'+label.replace(/[^a-zA-Z0-9]/g,'_');input.dataset.customColumn=label;cell.append(input);row.append(cell)});
  }
  function syncTaxStructure(){
    const none=state.taxType==='NONE',single=state.gstMode==='igst'||state.taxType==='VAT';
    const text=state.taxType==='VAT'?'VAT':state.gstMode==='igst'?'IGST':'CGST';
    qa(cl('LineItems_lineItemHeader')+' > span',form).forEach(e=>{e.dataset.originalLabel ||= e.textContent.trim();const v=e.dataset.originalLabel;if(['GST Rate','CGST','SGST'].includes(v)){e.hidden=none||(single&&v==='SGST');e.style.display=e.hidden?'none':'';e.textContent=v==='GST Rate'?(state.taxType==='VAT'?'VAT Rate':'GST Rate'):v==='CGST'?text:'SGST'}});
    qa(cl('LineItems_lineItemContainer'),form).forEach(row=>{const cells=qa(cl('LineItems_computedField'),row);cells.slice(1,3).forEach((e,i)=>{const cell=e.parentElement;cell.hidden=none||(single&&i===1);cell.style.display=cell.hidden?'none':'';const label=q(cl('LineItems_lineItemLabel'),cell);if(label)label.textContent=i===0?text:'SGST'});const rate=q('input[name$=".gstRate"]',row)?.closest(cl('LineItems_lineItemCell'));if(rate){rate.hidden=none;rate.style.display=none?'none':''}});
    qa(cl('InvoiceBalance_taxRow'),form).forEach((row,i)=>{row.hidden=none||(single&&i>0);row.style.display=row.hidden?'none':'';if(i===0){const label=q('span',row);if(label)label.textContent=state.taxType==='VAT'?'VAT':single?'IGST':'GST'}});
  }
  function dateISO(raw){
    if(!raw)return '';
    let parts=raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/),year,month,day;
    if(parts){year=+parts[1];month=+parts[2];day=+parts[3]}else{parts=raw.trim().match(/^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/);if(!parts)throw Error('Use a valid calendar date, for example Oct 20, 2026');month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(parts[1].toLowerCase())+1;day=+parts[2];year=+parts[3]}
    const d=new Date(Date.UTC(year,month-1,day));if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)throw Error('Enter a real calendar date');return d.toISOString().slice(0,10);
  }
  function getDocument(){
    const party=prefix=>({name:value(prefix+'.name'),street:value(prefix+'.street'),city:value(prefix+'.city'),gstState:value(prefix+'.gstState'),pincode:value(prefix+'.pincode'),country:value(prefix+'.country'),address:[value(prefix+'.street'),value(prefix+'.city'),value(prefix+'.gstState'),value(prefix+'.pincode'),value(prefix+'.country')].filter(Boolean).join(', '),email:value(prefix+'.email'),phone:value(prefix+'.phone'),gstin:value(prefix+'.gstin'),panNumber:value(prefix+'.panNumber')});
    return {type:documentType,template:state.template,brandColor:state.brandColor,bank:state.bank,clientId:state.clientId,number:value('invoiceNumber'),date:dateISO(value('invoiceDate')),dueDate:dateISO(value('dueDate')),currency:state.currency,seller:party('billedBy'),buyer:party('billedTo'),taxType:state.taxType,gstMode:state.gstMode,
      items:qa(cl('LineItems_lineItemContainer'),form).map(row=>{const f=suffix=>q('input[name$=".'+suffix+'"]',row)?.value||'';return{name:f('name'),description:q('.toastui-editor-contents[contenteditable]',row)?.innerText||'',hsn:f('hsn'),quantity:f('quantity'),rate:f('rate'),taxRate:f('gstRate'),discount:f('discount.amount')||0,discountType:f('discount.discountType')==='PERCENTAGE'?'percent':'fixed',customFields:qa('[data-custom-column]',row).map(e=>({label:e.dataset.customColumn,value:e.value}))}}),
      notes:q(cl('Notes_wrapper')+' .toastui-editor-contents[contenteditable]',form)?.innerText||'',terms:qa('input[name^="terms["]',form).map(e=>e.value).filter(Boolean).join('\n'),
      customFields:qa('[data-source-custom-field]',form).map(e=>({label:q('label',e)?.textContent||'Custom field',value:q('input',e)?.value||''})),
      transport:Object.fromEntries(qa('input[name^="transportDetails."]',form).map(e=>[e.name.slice(17),e.value])),
      shipping:Object.fromEntries(qa('[data-source-shipping] input[name]',form).filter(e=>!['file','checkbox'].includes(e.type)).map(e=>[e.name,e.value])),
      taxDetails:{placeOfSupply:state.placeOfSupply||'',reverseCharge:state.reverseCharge?'Yes':'No'},
      attachments:qa('[data-attachment-path]',form).map(e=>({path:e.dataset.attachmentPath,name:e.dataset.attachmentName})),
      editorSnapshot:{html:serializeEditor(),layout:layout()},
      signature:q('img[data-source-signature]',form)?.src||'',logo:q('img[data-business-logo], [class*=logoEditWrapper] img[data-local-upload]',form)?.src||'',status:savedRecord?.data?.status||'draft'};
  }
  function status(text,error=false){const e=q('[data-document-status]');if(e){e.textContent=text;e.setAttribute('role',error?'alert':'status');e.classList.toggle('error',error)}}
  function validate(){
    if(documentLoading||documentLoadError){status(documentLoadError||'Wait for your saved document to load.',true);return false}
    for(const input of qa('input',form))input.setCustomValidity('');
    for(const input of qa('input[name$=".quantity"],input[name$=".rate"],input[name$=".gstRate"],input[name$=".discount.amount"]',form)){
      const n=Number(input.value),isQty=input.name.endsWith('.quantity'),tax=input.name.endsWith('.gstRate');
      if(!input.value.trim()||!Number.isFinite(n)||n<0||(isQty&&n<=0)||(tax&&n>100)){input.setCustomValidity(isQty?'Enter a quantity greater than zero':tax?'Enter a tax rate from 0 to 100':'Enter a non-negative number');input.reportValidity();return false}}
    for(const name of ['invoiceDate','dueDate']){const input=q('[name="'+name+'"]',form);if(input?.value){try{dateISO(input.value)}catch(e){input.setCustomValidity(e.message);input.reportValidity();return false}}}
    return form.reportValidity();
  }
  async function downloadDocument(){if(!validate())return;try{const m=await exportModule,result=await m.download(getDocument());saveDraft();status('Downloaded '+result.filename+(result.warnings.length?' — '+result.warnings.join(' '):''));return result}catch(e){status(e.message,true)}}
  async function previewDocument(){if(!validate())return;try{const m=await exportModule;return await m.preview(getDocument(),template=>{state.template=template;const select=q('[data-pdf-template]');if(select)select.value=template;saveDraft()})}catch(e){status(e.message,true)}}
  async function saveDocument(){if(!validate()||state.documentSaving)return;state.documentSaving=true;form.inert=true;qa('[data-action]',q('[data-document-toolbar]')).forEach(b=>b.disabled=true);status('Saving document…');try{
    await fetch('/api/auth');const workspace=await fetch('/api/workspace').then(r=>r.json());if(!workspace.businesses?.length){status('Sign in and create a business in Workspace before saving. Your draft is kept in this browser.',true);return}
    const data=getDocument();const m=await exportModule;await m.buildWithImages(data);
    const chosen=localStorage.getItem('billing-active-business'),business=workspace.businesses.some(b=>b.id===chosen)?chosen:workspace.businesses[0].id;
    if(savedRecord&&savedRecord.business_id!==business)throw Error('This document belongs to a different business. Select its business in Workspace before saving.');
    const pending=qa('[data-source-attachments] input[type=file]',form).flatMap(e=>[...(e.files||[])]);
    for(const file of pending){const upload=new FormData();upload.set('business',business);upload.set('file',file);const r=await fetch('/api/files',{method:'POST',body:upload});const result=await r.json();if(!r.ok)throw Error(result.error);const line=qa('[data-attachment-name]',form).find(e=>e.dataset.attachmentName===file.name&&!e.dataset.attachmentPath);if(line){line.dataset.attachmentPath=result.path;const link=document.createElement('a');link.href='/api/files?'+new URLSearchParams({path:result.path});link.textContent=file.name;link.target='_blank';line.replaceChildren(link)}}
    qa('[data-source-attachments] input[type=file]',form).forEach(e=>e.value='');
    data.attachments=qa('[data-attachment-path]',form).map(e=>({path:e.dataset.attachmentPath,name:e.dataset.attachmentName}));data.editorSnapshot={html:serializeEditor(),layout:layout()};
    const payload={business,collection:'documents',demo:isDemo,data,...(savedRecord?{id:savedRecord.id,version:savedRecord.version}:{})};
    const response=await fetch('/api/records',{method:savedRecord?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const body=await response.json();if(!response.ok)throw Error(body.error);savedRecord=body.record;saveDraft();status('Saved '+data.number+' to your Supabase business.'+(isDemo?' Demo record.':''));return savedRecord;
    }catch(e){status(e.message,true)}finally{state.documentSaving=false;form.inert=false;qa('[data-action]',q('[data-document-toolbar]')).forEach(b=>b.disabled=false)}}
  function setValue(name,value){const e=q('[name="'+name+'"]',form);if(e){e.value=value;const container=e.closest('.disco-select');const label=container&&q('.disco-select__single-value,.disco-select__placeholder',container);if(label&&value)label.textContent=value}}
  function applyDocument(doc){
    state.template=doc.template||'classic';state.brandColor=doc.brandColor||'#6040a0';state.bank=doc.bank||null;state.clientId=doc.clientId||null;const design=q('[data-pdf-template]');if(design)design.value=state.template;state.currency=doc.currency||'INR';state.taxType=doc.taxType||'GST';state.gstMode=doc.gstMode||'split';
    state.placeOfSupply=doc.taxDetails?.placeOfSupply||'';state.reverseCharge=doc.taxDetails?.reverseCharge==='Yes';
    if(typeof doc.editorSnapshot?.html==='string'&&doc.editorSnapshot.html.length<350000){const restored=sanitize(parse(doc.editorSnapshot.html));if(q('form',restored)&&q('[name=invoiceNumber]',restored)){adapt(restored,layout());form.parentElement.replaceWith(restored);form=q('form',restored);bindForm();setupToolbar();update();return}}
    setValue('invoiceNumber',doc.number);setValue('invoiceDate',doc.date);if(doc.dueDate){const add=qa('button',form).find(b=>b.textContent.trim()==='Add due date');if(add)optional(add,'dueDate');setValue('dueDate',doc.dueDate)}
    for(const [prefix,party]of [['billedBy',doc.seller],['billedTo',doc.buyer]]){qa('input[name^="'+prefix+'."]',form).forEach(e=>e.value='');for(const key of ['email','panNumber'])if(party?.[key]&&!q('[name="'+prefix+'.'+key+'"]',form)){const card=q('[name="'+prefix+'.name"]',form)?.closest(cl('BusinessDetails_cardWrapper'));const add=card&&qa('button',card).find(b=>b.textContent.trim()===(key==='email'?'Add Email':'Add PAN'));if(add)optional(add,prefix+'.'+key)}for(const [key,v]of Object.entries(party||{}))if(key!=='address')setValue(prefix+'.'+key,v);if(!party?.street)setValue(prefix+'.street',party?.address||'')}
    let rows=qa(cl('LineItems_lineItemContainer'),form);while(rows.length<doc.items.length){addLine();rows=qa(cl('LineItems_lineItemContainer'),form)}rows.slice(doc.items.length).forEach(r=>r.remove());
    if(doc.items.some(i=>Number(i.discount)>0)&&!q('input[name$=".discount.amount"]',form))enableDiscounts();
    rows=qa(cl('LineItems_lineItemContainer'),form);doc.items.forEach((item,i)=>{const row=rows[i];for(const [key,v]of Object.entries({name:item.name,hsn:item.hsn||'',quantity:item.quantity,rate:item.rate,gstRate:item.taxRate,'discount.amount':item.discount||0,'discount.discountType':item.discountType==='percent'?'PERCENTAGE':'FIXED'})){const input=q('input[name$=".'+key+'"]',row);if(input)input.value=v}const name=q('.disco-select-creatable__single-value',row);if(name)name.textContent=item.name;if(item.description){const cell=q(cl('LineItems_lineItemDescriptionCell'),row);if(cell&&!q('[contenteditable]',cell)){const editor=sanitize(parse(extras[layout()==='mobile'?'description-mobile':'description']));cell.replaceWith(editor);wireRichEditor(editor,'Description')}const editor=q('.toastui-editor-contents[contenteditable]',row);if(editor)editor.textContent=item.description}});
    for(const [key,text,label]of [['notes',doc.notes,'Add Notes'],['terms',doc.terms,'Add Terms & Conditions']]){if(!text)continue;const add=qa('button',form).find(b=>b.textContent.trim()===label);if(add)optional(add,key);if(key==='notes'){const editor=q(cl('Notes_wrapper')+' .toastui-editor-contents[contenteditable]',form);if(editor)editor.textContent=text}else{const lines=text.split('\n');const first=q('input[name^="terms["]',form);qa('input[name^="terms["]',form).forEach(e=>e.value='');if(first){first.value=lines[0];for(const line of lines.slice(1)){const clone=first.cloneNode();clone.name='terms[0].terms['+qa('input[name^="terms["]',form).length+']';clone.value=line;first.parentElement.append(clone)}}}}
    setValue('currency',state.currency);if(doc.logo)setBusinessLogo(doc.logo);reindex();applyDocumentLabels();update();
  }
  async function applyBusinessDefaults(){
    documentLoading=true;form.inert=true;qa('[data-action]',q('[data-document-toolbar]')).forEach(b=>b.disabled=true);
    try{await fetch('/api/auth');const workspace=await fetch('/api/workspace').then(r=>r.json());const selected=localStorage.getItem('billing-active-business'),business=workspace.businesses?.find(b=>b.id===selected)||workspace.businesses?.[0];if(!business)return;localStorage.setItem('billing-active-business',business.id);const response=await fetch('/api/documents/number',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({business:business.id})});const numbered=await response.json();if(!response.ok)throw Error(numbered.error);const first=q(cl('LineItems_lineItemContainer'),form);applyDocument({number:numbered.number,date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date()),currency:business.currency,taxType:documentType==='delivery-challan'?'NONE':Number(business.default_tax_rate)>0?'GST':'NONE',seller:documentType==='purchase-order'?{name:''}:{name:business.name,address:business.address,email:business.email,phone:business.phone,gstin:business.gstin,panNumber:business.pan},buyer:documentType==='purchase-order'?{name:business.name,address:business.address,email:business.email,phone:business.phone,gstin:business.gstin,panNumber:business.pan}:{name:''},items:[{name:'Item Name',quantity:1,rate:0,taxRate:business.default_tax_rate||0}],notes:business.default_notes,terms:business.default_terms});state.brandColor=business.brand_color;state.bank={Bank:business.bank_name,Account:business.bank_account,IFSC:business.bank_ifsc,UPI:business.bank_upi};if(business.logo_path){const image=await fetch('/api/files?'+new URLSearchParams({path:business.logo_path}));if(!image.ok)throw Error('Business logo could not be loaded. Re-upload it in Settings.');setBusinessLogo(await normalizedImage(await image.blob()))}form.style.setProperty('--form-color',business.brand_color||'#3c136b');status('Business defaults loaded. Document number '+numbered.number+' reserved.');}catch(e){status(e.message,true)}finally{documentLoading=false;form.inert=false;qa('[data-action]',q('[data-document-toolbar]')).forEach(b=>b.disabled=false)}
  }
  async function loadDemo(){if(!form)await openEditor();isDemo=true;savedRecord=null;const n={'invoice':'INV','gst-invoice':'GST','quotation':'QUO','proforma':'PRO','purchase-order':'PO','delivery-challan':'DC','commercial-invoice':'COM'}[documentType];
    applyDocument({number:'DEMO-'+n+'-001',date:'2026-10-20',currency:documentType==='commercial-invoice'?'USD':'INR',taxType:documentType==='delivery-challan'?'NONE':'GST',gstMode:documentType==='commercial-invoice'?'igst':'split',seller:{name:'Acme Studio (Demo)',address:'12 Demo Road, Bengaluru 560001',gstin:'29AAAAA0000A1Z5',phone:'9000000000'},buyer:{name:'Northstar Trading (Demo)',address:'45 Sample Avenue, Mumbai 400001',gstin:'27BBBBB1111B1Z6'},items:[{name:documentType==='delivery-challan'?'Sample equipment':'Website design services',description:'Demo project: design and delivery of a responsive business website.',hsn:'998314',quantity:2,rate:15000,taxRate:18},{name:'Support package',description:'Three months of demo maintenance and support.',hsn:'998313',quantity:3,rate:2500,taxRate:18}]});status('Demo data loaded. Edit the details, then preview or download.');
  }
  async function newDocument(){if(form&&!await (await confirmationModule).confirmAction('Start a new '+documentTypes[documentType].toLowerCase()+'? The current browser draft will be replaced. Saved records stay in your account.'))return;clearTimeout(state.saving);localStorage.removeItem(draftKey);params.delete('id');params.delete('demo');history.replaceState(null,'',location.pathname+'?'+params);form=null;savedRecord=null;isDemo=false;documentLoading=false;documentLoadError='';Object.assign(state,initialState);await openEditor();status('New document ready.')}
  async function loadSavedDocument(id){
    documentLoading=true;status('Loading your saved document…');qa('[data-action]',q('[data-document-toolbar]')).forEach(b=>b.disabled=true);
    try{await fetch('/api/auth');const workspace=await fetch('/api/workspace').then(r=>r.json());const selected=localStorage.getItem('billing-active-business'),business=workspace.businesses?.find(b=>b.id===selected)?.id||workspace.businesses?.[0]?.id;if(!business)throw Error('Sign in and select the document business in Workspace, then reopen this document.');const response=await fetch('/api/records?'+new URLSearchParams({business,collection:'documents',id,demo:String(params.get('demo')==='true')})),r=await response.json();if(!response.ok||!r.records?.[0])throw Error(r.error||'Document not found in this business. Return to Workspace and select its business.');savedRecord=r.records[0];isDemo=savedRecord.demo;applyDocument(savedRecord.data);documentLoadError='';status('Opened '+savedRecord.data.number+' from your Supabase business.');}
    catch(e){documentLoadError=e.message;status(e.message,true)}finally{documentLoading=false;qa('[data-action]',q('[data-document-toolbar]')).forEach(b=>b.disabled=Boolean(documentLoadError)&&b.dataset.action!=='new')}
  }
  function applyDocumentLabels(){const title=documentTypes[documentType];document.title=title+' Generator';qa('h2').filter(e=>e.textContent.includes('Invoice generator (')).forEach(e=>e.textContent=title+' generator');txt(form,'[name=invoiceTitle]',title);txt(form,'[name="customLabels.invoiceNumber"]',title+' No');txt(form,'[name="customLabels.invoiceDate"]',title+' Date');if(documentType==='purchase-order')qa('h2,h3,label,span',form).filter(e=>e.children.length===0&&['Billed By','Billed To'].includes(e.textContent.trim())).forEach(e=>e.textContent=e.textContent.trim()==='Billed By'?'Vendor / Supplier':'Buyer');}

  async function normalizedImage(file){
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5242880)throw Error('Use a PNG, JPEG or WebP image up to 5 MB.');
    const bitmap=await createImageBitmap(file);try{if(bitmap.width*bitmap.height>16000000)throw Error('Image is too large. Use at most 16 million pixels.');const canvas=document.createElement('canvas'),scale=Math.min(1,480/bitmap.width,240/bitmap.height);canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);let result=canvas.toDataURL('image/png');if(result.length>100000){const context=canvas.getContext('2d');context.globalCompositeOperation='destination-over';context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);result=canvas.toDataURL('image/jpeg',0.8)}return result;}finally{bitmap.close()}
  }
  function setBusinessLogo(src){
    const input=q('input[name="logo"]',form),area=input?.closest('[class*="logoEditWrapper"]')||input?.parentElement;if(!area)return;
    q('img[data-business-logo],img[data-local-upload]',area)?.remove();const image=new Image();image.src=src;image.alt='Business logo';image.dataset.businessLogo='true';image.style.cssText='max-width:150px;max-height:90px;object-fit:contain';area.prepend(image);const button=q('button',area);if(button)button.style.display='none';update();
  }
  async function openCatalog(collection){
    status('Loading saved catalog…');try{await fetch('/api/auth');const response=await fetch('/api/workspace'),workspace=await response.json();if(!response.ok||!workspace.businesses?.length)throw Error('Sign in and select your business in Workspace to use saved clients and items.');const selected=localStorage.getItem('billing-active-business'),business=workspace.businesses.find(b=>b.id===selected)||workspace.businesses[0];if(savedRecord&&savedRecord.business_id!==business.id)throw Error('Select this document’s business in Workspace first.');
      const {chooseCatalogRecord}=await import('/invoice-catalog.js');await chooseCatalogRecord({business:business.id,collection,demo:isDemo,onSelect:record=>{
        if(record.demo)isDemo=true;
        if(collection==='items'){
          const existing=qa(cl('LineItems_lineItemContainer'),form);let row=existing.length===1&&Number(q('input[name$=".rate"]',existing[0])?.value)===0&&['','Item Name'].includes(q('input[name$=".name"]',existing[0])?.value)?existing[0]:null;if(!row){addLine();row=qa(cl('LineItems_lineItemContainer'),form).at(-1)}
          for(const [key,value]of Object.entries({name:record.data.name,quantity:1,rate:record.data.rate,hsn:record.data.hsn||'',gstRate:record.data.taxRate??q('input[name$=".gstRate"]',existing[0])?.value??0})){const input=q('input[name$=".'+key+'"]',row);if(input)input.value=value}
          const label=q('.disco-select-creatable__single-value,[data-item-name]',row);if(label)label.textContent=record.data.name;
        }else{
          state.clientId=record.id;const prefix=documentType==='purchase-order'?'billedBy':'billedTo';qa('input[name^="'+prefix+'."]',form).forEach(e=>e.value='');
          if(record.data.email&&!q('[name="'+prefix+'.email"]',form)){const card=q('[name="'+prefix+'.name"]',form)?.closest(cl('BusinessDetails_cardWrapper')),add=card&&qa('button',card).find(b=>b.textContent.trim()==='Add Email');if(add)optional(add,prefix+'.email')}
          for(const [key,value]of Object.entries(record.data))setValue(prefix+'.'+(key==='address'?'street':key),value);
        }update();status('Added '+record.data.name+(record.demo?' (demo record).':'.'));
      }});
    }catch(error){status(error.message,true)}
  }

  function setupToolbar(){
    q('[data-document-toolbar]')?.remove();const bar=document.createElement('section');bar.dataset.documentToolbar='true';bar.className='independent-document-toolbar';bar.innerHTML='<div class="independent-document-actions"><a href="/">Home</a><a href="/services/">All services</a><a href="/services/?service=invoicing">Workspace</a><strong>'+documentTypes[documentType]+'</strong><button type="button" data-action="new">New document</button><button type="button" data-action="demo">Load demo data</button><button type="button" data-action="save">Save to account</button><button type="button" data-action="preview">Preview PDF</button><button type="button" data-action="download">Download PDF</button><button type="button" data-action="share">Share &amp; send</button></div><div class="independent-document-actions"><label>PDF design <select data-pdf-template aria-label="PDF design"><option value="classic">Classic</option><option value="modern">Modern</option><option value="minimal">Minimal</option><option value="elegant">Elegant</option><option value="compact">Compact</option></select></label><button type="button" data-action="client">Choose saved client</button><button type="button" data-action="item">Add saved item</button></div><p data-document-status role="status">Your draft stays in this browser. Save to your account to keep it across devices.</p>';
    mount.before(bar);const actions={new:newDocument,demo:loadDemo,save:saveDocument,preview:previewDocument,download:downloadDocument,share:async()=>{const record=await saveDocument();if(record){const {openDelivery}=await import('/document-delivery.js');await openDelivery(record,r=>{savedRecord=r;saveDraft()})}},client:()=>openCatalog(documentType==='purchase-order'?'vendors':'clients'),item:()=>openCatalog('items')};const design=q('[data-pdf-template]',bar);design.value=state.template;design.addEventListener('change',()=>{state.template=design.value;saveDraft();status('PDF design: '+design.selectedOptions[0].text+'. Open Preview PDF to see it.');});if(documentType==='purchase-order')q('[data-action=client]',bar).textContent='Choose saved vendor';bar.addEventListener('click',e=>{const key=e.target.closest('[data-action]')?.dataset.action;if(key)actions[key]()});
    qa('button',form).filter(b=>b.textContent.trim()==='Save & Continue').forEach(b=>{b.textContent='Preview & Download';b.addEventListener('click',e=>{e.preventDefault();previewDocument()})});
    if(location.pathname.startsWith('/invoice-editor')){const main=document.getElementById('refrens-page-form');if(main){for(let node=main;node.parentElement&&node!==document.body;node=node.parentElement){for(const sibling of node.parentElement.children)if(sibling!==node&&!['SCRIPT','STYLE','LINK'].includes(sibling.tagName)){sibling.hidden=true;sibling.style.display='none'}}}qa('span',main||document).filter(e=>!e.children.length&&e.textContent.trim()==='Design & Share (optional)').forEach(e=>e.textContent='Design & download');}
    window.RefrensNavigation?.normalize(document);
  }
  window.RefrensInvoice={open:openEditor,loadDemo,newDocument,getDocument,download:downloadDocument,preview:previewDocument,save:saveDocument};
  let currentViewportLayout=layout(),resizeTimer;
  addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{const next=layout();if(next!==currentViewportLayout&&!document.querySelector('[role="dialog"]')){currentViewportLayout=next;if(form){saveDraft();form=null;openEditor()}}},220)});
  document.addEventListener('click',e=>{
    const button=e.target.closest('button');if(button){const text=button.textContent.trim();if(button.title==='Create Your First Invoice'){e.preventDefault();openEditor()}else if(text==='Login'){window.location.assign('/services/?service=invoicing')}else if(text==='Signup'){signupDialog()}}
    const anchor=e.target.closest('a[href]');if(anchor&&anchor.hash==='#refrens-page-form'&&new URL(anchor.href).origin===location.origin){e.preventDefault();document.getElementById('refrens-page-form')?.scrollIntoView({behavior:'smooth'})}
  });
  if(params.has('document')||params.has('id')||location.pathname.startsWith('/invoice-editor'))queueMicrotask(openEditor);
})();
