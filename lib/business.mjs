import{build}from'../public/document-export.js';
export const collections=['documents','clients','vendors','items','expenses','leads','subscriptions','journals','payments','shipments','settings'];
export function validateRecord(collection,data){
 if(!collections.includes(collection)||!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid record');
 const out=JSON.parse(JSON.stringify(data));
 if(JSON.stringify(out).length>400000)throw Error('Record is too large');
 const text=(key,required=true)=>{if(required&&!String(out[key]||'').trim())throw Error(key+' is required');if(String(out[key]||'').length>5000)throw Error(key+' is too long');};
 const number=(key,min=0)=>{if(out[key]===null||String(out[key]??'').trim()===''||!Number.isFinite(Number(out[key]))||Number(out[key])<min||Number(out[key])>1e10)throw Error(key+' must be a valid non-negative number');out[key]=Number(out[key]);};
 const date=key=>{const value=String(out[key]||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error(key+' must be a real date');};
 if(collection==='documents'){const pdf=build(out);out.totals=pdf.totals;if(!['draft','sent','paid','cancelled'].includes(out.status))out.status='draft';}
 else if(['clients','vendors'].includes(collection)){text('name');if(out.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))throw Error('Email is invalid');}
 else if(collection==='items'){text('name');number('quantity');number('rate');number('reorderLevel');}
 else if(collection==='expenses'){text('name');date('date');number('amount');}
 else if(collection==='leads'){text('name');number('amount');if(!['New','Contacted','Qualified','Proposal','Won','Lost'].includes(out.status))throw Error('Select a valid lead stage');}
 else if(collection==='subscriptions'){text('name');date('nextDate');number('amount');if(!['Monthly','Quarterly','Yearly'].includes(out.frequency))throw Error('Select a billing frequency');if(!['Active','Paused','Cancelled'].includes(out.status))throw Error('Select a valid subscription status');}
 else if(collection==='payments'){text('documentId');date('date');number('amount',0.01);text('method');}
 else if(collection==='journals'){text('name');date('date');if(!Array.isArray(out.entries)||out.entries.length<2||out.entries.length>1000)throw Error('A journal needs 2 to 1,000 entries');let debit=0,credit=0;for(const e of out.entries){if(!String(e.account||'').trim()||![e.debit,e.credit].every(n=>Number.isFinite(Number(n))&&Number(n)>=0&&Number(n)<=1e10)||Boolean(Number(e.debit))===Boolean(Number(e.credit)))throw Error('Each journal entry needs one positive debit or credit');debit+=Math.round(Number(e.debit)*100);credit+=Math.round(Number(e.credit)*100);}if(!debit||debit!==credit||!Number.isSafeInteger(debit))throw Error('Journal debits and credits must balance');if(new Set(out.entries.map(e=>e.account.trim().toLowerCase())).size<2)throw Error('Use at least two different accounts');}
 return out;
}
export function csv(rows){if(!rows.length)return '';const keys=[...new Set(rows.flatMap(Object.keys))];const cell=v=>'"'+String(typeof v==='object'?JSON.stringify(v):v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';return[keys.map(cell).join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\r\n');}
