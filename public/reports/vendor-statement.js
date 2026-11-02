import{api,selectedBusiness}from'/workspace-shell.js';
import{businessDate}from'/business-date.js';
import{loginURL}from'/auth-links.js';
import{openPrint}from'/print-open.js';
import{agingLabels,movementLabels,statementMoney,validateVendorStatement}from'./vendor-statement-model.mjs';
const q=s=>document.querySelector(s),el=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text}),params=new URLSearchParams(location.search);
let businesses=[],generation=0,data=null,scope=null,cursor=null,page=1,busy=false,vendorScope='',lastRequest=null;
const values=()=>({business:q('#business').value,demo:q('#demo').value==='true',vendor:q('#vendor').value,from:q('#from').value,to:q('#to').value});
function status(text,error=false){q('#status').textContent=text;q('#status').className=error?'error':''}
function setBusy(value){busy=value;q('#filters').querySelectorAll('input,select,button').forEach(e=>e.disabled=value);q('#first').disabled=value||!cursor;q('#next').disabled=value||!data?.next;for(const key of['csv','print'])q('#'+key).disabled=value||!data}
function invalidate(){generation++;data=null;lastRequest=null;q('#report').hidden=true;setBusy(false);status('Filters changed. Review the vendor statement again.')}
function dates(){const b=businesses.find(b=>b.id===q('#business').value),today=businessDate(new Date(),b?.time_zone);q('#from').value=today.slice(0,8)+'01';q('#to').value=today}
function table(target,headers,rows){const t=el('table',''),head=el('thead',''),tr=el('tr','');headers.forEach(h=>{const th=el('th',h);th.scope='col';tr.append(th)});head.append(tr);t.append(head);const body=el('tbody','');for(const cells of rows){const row=el('tr','');cells.forEach(value=>{const td=el('td','');td.append(typeof value==='object'?value:document.createTextNode(value));row.append(td)});body.append(row)}if(!rows.length){const row=el('tr',''),cell=el('td','No movements in the selected period.');cell.colSpan=headers.length;row.append(cell);body.append(row)}t.append(body);q(target).replaceChildren(t)}
function billLink(row){const a=el('a','Open bill');a.href='/payables/?'+new URLSearchParams({business:scope.business,demo:String(scope.demo),bill:row.billId,date:scope.to});return a}
function render(){
 q('#heading').textContent=data.vendor.name+' · '+data.currency+(data.vendor.archived?' · Archived vendor':'');q('#contact').textContent=[data.vendor.address,data.vendor.email].filter(Boolean).join(' · ');q('#scope').textContent=data.businessName+' · '+(data.demo?'DEMO':'REAL')+' · '+data.from+' through '+data.to+' · snapshot '+data.snapshotNumber;
 q('#summary').replaceChildren(...[['Opening owed',data.opening],['Charges / settlement reversals',data.charges],['Settlements / bill reversals',data.credits],['Closing owed',data.closing]].map(([label,value])=>{const span=el('span',label);span.append(el('strong',statementMoney(value)));return span}));
 q('#aging-date').textContent=data.to;table('#aging',Object.values(agingLabels),[Object.keys(agingLabels).map(k=>statementMoney(data.aging[k]))]);
 q('#page-info').textContent=(page===null?'Continuation page':'Page '+page)+' · '+data.rows.length+' of '+data.totalRows+' movements'+(data.next?' · more movements follow':' · end of movements');table('#movements',['Date','Movement','Journal / reference','Charge','Payment / credit','Amount owed','Bill'],data.rows.map(r=>[r.date,movementLabels[r.kind],r.number+' · '+r.reference,statementMoney(r.charge),statementMoney(r.credit),statementMoney(r.balance),billLink(r)]));
 q('#limitations').textContent='Includes explicit Folio vendor bills, payments/reversals and cash allocations/releases. Unapplied advances remain separate from bill aging. Excludes legacy expenses, purchase orders, vendor credits and manual AP journals. Contact details are current; issued snapshots stay unchanged. No funds are transferred or refunded.';q('#report').hidden=false;
}
async function load(next=null,pageNumber=1){
 const id=++generation;data=null;q('#report').hidden=true;scope=values();cursor=next;page=pageNumber;setBusy(true);status('Loading dated vendor movements…');
 const query=new URLSearchParams({...scope,demo:String(scope.demo),limit:'100'});if(next){query.set('afterDate',next.date);query.set('afterSequence',next.sequence);query.set('snapshot',next.snapshot)}
 history.replaceState(null,'','/reports/vendor-statement/?'+query);q('[data-account-link]').href=loginURL();q('#payables-link').href='/payables/?'+new URLSearchParams({business:scope.business,demo:String(scope.demo),date:scope.to});
 try{const result=await api('/api/reports/vendor-statement?'+query);if(id!==generation)return;validateVendorStatement(result,{business:scope.business,data_mode:scope.demo,vendor_id:scope.vendor,from_date:scope.from,to_date:scope.to,page_size:100,after_date:next?.date||null,after_sequence:next?.sequence||null,snapshot_number:next?.snapshot||null});data=result;query.set('snapshot',result.snapshotNumber);lastRequest=query;render();status('Statement reviewed through '+scope.to+'.')}
 catch(error){if(id===generation){status(error.message,true);if(error.status===401){const a=el('a','Sign in');a.href=loginURL();q('#status').append(' ',a)}}}finally{if(id===generation)setBusy(false)}
}
async function prepare(initial=false){
 const id=++generation;data=null;lastRequest=null;q('#report').hidden=true;setBusy(true);status('Loading saved vendors…');
 try{const c=values(),key=c.business+':'+c.demo,previous=initial?params.get('vendor'):vendorScope===key?c.vendor:null;const result=await api('/api/records?'+new URLSearchParams({business:c.business,collection:'vendors',demo:String(c.demo),limit:'500'}));if(id!==generation)return;
 const vendors=result.records.map(r=>({id:r.id,name:r.data.name,archived:r.archived}));
 const options=()=>q('#vendor').replaceChildren(...vendors.map(v=>{const option=el('option',v.name+(v.archived?' (archived)':''));option.value=v.id;return option}));options();vendorScope=key;
 if(previous&&!vendors.some(v=>v.id===previous)){
  let found=null;for(const archived of['false','true']){const r=await api('/api/records?'+new URLSearchParams({business:c.business,collection:'vendors',demo:String(c.demo),archived,id:previous}));if(id!==generation)return;if(r.records?.[0]){found=r.records[0];break}}
  if(!found){q('#vendor').value='';throw Error('The selected vendor is unavailable in this business and data mode. Choose an available vendor.');}vendors.push({id:found.id,name:found.data.name,archived:found.archived});
 }
 options();if(previous)q('#vendor').value=previous;
 q('#vendor-limit').textContent=result.nextOffset!==null?'The selector shows the first 500 active vendors. Use Statement in the vendor directory to open another or archived vendor.':'';
 if(!vendors.length){status('Save a vendor in the vendor directory before generating a statement.');return}
 const next=initial&&['afterDate','afterSequence'].some(k=>params.has(k))?{date:params.get('afterDate'),sequence:params.get('afterSequence'),snapshot:params.get('snapshot')}:null;await load(next,next?null:1);
 }catch(error){if(id===generation)status(error.message,true)}finally{if(id===generation)setBusy(false)}
}
q('#filters').onsubmit=event=>{event.preventDefault();prepare()};for(const input of q('#filters').querySelectorAll('input,select'))input.onchange=()=>{invalidate();if(input.id==='business'){localStorage.setItem('billing-active-business',input.value);q('#vendor').replaceChildren();dates();prepare()}if(input.id==='demo'){sessionStorage.setItem('billing-demo-mode',input.value);q('#vendor').replaceChildren();prepare()}};
q('#first').onclick=()=>load();q('#next').onclick=()=>{if(data?.next)load(data.next,page===null?null:page+1)};
q('#csv').onclick=()=>{if(!data||busy)return;const p=new URLSearchParams(lastRequest);p.set('format','csv');const a=el('a','');a.href='/api/reports/vendor-statement?'+p;a.download='';document.body.append(a);a.click();a.remove()};
q('#print').onclick=async()=>{if(!data||busy)return;const p=new URLSearchParams(lastRequest);p.set('format','print');try{await openPrint('/api/reports/vendor-statement?'+p)}catch(error){status(error.message,true)}};
async function init(){try{const workspace=await api('/api/workspace');businesses=workspace.businesses;if(!businesses.length){status('Create a business before generating vendor statements.');return}q('#business').replaceChildren(...businesses.map(b=>{const option=el('option',b.name);option.value=b.id;return option}));q('#business').value=selectedBusiness(businesses).id;q('#demo').value=params.get('demo')||sessionStorage.getItem('billing-demo-mode')||'false';dates();for(const key of['from','to'])if(params.has(key))q('#'+key).value=params.get(key);q('#tools').hidden=false;await prepare(true)}catch(error){status(error.message,true);if(error.status===401){const a=el('a','Sign in');a.href=loginURL();q('#status').append(' ',a)}}}await init();
