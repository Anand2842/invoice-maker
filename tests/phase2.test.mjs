import test from 'node:test';
import assert from 'node:assert/strict';
import {build,buildWithImages} from '../public/document-export.js';
import {PDFDocument,PDFName,PDFDict} from 'pdf-lib';
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const doc={number:'P2-TEST',date:'2026-10-22',seller:{name:'Demo Studio'},buyer:{name:'Demo Client'},items:[{name:'Design service',quantity:2,rate:15000,taxRate:18}],taxType:'GST',bank:{Bank:'Demo Bank',Account:'DEMO-0001'}};
for(const template of ['classic','modern','minimal']) for(const type of ['invoice','gst-invoice','quotation','proforma','purchase-order','delivery-challan','commercial-invoice']) test(`${template}: ${type} PDF with embedded logo and signature`,async()=>{
 const result=await buildWithImages({...doc,type,template,logo:pixel,signature:pixel});const pdf=await PDFDocument.load(result.bytes);assert.equal(pdf.getPageCount(),result.pageCount);assert.equal(result.warnings.length,0);assert.equal(result.totals.total,type==='delivery-challan'?30000:35400);let images=0;for(const [,object]of pdf.context.enumerateIndirectObjects())if(object instanceof PDFDict&&object.get(PDFName.of('Subtype'))===PDFName.of('Image'))images++; // Image streams are checked by their dictionaries below.
 const rendered=pdf.context.enumerateIndirectObjects().filter(([,o])=>o.dict?.get(PDFName.of('Subtype'))===PDFName.of('Image'));assert.ok(rendered.length>=2);
 assert.equal(result.imageSlots.length,2);assert.ok(result.imageSlots.every(s=>s.top+s.height<778));
});
test('PDF templates reject invalid identifiers and colors',()=>{assert.throws(()=>build({...doc,template:'bad'}),/template/);assert.throws(()=>build({...doc,brandColor:'red'}),/color/)});
test('Artwork refuses remote fetches and oversized decompressed images',async()=>{await assert.rejects(buildWithImages({...doc,logo:'https://example.test/logo.png'}),/not fetched/);const bytes=Uint8Array.from(atob(pixel.split(',')[1]),c=>c.charCodeAt(0));new DataView(bytes.buffer).setUint32(16,5000000);await assert.rejects(buildWithImages({...doc,logo:bytes}),/million pixels/)});
test('Long branded documents reserve signature space on a valid page',async()=>{const result=await buildWithImages({...doc,logo:pixel,signature:pixel,items:Array.from({length:100},(_,i)=>({name:'Service '+i,quantity:1,rate:25,taxRate:18}))});assert.ok(result.pageCount>3);assert.equal(result.imageSlots.at(-1).page,result.pageCount-1);assert.ok(result.imageSlots.at(-1).top+60<778)});
