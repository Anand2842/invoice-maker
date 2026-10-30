import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument, PDFRawStream, decodePDFRawStream, StandardFonts} from 'pdf-lib';
import {buildPaymentReceipt} from '../lib/payment-receipt.mjs';

const receipt = () => ({
 id: 'payment-abc', business_id: 'business-one', demo: false,
 data: {
  kind: 'receipt', number: 'RCT-000001', documentId: 'invoice-123',
  invoiceNumber: 'INV-000014', invoiceDate: '2026-10-01', invoiceType: 'gst-invoice',
  currency: 'INR', date: '2026-10-29', amount: '25.00', method: 'Bank transfer',
  reference: 'BANK-XYZ-42', notes: 'Recorded by accounts.',
  seller: {name: 'Snapshot Seller', address: '4 Paper Lane\nMumbai', email: 'accounts@example.test'},
  buyer: {name: 'Snapshot Buyer', address: '10 North Road', email: 'payer@example.test'},
  clientId: 'client-55',
 },
});

async function inspect(bytes) {
 const pdf = await PDFDocument.load(bytes);
 const contents = [];
 for (const [, object] of pdf.context.enumerateIndirectObjects()) {
  if (object instanceof PDFRawStream) {
   const stream = Buffer.from(decodePDFRawStream(object).decode()).toString('latin1');
   if (stream.includes('BT')) contents.push(stream);
  }
 }
 const text = contents.map(stream => [...stream.matchAll(/<([a-fA-F0-9]+)>\s*Tj/g)]
  .map(match => Buffer.from(match[1], 'hex').toString('latin1')).join('\n')).join('\n');
 return {pdf, contents, text};
}

test('receipt contains the recorded snapshot, identifiers and honest payment wording', async () => {
 const input = receipt();
 // Mutable relation-like fields must never replace recorded parties or balance.
 input.business = {name: 'MUTABLE CURRENT BUSINESS'};
 input.currentInvoice = {balance: '900.00', buyer: {name: 'MUTABLE CUSTOMER'}};
 const before = JSON.stringify(input);
 const bytes = await buildPaymentReceipt(input);
 assert.ok(bytes instanceof Uint8Array);
 const {pdf, text} = await inspect(bytes);
 assert.equal(pdf.getPageCount(), 1);
 assert.equal(pdf.getTitle(), 'Payment receipt - RCT-000001');
 assert.equal(pdf.getAuthor(), 'Snapshot Seller');
 assert.equal(pdf.getCreationDate().toISOString(), '2026-10-29T00:00:00.000Z');
 for (const value of ['Payment receipt', 'RCT-000001', 'INR 25.00', '2026-10-29', 'Bank transfer', 'BANK-XYZ-42', 'Snapshot Seller', 'Snapshot Buyer', 'INV-000014', '2026-10-01', 'gst-invoice', 'payment-abc', 'business-one', 'invoice-123', 'Page 1 of 1']) {
  assert.ok(text.includes(value), 'missing receipt value: ' + value);
 }
 assert.match(text, /does not confirm gateway collection/);
 assert.match(text, /current invoice balance/);
 assert.doesNotMatch(text, /MUTABLE|900\.00|DEMO/);
 assert.equal(JSON.stringify(input), before);
});

test('the same immutable receipt produces stable bytes without generation-time fields', async () => {
 const input = receipt();
 const freeze = obj => {for (const v of Object.values(obj)) if (v && typeof v === 'object') freeze(v); return Object.freeze(obj);};
 freeze(input);
 assert.deepEqual(await buildPaymentReceipt(input), await buildPaymentReceipt(input));
});

test('demo pages explicitly identify a simulated payment', async () => {
 const input = receipt(); input.demo = true;
 const {text} = await inspect(await buildPaymentReceipt(input));
 assert.match(text, /DEMO - NOT A REAL PAYMENT/);
 assert.match(text, /DEMO/);
});

test('long party names, references and notes wrap and paginate without dropping their end', async () => {
 const input = receipt();
 input.demo = true;
 input.data.number = 'RCT-' + 'N'.repeat(240);
 input.data.reference = 'R'.repeat(2000) + ' END-REFERENCE';
 input.data.seller.name = 'A'.repeat(1000) + ' END-SELLER';
 input.data.buyer.address = ('Detailed address and suite '.repeat(150)) + ' END-ADDRESS';
 input.data.notes = ('Payment note with supporting recorded details. '.repeat(240)) + '\nEND-NOTES';
 const {pdf, contents, text} = await inspect(await buildPaymentReceipt(input));
 assert.ok(pdf.getPageCount() > 2);
 for (const marker of ['END-REFERENCE', 'END-SELLER', 'END-ADDRESS', 'END-NOTES']) assert.ok(text.includes(marker));
 assert.equal((text.match(/Payment receipt/g) || []).length, pdf.getPageCount());
 assert.equal((text.match(/DEMO - NOT A REAL PAYMENT/g) || []).length, pdf.getPageCount());
 for (let page = 1; page <= pdf.getPageCount(); page++) assert.ok(text.includes(`Page ${page} of ${pdf.getPageCount()}`));
 // All ordinary text origins stay within the page's content/header/footer area.
 for (const content of contents) for (const match of content.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)) {
  assert.ok(Number(match[1]) >= 42 && Number(match[1]) <= 554);
  assert.ok(Number(match[2]) >= 25 && Number(match[2]) <= 795);
 }
 const metrics = await PDFDocument.create();
 const regular = await metrics.embedFont(StandardFonts.Helvetica);
 const strong = await metrics.embedFont(StandardFonts.HelveticaBold);
 for (const content of contents) for (const match of content.matchAll(/BT\n([\s\S]*?)ET/g)) {
  const block = match[1], origin = block.match(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/);
  if (!origin) continue; // The diagonal demo watermark intentionally rotates.
  const font = block.match(/\/(Helvetica(?:-Bold)?)-\d+ ([\d.]+) Tf/);
  const encoded = block.match(/<([a-fA-F0-9]+)> Tj/);
  if (!font || !encoded) continue;
  const value = Buffer.from(encoded[1], 'hex').toString('latin1');
  const face = font[1] === 'Helvetica-Bold' ? strong : regular;
  assert.ok(Number(origin[1]) + face.widthOfTextAtSize(value, Number(font[2])) <= 553.29, 'text crosses right content edge');
 }
});

test('reversal annotates the original positive receipt and its effective date/reason', async () => {
 const input = receipt();
 input.data.reversal = {date: '2026-10-30', number: 'REV-000003', reason: 'Duplicate manual entry'};
 const {text} = await inspect(await buildPaymentReceipt(input));
 assert.match(text, /Reversal recorded for 2026-10-30/);
 assert.match(text, /REV-000003/);
 assert.match(text, /Duplicate manual entry/);
 assert.match(text, /INR 25\.00/);
 assert.doesNotMatch(text, /-25\.00/);
 assert.match(text, /original amount is retained/);
});

test('rejects missing receipt identity, other record kinds and invalid currency', async () => {
 for (const mutate of [
  x => delete x.id,
  x => {x.data.number = '  ';},
  x => {x.data.kind = 'reversal';},
  x => {x.data.currency = 'inr';},
  x => {x.data.currency = 'RUPEES';},
 ]) {
  const input = receipt(); mutate(input);
  await assert.rejects(() => buildPaymentReceipt(input));
 }
});

test('amount validation shares the positive, exact two-decimal payment contract', async () => {
 for (const amount of ['-25.00', '0.00', '1.001', '1e4', '90071992547409999', NaN, {}, '']) {
  const input = receipt(); input.data.amount = amount;
  await assert.rejects(() => buildPaymentReceipt(input), /Payment amount/);
 }
 const input = receipt(); input.data.amount = '0.01';
 assert.match((await inspect(await buildPaymentReceipt(input))).text, /INR 0\.01/);
});

test('validates real ISO dates, including leap years and optional invoice/reversal dates', async () => {
 for (const field of ['date', 'invoiceDate']) for (const value of ['2026-02-29', '2024-02-30', '2026-13-01', '29-10-2026', '2026-1-01']) {
  const input = receipt(); input.data[field] = value;
  await assert.rejects(() => buildPaymentReceipt(input), /date/i);
 }
 const reversed = receipt(); reversed.data.reversal = {date: '2026-04-31'};
 await assert.rejects(() => buildPaymentReceipt(reversed), /Reversal date/);
 const leap = receipt(); leap.data.date = '2024-02-29';
 assert.match((await inspect(await buildPaymentReceipt(leap))).text, /2024-02-29/);
});

test('rejects unsupported scripts clearly in any rendered snapshot field', async () => {
 for (const mutate of [
  x => {x.data.seller.name = 'नमस्ते';},
  x => {x.data.reference = '支払';},
  x => {x.data.notes = 'Payment 😀';},
  x => {x.data.reversal = {date: '2026-10-30', reason: 'शुल्क'};},
 ]) {
  const input = receipt(); mutate(input);
  await assert.rejects(() => buildPaymentReceipt(input), /supports Latin text/);
 }
 const latin = receipt(); latin.data.buyer.name = 'José & Müller';
 assert.equal((await inspect(await buildPaymentReceipt(latin))).pdf.getPageCount(), 1);
});

test('bounded optional text and controls reject unsafe oversized receipt rendering', async () => {
 for (const mutate of [
  x => {x.data.notes = 'x'.repeat(12001);},
  x => {x.data.reference = 'x'.repeat(2049);},
  x => {x.data.seller.name = 'x'.repeat(1025);},
  x => {x.id = 'x'.repeat(129);},
  x => {x.data.notes = 'unexpected\u0000control';},
  x => {x.data.buyer.email = {email: 'not text'};},
 ]) {
  const input = receipt(); mutate(input);
  await assert.rejects(() => buildPaymentReceipt(input), /must be text/);
 }
});

test('legacy missing optional snapshot values remain explicit, without reading current fields', async () => {
 const input = {id: 'payment-legacy', data: {kind: 'receipt', number: 'RCT-legacy', date: '2026-10-29', amount: '1.25', currency: 'INR'}};
 const {text} = await inspect(await buildPaymentReceipt(input));
 assert.match(text, /Name not recorded/);
 assert.match(text, /Invoice number: Not recorded/);
 assert.match(text, /Method: Not recorded/);
});

test('pathological newline input hits a bounded page limit rather than unbounded PDF growth', async () => {
 const input = receipt(); input.data.notes = 'start' + '\n'.repeat(11980) + 'end';
 await assert.rejects(() => buildPaymentReceipt(input), /40-page limit/);
});
