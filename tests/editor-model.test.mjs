import test from 'node:test';
import assert from 'node:assert/strict';
import{newDocument,toDocument,fromDocument,autoGst,setTerms,setDate,setDueDate,problems,addDays,newItem}from'../public/editor/model.mjs';
import{calculate}from'../public/document-export.js';

const MH='27AAAAA0000A1Z5',KA='29BBBBB1111B1Z6';
const filled=(patch={})=>{const s=newDocument('invoice',{today:'2026-11-09'});s.seller={...s.seller,name:'Studio Paper',gstin:MH};s.buyer={...s.buyer,name:'Cedar & Co.',gstin:MH};s.items=[{...newItem(),name:'Design',quantity:'2',rate:'2500',taxRate:'18',hsn:'9983'},{...newItem(),name:'Hosting',quantity:'1',rate:'1000.50',taxRate:'18'}];return Object.assign(autoGst(s),patch)};

test('a new invoice starts with Net 15 from today, GST on, and one empty line',()=>{
 const s=newDocument('invoice',{today:'2026-11-09'});
 assert.equal(s.dueDate,'2026-11-24');assert.equal(s.paymentTerms,'15');assert.equal(s.taxType,'GST');assert.equal(s.items.length,1);
 assert.equal(newDocument('quotation',{today:'2026-11-09'}).dueDate,'','quotations have no due date by default');
 assert.equal(newDocument('delivery-challan',{today:'2026-11-09'}).taxType,'NONE');
});

test('payment terms and dates follow each other, and a hand-set due date clears the terms',()=>{
 const s=newDocument('invoice',{today:'2026-11-09'});
 setDate(s,'2026-12-20');assert.equal(s.dueDate,'2027-01-04');
 setTerms(s,'30');assert.equal(s.dueDate,'2027-01-19');
 setTerms(s,'');assert.equal(s.dueDate,'');
 setDueDate(s,'2026-12-31');assert.equal(s.paymentTerms,'');
 setDate(s,'2026-12-01');assert.equal(s.dueDate,'2026-12-31','a hand-set due date is not moved by a new issue date');
 assert.equal(addDays('2026-02-20',10),'2026-03-02');
});

test('the two GSTINs pick CGST+SGST or IGST and the place of supply, and fill the state names',()=>{
 let s=filled();assert.equal(s.gstMode,'split');assert.equal(s.placeOfSupply,'27');assert.equal(s.seller.gstState,'Maharashtra');
 s=filled();s.buyer.gstin=KA;autoGst(s);assert.equal(s.gstMode,'igst');assert.equal(s.placeOfSupply,'29');assert.equal(s.buyer.gstState,'Karnataka');
 s=filled();s.taxType='NONE';s.buyer.gstin=KA;autoGst(s);assert.equal(s.gstMode,'split','no GST, no change');
});

test('the document it produces is accepted by the PDF engine and gives the same totals as the figures by hand',()=>{
 const s=filled();s.items[0].discount='10';s.items[0].discountType='percent';
 const r=calculate(toDocument(s));
 // 2 x 2500 = 5000, 10% off = 4500; 1000.50; taxable 5500.50; 18% = 990.09
 assert.equal(r.totals.taxable,5500.5);assert.equal(r.totals.tax,990.09);assert.equal(r.totals.total,6490.59);
 assert.equal(r.totals.igst,0);assert.ok(r.totals.cgst>0&&r.totals.sgst>0);
 s.buyer.gstin=KA;autoGst(s);const i=calculate(toDocument(s));assert.equal(i.totals.igst,990.09);assert.equal(i.totals.cgst,0);
 assert.equal(toDocument(s).taxDetails.placeOfSupply,'29');
 assert.equal(toDocument(s).seller.address,'Maharashtra, India');
});

test('saved documents come back as the same editor state, including ones from the older editor',()=>{
 const s=filled();s.number='INV-000012';s.notes='Thank you';s.terms='Pay within 15 days';
 const back=fromDocument(toDocument(s));
 assert.deepEqual(toDocument(back),toDocument(s));
 // An older document: numbers as strings, no title, due date that no longer matches the terms.
 const old={type:'invoice',number:'ST-000003',date:'2026-10-01',dueDate:'2026-10-20',paymentTerms:'15',currency:'INR',taxType:'GST',gstMode:'igst',seller:{name:'A'},buyer:{name:'B'},items:[{name:'X',quantity:1,rate:100,taxRate:18}],template:'weird'};
 const o=fromDocument(old);assert.equal(o.paymentTerms,'','terms that no longer match the dates are dropped');assert.equal(o.dueDate,'2026-10-20');assert.equal(o.template,'classic');assert.equal(o.items[0].quantity,'1');assert.equal(o.gstMode,'igst');
});

test('problems come in plain words and in the order a person fixes them',()=>{
 const s=newDocument('invoice',{today:'2026-11-09'});
 const msgs=problems(s).map(p=>p.message);
 assert.deepEqual(msgs.slice(0,2),['Add your client’s name to continue.','Add your business name to continue.']);
 assert.ok(msgs.includes('Item 1: add a name.')&&msgs.includes('Item 1: enter the rate.'));
 const ok=filled();assert.deepEqual(problems(ok),[]);
 ok.dueDate='2026-11-01';assert.equal(problems(ok)[0].message,'The due date cannot be before the issue date.');
 ok.dueDate='';ok.buyer.gstin='12AB';assert.match(problems(ok)[0].message,/15 letters and numbers/);
 ok.buyer.gstin='';ok.items[0].quantity='0';assert.match(problems(ok)[0].message,/quantity must be more than zero/);
});
