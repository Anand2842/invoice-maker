import{api,selectedBusiness}from'/workspace-shell.js';import{loginURL}from'/auth-links.js';
const q=s=>document.querySelector(s),node=(tag,value)=>Object.assign(document.createElement(tag),{textContent:String(value??'')});
let pending=null,busy=false;
function status(message,error=false){q('#status').textContent=message;q('#status').className=error?'error':''}
function signIn(error){if(error.status===401){const a=node('a','Sign in');a.href=loginURL();q('#status').append(' ',a)}}
function row(...cells){const tr=document.createElement('tr');tr.append(...cells.map(c=>node('td',c)));return tr}
function details(r){return['email','phone','gstin','sku'].map(k=>r[k]).filter(Boolean).concat('rate' in r?[`Rate ${r.rate}`]:[]).join(' · ')}
function render(r){
 const skipped=r.duplicates.length+r.errors.length;
 q('#summary').textContent=`${r.ready} record${r.ready===1?'':'s'} ready to import${skipped?`, ${skipped} skipped`:''}.`+(r.unknownColumns.length?` Ignored columns: ${r.unknownColumns.join(', ')}.`:'')+(r.ready>20?' Showing the first 20.':'');
 q('#preview').replaceChildren(...(r.preview.length?r.preview.map(p=>row(p.name,details(p))):[row('Nothing new to import')]));
 const skip=[...r.errors.map(e=>[e.line,e.message]),...r.duplicates.map(d=>[d.line,`"${d.name}" already exists`])].sort((a,b)=>a[0]-b[0]);
 q('#skipped').replaceChildren(...(skip.length?skip.map(([line,why])=>row(line,why)):[row('None','')]));
 q('#commit').disabled=!r.ready;q('#result').hidden=false;
}
async function request(commit){
 const f=q('#import-form').elements,file=f.file.files[0];if(!file)throw Error('Choose a CSV file');
 if(file.size>1_000_000)throw Error('The file is larger than 1 MB; split it into smaller files');
 return api('/api/import',{method:'POST',body:JSON.stringify({business:f.business.value,demo:f.demo.value==='true',collection:f.collection.value,csv:await file.text(),commit})});
}
q('#import-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;q('#result').hidden=true;status('Checking the file…');
 try{pending=await request(false);render(pending);status('Review the preview, then import.')}catch(error){status(error.message,true);signIn(error)}finally{busy=false}});
q('#import-form').addEventListener('change',()=>{q('#result').hidden=true;pending=null});
q('#commit').addEventListener('click',async()=>{if(busy||!pending)return;busy=true;q('#commit').disabled=true;status('Importing…');
 try{const r=await request(true);q('#result').hidden=true;pending=null;q('#import-form').elements.file.value='';status(`Imported ${r.imported} record${r.imported===1?'':'s'}.`+(r.errors.length+r.duplicates.length?` ${r.errors.length+r.duplicates.length} row(s) skipped.`:''))}
 catch(error){status(error.message,true);signIn(error);q('#commit').disabled=false}finally{busy=false}});
(async()=>{try{const w=await api('/api/workspace'),businesses=w.businesses;if(!businesses.length){status('Create a business first.');return}
 q('#business').replaceChildren(...businesses.map(b=>Object.assign(node('option',b.name),{value:b.id})));q('#business').value=selectedBusiness(businesses).id;
 q('#import-form').elements.demo.value=new URLSearchParams(location.search).get('demo')==='true'?'true':'false';q('#workspace').hidden=false;status('Choose what to import and a CSV file.')}
 catch(error){status(error.message,true);signIn(error)}})();
