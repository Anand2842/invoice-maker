import test from 'node:test';
import assert from 'node:assert/strict';
import {captureEditorDocument,readEditorDocument,createEditorDraft,readEditorDraft} from '../public/editor-document.mjs';
import {DraftStore} from '../public/drafts.js';
const fixture=()=>({
  type:'gst-invoice',template:'elegant',brandColor:'#6040a0',bank:{Bank:'Demo bank',Account:'123',IFSC:'DEMO0000001',UPI:'demo@bank'},clientId:'client-demo',
  number:'DEMO-001',date:'2026-10-30',dueDate:'2026-11-05',currency:'INR',roundOff:true,taxType:'GST',gstMode:'igst',
  seller:{name:'Demo seller',street:'12 Demo Road',city:'Pune',gstState:'Maharashtra',pincode:'411001',country:'India',address:'12 Demo Road, Pune',email:'seller@example.com',phone:'9000000000',gstin:'27AAAAA0000A1Z5',panNumber:'AAAAA0000A'},
  buyer:{name:'Demo buyer',address:'Mumbai',gstin:'27BBBBB1111B1Z6'},
  items:[{name:'Design service',description:'Discovery\nDelivery',hsn:'998314',uqc:'NA',quantity:'2.50',rate:'1000.125',taxRate:'18',cessRate:'2',discount:'7.5',discountType:'percent',customFields:[{label:'Project',value:'Website'}]},{name:'Materials',quantity:'1',rate:'100',discount:'10',discountType:'fixed'}],
  notes:'First line\nSecond line',terms:'Due in 7 days\nThank you',customFields:[{label:'Reference',value:'PO-101'}],shipping:{'shippedFrom.street':'Demo origin','shippedTo.street':'Demo destination'},transport:{documentNumber:'TR-001',transportMode:'Road'},
  gstReporting:{category:'taxable',placeOfSupply:'27',exportType:'with-payment'},taxDetails:{placeOfSupply:'27',reverseCharge:'Yes'},attachments:[{path:'demo/file.pdf',name:'Scope.pdf'}],signature:'data:image/png;base64,U0lHTg==',logo:'data:image/png;base64,TE9HTw==',status:'draft',editorSnapshot:{html:'<form>legacy shape</form>',layout:'desktop'}
});
const metadata={html:'<div><form data-optional-sections="true">rich text and optional sections</form></div>',layout:'desktop',isDemo:true,savedRecord:null};
test('versioned values survive browser draft storage with exact decimals, optional fields and assets',async()=>{
  const source=fixture(),draft=createEditorDraft(source,metadata),memory=new Map(),storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)};
  const writer=new DraftStore({storage,key:'synthetic'});writer.load();await writer.save(draft);
  const reader=new DraftStore({storage,key:'synthetic'}),loaded=reader.load(),restored=readEditorDraft(loaded,{expectedType:'gst-invoice'});
  const {editorSnapshot,...expected}=source;
  assert.deepEqual(restored.document,expected);assert.equal(restored.legacy,false);assert.equal(loaded.html,metadata.html);assert.equal(loaded.isDemo,true);assert.equal(loaded.canonicalDocument.value.editorSnapshot,undefined);
  source.items[0].rate='999';assert.equal(restored.document.items[0].rate,'1000.125');
});
test('old HTML-only drafts remain readable without inventing canonical values',()=>{
  const old={...metadata,bank:{Account:'legacy'},customLayout:'original'};const before=JSON.stringify(old);
  assert.deepEqual(readEditorDraft(old),{document:null,legacy:true});assert.equal(JSON.stringify(old),before);
});
test('unfinished field input is preserved without treating a draft as an issued invoice',()=>{
  const source=fixture();source.date='Oct ';source.dueDate='';source.items[0].quantity='';source.items[0].rate='1.';source.seller.name='';source.seller.email=undefined;
  const value=readEditorDocument(captureEditorDocument(source));assert.equal(value.date,'Oct ');assert.equal(value.items[0].rate,'1.');assert.equal(value.items[0].quantity,'');assert.equal(value.seller.name,'');assert.equal(Object.hasOwn(value.seller,'email'),false);
});
test('credit-note source context and each document family retain their type',()=>{
  for(const type of ['invoice','gst-invoice','quotation','proforma','purchase-order','delivery-challan','commercial-invoice','credit-note','debit-note']){
    const source={...fixture(),type,originalDocumentId:'source-invoice',originalDocumentNumber:'INV-01',originalDocumentDate:'2026-10-01',adjustmentReason:'Returned goods'};
    const value=readEditorDocument(captureEditorDocument(source),{expectedType:type});assert.equal(value.type,type);assert.equal(value.originalDocumentId,'source-invoice');assert.equal(value.adjustmentReason,'Returned goods');
  }
});
test('corrupt and future canonical data is rejected even when HTML fallback exists',()=>{
  const valid=createEditorDraft(fixture(),metadata);
  for(const mutate of [draft=>draft.canonicalDocument.version=2,draft=>draft.canonicalDocument.schema='other',draft=>draft.canonicalDocument.value.items=null,draft=>draft.canonicalDocument.value.items[0].rate=Infinity,draft=>draft.canonicalDocument.value.items[0].discountType='unknown',draft=>draft.canonicalDocument.value.template='unknown',draft=>draft.canonicalDocument.value.items[0].customFields=[{label:'x',value:{corrupt:true}}],draft=>draft.canonicalDocument.value.seller.name={},draft=>draft.canonicalDocument=null]){
    const draft=structuredClone(valid);mutate(draft);assert.throws(()=>readEditorDraft(draft),/preserved/);
  }
  assert.throws(()=>readEditorDraft(valid,{expectedType:'quotation'}),/preserved/);
  const dangerous=JSON.parse(JSON.stringify(valid));dangerous.canonicalDocument.value.seller=JSON.parse('{"__proto__":{"polluted":true}}');assert.throws(()=>readEditorDraft(dangerous),/preserved/);assert.equal({}.polluted,undefined);
});
test('canonical decoding cannot mutate the stored fallback or envelope',()=>{
  const draft=createEditorDraft(fixture(),metadata),before=JSON.stringify(draft),decoded=readEditorDraft(draft).document;
  decoded.bank.Account='changed';decoded.items[0].customFields[0].value='changed';assert.equal(JSON.stringify(draft),before);
  assert.throws(()=>createEditorDraft(fixture(),{html:''}),/preserved/);assert.throws(()=>readEditorDraft({...metadata,html:42}),/preserved/);
});
