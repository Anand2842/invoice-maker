// The editor's data and rules, with no page code, so they can be tested directly. The document it produces has the
// same shape the PDF engine and the save API already use.
import{GST_STATES,stateCodeOf,gstinState}from'./gst-states.mjs';

export const DOC_TYPES={invoice:'Invoice','gst-invoice':'Tax Invoice',quotation:'Quotation',proforma:'Proforma Invoice','purchase-order':'Purchase Order','delivery-challan':'Delivery Challan','commercial-invoice':'Commercial Invoice'};
export const TEMPLATES=['classic','modern','minimal','elegant','compact'];
export const PAYMENT_TERMS=[['','No due date'],['0','Due on receipt'],['7','Net 7'],['15','Net 15'],['30','Net 30'],['45','Net 45'],['60','Net 60']];
export const CURRENCIES=['INR','USD','EUR','GBP','AUD','CAD','SGD','AED'];
// Quotations and orders usually carry no due date by default; invoices default to Net 15, like the old editor.
const DEFAULT_TERMS={invoice:'15','gst-invoice':'15','commercial-invoice':'15',proforma:'15'};

export const emptyParty=()=>({name:'',gstin:'',street:'',city:'',gstState:'',pincode:'',country:'India',email:'',phone:'',panNumber:''});
export const newItem=()=>({name:'',description:'',hsn:'',uqc:'',quantity:'1',rate:'',taxRate:'18',cessRate:0,discount:'',discountType:'fixed'});

export function addDays(iso,days){const[y,m,d]=iso.split('-').map(Number);const e=new Date(Date.UTC(y,m-1,d+Number(days)));return e.toISOString().slice(0,10)}
export const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;

export function newDocument(type,{today,business}={}){
 const kind=DOC_TYPES[type]?type:'invoice';
 const terms=DEFAULT_TERMS[kind]??'';
 const s={type:kind,title:DOC_TYPES[kind],number:'',date:today,paymentTerms:terms,dueDate:'',currency:'INR',taxType:kind==='delivery-challan'?'NONE':'GST',gstMode:'split',placeOfSupply:'',reverseCharge:false,roundOff:false,
  seller:emptyParty(),buyer:emptyParty(),items:[newItem()],notes:'',terms:'',bank:null,signature:'',logo:'',template:'classic',brandColor:'#115e59',clientId:null,status:'draft'};
 if(terms!=='')s.dueDate=addDays(today,terms);
 if(business)applyBusiness(s,business);
 return autoGst(s);
}

// Fills "billed by", bank details, defaults and brand from the business profile.
export function applyBusiness(s,b){
 s.seller={...s.seller,name:b.name||'',gstin:b.gstin||'',street:b.address||'',phone:b.phone||'',email:b.email||'',panNumber:b.pan||''};
 s.currency=b.currency||s.currency;
 if(b.bank_name||b.bank_account||b.bank_ifsc||b.bank_upi)s.bank={Bank:b.bank_name||'',Account:b.bank_account||'',IFSC:b.bank_ifsc||'',UPI:b.bank_upi||''};
 if(b.default_notes&&!s.notes)s.notes=b.default_notes;
 if(b.default_terms&&!s.terms)s.terms=b.default_terms;
 if(b.default_tax_rate!==undefined&&b.default_tax_rate!==null&&s.items.length===1&&!s.items[0].name)s.items[0].taxRate=String(b.default_tax_rate);
 if(/^#[0-9a-f]{6}$/i.test(b.brand_color||''))s.brandColor=/^#(3c136b|5b3fa8)$/i.test(b.brand_color)?'#115e59':b.brand_color;
 return s;
}

// Both parties' GSTIN decide between CGST+SGST (same state) and IGST (different states), and the place of supply.
export function autoGst(s){
 if(s.taxType!=='GST')return s;
 for(const p of[s.seller,s.buyer]){const name=gstinState(p.gstin);if(name&&p.gstState.trim().toLowerCase()!==name.toLowerCase())p.gstState=name}
 const own=(s.seller.gstin||'').slice(0,2)||stateCodeOf(s.seller.gstState),their=(s.buyer.gstin||'').slice(0,2)||stateCodeOf(s.buyer.gstState);
 if(GST_STATES[own]&&GST_STATES[their]){s.gstMode=own===their?'split':'igst';s.placeOfSupply=their}
 return s;
}

// Choosing payment terms sets the due date from the issue date; setting a due date by hand clears the terms.
export function setTerms(s,days){s.paymentTerms=String(days);s.dueDate=days===''||validDate(s.date)===false?'':addDays(s.date,days);return s}
export function setDate(s,iso){s.date=iso;if(s.paymentTerms!==''&&validDate(iso))s.dueDate=addDays(iso,s.paymentTerms);return s}
export function setDueDate(s,iso){s.dueDate=iso;s.paymentTerms='';return s}

const party=p=>({...p,address:[p.street,p.city,p.gstState,p.pincode,p.country].filter(Boolean).join(', ')});

// The document the PDF engine and the save API take.
export function toDocument(s){
 return{type:s.type,title:s.title||DOC_TYPES[s.type],template:s.template,brandColor:s.brandColor,bank:s.bank,clientId:s.clientId,number:s.number,date:s.date,dueDate:s.dueDate,paymentTerms:s.paymentTerms,currency:s.currency,roundOff:s.roundOff,
  seller:party(s.seller),buyer:party(s.buyer),taxType:s.taxType,gstMode:s.gstMode,
  items:s.items.map(i=>({name:i.name,description:i.description||'',hsn:i.hsn||'',uqc:(i.uqc||'').trim().toUpperCase(),quantity:i.quantity,rate:i.rate,taxRate:s.taxType==='NONE'?0:i.taxRate,cessRate:i.cessRate||0,discount:i.discount||0,discountType:i.discountType==='percent'?'percent':'fixed',customFields:[]})),
  notes:s.notes,terms:s.terms,customFields:[],transport:{},shipping:{},gstReporting:null,
  taxDetails:{placeOfSupply:s.placeOfSupply||'',reverseCharge:s.reverseCharge?'Yes':'No'},attachments:[],signature:s.signature,logo:s.logo,status:s.status||'draft'};
}

// Rebuilds editor state from a saved document, including documents saved by the older editor.
export function fromDocument(d,{today}={}){
 const base=newDocument(d.type,{today:d.date||today});
 const p=x=>({...emptyParty(),...(x||{})});
 const s={...base,type:base.type,title:d.title||base.title,number:d.number||'',date:d.date||base.date,dueDate:d.dueDate||'',paymentTerms:d.paymentTerms??'',currency:d.currency||'INR',taxType:d.taxType||base.taxType,gstMode:d.gstMode||'split',
  placeOfSupply:d.taxDetails?.placeOfSupply||'',reverseCharge:d.taxDetails?.reverseCharge==='Yes',roundOff:Boolean(d.roundOff),seller:p(d.seller),buyer:p(d.buyer),
  items:(d.items&&d.items.length?d.items:[newItem()]).map(i=>({...newItem(),...i,discountType:i.discountType==='percent'?'percent':'fixed',quantity:String(i.quantity??'1'),rate:String(i.rate??''),taxRate:String(i.taxRate??'0'),discount:i.discount?String(i.discount):''})),
  notes:d.notes||'',terms:d.terms||'',bank:d.bank||null,signature:d.signature||'',logo:d.logo||'',template:TEMPLATES.includes(d.template)?d.template:'classic',brandColor:/^#[0-9a-f]{6}$/i.test(d.brandColor||'')?d.brandColor:'#115e59',clientId:d.clientId||null,status:d.status||'draft'};
 // A saved due date wins over terms; remember the terms only when they still match the dates.
 if(s.paymentTerms!==''&&validDate(s.date)&&validDate(s.dueDate)&&addDays(s.date,s.paymentTerms)!==s.dueDate)s.paymentTerms='';
 return s;
}

// Plain-words problems that stop a PDF or a save, in the order a person would fix them.
export function problems(s){
 const out=[];
 if(!validDate(s.date))out.push({field:'date',message:'Choose the issue date.'});
 if(s.dueDate&&!validDate(s.dueDate))out.push({field:'dueDate',message:'Choose a valid due date.'});
 else if(s.dueDate&&validDate(s.date)&&s.dueDate<s.date)out.push({field:'dueDate',message:'The due date cannot be before the issue date.'});
 if(!s.buyer.name.trim())out.push({field:'buyer.name',message:'Add your client’s name to continue.'});
 if(!s.seller.name.trim())out.push({field:'seller.name',message:'Add your business name to continue.'});
 for(const[k,p]of[['seller',s.seller],['buyer',s.buyer]])if(p.gstin&&!/^\d{2}[A-Z0-9]{13}$/i.test(p.gstin.trim()))out.push({field:k+'.gstin',message:'A GSTIN has 15 letters and numbers, starting with the 2-digit state code.'});
 s.items.forEach((i,n)=>{
  const row='Item '+(n+1)+': ';
  if(!i.name.trim())out.push({field:`items.${n}.name`,message:row+'add a name.'});
  const q=Number(i.quantity);if(!String(i.quantity).trim()||!Number.isFinite(q)||q<=0)out.push({field:`items.${n}.quantity`,message:row+'quantity must be more than zero.'});
  const r=Number(i.rate);if(!String(i.rate).trim()||!Number.isFinite(r)||r<0)out.push({field:`items.${n}.rate`,message:row+'enter the rate.'});
  const t=Number(i.taxRate);if(s.taxType!=='NONE'&&(!Number.isFinite(t)||t<0||t>100))out.push({field:`items.${n}.taxRate`,message:row+'tax rate must be from 0 to 100.'});
 });
 return out;
}
