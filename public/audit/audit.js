import{api,selectedBusiness}from'/workspace-shell.js';import{loginURL}from'/auth-links.js';
const q=s=>document.querySelector(s),node=(tag,value)=>Object.assign(document.createElement(tag),{textContent:String(value??'')});
let next=null,epoch=0;
function status(message,error=false){q('#status').textContent=message;q('#status').className=error?'error':''}
function signIn(error){if(error.status===401){const a=node('a','Sign in');a.href=loginURL();q('#status').append(' ',a)}}
// Show the most useful identifying detail without dumping internal ids.
function item(e){const d=e.details||{};if(e.area==='records')return`${d.collection} · ${d.label}${d.version>1?` (v${d.version})`:''}`;
 const pick=['number','name','code','reference','reason','date','amount'].filter(k=>d[k]!==undefined&&typeof d[k]!=='object').map(k=>`${k} ${d[k]}`);return pick.slice(0,3).join(' · ')||''}
function row(e){const tr=document.createElement('tr');tr.append(node('td',new Date(e.at).toLocaleString()),node('td',e.area),node('td',e.action.replaceAll('_',' ').replaceAll('.',' · ')),node('td',item(e)),node('td',e.actor));return tr}
async function load(append=false){const tick=++epoch,s={business:q('#business').value,demo:q('#demo').value,area:q('#area').value};
 if(!append){next=null;q('#entries').replaceChildren()}status('Loading audit trail…');
 try{const p=new URLSearchParams({business:s.business,demo:s.demo});if(s.area)p.set('area',s.area);if(append&&next){p.set('at',next.at);p.set('key',next.key)}
  const data=await api('/api/audit?'+p);if(tick!==epoch)return;next=data.next;q('#entries').append(...data.entries.map(row));q('#more').hidden=!next;
  if(!q('#entries').children.length){const tr=document.createElement('tr'),td=node('td','No audit entries yet.');td.colSpan=5;tr.append(td);q('#entries').append(tr)}
  status(data.owner?'Showing all areas you can see, including team changes.':'Showing entries for your role.')}
 catch(error){if(tick!==epoch)return;status(error.message,true);signIn(error)}}
q('#scope').addEventListener('submit',e=>{e.preventDefault();load()});q('#more').addEventListener('click',()=>load(true));
(async()=>{try{const w=await api('/api/workspace'),b=w.businesses;if(!b.length){status('Create a business first.');return}
 q('#business').replaceChildren(...b.map(x=>Object.assign(node('option',x.name),{value:x.id})));q('#business').value=selectedBusiness(b).id;q('#demo').value=new URLSearchParams(location.search).get('demo')==='true'?'true':'false';q('#workspace').hidden=false;load()}
 catch(error){status(error.message,true);signIn(error)}})();
