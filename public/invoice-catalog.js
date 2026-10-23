export async function chooseCatalogRecord({business,collection,demo,onSelect}) {
  const dialog=document.createElement('dialog');dialog.className='invoice-catalog';
  const kind=collection==='items'?'item':collection==='vendors'?'vendor':'client';
  dialog.setAttribute('aria-label','Choose saved '+kind);
  dialog.innerHTML='<header><h2>Choose saved '+kind+'</h2><button type="button" data-close aria-label="Close catalog">Close</button></header><label>Search '+kind+'<input type="search" data-search placeholder="Search by name"></label><label class="catalog-demo"><input type="checkbox" data-demo> Show demo records</label><p role="status"></p><div data-results></div>';
  const search=dialog.querySelector('[data-search]'),demoToggle=dialog.querySelector('[data-demo]'),results=dialog.querySelector('[data-results]'),status=dialog.querySelector('[role=status]');
  demoToggle.checked=demo;let records=[],generation=0;
  function render(){results.replaceChildren();const found=records.filter(r=>String(r.data.name||'').toLowerCase().includes(search.value.toLowerCase()));
    for(const record of found){const button=document.createElement('button');button.type='button';button.className='catalog-record';button.textContent=record.data.name+(collection==='items'?' — unit price '+record.data.rate:record.data.email?' — '+record.data.email:'');button.addEventListener('click',()=>{onSelect(record);dialog.close()});results.append(button)}
    if(!found.length){const empty=document.createElement('p');empty.textContent='No matching '+kind+' records. Add one in Workspace or enter the details manually.';results.append(empty)}
  }
  async function load(){const current=++generation;status.textContent='Loading saved records…';results.replaceChildren();records=[];search.disabled=true;
    try{await fetch('/api/auth',{signal:AbortSignal.timeout(20000)});let offset=0;
      do{const response=await fetch('/api/records?'+new URLSearchParams({business,collection,demo:String(demoToggle.checked),offset:String(offset),limit:'100'}),{signal:AbortSignal.timeout(20000)});const body=await response.json();if(!response.ok)throw Error(body.error||'Could not load catalog');if(current!==generation||!dialog.open)return;records.push(...body.records);offset=body.nextOffset;if(records.length>=10000&&offset!==null)throw Error('Catalog exceeds 10,000 records. Enter details manually.');}while(offset!==null&&offset!==undefined);
      status.textContent=records.length+' saved '+kind+' records';search.disabled=false;render();
    }catch(error){if(current!==generation)return;status.textContent=error.message;status.setAttribute('role','alert');}
  }
  search.addEventListener('input',render);demoToggle.addEventListener('change',load);dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{generation++;dialog.remove()});document.body.append(dialog);dialog.showModal();await load();
}
