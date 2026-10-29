import{api,selectedBusiness}from'/workspace-shell.js';
import{businessDate}from'/business-date.js';
import{loginURL}from'/auth-links.js';
import{escapeHTML as esc}from'/document-export.js';
import{csv}from'/csv.js';
import{visibleInvoices,settlementLabels,invoiceURL,statementURL}from'./view.mjs';

const q=s=>document.querySelector(s),params=new URLSearchParams(location.search);
let businesses=[],report=null,context=null,generation=0;
const money=n=>new Intl.NumberFormat('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
q('#as-of').value=params.get('date')||businessDate();
q('#demo').value=params.get('demo')==='true'||(!params.has('demo')&&sessionStorage.getItem('billing-demo-mode')==='true')?'true':'false';

function invalidate(){generation++;report=null;context=null;q('#result').hidden=true;q('#status').className='';q('#status').textContent='Filters changed. Review balances again.';q('#refresh').disabled=false}
function showError(error){q('#status').className='error';q('#status').textContent=error.message;const retry=document.createElement('button');retry.type='button';retry.textContent='Try again';retry.onclick=()=>q('#filters').requestSubmit();q('#status').append(retry)}
function renderRows(){
 if(!report)return;
 const rows=visibleInvoices(report.invoiceBalances,{search:q('#search').value,state:q('#state').value});
 q('#count').textContent=`${rows.length} of ${report.invoiceBalances.length} invoices · ${report.currency} · balances through ${report.to}`;
 if(!rows.length){q('#invoices').innerHTML='<div class="empty"><h2>'+(report.invoiceBalances.length?'No matching invoices':'No issued invoices in this view')+'</h2><p>'+(report.invoiceBalances.length?'Clear the search or choose a different status.':'Try another balance date, currency or data mode. Drafts and cancelled invoices are excluded.')+'</p></div>';return}
 q('#invoices').innerHTML='<table><caption class="visually-hidden">Invoice balances through '+esc(report.to)+'</caption><thead><tr>'+['Invoice / client','Due date','Charges','Adjustments','Received','Balance','Settlement','Actions'].map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr><td><a class="invoice-link" href="'+esc(invoiceURL(row,context))+'">'+esc(row.number)+'</a><small>'+esc(row.clientName||'No client name')+'</small>'+(row.scheduled?'<small>Invoice dated '+esc(row.date)+'; charges start on that date</small>':'')+'</td><td>'+esc(row.dueDate||'Not set')+(row.balanceMinor>0&&row.daysOverdue>0?'<small>'+row.daysOverdue+' days overdue</small>':'')+'</td>'+[row.charges,row.adjustments,row.received,row.balance].map(n=>'<td class="amount">'+money(n)+'</td>').join('')+'<td><span class="settlement '+(row.daysOverdue>0&&row.balanceMinor>0?'overdue':row.status)+'">'+settlementLabels[row.status]+'</span>'+(row.issues.some(i=>i.code==='PAID_WITHOUT_SETTLEMENT')?'<small class="review-flag">Marked paid; settlement needs review</small>':'')+'</td><td><div class="row-actions"><a href="'+esc(invoiceURL(row,context))+'">Open invoice</a>'+(row.clientId?'<a href="'+esc(statementURL(context,row.clientId))+'">Client statement</a>':'')+'</div></td></tr>').join('')+'</tbody></table>';
}
function render(){
 const overdue=report.aging.filter(r=>r.balance>0&&r.daysOverdue>0).reduce((sum,r)=>sum+Math.round(r.balance*100),0)/100;
 q('#summary').innerHTML=[['Outstanding',report.receivable,'Issued balances still due'],['Overdue',overdue,'Due before '+report.to],['Customer credits',report.creditBalance,'Kept separate from amounts due'],['Net balance',report.closing,'Outstanding less customer credits']].map(([label,n,hint])=>'<article><span>'+label+'</span><strong>'+money(n)+'</strong><small>'+esc(report.currency)+' · '+esc(hint)+'</small></article>').join('');
 q('#issue-heading').textContent='Review issues ('+report.issues.length+')';q('#issues').open=report.issues.length>0;
 q('#issue-list').innerHTML=report.issues.length?'<ul>'+report.issues.map(i=>'<li>'+esc(i.message)+' <small>('+esc(i.recordId)+')</small></li>').join('')+'</ul>':'<p>No issues detected in supported records.</p>';
 q('#limitations').innerHTML=report.limitations.map(s=>'<li>'+esc(s)+'</li>').join('');
 q('#statement').href=statementURL(context);renderRows();q('#result').hidden=false;
}
q('#filters').onsubmit=async event=>{
 event.preventDefault();invalidate();const id=generation,request={business:q('#business').value,date:q('#as-of').value,currency:q('#currency').value,demo:q('#demo').value};
 q('#refresh').disabled=true;q('#status').textContent='Calculating dated balances…';
 try{const result=await api('/api/reports/statement?'+new URLSearchParams({...request,from:request.date,to:request.date}));if(id!==generation)return;report=result;context=request;render();q('#status').textContent='Balances reviewed through '+report.to+'. Search and status filters affect the list only.'}
 catch(error){if(id===generation)showError(error)}finally{if(id===generation)q('#refresh').disabled=false}
};
q('#filters').querySelectorAll('input,select').forEach(el=>el.onchange=()=>{invalidate();if(el.id==='business'){localStorage.setItem('billing-active-business',el.value);q('#currency').value=businesses.find(b=>b.id===el.value)?.currency||'INR'}if(el.id==='demo')sessionStorage.setItem('billing-demo-mode',el.value)});
q('#search').oninput=renderRows;q('#state').onchange=renderRows;
q('#csv').onclick=()=>{if(!report)return;const rows=visibleInvoices(report.invoiceBalances,{search:q('#search').value,state:q('#state').value});const content=csv(rows.map(r=>({invoice:r.number,client:r.clientName,invoiceDate:r.date,dueDate:r.dueDate,asOf:report.to,currency:report.currency,charges:r.charges,adjustments:r.adjustments,received:r.received,balance:r.balance,settlement:settlementLabels[r.status],daysOverdue:r.daysOverdue,scheduled:r.scheduled})));const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='receivables-'+report.to+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};

async function init(){
 q('#entry').replaceChildren();q('#entry').textContent='Checking your account…';q('#tools').hidden=true;
 try{
  const auth=await api('/api/auth');
  if(!auth.user){q('#entry').innerHTML='<section class="panel"><h2>Sign in to review receivables</h2><p>Review balances for your saved business invoices.</p><a class="button primary" href="'+esc(loginURL())+'">Sign in</a></section>';return}
  q('[data-account-link]').textContent='Account';
  const workspace=await api('/api/workspace');businesses=workspace.businesses;
  if(!businesses.length){q('#entry').innerHTML='<section class="panel"><h2>Create your first business</h2><p>Set up your business and issue an invoice to start reviewing receivables.</p><a class="button primary" href="/services/?service=invoicing">Open workspace</a></section>';return}
  const active=selectedBusiness(businesses);q('#business').replaceChildren(...businesses.map(b=>new Option(b.name,b.id)));q('#business').value=active.id;q('#currency').value=params.get('currency')||active.currency||'INR';q('#tools').hidden=false;q('#entry').hidden=true;q('#filters').requestSubmit();
 }catch(error){q('#entry').hidden=false;q('#entry').innerHTML='<section class="panel" role="alert"><h2>Receivables could not be loaded</h2><p>'+esc(error.message)+'</p><button id="retry-entry">Try again</button></section>';q('#retry-entry').onclick=init}
}
await init();
