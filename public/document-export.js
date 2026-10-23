import { templateStyle } from './pdf-templates/index.js';
/**
 * Dependency-free, local PDF export. Import this module once before calling
 * window.RefrensDocumentExport.{build,download,preview}(document).
 *
 * Money is rounded half-up to cents after each line, discount and tax. A fixed
 * item discount is an absolute line discount; percentage discounts use the
 * rounded line amount. Shipping is an untaxed document charge. Split GST's odd
 * cent goes to SGST so the displayed components always reconcile.
 *
 * Boundaries: standard PDF Helvetica/WinAnsi supports Latin text, not every
 * writing system. Unsupported text is rejected rather than silently corrupted.
 * Currency codes are printed instead of unsupported currency glyphs. Uploaded
 * logo/signature artwork is embedded by buildWithImages(); build() returns a visible warning.
 * Typed signature names are included. No network requests or print dialogs.
 */

const PAGE = { width: 595.28, height: 841.89, margin: 44, bottom: 778 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const MAX_MINOR = BigInt(Number.MAX_SAFE_INTEGER);
const TITLES = {
  invoice: 'Invoice', 'gst-invoice': 'Tax Invoice', quotation: 'Quotation',
  proforma: 'Proforma Invoice', 'purchase-order': 'Purchase Order',
  'delivery-challan': 'Delivery Challan', 'commercial-invoice': 'Commercial Invoice',
};
const CP1252 = new Map([
  [0x20ac, 128], [0x201a, 130], [0x0192, 131], [0x201e, 132], [0x2026, 133],
  [0x2020, 134], [0x2021, 135], [0x02c6, 136], [0x2030, 137], [0x0160, 138],
  [0x2039, 139], [0x0152, 140], [0x017d, 142], [0x2018, 145], [0x2019, 146],
  [0x201c, 147], [0x201d, 148], [0x2022, 149], [0x2013, 150], [0x2014, 151],
  [0x02dc, 152], [0x2122, 153], [0x0161, 154], [0x203a, 155], [0x0153, 156],
  [0x017e, 158], [0x0178, 159],
]);

export const boundaries = Object.freeze({
  text: 'Latin text using standard PDF Helvetica/WinAnsi; unsupported scripts are rejected.',
  images: 'PNG/JPEG logo and signature artwork is embedded by buildWithImages, preview and download. Synchronous build returns text-only PDF warnings.',
  shipping: 'Shipping is an untaxed charge. Add a taxable shipping line item if tax applies.',
  rounding: 'Line amounts, line discounts and line tax are rounded half-up to two decimal places.',
});

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function textValue(value, label = 'Text') {
  if (value === null || value === undefined) return '';
  if (!['string', 'number', 'boolean'].includes(typeof value)) throw new TypeError(`${label} must be text.`);
  const text = String(value).replace(/\r\n?/g, '\n').trim();
  if (text.length > 50000) throw new RangeError(`${label} is too long (maximum 50,000 characters).`);
  return text;
}

function decimal(value, label, fallback = 0, maximum = 1e12) {
  if (value === undefined || value === null || value === '') value = fallback;
  if (!['number', 'string'].includes(typeof value)) throw new TypeError(`${label} must be a number.`);
  const raw = String(value).trim();
  const numeric = Number(raw);
  if (!raw || raw.length > 100 || !Number.isFinite(numeric) || numeric < 0 || numeric > maximum) {
    throw new RangeError(`${label} must be a finite non-negative number no greater than ${maximum}.`);
  }
  const match = raw.match(/^\+?(\d*\.?\d+)(?:e([+-]?\d+))?$/i);
  if (!match) throw new TypeError(`${label} must be a decimal number.`);
  const [whole, fraction = ''] = match[1].split('.');
  const exponent = Number(match[2] || 0);
  const scale = fraction.length - exponent;
  if (Math.abs(scale) > 30 || Math.abs(exponent) > 30) throw new RangeError(`${label} has too much decimal precision.`);
  let numerator = BigInt((whole || '0') + fraction);
  let denominator = 1n;
  if (scale > 0) denominator = 10n ** BigInt(scale);
  else numerator *= 10n ** BigInt(-scale);
  return { numerator, denominator, numeric, raw };
}

function rounded(numerator, denominator) {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

function safeMinor(value, label = 'Amount') {
  if (value > MAX_MINOR) throw new RangeError(`${label} is too large to export accurately.`);
  return Number(value);
}

function toMinor(value, label) {
  const number = decimal(value, label);
  return safeMinor(rounded(number.numerator * 100n, number.denominator), label);
}

function realDate(value, label, fallback = '') {
  const text = textValue(value || fallback, label);
  if (!text) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new TypeError(`${label} must use YYYY-MM-DD.`);
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new RangeError(`${label} must be a real date.`);
  return text;
}

function localDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = key => parts.find(piece => piece.type === key).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function dateLabel(value) {
  return value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : '';
}

function party(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} details are required.`);
  const result = {};
  for (const key of ['name', 'address', 'email', 'gstin', 'phone', 'country', 'taxId']) result[key] = textValue(value[key], `${label} ${key}`);
  if (!result.name) throw new RangeError(`${label} name is required.`);
  return result;
}

function normalizeType(value) {
  const raw = String(value || 'invoice').toLowerCase().trim().replace(/[ _]+/g, '-');
  const aliases = { 'proforma-invoice': 'proforma', 'tax-invoice': 'gst-invoice', quote: 'quotation', 'purchaseorder': 'purchase-order', 'deliverychallan': 'delivery-challan' };
  const type = aliases[raw] || raw;
  if (!TITLES[type]) throw new RangeError(`Unsupported document type: ${raw}.`);
  return type;
}

function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('A document object is required.');
  const type = normalizeType(input.type);
  const currency = String(input.currency || 'INR').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new RangeError('Currency must be a three-letter code such as INR, USD or EUR.');
  const taxType = String(input.taxType || (type === 'gst-invoice' ? 'GST' : 'NONE')).toUpperCase();
  if (!['GST', 'VAT', 'NONE'].includes(taxType)) throw new RangeError('Tax type must be GST, VAT or NONE.');
  const gstMode = input.gstMode || 'split';
  if (!['split', 'igst'].includes(gstMode)) throw new RangeError('GST mode must be split or igst.');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 1000) throw new RangeError('Add between 1 and 1,000 document items.');
  const groups = new Map();
  const minor = { subtotal: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, vat: 0, tax: 0, shipping: 0, total: 0 };
  let quantityTotal = 0;
  const items = input.items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`Item ${index + 1} must be an object.`);
    const label = `Item ${index + 1}`;
    const quantity = decimal(item.quantity, `${label} quantity`, 1, 1e9);
    if (quantity.numerator === 0n) throw new RangeError(`${label} quantity must be greater than zero.`);
    const rate = decimal(item.rate, `${label} rate`);
    const subtotal = safeMinor(rounded(quantity.numerator * rate.numerator * 100n, quantity.denominator * rate.denominator), `${label} amount`);
    const rawDiscount = decimal(item.discount, `${label} discount`);
    const discountType = String(item.discountType || 'fixed').toLowerCase();
    if (!['fixed', 'amount', 'percent', 'percentage', '%'].includes(discountType)) throw new RangeError(`${label} discount type must be fixed or percent.`);
    const isPercent = ['percent', 'percentage', '%'].includes(discountType);
    if (isPercent && rawDiscount.numeric > 100) throw new RangeError(`${label} percentage discount cannot exceed 100.`);
    const discount = isPercent
      ? safeMinor(rounded(BigInt(subtotal) * rawDiscount.numerator, rawDiscount.denominator * 100n))
      : safeMinor(rounded(rawDiscount.numerator * 100n, rawDiscount.denominator));
    if (discount > subtotal) throw new RangeError(`${label} discount cannot exceed its line amount.`);
    const taxable = subtotal - discount;
    const ratePercent = decimal(item.taxRate, `${label} tax rate`, 0, 100);
    const taxApplies = taxType !== 'NONE' && type !== 'delivery-challan';
    const tax = taxApplies ? safeMinor(rounded(BigInt(taxable) * ratePercent.numerator, ratePercent.denominator * 100n)) : 0;
    const cgst = taxType === 'GST' && gstMode === 'split' ? Math.floor(tax / 2) : 0;
    const sgst = taxType === 'GST' && gstMode === 'split' ? tax - cgst : 0;
    const igst = taxType === 'GST' && gstMode === 'igst' ? tax : 0;
    const vat = taxType === 'VAT' ? tax : 0;
    const total = safeMinor(BigInt(taxable) + BigInt(tax), `${label} total`);
    for (const [key, amount] of Object.entries({ subtotal, discount, taxable, tax, cgst, sgst, igst, vat })) minor[key] = safeMinor(BigInt(minor[key]) + BigInt(amount));
    quantityTotal += quantity.numeric;
    if (taxApplies) {
      const key = String(ratePercent.numeric);
      const group = groups.get(key) || { rate: ratePercent.numeric, taxable: 0, tax: 0, cgst: 0, sgst: 0, igst: 0, vat: 0 };
      for (const field of ['taxable', 'tax', 'cgst', 'sgst', 'igst', 'vat']) group[field] += { taxable, tax, cgst, sgst, igst, vat }[field];
      groups.set(key, group);
    }
    return {
      name: textValue(item.name, `${label} name`) || textValue(item.description, `${label} description`) || label,
      description: item.name ? textValue(item.description, `${label} description`) : '',
      customFields: item.customFields,
      hsn: textValue(item.hsn, `${label} HSN`), quantity: quantity.raw,
      rateMinor: safeMinor(rounded(rate.numerator * 100n, rate.denominator)),
      discountLabel: isPercent ? `${rawDiscount.numeric}%` : null,
      taxRate: taxApplies ? ratePercent.numeric : 0,
      minor: { subtotal, discount, taxable, tax, cgst, sgst, igst, vat, total },
    };
  });
  let shippingAmount = input.shipping;
  if (shippingAmount && typeof shippingAmount === 'object') shippingAmount = shippingAmount.amount ?? shippingAmount.charge ?? 0;
  // A free-form shipping address is a detail, never an implicit charge.
  if (typeof shippingAmount === 'string' && Number.isNaN(Number(shippingAmount))) shippingAmount = 0;
  minor.shipping = toMinor(shippingAmount || 0, 'Shipping charge');
  minor.total = safeMinor(BigInt(minor.taxable) + BigInt(minor.tax) + BigInt(minor.shipping), 'Document total');
  const date = realDate(input.date, 'Document date', localDate());
  const dueDate = realDate(input.dueDate, 'Due date');
  if (dueDate && dueDate < date) throw new RangeError('Due date cannot be before the document date.');
  const document = {
    type, title: TITLES[type], number: textValue(input.number, 'Document number') || 'DRAFT',
    date, dueDate, currency, taxType, gstMode, items,
    seller: party(input.seller, 'Seller'), buyer: party(input.buyer, 'Buyer'),
    notes: textValue(input.notes, 'Notes'), terms: textValue(input.terms, 'Terms'),
    shipping: input.shipping, transport: input.transport, customFields: input.customFields, taxDetails: input.taxDetails,
    signature: input.signature, logo: input.logo, bank: input.bank, template: input.template || 'classic', brandColor: input.brandColor || '#6040a0', embedImages: input.embedImages === true,
  };
  templateStyle(document.template, document.brandColor);
  if (document.number.length > 200) throw new RangeError('Document number is too long (maximum 200 characters).');
  const totals = { ...Object.fromEntries(Object.entries(minor).map(([key, value]) => [key, value / 100])), minor, quantity: quantityTotal,
    taxGroups: [...groups.values()].sort((a, b) => a.rate - b.rate), currency,
    displayAmounts: type !== 'delivery-challan' };
  return { document, totals };
}

function money(minor, currency) {
  return `${currency} ${new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
}

function winAnsi(value) {
  let result = '';
  for (const character of String(value).normalize('NFC').replace(/\u20b9/g, 'INR ').replace(/\t/g, '    ')) {
    const code = character.codePointAt(0);
    if (code === 10 || (code >= 32 && code <= 126) || (code >= 160 && code <= 255)) result += character;
    else if (CP1252.has(code)) result += String.fromCharCode(CP1252.get(code));
    else if ([0x200b, 0x200c, 0x200d, 0xfeff].includes(code)) continue;
    else if (code >= 0x2010 && code <= 0x2015) result += '-';
    else throw new RangeError(`PDF text contains an unsupported character (${character}, U+${code.toString(16).toUpperCase()}). Use Latin text for this export.`);
  }
  return result;
}

function pdfEscape(value) {
  let result = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === '(' || character === ')' || character === '\\') result += `\\${character}`;
    else if (code > 126 || code < 32) result += `\\${code.toString(8).padStart(3, '0')}`;
    else result += character;
  }
  return result;
}

const REGULAR_UPPER = [667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611];
const REGULAR_LOWER = [556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500];
const BOLD_UPPER = [722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611];
const BOLD_LOWER = [556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500];
const PUNCTUATION = { ' ':278, '.':278, ',':278, ':':278, ';':278, '!':333, "'":278, '"':474, '(':333, ')':333, '[':278, ']':278, '{':389, '}':389, '/':278, '\\':278, '-':333, '_':556, '+':584, '=':584, '%':889, '&':722, '*':389, '?':611, '@':1015, '|':280, '<':584, '>':584, '#':556, '$':556, '^':469, '~':584, '`':333 };

function textWidth(value, size = 9, bold = false) {
  let width = 0;
  for (const original of value) {
    const base = original.normalize('NFD').replace(/[\u0300-\u036f]/g, '')[0] || original;
    const code = base.charCodeAt(0);
    if (code >= 65 && code <= 90) width += (bold ? BOLD_UPPER : REGULAR_UPPER)[code - 65];
    else if (code >= 97 && code <= 122) width += (bold ? BOLD_LOWER : REGULAR_LOWER)[code - 97];
    else if (/\d/.test(base)) width += 556;
    else width += PUNCTUATION[base] || 1000;
  }
  return width * size / 1000;
}

function wrap(value, width, size = 9, bold = false) {
  const encoded = winAnsi(value);
  const lines = [];
  for (const paragraph of encoded.split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let line = '';
    for (let word of paragraph.trim().split(/ +/)) {
      if (textWidth(line ? `${line} ${word}` : word, size, bold) <= width) {
        line = line ? `${line} ${word}` : word;
        continue;
      }
      if (line) { lines.push(line); line = ''; }
      while (textWidth(word, size, bold) > width) {
        let count = 1;
        while (count < word.length && textWidth(word.slice(0, count + 1), size, bold) <= width) count++;
        lines.push(word.slice(0, count));
        word = word.slice(count);
      }
      line = word;
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

const n = value => Number(value.toFixed(3));
class Layout {
  constructor(doc) { this.doc = doc; this.style = templateStyle(doc.template, doc.brandColor); this.imageSlots = []; this.pages = []; this.y = 0; this.newPage(); }
  command(value) { this.pages.at(-1).push(value); }
  text(encoded, x, top, size = 9, bold = false, color = '0.14 0.16 0.22', align = 'left') {
    if (align === 'right') x -= textWidth(encoded, size, bold);
    this.command(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color} rg 1 0 0 1 ${n(x)} ${n(PAGE.height - top)} Tm (${pdfEscape(encoded)}) Tj ET`);
  }
  line(y, color = '0.85 0.87 0.9') { this.command(`${color} RG 0.6 w ${PAGE.margin} ${n(PAGE.height - y)} m ${n(PAGE.width - PAGE.margin)} ${n(PAGE.height - y)} l S`); }
  rect(x, top, width, height, color) { this.command(`${color} rg ${n(x)} ${n(PAGE.height - top - height)} ${n(width)} ${n(height)} re f`); }
  newPage() {
    this.pages.push([]);
    const continued = this.pages.length > 1;
    this.y = 49;
    if (!continued && this.doc.embedImages && this.doc.logo) {
      this.imageSlots.push({ kind: 'logo', page: 0, x: PAGE.margin, top: 28, width: 150, height: 56 });
      this.y = 112;
    }
    const modern = this.style.id === 'modern';
    const numberLines = wrap(`Document no. ${this.doc.number}`, CONTENT_WIDTH - (modern ? 24 : 0), 10, true);
    if (modern) this.rect(PAGE.margin, this.y - 26, CONTENT_WIDTH, (continued ? 48 : 53) + numberLines.length * 13, this.style.accent);
    const x = PAGE.margin + (modern ? 12 : 0);
    const color = modern ? this.style.foreground : this.style.accent;
    this.text(winAnsi(`${this.doc.title}${continued ? ' - continued' : ''}`), x, this.y, continued ? 15 : this.style.id === 'minimal' ? 22 : 25, true, color);
    this.y += continued ? 21 : 26;
    for (const line of numberLines) { this.text(line, x, this.y, 10, true, color); this.y += 13; }
    if (!modern) this.line(this.y + 2, this.style.accent);
    this.y += modern ? 28 : 22;
  }
  ensure(height) { if (this.y + height > PAGE.bottom) this.newPage(); }
  paragraph(value, { size = 9, bold = false, color, width = CONTENT_WIDTH, gap = 7 } = {}) {
    for (const line of wrap(value, width, size, bold)) {
      this.ensure(size + 6);
      this.text(line, PAGE.margin, this.y + size, size, bold, color);
      this.y += size + 5;
    }
    this.y += gap;
  }
  section(title, value) {
    if (!value) return;
    this.ensure(48);
    this.paragraph(title, { size: 11, bold: true, gap: 3 });
    this.paragraph(value, { gap: 12 });
  }
}

function partyLines(value, width) {
  const lines = wrap(value.name, width, 11, true).map(line => ({ line, bold: true, size: 11 }));
  for (const text of [value.address, value.country, value.email, value.phone, value.gstin ? `GSTIN: ${value.gstin}` : '', value.taxId ? `Tax ID: ${value.taxId}` : ''].filter(Boolean)) {
    lines.push(...wrap(text, width, 9).map(line => ({ line, bold: false, size: 9 })));
  }
  return lines;
}

function renderParties(layout, doc) {
  const labels = doc.type === 'purchase-order' ? ['Vendor', 'Buyer'] : doc.type === 'delivery-challan' ? ['From', 'Deliver to'] : doc.type === 'commercial-invoice' ? ['Exporter', 'Consignee'] : ['Billed by', 'Billed to'];
  const gap = 28;
  const column = (CONTENT_WIDTH - gap) / 2;
  const right = PAGE.margin + column + gap;
  layout.ensure(54);
  layout.text(labels[0].toUpperCase(), PAGE.margin, layout.y + 9, 9, true, '0.43 0.45 0.51');
  layout.text(labels[1].toUpperCase(), right, layout.y + 9, 9, true, '0.43 0.45 0.51');
  layout.y += 22;
  const leftLines = partyLines(doc.seller, column);
  const rightLines = partyLines(doc.buyer, column);
  for (let index = 0; index < Math.max(leftLines.length, rightLines.length); index++) {
    const before = layout.pages.length;
    layout.ensure(16);
    if (layout.pages.length !== before) {
      layout.text(`${labels[0]} (continued)`, PAGE.margin, layout.y + 9, 9, true);
      layout.text(`${labels[1]} (continued)`, right, layout.y + 9, 9, true);
      layout.y += 19;
    }
    for (const [line, x] of [[leftLines[index], PAGE.margin], [rightLines[index], right]]) {
      if (line) layout.text(line.line, x, layout.y + 11, line.size, line.bold);
    }
    layout.y += 15;
  }
  layout.y += 15;
  layout.paragraph(`Issue date: ${dateLabel(doc.date)}${doc.dueDate ? `    |    ${doc.type === 'quotation' ? 'Valid until' : 'Due date'}: ${dateLabel(doc.dueDate)}` : ''}${doc.type === 'delivery-challan' ? '' : `    |    Currency: ${doc.currency}`}`, { gap: 14 });
}

function detailEntries(value, prefix = '', depth = 0) {
  if (value === null || value === undefined || value === '') return [];
  if (depth > 4) throw new RangeError('Document details cannot be nested more than four levels.');
  if (Array.isArray(value)) return value.flatMap((item, index) => {
    if (item && typeof item === 'object' && ('value' in item)) return detailEntries(item.value, textValue(item.label || item.name || `Field ${index + 1}`), depth + 1);
    return detailEntries(item, prefix ? `${prefix} ${index + 1}` : `Field ${index + 1}`, depth + 1);
  });
  if (typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => detailEntries(item, prefix ? `${prefix} - ${key}` : key, depth + 1));
  return [`${prefix ? `${prefix}: ` : ''}${textValue(value)}`];
}

function renderDetails(layout, doc) {
  const entries = detailEntries(doc.customFields);
  if (entries.length) layout.section('Document details', entries.join('\n'));
  if (doc.transport) layout.section('Transport details', detailEntries(doc.transport).join('\n'));
  if (doc.taxDetails) { const details=Object.fromEntries(Object.entries(doc.taxDetails).filter(([key,value])=>value&&!(key==='reverseCharge'&&value==='No')));if(Object.keys(details).length)layout.section('Tax details',detailEntries(details).join('\n')); }
  if (doc.shipping && typeof doc.shipping === 'object') {
    const { amount: _amount, charge: _charge, ...details } = doc.shipping;
    const lines = detailEntries(details);
    if (lines.length) layout.section('Shipping details', lines.join('\n'));
  } else if (typeof doc.shipping === 'string' && Number.isNaN(Number(doc.shipping))) layout.section('Shipping details', doc.shipping);
}

function tableHeader(layout, delivery) {
  layout.ensure(55);
  layout.rect(PAGE.margin, layout.y, CONTENT_WIDTH, 25, layout.style.tint);
  layout.text('#', PAGE.margin + 6, layout.y + 16, 8, true);
  layout.text('ITEM / DESCRIPTION', PAGE.margin + 26, layout.y + 16, 8, true);
  layout.text('QTY', delivery ? PAGE.width - PAGE.margin - 10 : 318, layout.y + 16, 8, true, undefined, 'right');
  if (!delivery) {
    layout.text('RATE', 418, layout.y + 16, 8, true, undefined, 'right');
    layout.text('AMOUNT', PAGE.width - PAGE.margin - 8, layout.y + 16, 8, true, undefined, 'right');
  }
  layout.y += 29;
}

function renderItems(layout, doc) {
  const delivery = doc.type === 'delivery-challan';
  tableHeader(layout, delivery);
  doc.items.forEach((item, index) => {
    const descriptionWidth = delivery ? 354 : 207;
    const description = [
      ...wrap(item.name, descriptionWidth, 9, true).map(line => ({ line, bold: true })),
      ...(item.description ? wrap(item.description, descriptionWidth, 9).map(line => ({ line })) : []),
      ...detailEntries(item.customFields).flatMap(value=>wrap(value,descriptionWidth,8).map(line=>({line,size:8}))),
    ];
    const meta = [item.hsn ? `HSN/SAC: ${item.hsn}` : ''];
    if (!delivery && item.minor.discount) meta.push(`Discount: ${item.discountLabel || money(item.minor.discount, doc.currency)}`);
    if (!delivery && doc.taxType !== 'NONE') meta.push(`${doc.taxType}: ${item.taxRate}%`);
    if (meta.filter(Boolean).length) description.push(...wrap(meta.filter(Boolean).join(' | '), descriptionWidth, 8).map(line => ({ line, size: 8, color: '0.43 0.45 0.51' })));
    const quantity = wrap(item.quantity, delivery ? 105 : 40, 9);
    const rate = delivery ? [] : wrap(money(item.rateMinor, doc.currency), 92, 9);
    // Amount is before tax; the tax summary below reconciles to the grand total.
    const amount = delivery ? [] : wrap(money(item.minor.taxable, doc.currency), 117, 9, true);
    const lineCount = Math.max(description.length, quantity.length, rate.length, amount.length);
    if (lineCount * 13 + 18 < 570 && layout.y + lineCount * 13 + 18 > PAGE.bottom) { layout.newPage(); tableHeader(layout, delivery); }
    let offset = 0;
    while (offset < lineCount) {
      let capacity = Math.floor((PAGE.bottom - layout.y - 18) / 13);
      if (capacity < 1) { layout.newPage(); tableHeader(layout, delivery); capacity = Math.floor((PAGE.bottom - layout.y - 18) / 13); }
      const count = Math.min(capacity, lineCount - offset);
      for (let row = 0; row < count; row++) {
        const position = offset + row;
        const baseline = layout.y + 13 + row * 13;
        const desc = description[position];
        if (position === 0) layout.text(String(index + 1), PAGE.margin + 5, baseline, 8);
        if (desc) layout.text(desc.line, PAGE.margin + 26, baseline, desc.size || 9, desc.bold || false, desc.color);
        if (quantity[position]) layout.text(quantity[position], delivery ? PAGE.width - PAGE.margin - 10 : 318, baseline, 9, false, undefined, 'right');
        if (rate[position]) layout.text(rate[position], 418, baseline, 9, false, undefined, 'right');
        if (amount[position]) layout.text(amount[position], PAGE.width - PAGE.margin - 8, baseline, 9, true, undefined, 'right');
      }
      layout.y += count * 13 + 14;
      layout.line(layout.y);
      layout.y += 4;
      offset += count;
      if (offset < lineCount) { layout.newPage(); tableHeader(layout, delivery); }
    }
  });
  layout.y += 17;
}

function totalLine(layout, label, amount, currency, final = false) {
  const value = money(amount, currency);
  layout.ensure(final ? 40 : 24);
  if (final) { layout.rect(PAGE.margin, layout.y, CONTENT_WIDTH, 34, layout.style.tint); layout.y += 5; }
  const size = final ? 13 : 10;
  layout.text(winAnsi(label), PAGE.margin + (final ? 10 : 0), layout.y + size, size, final);
  layout.text(winAnsi(value), PAGE.width - PAGE.margin - (final ? 10 : 0), layout.y + size, size, final, undefined, 'right');
  layout.y += final ? 37 : 22;
}

function renderTotals(layout, doc, totals) {
  if (doc.type === 'delivery-challan') {
    layout.paragraph(`Total items: ${doc.items.length}    |    Total quantity: ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(totals.quantity)}`, { bold: true, gap: 16 });
    return;
  }
  layout.ensure(110);
  const minor = totals.minor;
  totalLine(layout, 'Subtotal', minor.subtotal, doc.currency);
  if (minor.discount) {
    // A separate minus sign keeps all numeric amounts positive and unambiguous.
    totalLine(layout, 'Less: discounts', minor.discount, doc.currency);
    totalLine(layout, 'Taxable amount', minor.taxable, doc.currency);
  }
  if (doc.taxType === 'GST' && doc.gstMode === 'split') {
    totalLine(layout, 'CGST', minor.cgst, doc.currency);
    totalLine(layout, 'SGST', minor.sgst, doc.currency);
  } else if (doc.taxType === 'GST') totalLine(layout, 'IGST', minor.igst, doc.currency);
  else if (doc.taxType === 'VAT') totalLine(layout, 'VAT', minor.vat, doc.currency);
  if (minor.shipping) totalLine(layout, 'Shipping (untaxed)', minor.shipping, doc.currency);
  totalLine(layout, doc.type === 'quotation' ? 'Quotation total' : doc.type === 'purchase-order' ? 'Order total' : 'Total', minor.total, doc.currency, true);
  if (totals.taxGroups.length) {
    const groups = totals.taxGroups.map(group => {
      const components = doc.taxType === 'GST' && doc.gstMode === 'split'
        ? `CGST ${money(group.cgst, doc.currency)} + SGST ${money(group.sgst, doc.currency)}`
        : `${doc.taxType === 'VAT' ? 'VAT' : 'IGST'} ${money(group.tax, doc.currency)}`;
      return `${doc.taxType} ${group.rate}% | Taxable ${money(group.taxable, doc.currency)} | ${components}`;
    });
    layout.section('Tax breakdown', groups.join('\n'));
  }
}

function imageWarnings(doc) {
  const warnings = [];
  if (doc.logo) warnings.push('Uploaded logo artwork is not embedded in this PDF.');
  const signature = doc.signature;
  const art = typeof signature === 'string' ? /^(data:|blob:|https?:)/i.test(signature) : Boolean(signature?.dataUrl || signature?.image || signature?.src || signature?.url);
  if (art) warnings.push('Uploaded signature artwork is not embedded in this PDF; a typed signature name can be included.');
  return warnings;
}

function typedSignature(value) {
  if (!value) return '';
  if (typeof value === 'string') return /^(data:|blob:|https?:)/i.test(value) ? '' : textValue(value);
  if (typeof value === 'object') return textValue(value.name || value.text || '');
  throw new TypeError('Signature must be a typed name or an image descriptor.');
}

function serializePDF(layout, doc) {
  const count = layout.pages.length;
  layout.pages.forEach((commands, index) => {
    const original = layout.pages;
    layout.pages = [commands];
    layout.line(798);
    layout.text(winAnsi(`${doc.title} | ${doc.number}`.slice(0, 90)), PAGE.margin, 814, 8, false, '0.43 0.45 0.51');
    layout.text(`Page ${index + 1} of ${count}`, PAGE.width - PAGE.margin, 814, 8, false, '0.43 0.45 0.51', 'right');
    layout.pages = original;
  });
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${count} /Kids [${layout.pages.map((_, index) => `${5 + index * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  layout.pages.forEach((commands, index) => {
    const pageId = 5 + index * 2;
    const content = `${commands.join('\n')}\n`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
  });
  const infoId = objects.length + 1;
  objects.push(`<< /Title (${pdfEscape(winAnsi(`${doc.title} ${doc.number}`))}) /Author (${pdfEscape(winAnsi(doc.seller.name))}) /Creator (Refrens local document export) /Producer (Browser-local PDF writer) >>`);
  let output = '%PDF-1.4\n%Refrens local document export\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const startXref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;
  return new TextEncoder().encode(output);
}

export function build(input) {
  const { document: doc, totals } = normalize(input);
  const warnings = imageWarnings(doc);
  const layout = new Layout(doc);
  renderParties(layout, doc);
  renderDetails(layout, doc);
  renderItems(layout, doc);
  renderTotals(layout, doc, totals);
  if (doc.bank && doc.type !== 'delivery-challan') layout.section('Payment details', detailEntries(doc.bank).join('\n'));
  layout.section('Notes', doc.notes);
  layout.section('Terms & conditions', doc.terms);
  const signature = typedSignature(doc.signature);
  if (signature) layout.section('Authorized signatory', signature);
  if (doc.embedImages && imageSource(doc.signature)) { layout.ensure(92); layout.paragraph('Authorized signature', { bold: true, gap: 2 }); layout.imageSlots.push({ kind: 'signature', page: layout.pages.length - 1, x: PAGE.margin, top: layout.y, width: 160, height: 60 }); layout.y += 68; }
  const bytes = serializePDF(layout, doc);
  const safeNumber = doc.number.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'draft';
  return { bytes, mime: 'application/pdf', filename: `${doc.type}-${safeNumber}.pdf`, totals, warnings, pageCount: layout.pages.length, imageSlots: layout.imageSlots };
}

function requireBrowser() {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') throw new Error('Download and preview require a browser. Use build() to obtain PDF bytes.');
}

function downloadBuilt(result) {
  requireBrowser();
  const url = URL.createObjectURL(new Blob([result.bytes], { type: result.mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return result;
}

export async function download(input) { return downloadBuilt(await buildWithImages(input)); }

export async function preview(input) {
  requireBrowser();
  const result = await buildWithImages(input);
  const url = URL.createObjectURL(new Blob([result.bytes], { type: result.mime }));
  const dialog = document.createElement('dialog');
  dialog.className = 'refrens-document-preview';
  dialog.setAttribute('aria-label', 'PDF document preview');
  dialog.style.cssText = 'box-sizing:border-box;width:min(1100px,96vw);max-width:96vw;max-height:95vh;padding:20px;border:1px solid #dedbe8;border-radius:12px;background:white;color:#242033;box-shadow:0 20px 70px #0004;';
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap;';
  const heading = document.createElement('h2');
  heading.textContent = result.filename;
  heading.style.cssText = 'font:600 18px/1.4 system-ui,sans-serif;margin:0;flex:1;overflow-wrap:anywhere;';
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Download PDF';
  save.style.cssText = 'font:600 14px system-ui;padding:10px 16px;border:0;border-radius:6px;background:#6c43c0;color:white;cursor:pointer;';
  save.addEventListener('click', () => downloadBuilt(result));
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.setAttribute('aria-label', 'Close PDF preview');
  close.style.cssText = 'font:500 14px system-ui;padding:10px 16px;border:1px solid #d8d4e2;border-radius:6px;background:white;color:#242033;cursor:pointer;';
  close.addEventListener('click', () => dialog.close());
  toolbar.append(heading, save, close);
  dialog.append(toolbar);
  if (result.warnings.length) {
    const notice = document.createElement('p');
    notice.setAttribute('role', 'status');
    notice.textContent = result.warnings.join(' ');
    notice.style.cssText = 'font:13px/1.5 system-ui;color:#74520e;background:#fff8e8;padding:10px;border-radius:6px;';
    dialog.append(notice);
  }
  const frame = document.createElement('iframe');
  frame.title = `PDF preview: ${result.filename}`;
  frame.src = url;
  frame.style.cssText = 'display:block;width:100%;height:68vh;min-height:300px;border:1px solid #e2dfe9;border-radius:4px;background:#eee;';
  const fallback = document.createElement('a');
  fallback.href = url;
  fallback.target = '_blank';
  fallback.rel = 'noopener';
  fallback.textContent = 'Open PDF in a new tab';
  fallback.style.cssText = 'display:inline-block;margin-top:10px;font:13px system-ui;color:#6033ac;';
  dialog.append(frame, fallback);
  dialog.addEventListener('close', () => { URL.revokeObjectURL(url); dialog.remove(); }, { once: true });
  document.body.append(dialog);
  try { dialog.showModal(); } catch (error) { URL.revokeObjectURL(url); dialog.remove(); throw error; }
  close.focus();
  return { ...result, dialog, close: () => dialog.close() };
}

export const RefrensDocumentExport = Object.freeze({ build, buildWithImages, download, preview, escapeHTML, boundaries });
if (typeof window !== 'undefined') window.RefrensDocumentExport = RefrensDocumentExport;
export default RefrensDocumentExport;

function imageSource(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'object') return value.dataUrl || value.image || value.src || value.url || null;
  return typeof value === 'string' && /^(data:|blob:|https?:)/i.test(value) ? value : null;
}
function imageBytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (typeof value !== 'string' || !/^data:image\/(png|jpeg);base64,[a-z0-9+/=\s]+$/i.test(value)) throw new Error(`${label}: use a PNG or JPEG image. Remote image URLs are not fetched.`);
  if (value.length > 2800000) throw new Error(`${label}: image exceeds 2 MB. Use a smaller image.`);
  const raw = atob(value.slice(value.indexOf(',') + 1));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function imageFormat(bytes, label) {
  if (bytes.byteLength > 2097152) throw new Error(`${label}: image exceeds 2 MB.`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width, height, format;
  if (bytes.length >= 24 && v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a) { format = 'png'; width = v.getUint32(16); height = v.getUint32(20); }
  else if (bytes[0] === 255 && bytes[1] === 216) {
    format = 'jpeg'; let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1], length = v.getUint16(offset + 2);
      if (length < 2 || offset + length + 2 > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 8) { height = v.getUint16(offset + 5); width = v.getUint16(offset + 7); break; }
      offset += length + 2;
    }
  }
  if (!width || !height || width * height > 4000000) throw new Error(`${label}: use a valid PNG/JPEG image of at most 4 million pixels.`);
  return format;
}
export async function buildWithImages(input) {
  const sources = { logo: imageSource(input.logo) || (input.logoBytes instanceof Uint8Array ? input.logoBytes : null), signature: imageSource(input.signature) };
  const images = Object.fromEntries(Object.entries(sources).filter(([, v]) => v).map(([kind, value]) => { const bytes = imageBytes(value, kind); return [kind, { bytes, format: imageFormat(bytes, kind) }]; }));
  const result = build({ ...input, logo: sources.logo, embedImages: true });
  if (!Object.keys(images).length) return result;
  const { PDFDocument } = await import('./vendor/pdf-lib.esm.min.js');
  const pdf = await PDFDocument.load(result.bytes);
  for (const slot of result.imageSlots) {
    const source = images[slot.kind]; if (!source) continue;
    const image = source.format === 'png' ? await pdf.embedPng(source.bytes) : await pdf.embedJpg(source.bytes);
    const scale = Math.min(slot.width / image.width, slot.height / image.height);
    const width = image.width * scale, height = image.height * scale;
    pdf.getPages()[slot.page].drawImage(image, { x: slot.x, y: PAGE.height - slot.top - height, width, height });
  }
  return { ...result, bytes: await pdf.save(), warnings: [] };
}
