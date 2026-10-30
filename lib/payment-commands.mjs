import {paymentMinor} from './payments.mjs';
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error('Enter a real payment date');return value}
function text(value,label,max,required=false){if(value===undefined&&!required)return '';if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw Error(label+' must be text'+(required?' and cannot be empty':'')+' (up to '+max+' characters)');return value.trim()}
export function paymentCommand(body){
 if(!body||!uuid(body.business)||!uuid(body.commandId)||typeof body.demo!=='boolean')throw Error('Select a business, data mode and valid retry key');
 const common={business:body.business.toLowerCase(),command_id:body.commandId.toLowerCase(),data_mode:body.demo};
 if(body.action==='record'){
  if(!uuid(body.invoice)||!Number.isInteger(body.version)||body.version<1)throw Error('Reload the invoice before recording payment');
  const minor=paymentMinor(body.amount);if(minor>1e12)throw Error('Payment amount exceeds the supported range');
  const payment_data={amount:(minor/100).toFixed(2),date:date(body.date),method:text(body.method,'Payment method',100,true),reference:text(body.reference,'Reference',500),notes:text(body.notes,'Notes',5000)};
  if(body.currency!==undefined){if(typeof body.currency!=='string'||!/[A-Z]{3}/.test(body.currency)||body.currency.length!==3)throw Error('Choose a three-letter currency code');payment_data.currency=body.currency}
  return {rpc:'billing_record_payment',args:{...common,invoice_id:body.invoice.toLowerCase(),expected_version:body.version,payment_data}};
 }
 if(body.action==='reverse'){
  if(!uuid(body.payment))throw Error('Select a recorded payment');
  return{rpc:'billing_reverse_payment',args:{...common,payment_id:body.payment.toLowerCase(),reversal_data:{date:date(body.date),reason:text(body.reason,'Reversal reason',1000,true)}}};
 }
 throw Error('Choose record or reverse payment');
}
const safeErrors=new Set(['You cannot record payments for this business','You cannot reverse payments for this business','This retry key was used for a different payment','The invoice changed. Reload before recording payment','Choose an issued invoice in this business and data mode','Payment currency differs from its invoice','Payment unavailable in this business and data mode','The payment invoice needs review before reversal','The payment currency needs review before reversal','A reversal cannot predate its payment','This payment is already reversed','The invoice due date needs review before recording payment','The invoice number needs review before recording payment','The invoice parties need review before recording payment','Enter a real payment date']);
export function paymentError(response){
 if(response.data?.code==='PGRST202')return{status:503,error:'Payment recording is not available yet.',code:'PAYMENT_NOT_READY'};
 const status=response.data?.code==='42501'?403:['40001','23505'].includes(response.data?.code)?409:response.status>=500?502:400;
 return{status,error:safeErrors.has(response.data?.message)?response.data.message:status===502?'The payment service did not respond. Retry with the same payment details.':'The payment could not be saved. Check the details and reload if the invoice changed.'};
}
