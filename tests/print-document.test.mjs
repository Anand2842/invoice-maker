import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {statementPrintHTML,paymentReceiptPrintHTML} from '../lib/print-document.mjs';
import {clientStatement} from '../lib/statements.mjs';
const receipt=()=>({id:'receipt-demo',business_id:'business-demo',demo:true,data:{kind:'receipt',number:'DEMO-RCT-001',documentId:'invoice-demo',invoiceNumber:'DEMO-INV-001',invoiceDate:'2026-10-01',invoiceType:'gst-invoice',currency:'INR',date:'2026-10-30',amount:'25.00',method:'बैंक हस्तांतरण',reference:'संदर्भ १२३',notes:'प्राप्त भुगतान\nधन्यवाद',seller:{name:'आनंद ट्रेडर्स',address:'पुणे, महाराष्ट्र',email:'demo@example.test'},buyer:{name:'श्री लक्ष्मी उद्योग',address:'मुंबई'}}});
const report=()=>clientStatement([
 {id:'client-demo',collection:'clients',data:{name:'श्री लक्ष्मी उद्योग'}},
 {id:'invoice-demo',collection:'documents',data:{type:'invoice',status:'sent',clientId:'client-demo',number:'चालान १२३',date:'2026-10-01',dueDate:'2026-10-15',currency:'INR',taxType:'NONE',seller:{name:'आनंद ट्रेडर्स'},buyer:{name:'श्री लक्ष्मी उद्योग'},items:[{name:'सेवा',quantity:1,rate:100,taxRate:0}]}},
 {id:'payment-demo',collection:'payments',data:{kind:'receipt',documentId:'invoice-demo',number:'रसीद १२३',date:'2026-10-30',currency:'INR',amount:25}}
],{name:'आनंद ट्रेडर्स',currency:'INR'},{from:'2026-10-01',to:'2026-10-30',currency:'INR',client:'client-demo'});

test('statement print renders actual canonical report balances and Hindi values without truncation',()=>{
 const input=report();input.demo=true;const before=JSON.stringify(input),html=statementPrintHTML(input);
 for(const text of ['आनंद ट्रेडर्स','श्री लक्ष्मी उद्योग','चालान १२३','रसीद १२३','INR 75.00','100.00','25.00','DEMO — NOT A REAL TRANSACTION','Receivables aging as of 2026-10-30','1–30 days overdue','Credit balances','Net balance','Report limitations'])assert.ok(html.includes(text),text);
 assert.equal(JSON.stringify(input),before);assert.match(html,/<meta charset="utf-8">/);assert.match(html,/<thead>/);assert.match(html,/<th scope="col"/);assert.match(html,/<caption>Statement movements in INR/);
});
test('receipt print renders frozen Unicode snapshot, positive amount and dated reversal',()=>{
 const input=receipt();input.business={name:'MUTABLE BUSINESS'};input.currentInvoice={buyer:{name:'MUTABLE BUYER'},balance:900};input.data.reversal={date:'2026-10-30',number:'REV-001',reason:'दोहरी प्रविष्टि'};
 const before=JSON.stringify(input),html=paymentReceiptPrintHTML(input);
 for(const text of ['आनंद ट्रेडर्स','श्री लक्ष्मी उद्योग','बैंक हस्तांतरण','संदर्भ १२३','प्राप्त भुगतान\nधन्यवाद','DEMO-RCT-001','DEMO-INV-001','Recorded amount: INR 25.00','Reversal recorded for 2026-10-30','REV-001','दोहरी प्रविष्टि','original positive amount','does not confirm gateway collection','current invoice balance'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/MUTABLE|900\.00|-25\.00/);assert.equal(JSON.stringify(input),before);assert.equal(paymentReceiptPrintHTML(input),html);
});
test('all user text is escaped and cannot create scripts, attributes, links or external content',()=>{
 const attack='</p><script>alert("x")</script><img src="https://evil.test/x" onerror="alert(1)">&\'';
 const input=receipt();for(const field of ['number','invoiceNumber','method','reference','notes'])input.data[field]=attack;input.data.seller={name:attack,address:attack,email:attack};
 const html=paymentReceiptPrintHTML(input);
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&quot;'));assert.ok(html.includes('&#39;'));assert.ok(html.includes('&amp;'));
 assert.doesNotMatch(html,/<img|<script>|<a[^>]+https:|onerror="/);assert.equal((html.match(/<script /g)||[]).length,1);assert.match(html,/<script src="\/print-document.js" defer><\/script>/);
 assert.match(html,/<title>[A-Za-z0-9_-]+<\/title>/);
 const statement=report();statement.businessName=attack;statement.rows[0].number=attack;statement.issues.push({code:'UNSAFE',recordId:'one',message:attack});statement.excluded.push({recordId:'two',reason:attack});statement.limitations.push(attack);
 const printed=statementPrintHTML(statement);assert.ok(printed.includes('&lt;img'));assert.doesNotMatch(printed,/<img|<script>|onerror="/);
});
test('long Devanagari names and 2,000 rows survive intact for browser pagination',()=>{
 const input=report(),name='श्री लक्ष्मी उद्योग '.repeat(45)+' अंतिम';input.businessName=name;input.rows=Array.from({length:2000},(_,index)=>({...input.rows[0],number:'चालान '+index,clientName:name}));
 const html=statementPrintHTML(input);assert.ok(html.includes(name));assert.ok(html.includes('चालान 1999'));assert.equal((html.match(/<tr>/g)||[]).length,2001);
 input.rows.push(input.rows[0]);assert.throws(()=>statementPrintHTML(input),/2,000/);
 const paid=receipt();paid.data.seller.name=name;paid.data.reference='संदर्भ '.repeat(200);paid.data.notes='धन्यवाद '.repeat(1100)+' अंत';assert.ok(paymentReceiptPrintHTML(paid).includes(' अंत'));
});
test('print controls are static, explicit, accessible and print stylesheet repeats headings',async()=>{
 const html=paymentReceiptPrintHTML(receipt()),script=await readFile(new URL('../public/print-document.js',import.meta.url),'utf8'),css=await readFile(new URL('../public/print-document.css',import.meta.url),'utf8');
 assert.match(html,/>Print \/ Save PDF<\/button>/);assert.match(html,/role="status" aria-live="polite"/);assert.doesNotMatch(html,/onload=|onclick=|<style>/);assert.match(script,/addEventListener\('click'/);assert.match(script,/window\.print\(\)/);assert.doesNotMatch(script,/fetch\(|innerHTML|document\.write/);assert.match(css,/@page\{size:A4/);assert.match(css,/thead\{display:table-header-group\}/);assert.match(css,/overflow-wrap:anywhere/);assert.match(css,/break-inside:avoid/);assert.doesNotMatch(css,/@import|url\(/);
});
test('receipt print enforces existing PDF amount, date, text and kind boundaries',()=>{
 for(const mutate of [x=>x.id='',x=>x.data.kind='reversal',x=>x.data.currency='inr',x=>x.data.date='2026-02-29',x=>x.data.amount='1.001',x=>x.data.amount='0.00',x=>x.data.notes='x'.repeat(12001),x=>x.data.seller.address=0,x=>x.data.buyer.email={},x=>x.data.reference='bad\u0000',x=>x.data.reversal={date:'2026-04-31'}]){const input=receipt();mutate(input);assert.throws(()=>paymentReceiptPrintHTML(input));}
 const minimal={id:'legacy',data:{kind:'receipt',number:'RCT-legacy',date:'2026-10-30',amount:1,currency:'INR'}};const html=paymentReceiptPrintHTML(minimal);assert.match(html,/Name not recorded/);assert.match(html,/Not recorded/);assert.doesNotMatch(html,/DEMO — NOT A REAL TRANSACTION/);
});
test('malformed statement values cannot print misleading totals or uncontrolled review payloads',()=>{
 for(const mutate of [r=>r.closing=Infinity,r=>r.buckets.current=NaN,r=>r.rows[0].debit='100',r=>r.from='2026-02-29',r=>r.currency='inr',r=>r.issues=null,r=>r.rows[0].number={},r=>r.limitations=['x'.repeat(12001)]]){const input=report();mutate(input);assert.throws(()=>statementPrintHTML(input));}
});
