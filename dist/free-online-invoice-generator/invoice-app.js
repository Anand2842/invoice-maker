(() => {
  'use strict';
  const base='/free-online-invoice-generator/';
  let mount=document.getElementById('invoice-editor-mount');
  const draftKey='refrens-public-invoice-draft-v1';
  const q=(selector,scope=document)=>scope.querySelector(selector);
  const qa=(selector,scope=document)=>[...scope.querySelectorAll(selector)];
  const cl=name=>`[class*="${name}__"]`;
  const state={currency:'INR',taxType:'GST',gstMode:'split',discount:0,discountType:'amount',saving:null,options:{}};
  let form, originalLine, templates={},selectTemplates={},discountSource={},classMaps={},extras={};
  const layout=()=>innerWidth<=568?'mobile':'desktop';
  const adapt=(node,target)=>{const mapping=target==='mobile'?classMaps.desktopToMobile:classMaps.mobileToDesktop;node.querySelectorAll('[class]').forEach(e=>{const replacement=mapping?.[e.getAttribute('class')];if(replacement)e.setAttribute('class',replacement)});return node};
  const sourceStyles=new Set();
  function sanitize(node){node.querySelectorAll('script,iframe,object,embed,style,link,meta,base,foreignObject').forEach(e=>e.remove());node.querySelectorAll('*').forEach(e=>{for(const a of [...e.attributes]){if(/^on/i.test(a.name)||['srcdoc','formaction'].includes(a.name))e.removeAttribute(a.name);if(['href','xlink:href'].includes(a.name)&&/^\s*(javascript|data|vbscript):/i.test(a.value))e.removeAttribute(a.name);if(a.name==='style'&&/url\(|expression\(|@import/i.test(a.value))e.removeAttribute(a.name)}if(e.tagName==='FORM'){e.removeAttribute('method');e.removeAttribute('action')}});return node}
  async function loadStyle(name){if(sourceStyles.has(name))return;await new Promise(resolve=>{const link=document.createElement('link');link.rel='stylesheet';link.href=base+name;link.onload=resolve;link.onerror=resolve;const first=document.head.querySelector('link[rel="stylesheet"]');document.head.insertBefore(link,first)});sourceStyles.add(name)}
  const parse=html=>{const t=document.createElement('template');t.innerHTML=html.trim();return t.content.firstElementChild};
  const value=name=>q(`[name="${CSS.escape(name)}"]`,form)?.value||'';
  const money=amount=>new Intl.NumberFormat('en-IN',{style:'currency',currency:state.currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(amount);
  const finite=x=>Number.isFinite(Number(x))?Number(x):0;
  const txt=(root,selector,text)=>{const e=q(selector,root);if(e)e.textContent=text};
  function update(){
    if(!form)return;
    let amount=0,gst=0,quantity=0;
    qa(cl('LineItems_lineItemContainer'),form).forEach(row=>{
      const field=suffix=>q(`input[name$=".${suffix}"]`,row);
      const qty=finite(field('quantity')?.value),rate=finite(field('rate')?.value);
      const gross=Math.round(qty*rate*100)/100;const itemDiscount=finite(field('discount.amount')?.value);const discountType=field('discount.discountType')?.value||'PERCENTAGE';const subtotal=Math.max(0,Math.round((gross-(discountType==='PERCENTAGE'?gross*Math.min(100,itemDiscount)/100:itemDiscount))*100)/100);
      const tax=state.taxType==='NONE'?0:Math.round(subtotal*finite(field('gstRate')?.value)/100*100)/100;
      amount+=subtotal;gst+=tax;quantity+=qty;
      qa(cl('LineItems_computedField'),row).forEach((e,i)=>e.textContent=money([subtotal,tax/2,tax/2,subtotal+tax][i]||0));
      const name=q('input[name$=".name"]',row);const label=q('[contenteditable][data-item-name]',row);if(name&&label)name.value=label.textContent.trim();
    });
    amount=Math.round(amount*100)/100;gst=Math.round(gst*100)/100;
    const discount=0;
    const total=Math.max(0,Math.round((amount+gst-discount)*100)/100);
    txt(form,`${cl('InvoiceBalance_balanceRow')} .bxCORq`,money(amount));
    const taxRows=qa(cl('InvoiceBalance_taxRow'),form);
    taxRows.forEach((row,i)=>{const children=qa(':scope > span',row);if(children[0])children[0].textContent=money(i===0?gst:gst/2);row.hidden=state.taxType==='NONE';row.style.display=state.taxType==='NONE'?'none':''});
    txt(form,`${cl('InvoiceBalance_totalAmountWrapper')} .bjbOAY`,money(total));
    txt(form,`${cl('InvoiceBalance_totalLabelRow')} .gwbZMU`,`(${state.currency})`);
    txt(form,cl('InvoiceBalance_totalInWordsValue'),toWords(total));
    qa('[data-currency-sign]',form).forEach(e=>e.textContent=new Intl.NumberFormat('en',{style:'currency',currency:state.currency,currencyDisplay:'narrowSymbol'}).formatToParts(0).find(p=>p.type==='currency')?.value||state.currency);
    const quantityRow=q('[data-total-quantity]',form);if(quantityRow)quantityRow.textContent=`Total Quantity: ${quantity}`;
    const discountRow=q('[data-discount-summary]',form);if(discountRow)discountRow.textContent=`Discount −${money(discount)}`;
    state.total=total;state.amount=amount;state.gst=gst;
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
  function saveDraft(){
    if(!form)return;
    const clone=form.parentElement.cloneNode(true);
    const original=qa('input,textarea,select',form.parentElement),copy=qa('input,textarea,select',clone);
    copy.forEach((e,i)=>{const source=original[i];if(!source||e.type==='file')return;if(e.type==='checkbox'||e.type==='radio'){e.toggleAttribute('checked',source.checked)}else if(e.tagName==='TEXTAREA')e.textContent=source.value;else e.setAttribute('value',source.value);});
    clone.querySelectorAll('.local-select-overlay,.disco-select__menu,.disco-select-creatable__menu,.react-tooltip,.local-quantity-summary').forEach(e=>e.remove());clone.querySelectorAll('[data-local-select-ready],[data-date-ready],[data-editable-label],[data-local-editor-ready],[data-source-signature-ready],[data-local-upload-ready],[data-item-select-ready]').forEach(e=>{e.removeAttribute('data-local-select-ready');e.removeAttribute('data-date-ready');e.removeAttribute('data-editable-label');e.removeAttribute('data-local-editor-ready');e.removeAttribute('data-source-signature-ready');e.removeAttribute('data-local-upload-ready');e.removeAttribute('data-item-select-ready')});
    sanitize(clone);
    try{localStorage.setItem(draftKey,JSON.stringify({html:clone.outerHTML,currency:state.currency,taxType:state.taxType,gstMode:state.gstMode,discount:state.discount,discountType:state.discountType,cess:state.cess,layout:layout(),updatedAt:new Date().toISOString()}));q('[data-draft-error]',form)?.remove()}catch{if(!q('[data-draft-error]',form)){const message=document.createElement('p');message.dataset.draftError='true';message.setAttribute('role','alert');message.className='local-storage-error';message.textContent='Your browser could not save this draft. Keep this page open to retain your changes.';form.prepend(message)}}
  }
  async function openEditor(){
    if(form)return;
    const button=q('button[title="Create Your First Invoice"]');if(button)button.disabled=true;
    try{
      const currentLayout=layout();
      const sourceHead=await fetch(base+(currentLayout==='mobile'?'form-head-mobile.html':'form-head.html')).then(r=>r.text());document.head.innerHTML=sourceHead;sourceStyles.clear();
      if(!document.getElementById('invoice-optional-source')){const stylesheet=document.createElement('link');stylesheet.id='invoice-optional-source';stylesheet.rel='stylesheet';stylesheet.href=base+'optional-source.css';const first=document.head.querySelector('link[rel="stylesheet"]');document.head.insertBefore(stylesheet,first)}
      const [html,options,selects,discounts,mapping,body,sourceExtras]=await Promise.all([fetch(base+(currentLayout==='mobile'?'form-mobile.html':'form.html')).then(r=>{if(!r.ok)throw Error('Unable to load invoice');return r.text()}),fetch(base+(currentLayout==='mobile'?'optionals-mobile.json':'optionals.json')).then(r=>r.json()),fetch(base+'selects.json').then(r=>r.json()),fetch(base+'discount-source.json').then(r=>r.json()),fetch(base+'responsive-classes.json').then(r=>r.json()),fetch(base+'body-open-'+currentLayout+'.html').then(r=>r.text()),fetch(base+'extras.json').then(r=>r.json())]);extras=sourceExtras;await loadStyle('extras-source.css');classMaps=mapping;document.body.innerHTML=body;mount=document.getElementById('invoice-editor-mount');templates=options;selectTemplates=selects;discountSource=discounts;await loadStyle('selects-source.css');await loadStyle('interaction-source.css');
      let draft;try{const candidate=JSON.parse(localStorage.getItem(draftKey));if(typeof candidate?.html==='string'&&candidate.html.length<2000000){const parsed=parse(candidate.html);sanitize(parsed);if(q('form',parsed)&&q('[name="invoiceNumber"]',parsed)&&q('input[name$=".rate"]',parsed)&&q(cl('LineItems_lineItemContainer'),parsed)&&q('[name="billedBy.name"]',parsed)&&q('[name="billedTo.name"]',parsed)){adapt(parsed,currentLayout);qa(cl('LineItems_lineItemDescriptionCell'),parsed).forEach(cell=>{const oldEditor=q('.toastui-editor-contents[contenteditable]',cell);if(oldEditor){const fresh=adapt(parse(extras[currentLayout==='mobile'?'description-mobile':'description']),currentLayout);q('.toastui-editor-contents[contenteditable]',fresh).innerHTML=oldEditor.innerHTML;cell.replaceWith(fresh)}});const oldNote=q(cl('Notes_wrapper')+' .toastui-editor-contents[contenteditable]',parsed);if(oldNote&&options.notes){let section=oldNote;while(section.parentElement&&section.parentElement.tagName!=='FORM')section=section.parentElement;if(section.parentElement?.tagName==='FORM'){const freshNote=adapt(parse(options.notes),currentLayout);const editor=q('.toastui-editor-contents[contenteditable]',freshNote);if(editor)editor.innerHTML=oldNote.innerHTML;section.replaceWith(freshNote)}}candidate.html=parsed.outerHTML;draft=candidate}}}catch{}
      const card=document.createElement('div');card.className='InvoiceFormLite_invoiceCard__DqVlk';const wrapper=document.createElement('div');wrapper.className='InvoiceFormLite_invoiceFormWrapper__myyU0';
      card.innerHTML=draft?.html||html;wrapper.append(card);mount.replaceChildren(wrapper);form=q('form',mount);
      if(draft){for(const key of ['currency','taxType','gstMode','discount','discountType','cess'])if(draft[key]!==undefined)state[key]=draft[key]}
      form.removeAttribute('method');form.addEventListener('submit',e=>{e.preventDefault();continueSignup()});
      templates.signatureButton=q(cl('Signature_wrapper'),parse(html)).outerHTML;templates.attachmentsButton=qa('button',parse(html)).find(e=>e.textContent.trim()==='Add Attachments')?.outerHTML;
      originalLine=q(cl('LineItems_lineItemContainer'),parse(q('input[name$=".discount.amount"]',form)?discountSource.lines:html)).cloneNode(true);
      if(!draft){const date=q('[name="invoiceDate"]',form);date.value=new Intl.DateTimeFormat('en-US',{month:'short',day:'2-digit',year:'numeric',timeZone:'Asia/Kolkata'}).format(new Date())}
      qa('input[name$=".rate"]',form).forEach(e=>{e.min='0';e.step='0.01'});
      qa('input[name$=".gstRate"],input[name$=".quantity"]',form).forEach(e=>{e.inputMode='decimal'});
      for(const name of ['invoiceNumber','invoiceDate','billedBy.name','billedTo.name']){const input=q(`[name="${name}"]`,form);if(input)input.required=true}
      prepareNames();prepareSelects();prepareDates();qa('.toastui-editor-defaultUI',form).forEach(e=>wireRichEditor(e,'Description'));const signature=q(cl('Signature_wrapper'),form);if(signature&&q('input[type="file"]',signature))wireSignature(signature);
      qa('.fHnneQ',form).forEach(e=>e.dataset.currencySign='true');
      form.addEventListener('paste',e=>{if(e.target.closest('[contenteditable]')){e.preventDefault();const text=e.clipboardData.getData('text/plain');document.execCommand('insertText',false,text)}});
      form.addEventListener('input',e=>{if(e.target.dataset.allItemDiscount!==undefined){state.discount=Math.max(0,finite(e.target.value));qa('input[name$=".discount.amount"]',form).forEach(input=>input.value=state.discount)}update()});form.addEventListener('change',changed);form.addEventListener('click',clicked);
      form.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('[contenteditable]')){e.preventDefault();e.target.blur()}});
      update();const heading=qa('h2').find(e=>e.textContent.includes('Invoice generator ('));if(heading){const top=heading.getBoundingClientRect().top+scrollY-(layout()==='mobile'?12:16);scrollTo({top,behavior:'smooth'})}
    }catch(error){if(button){button.disabled=false;button.title=error.message}}
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
      search.addEventListener('input',()=>{const measure=document.createElement('span');measure.style.cssText='position:absolute;visibility:hidden;white-space:pre';measure.style.font=getComputedStyle(search).font;measure.textContent=search.value;document.body.append(measure);search.style.width=Math.max(2,Math.ceil(measure.getBoundingClientRect().width))+'px';measure.remove();open()});search.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close()}if(e.key==='Enter'){e.preventDefault();choose(chosen||search.value.trim())}if(e.key==='ArrowDown'&&!q('.disco-select-creatable__menu',container)){e.preventDefault();open()}});search.addEventListener('blur',()=>setTimeout(close,100));
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
    const input=q('input[type="file"]',section);if(input&&!input.dataset.sourceSignatureReady){input.dataset.sourceSignatureReady='true';input.name='signature';input.addEventListener('change',()=>{if(!input.files?.[0])return;const reader=new FileReader();reader.onload=()=>setSignature(reader.result);reader.readAsDataURL(input.files[0])})}
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
    if(input.type==='file'&&input.name!=='signature'&&input.name!=='attachments'&&input.files?.length){const file=input.files[0];const reader=new FileReader();reader.onload=()=>{const image=new Image();image.src=reader.result;image.alt=input.name==='logo'?'Business Logo':'Item image';image.style.cssText='max-width:150px;max-height:110px;object-fit:contain';const area=input.closest('[class*="logoEditWrapper"],[class*="itemImageUploadWrapper"]')||input.parentElement;const old=q('img[data-local-upload]',area);old?.remove();image.dataset.localUpload='true';area.prepend(image);const button=q('button',area);if(button)button.style.display='none';update()};reader.readAsDataURL(file)}
    if(input.name==='showTotalsRow'){if(input.nextElementSibling)input.nextElementSibling.className='sc-ezuuWm '+(input.checked?'RXXMG':'iXxWJx')}
    if(input.closest(cl('ShippingDetails_shippingCheckboxWrapper'))){
      const after=input.closest(cl('ShippingDetails_shippingCheckboxWrapper'));if(input.nextElementSibling)input.nextElementSibling.className='sc-ezuuWm '+(input.checked?'iegBmO':'egubbp');
      qa('[data-source-shipping]',form).forEach(e=>e.remove());
      if(input.checked){let reference=after;for(const html of (layout()==='mobile'?extras.shippingMobile:extras.shipping)){const section=sanitize(adapt(parse(html),layout()));section.dataset.sourceShipping='true';reference.after(section);reference=section}prepareSelects()}
    }
    const shipping=input.closest('[data-source-shipping]');
    if(shipping&&input.type==='checkbox'){
      const source=input.closest('label')?.textContent.includes('your business')?'billedBy':'billedTo';const target=source==='billedBy'?'shippedFrom':'shippedTo';
      if(input.checked){for(const field of ['name','street','city','pincode','country','state']){const from=value(source+'.'+(field==='state'?'gstState':field)),to=q(`[name="${target}.${field}"]`,form);if(to)to.value=from}update()}
    }
    update();
  }
  function reindex(){qa(cl('LineItems_lineItemContainer'),form).forEach((row,index)=>{qa('[name]',row).forEach(e=>e.name=e.name.replace(/items\[\d+\]/,`items[${index}]`));const serial=q('.single-lineitem',row);if(serial)serial.style.setProperty('--item-number',index+1);qa('[id]',row).forEach(e=>e.id=e.id.replace(/-\d+$/,`-${index}`))})}
  function addLine(after,duplicate=false){
    const row=(after&&duplicate?after:originalLine).cloneNode(true);
    if(!duplicate){qa('input',row).forEach(e=>{if(e.name.endsWith('.name'))e.value='Item Name';else if(e.name.endsWith('.quantity')||e.name.endsWith('.rate'))e.value='1';else if(e.name.endsWith('.gstRate'))e.value='18';else if(e.type!=='hidden'&&e.type!=='file')e.value=''});const name=q('[data-item-name]',row);if(name)name.textContent='Item Name'}
    if(after)after.after(row);else q(cl('LineItems_lineItemContainer'),form).parentElement.append(row);
    qa('[data-local-select-ready],[data-item-select-ready]',row).forEach(e=>{e.removeAttribute('data-local-select-ready');e.removeAttribute('data-item-select-ready')});reindex();prepareNames();prepareSelects();update();
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
    const old=q('.invoice-lineitems-wrapper',form);const rows=qa(cl('LineItems_lineItemContainer'),old).map(row=>({inputs:qa('input[name]',row).map(i=>({suffix:i.name.replace(/^items\[\d+\]\./,''),value:i.value})),description:q('textarea',row)?.value}));
    const block=adapt(parse(discountSource.lines),layout()),template=q(cl('LineItems_lineItemContainer'),block).cloneNode(true),parent=q(cl('LineItems_lineItemContainer'),block).parentElement;parent.replaceChildren();
    rows.forEach(data=>{const row=template.cloneNode(true);data.inputs.forEach(({suffix,value})=>{const field=q(`input[name$=".${CSS.escape(suffix)}"]`,row);if(field)field.value=value});const label=q('.disco-select-creatable__single-value',row);if(label)label.textContent=data.inputs.find(i=>i.suffix==='name')?.value||'Item Name';parent.append(row)});old.replaceWith(block);
    const balance=parse(discountSource.balance);q(cl('InvoiceBalance_balanceWrapper'),form).replaceWith(balance);const all=q(cl('InvoiceBalance_itemWiseDiscountWrapper'),balance);const amount=q('input[type="number"]',all);if(amount){amount.dataset.allItemDiscount='true';amount.name='allItemDiscount';amount.min='0'}
    const options=qa(cl('InvoiceBalance_discountButton'),balance);state.discountType='percent';options.forEach(button=>button.addEventListener('click',()=>{state.discountType=button.textContent.trim()==='%'?'percent':'amount';options.forEach(b=>b.classList.toggle('InvoiceBalance_buttonSelected__VdQse',b===button));qa('input[name$=".discount.discountType"]',form).forEach(e=>e.value=state.discountType==='percent'?'PERCENTAGE':'FIXED');update()}));
    q('button[aria-label="Remove Discount"]',balance)?.addEventListener('click',()=>{qa('input[name$=".discount.amount"]',form).forEach(input=>input.value='0');if(amount)amount.value='0';update()});
    originalLine=template.cloneNode(true);reindex();prepareNames();prepareSelects();update();
  }
  async function signupDialog(){
    const overlay=await sourceOverlay('signup-dialog.html','signup-source.css','Signup on Refrens');
    const official=()=>window.location.assign('https://www.refrens.com/register');
    qa('form',overlay).forEach(account=>{account.autocomplete='off';account.addEventListener('submit',e=>{e.preventDefault();official()})});
    qa('input',overlay).forEach(input=>input.autocomplete='off');
    qa('button',overlay).forEach(button=>{const label=button.textContent.trim();if(label==='Continue with Google'||label==='Save and Continue')button.addEventListener('click',e=>{e.preventDefault();official()});if(label==='Login here')button.addEventListener('click',()=>window.location.assign('https://www.refrens.com/login'))});
    qa('a',overlay).forEach(anchor=>{if(anchor.textContent.includes('Login'))anchor.href='https://www.refrens.com/login';else if(anchor.getAttribute('href')?.startsWith('/'))anchor.href='https://www.refrens.com'+anchor.getAttribute('href')});
  }
  async function columnDialog(){
    const overlay=await sourceOverlay('columns-dialog.html','columns-source.css','Customize Columns & Formulas');const headers=qa(`${cl('LineItems_lineItemHeader')} > span`,form);const original=headers.map(e=>e.textContent.trim());
    const rows=qa('[data-rbd-draggable-id]',overlay);rows.forEach(row=>{const input=q('input[placeholder]',row);if(input){const index=original.indexOf(input.placeholder);if(index>=0)input.value=headers[index].textContent.trim();input.dataset.columnOriginal=input.placeholder}});
    qa('button',overlay).forEach(button=>{const label=button.textContent.trim();if(label==='Cancel')button.addEventListener('click',overlay.closeSource);if(label==='Reset to Default')button.addEventListener('click',()=>qa('input[data-column-original]',overlay).forEach(input=>input.value=input.dataset.columnOriginal));if(label==='Save Changes')button.addEventListener('click',()=>{qa('input[data-column-original]',overlay).forEach(input=>{const index=original.indexOf(input.dataset.columnOriginal);if(index>=0&&input.value.trim()){headers[index].textContent=input.value.trim();qa(cl('LineItems_lineItemContainer'),form).forEach(row=>{const labels=qa(cl('LineItems_lineItemLabel'),row);if(labels[index])labels[index].textContent=input.value.trim()})}});overlay.closeSource();update()});if(label==='Add New Column')button.addEventListener('click',()=>{const originalRow=rows.find(row=>row.dataset.rbdDraggableId==='hsn');if(originalRow){const row=originalRow.cloneNode(true);row.dataset.rbdDraggableId='custom-'+Date.now();const input=q('input[placeholder]',row);input.placeholder='Column Name';input.value='';originalRow.parentElement.append(row);input.focus()}})});
  }
  function continueSignup(){
    if(!form.reportValidity())return;
    qa('[data-local-error]',form).forEach(e=>e.remove());
    let bad=false;for(const name of ['invoiceNumber','invoiceDate','billedBy.name','billedTo.name']){const input=q(`[name="${name}"]`,form);if(!input.value.trim()){input.setCustomValidity('This field is required');input.reportValidity();input.addEventListener('input',()=>input.setCustomValidity(''),{once:true});bad=true;break}}if(bad)return;
    saveDraft();signupDialog();
  }
  let currentViewportLayout=layout(),resizeTimer;
  addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{const next=layout();if(next!==currentViewportLayout&&!document.querySelector('[role="dialog"]')){currentViewportLayout=next;if(form){saveDraft();form=null;openEditor()}}},220)});
  document.addEventListener('click',e=>{
    const button=e.target.closest('button');if(button){const text=button.textContent.trim();if(button.title==='Create Your First Invoice'){e.preventDefault();openEditor()}else if(text==='Login'){window.location.assign('https://www.refrens.com/login')}else if(text==='Signup'){signupDialog()}}
    const anchor=e.target.closest('a[href]');if(anchor&&anchor.hash==='#refrens-page-form'&&new URL(anchor.href).origin===location.origin){e.preventDefault();document.getElementById('refrens-page-form')?.scrollIntoView({behavior:'smooth'})}
  });
})();
