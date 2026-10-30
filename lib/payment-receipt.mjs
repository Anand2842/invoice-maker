import {PDFDocument, StandardFonts, rgb, degrees} from 'pdf-lib';
import {paymentMinor} from './payments.mjs';

const PAGE = [595.28, 841.89];
const LEFT = 42;
const WIDTH = PAGE[0] - LEFT * 2;
const INK = rgb(.16, .13, .2);
const PURPLE = rgb(.39, .26, .65);
const TEXT_ERROR = 'Payment receipt PDF supports Latin text. Unsupported writing systems cannot be exported yet.';

function text(value, label, max, required = false) {
 if (value == null && !required) return '';
 if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
  throw Error(`${label} must be text of at most ${max} characters without control characters`);
 }
 const result = value.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').trim();
 if (required && !result) throw Error(`${label} is required`);
 return result;
}

function date(value, label, required = true) {
 const result = text(value, label, 10, required);
 if (!result && !required) return '';
 const parsed = new Date(result + 'T00:00:00Z');
 if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
  throw Error(`${label} must be a real ISO date (YYYY-MM-DD)`);
 }
 return result;
}

function snapshot(payment) {
 if (!payment || typeof payment !== 'object' || payment.data?.kind !== 'receipt') throw Error('A recorded payment receipt is required');
 const d = payment.data;
 const party = (value, label) => ({
  name: text(value?.name, `${label} name`, 1024),
  address: text(value?.address, `${label} address`, 4096),
  email: text(value?.email, `${label} email`, 320),
 });
 const r = {
  id: text(payment.id, 'Payment ID', 128, true),
  businessId: text(payment.business_id, 'Business ID', 128),
  demo: payment.demo === true,
  number: text(d.number, 'Receipt number', 256, true),
  documentId: text(d.documentId, 'Invoice ID', 128),
  invoiceNumber: text(d.invoiceNumber, 'Invoice number', 256),
  invoiceDate: date(d.invoiceDate, 'Invoice date', false),
  invoiceType: text(d.invoiceType, 'Invoice type', 80),
  currency: text(d.currency, 'Currency', 3, true),
  date: date(d.date, 'Payment date'),
  amount: paymentMinor(d.amount),
  method: text(d.method, 'Payment method', 128),
  reference: text(d.reference, 'Payment reference', 2048),
  notes: text(d.notes, 'Payment notes', 12000),
  seller: party(d.seller, 'Seller'),
  buyer: party(d.buyer, 'Buyer'),
 };
 if (!/^[A-Z]{3}$/.test(r.currency)) throw Error('Currency must be a three-letter uppercase currency code');
 if (d.reversal != null) {
  if (typeof d.reversal !== 'object' || Array.isArray(d.reversal)) throw Error('Invalid receipt reversal');
  r.reversal = {
   date: date(d.reversal.date, 'Reversal date'),
   number: text(d.reversal.number, 'Reversal number', 256),
   reason: text(d.reversal.reason, 'Reversal reason', 4096),
  };
 }
 return r;
}

// Reads only the immutable payment snapshot. This is a record of a payment
// entered into Folio, not evidence of gateway collection or a current balance.
export async function buildPaymentReceipt(payment) {
 const r = snapshot(payment);
 const pdf = await PDFDocument.create();
 const font = await pdf.embedFont(StandardFonts.Helvetica);
 const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
 function preflight(value) {
  if (typeof value === 'string') {
   try {font.encodeText(value.replace(/\n/g, ' '));} catch {throw Error(TEXT_ERROR);}
  } else if (value && typeof value === 'object') {
   for (const child of Object.values(value)) preflight(child);
  }
 }
 preflight(r);
 const stamp = new Date(r.date + 'T00:00:00Z');
 pdf.setTitle('Payment receipt - ' + r.number);
 pdf.setSubject(`Recorded payment ${r.id}; receipt ${r.number}; invoice ${r.invoiceNumber || r.documentId || 'not recorded'}`);
 pdf.setAuthor(r.seller.name || 'Folio');
 pdf.setCreator('Folio');
 pdf.setProducer('Folio payment receipts');
 pdf.setCreationDate(stamp);
 pdf.setModificationDate(stamp);
 pdf.setKeywords(['payment receipt', r.number, r.id, r.businessId, r.documentId, r.demo ? 'demo' : 'recorded payment']);

 function wrap(value, width = WIDTH, size = 10, face = font) {
  const lines = [];
  for (const paragraph of value.split('\n')) {
   if (!paragraph) {lines.push(''); continue;}
   let line = '';
   for (const word of paragraph.split(/ +/)) {
    const candidate = line ? line + ' ' + word : word;
    if (face.widthOfTextAtSize(candidate, size) <= width) {line = candidate; continue;}
    if (line) {lines.push(line); line = '';}
    // Split unbroken identifiers/URLs too: never draw beyond the content box.
    for (const char of word) {
     if (line && face.widthOfTextAtSize(line + char, size) > width) {lines.push(line); line = '';}
     line += char;
    }
   }
   if (line) lines.push(line);
  }
  return lines;
 }

 let page, y;
 const pages = [];
 const footerRows = [
  'Payment ID: ' + r.id,
  ...(r.businessId ? ['Business ID: ' + r.businessId] : []),
  ...(r.documentId ? ['Invoice ID: ' + r.documentId] : []),
 ].flatMap(value => wrap(value, WIDTH - 95, 7));
 const bottom = Math.max(90, 45 + footerRows.length * 9);
 const draw = (value, x, at, size = 10, face = font, color = INK) => page.drawText(value, {x, y: at, size, font: face, color});
 function nextPage() {
  if (pages.length >= 40) throw Error('Payment receipt exceeds the supported 40-page limit');
  page = pdf.addPage(PAGE);
  pages.push(page);
  draw('Payment receipt', LEFT, 794, 22, bold, PURPLE);
  let headerY = 773;
  for (const line of wrap('Receipt number: ' + r.number, WIDTH, 10, bold)) {draw(line, LEFT, headerY, 10, bold); headerY -= 13;}
  if (r.demo) {
   page.drawText('DEMO', {x: 115, y: 345, size: 94, font: bold, rotate: degrees(35), color: PURPLE, opacity: .07});
   draw('DEMO - NOT A REAL PAYMENT', LEFT, headerY - 4, 10, bold, rgb(.65, .2, .12));
   headerY -= 24;
  }
  page.drawLine({start: {x: LEFT, y: headerY - 4}, end: {x: PAGE[0] - LEFT, y: headerY - 4}, thickness: .7, color: rgb(.82, .79, .88)});
  y = headerY - 25;
 }
 function line(value, {size = 10, strong = false, color = INK} = {}) {
  const face = strong ? bold : font;
  for (const row of wrap(value, WIDTH, size, face)) {
   if (y - size < bottom) nextPage();
   draw(row, LEFT, y, size, face, color);
   y -= size + 5;
  }
 }
 function gap() {y -= 9;}
 function field(label, value) {line(label + ': ' + (value || 'Not recorded'));}
 function party(label, data) {
  gap();
  line(label, {strong: true, color: PURPLE});
  line(data.name || 'Name not recorded');
  if (data.address) line(data.address);
  if (data.email) line(data.email);
 }
 nextPage();
 field('Payment date', r.date);
 const amount = Math.floor(r.amount / 100).toString() + '.' + (r.amount % 100).toString().padStart(2, '0');
 line('Recorded amount: ' + r.currency + ' ' + amount, {size: 16, strong: true});
 field('Method', r.method);
 field('Reference', r.reference);
 if (r.reversal) {
  gap();
  line('Reversal recorded for ' + r.reversal.date, {strong: true, color: rgb(.65, .2, .12)});
  if (r.reversal.number) field('Reversal number', r.reversal.number);
  if (r.reversal.reason) field('Reversal reason', r.reversal.reason);
  line('This receipt has a linked reversal with the effective date shown above. The original amount is retained for the audit trail.');
 }
 party('Recorded by / seller', r.seller);
 party('Payer / buyer', r.buyer);
 gap();
 line('Linked invoice', {strong: true, color: PURPLE});
 field('Invoice number', r.invoiceNumber);
 if (r.invoiceDate) field('Invoice date', r.invoiceDate);
 if (r.invoiceType) field('Invoice type', r.invoiceType);
 if (r.notes) {gap(); line('Notes', {strong: true, color: PURPLE}); line(r.notes);}
 gap();
 line('This receipt records a payment entered in Folio. It does not confirm gateway collection or show the current invoice balance.', {size: 9});
 for (let i = 0; i < pages.length; i++) {
  page = pages[i];
  page.drawLine({start: {x: LEFT, y: bottom - 15}, end: {x: PAGE[0] - LEFT, y: bottom - 15}, thickness: .5, color: rgb(.85, .83, .88)});
  footerRows.forEach((row, n) => draw(row, LEFT, bottom - 29 - n * 9, 7));
  const counter = `Page ${i + 1} of ${pages.length}`;
  draw(counter, PAGE[0] - LEFT - font.widthOfTextAtSize(counter, 8), bottom - 29, 8);
 }
 return pdf.save({useObjectStreams: false});
}
