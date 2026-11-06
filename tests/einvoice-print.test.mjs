import test from 'node:test';
import assert from 'node:assert/strict';
import {complianceDocumentPrintHTML} from '../lib/print-document.mjs';

test('issued print includes escaped frozen details and labelled simulated compliance',()=>{
 const documentId='doc',snapshot={seller:{name:'Seller <test>'},buyer:{name:'Buyer'},items:[{name:'Goods',hsn:'1234',quantity:'2',rate:'50'}],currency:'INR',totals:{total:100}};
 const report={demo:false,documents:[{documentId,number:'INV-1',type:'invoice',date:'2026-10-01',snapshot}],records:[{documentId,kind:'irn',response:{Irn:'abc',AckNo:'123',AckDt:'date'}},{documentId,kind:'ewb',response:{ewayBillNo:'456',validUpto:'tomorrow'}}]};
 const html=complianceDocumentPrintHTML(report,documentId);
 for(const value of ['Seller &lt;test&gt;','SIMULATED','abc','123','456','tomorrow'])assert.ok(html.includes(value));
 assert.throws(()=>complianceDocumentPrintHTML(report,'other'),/not found/);
});
