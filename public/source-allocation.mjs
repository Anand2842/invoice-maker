// Pure arithmetic for reviewed source-document partial conversions. Database
// conversion authority independently proves the identities and frozen inputs.
export const allocationPolicy='cumulative-proportion-final-residual';
export const allocationComponents=Object.freeze(['taxable','discount','cgst','sgst','igst','vat','cess']);
const max=BigInt(Number.MAX_SAFE_INTEGER),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
function micros(v){if(typeof v!=='string'||!/^\d{1,10}(?:\.\d{1,6})?$/.test(v))throw Error('Source allocation quantities require decimal strings with at most six places.');const[w,f='']=v.split('.'),n=BigInt(w)*1000000n+BigInt(f.padEnd(6,'0'));if(n>1000000000000000n)throw Error('Source allocation quantity exceeds the supported range.');return n;}
function amounts(v){if(!object(v)||Object.keys(v).length!==allocationComponents.length)throw Error('Source allocation requires all seven monetary components.');return Object.fromEntries(allocationComponents.map(k=>{if(typeof v[k]!=='string'||!/^\d{1,16}$/.test(v[k])||BigInt(v[k])>max)throw Error('Source allocation monetary components must be safe non-negative integer cent strings.');return[k,BigInt(v[k])]}));}
export function validateOrderConversion(value,type){if(!object(value)||value.version!==1||value.policy!==allocationPolicy||!uuid.test(value.conversionId||'')||value.kind!==type||!['invoice','gst-invoice','commercial-invoice','delivery-challan','credit-note'].includes(type))throw Error('Invalid reviewed source document conversion.');return value;}
export function sourceAllocation(item,conversion,type,taxType,gstMode){
 const s=item.sourceAllocation;if(s==null){if(conversion!=null)throw Error('Every converted document line requires its frozen source allocation.');return null;}
 validateOrderConversion(conversion,type);
 if(!object(s)||s.version!==1||s.policy!==allocationPolicy||s.reviewed!==true||!uuid.test(s.sourceLineId||'')||!uuid.test(s.conversionLineId||'')||item.id!==s.conversionLineId)throw Error('Invalid reviewed source line allocation.');
 const source=micros(s.sourceQuantity),before=micros(s.quantityBefore),after=micros(s.quantityAfter),q=micros(String(item.quantity));
 if(source===0n||q===0n||before+q!==after||after>source)throw Error('Source allocation quantity interval is invalid.');
 const totals=amounts(s.sourceTotals),prior=amounts(s.allocatedBefore),parts=amounts(s.components);
 for(const k of allocationComponents){if(prior[k]>totals[k])throw Error('Source allocation exceeds the frozen source amount.');const remaining=totals[k]-prior[k],target=(totals[k]*after*2n+source)/(2n*source),delta=target-prior[k],expected=after===source?remaining:delta<0n?0n:delta>remaining?remaining:delta;if(parts[k]!==expected)throw Error('Source allocation does not match the cumulative rounding policy.');}
 const forbidden=type==='delivery-challan'||taxType==='NONE'?['cgst','sgst','igst','vat','cess']:taxType==='VAT'?['cgst','sgst','igst','cess']:gstMode==='igst'?['cgst','sgst','vat']:['igst','vat'];
 if(forbidden.some(k=>totals[k]!==0n))throw Error('Source allocation tax components do not match the document tax scheme.');
 const tax=parts.cgst+parts.sgst+parts.igst+parts.vat,subtotal=parts.taxable+parts.discount,total=parts.taxable+tax+parts.cess;
 if(subtotal>max||total>max||tax>max)throw Error('Source allocation is too large to export accurately.');
 return Object.fromEntries(Object.entries({...parts,subtotal,tax,total}).map(([k,v])=>[k,Number(v)]));
}
