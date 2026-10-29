import{paymentMinor}from'./payments.mjs';
import{build}from'../public/document-export.js';
import{validHsnFormat}from'../public/hsn-search.js';
import{validateGstFields,validGstinFormat}from'./gst-fields.mjs';
export const collections=['documents','clients','vendors','items','expenses','leads','subscriptions','journals','payments','shipments','settings'];
export function validateRecord(collection,data){
 if(!collections.includes(collection)||!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid record');
 const out=JSON.parse(JSON.stringify(data));
 if(JSON.stringify(out).length>400000)throw Error('Record is too large');
 const text=(key,required=true)=>{if(required&&!String(out[key]||'').trim())throw Error(key+' is required');if(String(out[key]||'').length>5000)throw Error(key+' is too long');};
 const number=(key,min=0)=>{if(out[key]===null||String(out[key]??'').trim()===''||!Number.isFinite(Number(out[key]))||Number(out[key])<min||Number(out[key])>1e10)throw Error(key+' must be a valid non-negative number');out[key]=Number(out[key]);};
 const date=key=>{const value=String(out[key]||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error(key+' must be a real date');};
 if(collection==='documents'){validateGstFields(out);for(const item of out.items||[])if(item.hsn&&!validHsnFormat(item.hsn))throw Error('HSN/SAC must contain 4, 6 or 8 digits');const pdf=build(out);out.totals=pdf.totals;if(!['draft','sent','paid','cancelled'].includes(out.status))out.status='draft';if(['credit-note','debit-note'].includes(out.type)&&out.status==='paid')throw Error('Adjustment notes can be draft, issued or cancelled, not paid');}
 else if(['clients','vendors'].includes(collection)){text('name');if(out.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))throw Error('Email is invalid');}
 else if(collection==='items'){text('name');number('quantity');number('rate');number('reorderLevel');}
 else if(collection==='expenses'){
  text('name');date('date');number('amount');
  for(const key of ['taxableAmount','inputCgst','inputSgst','inputIgst','inputCess','reversalCgst','reversalSgst','reversalIgst','reversalCess'])if(out[key]!==undefined)number(key);
  if(out.vendorGstin){out.vendorGstin=String(out.vendorGstin).trim().toUpperCase();if(!validGstinFormat(out.vendorGstin))throw Error('Vendor GSTIN format is invalid');}
  for(const [key,options] of [['itcStatus',['Unreviewed','Eligible','Ineligible']],['reconciled2B',['No','Yes']],['reverseCharge',['No','Yes']]])if(out[key]!==undefined&&!options.includes(out[key]))throw Error('Invalid '+key);
  if(out.itcStatus==='Eligible'&&(!out.vendorGstin||out.reconciled2B!=='Yes'))throw Error('Eligible ITC requires a vendor GSTIN and explicit GSTR-2B reconciliation review');
  if(Number(out.inputIgst)>0&&(Number(out.inputCgst)>0||Number(out.inputSgst)>0))throw Error('An expense cannot mix IGST with CGST/SGST');
 }
 else if(collection==='leads'){text('name');number('amount');if(!['New','Contacted','Qualified','Proposal','Won','Lost'].includes(out.status))throw Error('Select a valid lead stage');}
 else if(collection==='subscriptions'){text('name');date('nextDate');number('amount');if(!['Monthly','Quarterly','Yearly'].includes(out.frequency))throw Error('Select a billing frequency');if(!['Active','Paused','Cancelled'].includes(out.status))throw Error('Select a valid subscription status');}
 else if(collection==='payments'){text('documentId');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(out.documentId))throw Error('Choose a saved invoice');out.documentId=out.documentId.toLowerCase();date('date');out.amount=paymentMinor(out.amount)/100;if(out.amount>1e10)throw Error('Payment amount exceeds the supported range');if(typeof out.method!=='string'||!out.method.trim()||out.method.length>100)throw Error('Enter a payment method (up to 100 characters)');out.method=out.method.trim();for(const [key,max]of [['reference',500],['notes',5000]])if(out[key]!==undefined&&(typeof out[key]!=='string'||out[key].length>max))throw Error(key+' must be text within the supported length');if(out.currency&&!/^[A-Z]{3}$/.test(out.currency))throw Error('Choose a three-letter currency code');if(out.direction&&out.direction!=='incoming')throw Error('Only incoming invoice payments are supported');}
 else if(collection==='journals'){text('name');date('date');if(!Array.isArray(out.entries)||out.entries.length<2||out.entries.length>1000)throw Error('A journal needs 2 to 1,000 entries');let debit=0,credit=0;for(const e of out.entries){if(!String(e.account||'').trim()||![e.debit,e.credit].every(n=>Number.isFinite(Number(n))&&Number(n)>=0&&Number(n)<=1e10)||Boolean(Number(e.debit))===Boolean(Number(e.credit)))throw Error('Each journal entry needs one positive debit or credit');debit+=Math.round(Number(e.debit)*100);credit+=Math.round(Number(e.credit)*100);}if(!debit||debit!==credit||!Number.isSafeInteger(debit))throw Error('Journal debits and credits must balance');if(new Set(out.entries.map(e=>e.account.trim().toLowerCase())).size<2)throw Error('Use at least two different accounts');}
 return out;
}
export {csv} from '../public/csv.js';
