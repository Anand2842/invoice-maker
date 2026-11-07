// The token lives in the URL fragment, which browsers never send to the server or in Referer headers.
const q=s=>document.querySelector(s),token=location.hash.slice(1);
const status=(text,error=false)=>{q('#status').textContent=text;q('#status').className=error?'error':''};
async function call(action){const r=await fetch('/api/pay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,action})});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'Payment link unavailable');return data}
const dateText=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)?new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(v+'T00:00:00Z')):v;
const moneyText=(c,v)=>{try{return new Intl.NumberFormat('en-IN',{style:'currency',currency:c||'INR'}).format(Number(v))}catch{return`${c} ${v}`}};
function show(d){for(const [id,value] of [['business',d.business],['number',d.number],['buyer',d.buyer],['due',d.dueDate?dateText(d.dueDate):'On receipt'],['amount',moneyText(d.currency,d.amount)]])q('#'+id).textContent=value;q('#details').hidden=false;q('#simulated').hidden=!d.simulated;
 const open=d.status==='open';q('#pay').hidden=!(open&&d.simulated);
 status(d.status==='paid'?'This invoice has been paid through this link. Thank you.':d.status==='open'?(d.simulated?'Review the amount, then complete the simulated payment.':'Online checkout opens through the business payment provider.'):'This payment link is no longer available. Contact the business for a new link.')}
q('#pay').addEventListener('click',async()=>{q('#pay').disabled=true;status('Recording payment…');try{const r=await call('capture');if(!r.recorded)throw Error(r.detail||'The payment needs review by the business.');show(await call('open'))}catch(e){status(e.message,true);q('#pay').disabled=false}});
if(!/^[0-9a-f]{64}$/.test(token))status('This payment link is incomplete. Open the full link you received.',true);
else call('open').then(show,e=>status(e.message,true));
