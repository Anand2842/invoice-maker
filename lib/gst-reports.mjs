import {calculate} from '../public/document-export.js';
import {csv} from './business.mjs';
import {GST_STATES as STATES,UQC,validGstinFormat as gstin} from './gst-fields.mjs';
import {findHsn} from './hsn-sac.mjs';
const TYPES=['invoice','gst-invoice','commercial-invoice','credit-note','debit-note'];
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const taxKeys=['txval','iamt','camt','samt','csamt'];
const zero=()=>({txval:0,iamt:0,camt:0,samt:0,csamt:0});
function date(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw Error('Use a real YYYY-MM-DD date');return v}
function add(a,b,sign=1){for(const k of taxKeys){const next=a[k]+Math.round((b[k]||0)*100)*sign;if(!Number.isSafeInteger(next))throw Error('Report totals exceed safe monetary precision');a[k]=next}return a}
function major(a){return Object.fromEntries(Object.entries(a).map(([k,v])=>[k,taxKeys.includes(k)?round(v/100):v]))}
function itemTax(item){const m=item.minor;return{rt:item.taxRate,txval:m.taxable/100,iamt:m.igst/100,camt:m.cgst/100,samt:m.sgst/100,csamt:m.cess/100}}
function threshold(day){return day<'2024-08-01'?250000:100000}
function posOf(d){const p=String(d.gstReporting?.placeOfSupply||d.taxDetails?.placeOfSupply||'').trim();return STATES.has(p)?p:''}
export function gstReport(records,business,{from,to,type='gstr-1'}){
 date(from);date(to);if(from>to||Date.parse(to)-Date.parse(from)>366*86400000)throw Error('Choose a date range of at most one year');if(!['gstr-1','gstr-3b'].includes(type))throw Error('Choose GSTR-1 or GSTR-3B');
 business={...business,gstin:String(business.gstin||'').trim().toUpperCase()};
 const issues=[],excluded=[],rows=[],b2b=new Map(),b2cl=new Map(),b2cs=new Map(),cdnr=new Map(),cdnur=[],exports=[],hsn=new Map(),nil=[],adjustments=[];
 const outward={taxable:zero(),zeroRated:zero(),nilExempt:zero(),nonGst:zero(),reverseCharge:zero()},itc={available:zero(),reversed:zero()},unreviewedExpenses=[];
 const recordLookup=new Map(records.map(r=>[r.id,r]));
 const issue=(id,code,message)=>{const record=recordLookup.get(id);issues.push({recordId:id||null,collection:record?.collection,documentType:record?.data?.type,code,message})};
 if(!gstin(business.gstin))issue(null,'BUSINESS_GSTIN','Add a valid business GSTIN before filing.');
 const parents=new Map(records.filter(r=>r.collection==='documents').map(r=>[r.id,r]));
 for(const record of records){const d=record.data||{};if(record.archived)continue;if(!d.date||d.date<from||d.date>to)continue;try{date(d.date)}catch{issue(record.id,'INVALID_DATE','Record date is invalid.');continue}
  if(record.collection==='expenses'){
   const amounts={txval:Number(d.taxableAmount||0),camt:Number(d.inputCgst||0),samt:Number(d.inputSgst||0),iamt:Number(d.inputIgst||0),csamt:Number(d.inputCess||0)};
   if(Object.values(amounts).some(n=>!Number.isFinite(n)||n<0)){issue(record.id,'EXPENSE_TAX','Expense tax amounts are invalid.');continue}
   if(Number(d.inputIgst)>0&&(Number(d.inputCgst)>0||Number(d.inputSgst)>0)){issue(record.id,'EXPENSE_TAX_MODE','Expense cannot mix IGST and CGST/SGST.');continue}
   const rev={txval:0,camt:Number(d.reversalCgst||0),samt:Number(d.reversalSgst||0),iamt:Number(d.reversalIgst||0),csamt:Number(d.reversalCess||0)};if(Object.values(rev).some(n=>!Number.isFinite(n)||n<0)){issue(record.id,'ITC_REVERSAL','Invalid ITC reversal amount.');continue}
   if(d.reverseCharge==='Yes')add(outward.reverseCharge,amounts);
   if(d.itcStatus==='Eligible'&&gstin(d.vendorGstin)&&d.reconciled2B==='Yes'){add(itc.available,{...amounts,txval:0});}
   else if(d.itcStatus!=='Ineligible'){unreviewedExpenses.push(record.id);issue(record.id,'ITC_REVIEW','Expense ITC needs an explicit eligibility and GSTR-2B reconciliation review. Vendor GSTIN alone is insufficient.');}
   add(itc.reversed,rev);continue;
  }
  if(record.collection!=='documents'||!TYPES.includes(d.type)||!['sent','paid'].includes(d.status)){excluded.push({id:record.id,reason:'Not an issued invoice or adjustment'});continue}
  if(d.currency!=='INR'){issue(record.id,'FOREIGN_CURRENCY','Convert and review the INR taxable value before GST reporting.');excluded.push({id:record.id,reason:'Foreign currency'});continue}
  if(d.taxType==='VAT'){issue(record.id,'VAT_UNSUPPORTED','VAT documents are excluded from GST reporting.');continue}
  let calculated;try{calculated=calculate(d)}catch(e){issue(record.id,'INVALID_DOCUMENT',e.message);continue}
  const isNote=['credit-note','debit-note'].includes(d.type),sign=d.type==='credit-note'?-1:1,parent=isNote?parents.get(d.originalDocumentId)?.data:d;
  if(!parent){issue(record.id,'MISSING_INVOICE','Original invoice is required to classify the adjustment.');continue}
  let original;if(isNote){try{original=calculate(parent);if(!['sent','paid'].includes(parent.status))throw Error('Parent is not issued')}catch{issue(record.id,'PARENT_TOTAL','Original invoice totals or status are invalid.');continue}}
  const buyer=(parent.buyer?.gstin||'').trim().toUpperCase(),seller=(d.seller?.gstin||business.gstin||'').trim().toUpperCase(),pos=posOf(parent),registered=Boolean(buyer);
  if(registered&&!gstin(buyer))issue(record.id,'BUYER_GSTIN','Buyer GSTIN has an invalid format.');
  if(!gstin(seller)||seller!==business.gstin)issue(record.id,'SELLER_GSTIN','Invoice seller GSTIN must match the selected business.');
  const category=parent.gstReporting?.category||'taxable';
  if(!['taxable','zero-rated','nil-rated','exempt','non-gst'].includes(category)){issue(record.id,'CATEGORY','Select a supported GST supply classification.');continue}
  if(parent.type==='commercial-invoice'&&!parent.gstReporting?.category){issue(record.id,'EXPORT_CLASSIFICATION','Commercial invoices require an explicit domestic/export classification.');continue}
  if(category!=='zero-rated'&&!pos){issue(record.id,'PLACE_OF_SUPPLY','Select an explicit two-digit place-of-supply state code.');continue}
  if(!/^[A-Za-z0-9/-]{1,16}$/.test(d.number||''))issue(record.id,'DOCUMENT_NUMBER','GST document numbers need 1–16 letters/digits, slash or hyphen.');
  if(category==='taxable'&&(calculated.document.taxType!=='GST'||calculated.document.items.some(i=>i.taxRate===0)))issue(record.id,'ZERO_RATE_REVIEW','Confirm nil/exempt/zero-rated treatment for zero-tax lines.');
  if(['nil-rated','exempt','non-gst'].includes(category)&&calculated.totals.tax+calculated.totals.cess>0){issue(record.id,'CATEGORY_TAX','Nil/exempt/non-GST supplies cannot contain GST or cess.');continue}
  if(category==='zero-rated'&&(calculated.totals.cgst+calculated.totals.sgst>0)){issue(record.id,'EXPORT_TAX_MODE','Export supplies cannot contain CGST/SGST. Review IGST or without-payment treatment.');continue}
  if(category==='zero-rated'&&registered){issue(record.id,'SPECIAL_ZERO_RATED','Registered-recipient zero-rated supplies require SEZ/special-supply review, which this workpaper does not support.');continue}
  const interstate=pos&&seller.slice(0,2)!==pos;
  if(category==='taxable'&&((interstate&&calculated.totals.cgst+calculated.totals.sgst>0)||(!interstate&&calculated.totals.igst>0))){issue(record.id,'TAX_MODE','GST components conflict with supplier state and place of supply.');continue}
  const detail={inum:d.number,idt:d.date.split('-').reverse().join('-'),val:calculated.totals.total,pos:category==='zero-rated'?'96':pos,rchrg:d.taxDetails?.reverseCharge==='Yes'?'Y':'N',inv_typ:'R',itms:calculated.document.items.map((i,n)=>({num:n+1,itm_det:itemTax(i)}))};
  const sums=zero();for(const i of detail.itms)add(sums,i.itm_det);const summary=major(sums);
  const outKey=category==='taxable'?'taxable':category==='zero-rated'?'zeroRated':category==='non-gst'?'nonGst':'nilExempt';
  if(detail.rchrg!=='Y')add(outward[outKey],summary,sign);else issue(record.id,'OUTWARD_RCM','Outward reverse-charge supplies excluded from supplier output-tax estimate; review return treatment.');
  let section;
  if(['nil-rated','exempt','non-gst'].includes(category)){section='NIL';nil.push({number:d.number,category,...Object.fromEntries(Object.entries(summary).map(([k,v])=>[k,v*sign]))});}
  else if(isNote){
   const note={nt_num:d.number,nt_dt:detail.idt,ntty:sign<0?'C':'D',val:detail.val,pos:detail.pos,rchrg:detail.rchrg,itms:detail.itms,originalInvoice:parent.number};adjustments.push({id:record.id,originalInvoiceId:d.originalDocumentId,...note});
   if(registered){section='CDNR';const group=cdnr.get(buyer)||{ctin:buyer,nt:[]};group.nt.push(note);cdnr.set(buyer,group)}
   else{if(category==='zero-rated'||(interstate&&original.totals.total>threshold(parent.date))){section='CDNUR';cdnur.push({...note,typ:category==='zero-rated'?'EXP':'B2CL'})}else section='B2CS';}
  }else if(category==='zero-rated'){section='EXP';exports.push({...detail,exp_typ:calculated.totals.igst?'WPAY':'WOPAY'});}
  else if(registered){section='B2B';const group=b2b.get(buyer)||{ctin:buyer,inv:[]};group.inv.push(detail);b2b.set(buyer,group)}
  else if(interstate&&detail.val>threshold(d.date)){section='B2CL';const group=b2cl.get(pos)||{pos,inv:[]};group.inv.push(detail);b2cl.set(pos,group)}else section='B2CS';
  for(let n=0;n<calculated.document.items.length;n++){
   const item=calculated.document.items[n],amounts=itemTax(item),original=d.items[n],hsnCode=item.hsn;
   if(section==='B2CS'){const key=JSON.stringify([pos,amounts.rt,interstate]);const group=b2cs.get(key)||{pos,rt:amounts.rt,sply_ty:interstate?'INTER':'INTRA',...zero()};add(group,amounts,sign);b2cs.set(key,group)}
   if(!/^\d{4}(?:\d{2})?(?:\d{2})?$/.test(hsnCode)){issue(record.id,'HSN','Add a valid 4, 6 or 8 digit HSN/SAC code.');continue}
   if(!findHsn(hsnCode))issue(record.id,'HSN_REFERENCE','Code '+hsnCode+' is not in the bundled reference. Verify the complete Indian classification.');
   const uqc=original.uqc|| (hsnCode.startsWith('99')?'NA':'');if(!UQC.has(uqc)||(!hsnCode.startsWith('99')&&uqc==='NA'))issue(record.id,'UQC','Goods need a valid unit quantity code for the HSN summary.');
   const bucket=registered?'b2b':'b2c',key=JSON.stringify([bucket,hsnCode,uqc,amounts.rt]);const group=hsn.get(key)||{bucket,hsn_sc:hsnCode,desc:item.name,uqc,rt:amounts.rt,qty:0,val:0,...zero()};group.qty+=Number(item.quantity)*sign;group.val+=item.minor.total*sign;add(group,amounts,sign);hsn.set(key,group);
  }
  rows.push({id:record.id,section,number:d.number,date:d.date,buyer:parent.buyer?.name||'',gstin:buyer,pos:detail.pos,sign,total:detail.val*sign,...Object.fromEntries(Object.entries(summary).map(([k,v])=>[k,round(v*sign)]))});
 }
 const included=new Set(rows.map(r=>r.id)),excludedIds=new Set(excluded.map(r=>r.id));for(const record of records)if(record.collection==='documents'&&!record.archived&&record.data?.date>=from&&record.data.date<=to&&!included.has(record.id)&&!excludedIds.has(record.id))excluded.push({id:record.id,reason:issues.find(i=>i.recordId===record.id)?.message||'Unsupported document'});
 const hsnRows=[...hsn.values()].map((g,i)=>({...major(g),num:i+1,qty:Math.round(g.qty*1e6)/1e6,val:round(g.val/100)}));
 const gstr1={b2b:[...b2b.values()],b2cl:[...b2cl.values()],b2cs:[...b2cs.values()].map(major),cdnr:[...cdnr.values()],cdnur,exp:exports,nil,hsn:{b2b:hsnRows.filter(g=>g.bucket==='b2b'),b2c:hsnRows.filter(g=>g.bucket==='b2c')}};
 const gstr3b={sup_details:{osup_det:major(outward.taxable),osup_zero:major(outward.zeroRated),osup_nil_exmp:major(outward.nilExempt),osup_nongst:major(outward.nonGst),isup_rev:major(outward.reverseCharge)},itc:{reviewedAvailable:major(itc.available),reviewedReversed:major(itc.reversed),net:major(Object.fromEntries(taxKeys.map(k=>[k,itc.available[k]-itc.reversed[k]]))),unreviewedExpenseIds:unreviewedExpenses}};
 const report={schema:'folio-gst-workpaper-v1',type,from,to,gstin:business.gstin||'',portalReady:false,limitations:['Review workpaper only; not validated for GST portal upload.','No GSTR-2B import, registration-status validation, amendments, advances, e-commerce or SEZ/deemed-export handling.','ITC is included only when explicitly marked eligible and reconciled; legal eligibility remains a review responsibility.'],issues,excluded,rows,adjustments,gstr1,gstr3b};
 report.exportRows=gstExportRows(report);return report;
}
export function gstExportRows(report){
 if(report.type==='gstr-1')return report.rows.map(({id,...row})=>row);
 const labels={osup_det:'3.1(a) Taxable outward supplies',osup_zero:'3.1(b) Zero-rated outward supplies',osup_nil_exmp:'3.1(c) Nil/exempt outward supplies',isup_rev:'3.1(d) Inward reverse charge',osup_nongst:'3.1(e) Non-GST outward supplies'};
 return [...Object.entries(report.gstr3b.sup_details).map(([key,value])=>({section:labels[key],...value})),...['reviewedAvailable','reviewedReversed','net'].map(key=>({section:{reviewedAvailable:'4 ITC reviewed available',reviewedReversed:'4 ITC reviewed reversals',net:'4 ITC net'}[key],...report.gstr3b.itc[key]}))];
}
export function gstCSV(report){return csv(gstExportRows(report))}

