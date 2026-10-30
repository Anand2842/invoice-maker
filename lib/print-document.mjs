import {paymentMinor} from './payments.mjs';

const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function text(value,label,max=4096,required=false){
 if(value==null&&!required)return '';
 if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw Error(`${label} must be text of at most ${max} characters without control characters`);
 const clean=value.replace(/\r\n?/g,'\n').replace(/\t/g,'    ').trim();
 if(required&&!clean)throw Error(`${label} is required`);
 return clean;
}
function date(value,label,required=true){
 const clean=text(value,label,10,required);if(!clean&&!required)return '';
 const parsed=new Date(clean+'T00:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(clean)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==clean)throw Error(`${label} must be a real ISO date (YYYY-MM-DD)`);
 return clean;
}
function money(value){if(typeof value!=='number'||!Number.isFinite(value)||!Number.isSafeInteger(Math.round(value*100)))throw Error('Report amount is outside the supported monetary range');return value.toFixed(2);}
function currency(value){if(typeof value!=='string'||! /^[A-Z]{3}$/.test(value))throw Error('Currency must be a three-letter uppercase currency code');return value;}
const safeTitle = value => value.replace(/[^A-Za-z0-9_-]/g,'-').replace(/-+/g,'-').slice(0,100).replace(/^-|-$/g,'')||'Folio-document';
const field = (label,value) => `<div class="print-field"><dt>${escape(label)}</dt><dd>${escape(value||'Not recorded')}</dd></div>`;
const demo = enabled => enabled?'<p class="print-demo"><strong>DEMO — NOT A REAL TRANSACTION</strong></p>':'';
function documentHTML(title,body){
 const cleanTitle=safeTitle(title);
 return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${cleanTitle}</title><link rel="stylesheet" href="/print-document.css"><script src="/print-document.js" defer></script></head>
<body><a class="print-skip" href="#document">Skip to document</a><header class="print-toolbar" aria-label="Print controls"><div><strong>Folio · Print document</strong><p>Print or choose Save as PDF in your browser. Your browser renders Unicode text using available system fonts.</p></div><button type="button" data-print-document>Print / Save PDF</button><p data-print-status role="status" aria-live="polite"></p><noscript>Use your browser’s Print command to print or save this document as PDF.</noscript></header><main id="document" tabindex="-1">${body}</main></body></html>`;
}

/** Returns a complete UTF-8 HTML document; the caller supplies authenticated report data.
 * No external resources or mutable client/business records are read here.
 * This is browser print output, not a server-generated Unicode PDF.
 */
export function statementPrintHTML(report){
 if(!report||!Array.isArray(report.rows)||report.rows.length>2000)throw Error('Print supports up to 2,000 statement movements. Use CSV for larger reports.');
 const unit=currency(report.currency),from=date(report.from,'From date'),to=date(report.to,'To date');if(from>to)throw Error('From must be on or before To');
 const business=text(report.businessName,'Business name',1024),client=text(report.clientName,'Client name',1024);
 for(const key of ['issues','excluded','limitations'])if(!Array.isArray(report[key])||report[key].length>20000)throw Error('Invalid or oversized statement review details');
 const summary=[['Opening balance',report.opening],['Debits',report.debits],['Credits',report.credits],['Closing balance',report.closing]].map(([label,value])=>field(label,unit+' '+money(value))).join('');
 const rows=report.rows.map(row=>`<tr><td>${escape(date(row.date,'Movement date'))}</td><td><strong>${escape(text(row.type,'Movement type',128))}</strong><br>${escape(text(row.number,'Movement reference',2048))}<br><span class="print-secondary">${escape(text(row.clientName,'Movement client',1024))}</span></td>${[row.debit,row.credit,row.balance].map(amount=>`<td class="print-money">${money(amount)}</td>`).join('')}</tr>`).join('');
 const buckets=Object.entries({current:'Current / not overdue',days1to30:'1–30 days overdue',days31to60:'31–60 days overdue',days61to90:'61–90 days overdue',daysOver90:'Over 90 days overdue',undated:'No due date'}).map(([key,label])=>field(label,unit+' '+money(report.buckets?.[key]))).join('');
 const issues=report.issues.map(issue=>`<li><strong>${escape(text(issue.code,'Issue code',256))}</strong> · ${escape(text(issue.recordId,'Issue record ID',128))}<p>${escape(text(issue.message,'Issue message',12000))}</p></li>`).join('');
 const excluded=report.excluded.map(item=>`<li>${escape(text(item.recordId,'Excluded record ID',128))} · ${escape(text(item.reason,'Exclusion reason',4096))}</li>`).join('');
 const limitations=report.limitations.map(value=>`<li>${escape(text(value,'Report limitation',12000))}</li>`).join('');
 return documentHTML('Client-statement-'+from+'-'+to,`<header class="print-heading"><p class="print-brand">Folio</p><h1>Client statement</h1>${demo(report.demo===true)}<p class="print-party">${escape(business)}</p><p>${escape(client)}</p><p>${from} to ${to} · ${unit}</p></header><dl class="print-summary">${summary}</dl><table><caption>Statement movements in ${unit}</caption><thead><tr><th scope="col">Date</th><th scope="col">Type / reference / client</th><th scope="col" class="print-money">Debit</th><th scope="col" class="print-money">Credit</th><th scope="col" class="print-money">Balance</th></tr></thead><tbody>${rows||'<tr><td colspan="5">No movements in this period.</td></tr>'}</tbody></table><section aria-labelledby="aging-heading"><h2 id="aging-heading">Receivables aging as of ${to}</h2><dl class="print-details">${buckets}${field('Credit balances',unit+' '+money(report.creditBalance))}${field('Net balance',unit+' '+money(report.closing))}</dl></section><section aria-labelledby="review-heading"><h2 id="review-heading">Review notes</h2><p>Review issues: ${report.issues.length} · Excluded records: ${report.excluded.length}</p>${issues?`<ul>${issues}</ul>`:'<p>No review issues reported.</p>'}${excluded?`<h3>Excluded records</h3><ul>${excluded}</ul>`:''}<h3>Report limitations</h3><ul>${limitations}</ul></section>`);
}

export function paymentReceiptPrintHTML(record){
 if(!record||typeof record!=='object'||record.data?.kind!=='receipt')throw Error('A recorded payment receipt is required');
 const data=record.data,number=text(data.number,'Receipt number',256,true),id=text(record.id,'Payment ID',128,true),unit=currency(text(data.currency,'Currency',3,true)),paidDate=date(data.date,'Payment date'),amount=paymentMinor(data.amount);
 const businessId=text(record.business_id,'Business ID',128),invoiceId=text(data.documentId,'Invoice ID',128),invoiceNumber=text(data.invoiceNumber,'Invoice number',256),invoiceDate=date(data.invoiceDate,'Invoice date',false),invoiceType=text(data.invoiceType,'Invoice type',80);
 const method=text(data.method,'Payment method',128),reference=text(data.reference,'Payment reference',2048),notes=text(data.notes,'Payment notes',12000);
 const party=(source,label)=>{const name=text(source?.name,label+' name',1024),address=text(source?.address,label+' address',4096),email=text(source?.email,label+' email',320);return `<section class="print-party-section"><h2>${escape(label)}</h2><p class="print-party">${escape(name||'Name not recorded')}</p>${address?`<p class="print-pre">${escape(address)}</p>`:''}${email?`<p>${escape(email)}</p>`:''}</section>`;};
 let reversal='';if(data.reversal!=null){
  if(typeof data.reversal!=='object'||Array.isArray(data.reversal))throw Error('Invalid receipt reversal');
  const reversedDate=date(data.reversal.date,'Reversal date'),reversedNumber=text(data.reversal.number,'Reversal number',256),reason=text(data.reversal.reason,'Reversal reason',4096);
  reversal=`<section class="print-reversal"><h2>Reversal recorded for ${reversedDate}</h2><dl>${reversedNumber?field('Reversal number',reversedNumber):''}${reason?field('Reversal reason',reason):''}</dl><p>This receipt has a linked reversal with the effective date shown above. The original positive amount is retained for the audit trail.</p></section>`;
 }
 const exactAmount=Math.floor(amount/100)+'.'+String(amount%100).padStart(2,'0');
 return documentHTML('Payment-receipt-'+number,`<header class="print-heading"><p class="print-brand">Folio</p><h1>Payment receipt</h1>${demo(record.demo===true)}<dl>${field('Receipt number',number)}${field('Payment date',paidDate)}</dl></header><p class="print-total">Recorded amount: ${unit} ${exactAmount}</p><dl>${field('Method',method)}${field('Reference',reference)}</dl>${reversal}<div class="print-parties">${party(data.seller,'Recorded by / seller')}${party(data.buyer,'Payer / buyer')}</div><section><h2>Linked invoice</h2><dl>${field('Invoice number',invoiceNumber)}${invoiceDate?field('Invoice date',invoiceDate):''}${invoiceType?field('Invoice type',invoiceType):''}</dl></section>${notes?`<section><h2>Notes</h2><p class="print-pre">${escape(notes)}</p></section>`:''}<footer class="print-record-footer"><p>This receipt records a payment entered in Folio. It does not confirm gateway collection or show the current invoice balance.</p><dl>${field('Payment ID',id)}${businessId?field('Business ID',businessId):''}${invoiceId?field('Invoice ID',invoiceId):''}</dl></footer>`);
}
