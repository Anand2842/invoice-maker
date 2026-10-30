/** Versioned editor values. This is a draft format, not financial validation.
 * Incomplete numeric/date input is deliberately retained until submission.
 * HTML remains a separate compatibility fallback for optional section layout.
 */
export const EDITOR_DOCUMENT_SCHEMA = 'folio.editor-document';
export const EDITOR_DOCUMENT_VERSION = 1;
const types = new Set(['invoice','gst-invoice','quotation','proforma','purchase-order','delivery-challan','commercial-invoice','credit-note','debit-note']);
const templates = new Set(['classic','modern','minimal','elegant','compact']);
const documentKeys = new Set(['type','template','brandColor','bank','clientId','number','date','dueDate','currency','roundOff','originalDocumentId','originalDocumentNumber','originalDocumentDate','adjustmentReason','seller','buyer','taxType','gstMode','items','notes','terms','customFields','transport','shipping','gstReporting','taxDetails','attachments','signature','logo','status']);
const fail = () => { throw Error('This document draft format could not be read. It has been preserved on this device.'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
function jsonCopy(value, depth=0) {
  if(depth>16)fail();
  if(value===null||typeof value==='boolean'||typeof value==='string')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))fail();return value;}
  if(Array.isArray(value)){if(value.length>2000)fail();return value.map(item=>jsonCopy(item,depth+1));}
  if(!object(value))fail();
  const copy={};
  for(const [key,item]of Object.entries(value)){if(item===undefined)continue;if(['__proto__','prototype','constructor'].includes(key))fail();copy[key]=jsonCopy(item,depth+1);}
  return copy;
}
function validate(value) {
  if(!object(value)||!types.has(value.type)||!object(value.seller)||!object(value.buyer)||!Array.isArray(value.items)||!value.items.length||value.items.length>1000)fail();
  if(Object.keys(value).some(key=>!documentKeys.has(key)))fail();
  for(const key of ['number','date','dueDate','currency','notes','terms','signature','logo','brandColor','status','originalDocumentId','originalDocumentNumber','originalDocumentDate','adjustmentReason','clientId'])if(value[key]!==undefined&&value[key]!==null&&typeof value[key]!=='string')fail();
  if(value.template!==undefined&&!templates.has(value.template))fail();
  if(value.taxType!==undefined&&!['GST','VAT','NONE'].includes(value.taxType))fail();
  if(value.gstMode!==undefined&&!['split','igst'].includes(value.gstMode))fail();
  if(value.roundOff!==undefined&&typeof value.roundOff!=='boolean')fail();
  for(const key of ['transport','shipping','taxDetails','bank','gstReporting'])if(value[key]!==undefined&&value[key]!==null&&!object(value[key]))fail();
  for(const key of ['customFields','attachments'])if(value[key]!==undefined&&!Array.isArray(value[key]))fail();
  for(const party of [value.seller,value.buyer])for(const key of ['name','street','city','gstState','pincode','country','address','email','phone','gstin','panNumber'])if(party[key]!==undefined&&party[key]!==null&&typeof party[key]!=='string')fail();
  const customFields=fields=>{if(fields===undefined)return;if(!Array.isArray(fields))fail();for(const field of fields)if(!object(field)||typeof field.label!=='string'||typeof field.value!=='string')fail();};
  customFields(value.customFields);
  for(const attachment of value.attachments||[])if(!object(attachment)||typeof attachment.path!=='string'||(attachment.name!==undefined&&typeof attachment.name!=='string'))fail();
  for(const item of value.items){
    if(!object(item))fail();
    for(const key of ['quantity','rate','taxRate','cessRate','discount'])if(item[key]!==undefined&&!['string','number'].includes(typeof item[key]))fail();
    for(const key of ['name','description','hsn','uqc','image'])if(item[key]!==undefined&&typeof item[key]!=='string')fail();
    if(item.discountType!==undefined&&!['percent','fixed'].includes(item.discountType))fail();
    customFields(item.customFields);
  }
  const copy=jsonCopy(value);
  if(JSON.stringify(copy).length>4000000)fail();
  return copy;
}
export function captureEditorDocument(document) {
  if(!object(document))fail();
  // Never embed a second HTML snapshot inside the versioned value payload.
  const {editorSnapshot,...value}=document;
  return {schema:EDITOR_DOCUMENT_SCHEMA,version:EDITOR_DOCUMENT_VERSION,value:validate(value)};
}
export function readEditorDocument(envelope,{expectedType}={}) {
  if(!object(envelope)||envelope.schema!==EDITOR_DOCUMENT_SCHEMA||envelope.version!==EDITOR_DOCUMENT_VERSION)fail();
  const value=validate(envelope.value);
  if(expectedType&&value.type!==expectedType)fail();
  return value;
}
export function createEditorDraft(document,metadata={}) {
  if(typeof metadata.html!=='string'||!metadata.html||metadata.html.length>=2000000)fail();
  return {...metadata,canonicalDocument:captureEditorDocument(document)};
}
export function readEditorDraft(draft,options={}) {
  if(!object(draft)||typeof draft.html!=='string'||!draft.html||draft.html.length>=2000000)fail();
  // Do not silently recover a corrupt/future canonical value from stale HTML.
  // The caller blocks saving and leaves the stored revision untouched.
  return {document:Object.hasOwn(draft,'canonicalDocument')?readEditorDocument(draft.canonicalDocument,options):null,legacy:!Object.hasOwn(draft,'canonicalDocument')};
}
