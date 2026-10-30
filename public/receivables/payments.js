import {api} from '/workspace-shell.js';
import {businessDate,businessTimeZone} from '/business-date.js';

let activeDialog;
const pendingMemory = new Map();
const issuedTypes = new Set(['invoice', 'gst-invoice', 'commercial-invoice']);

function el(tag, text, className) {
 const node = document.createElement(tag);
 if (text != null) node.textContent = text;
 if (className) node.className = className;
 return node;
}
function button(label, action, className) {
 const node = el('button', label, className); node.type = 'button'; node.onclick = action; return node;
}
function styles() {
 if (document.querySelector('link[href="/receivables/payments.css"]')) return;
 const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/receivables/payments.css'; document.head.append(link);
}
function amount(data, fallback = '') {
 const value = String(data?.amount ?? '');
 const currency = data?.currency || fallback;
 if (!/^\d+(\.\d{1,2})?$/.test(value) || !Number.isFinite(Number(value))) return 'Amount needs review';
 return currency + ' ' + new Intl.NumberFormat('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(Number(value));
}
function details(parent, label, value) {
 if (!value) return;
 const row = el('div'); row.append(el('dt', label), el('dd', String(value))); parent.append(row);
}

async function downloadReceipt(query, number) {
 const url = '/api/payments?' + query;
 let response = await fetch(url, {headers: {Accept: 'application/pdf'}});
 if (response.status === 401) {
  await api('/api/auth', {method: 'POST', body: JSON.stringify({action: 'refresh'})});
  response = await fetch(url, {headers: {Accept: 'application/pdf'}});
 }
 if (!response.ok || !response.headers.get('Content-Type')?.startsWith('application/pdf')) {
  const error = await response.json().catch(() => null);
  throw Error(error?.error || 'The receipt could not be downloaded. Try again.');
 }
 const blob = await response.blob();
 if (!blob.size || await blob.slice(0, 5).text() !== '%PDF-') throw Error('The receipt could not be downloaded. Try again.');
 const href = URL.createObjectURL(blob), a = document.createElement('a');
 a.href = href; a.download = String(number || 'payment-receipt').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) + '.pdf';
 document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export async function openPayments({business, invoice, demo = false, timeZone, onSaved} = {}) {
 if (activeDialog?.isConnected) {activeDialog.focus(); return;}
 const businessId = typeof business === 'string' ? business : business?.id;
 const invoiceId = typeof invoice === 'string' ? invoice : invoice?.id;
 const dataMode = demo === true || demo === 'true';
 if (!businessId || !invoiceId) throw Error('Choose an invoice to view its payments.');
 styles();
 const returnFocus = document.activeElement;
 const dialog = el('dialog', null, 'folio-payments'); activeDialog = dialog;
 const uid = 'payments-' + crypto.randomUUID();
 const heading = el('h2', 'Invoice payments'); heading.id = uid;
 dialog.setAttribute('aria-labelledby', uid);
 const intro = el('p', 'Review recorded payments and corrections for this invoice.', 'fp-intro'); intro.id = uid + '-intro';
 dialog.setAttribute('aria-describedby', intro.id);
 const status = el('p', 'Loading payment history…', 'fp-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
 const content = el('div', null, 'fp-content');
 let busy = false, closed = false, response, storageKey, pending, corruptPending = false, userId;
 const close = button('Close', () => {if (!busy) dialog.close();}, 'fp-close'); close.setAttribute('aria-label', 'Close payments');
 const header = el('header', null, 'fp-header'); header.append(heading, close);
 dialog.append(header, intro, status, content); document.body.append(dialog);
 dialog.addEventListener('cancel', event => {if (busy) event.preventDefault();});
 dialog.addEventListener('close', () => {closed = true; if (activeDialog === dialog) activeDialog = null; dialog.remove(); if (returnFocus?.isConnected) returnFocus.focus();}, {once: true});
 dialog.showModal(); close.focus();

 function message(value, error = false) {
  status.textContent = value; status.classList.toggle('fp-error', error); status.setAttribute('role', error ? 'alert' : 'status');
 }
 function setBusy(value) {busy = value; close.disabled = value; dialog.setAttribute('aria-busy', String(value));}
 function query(extra = {}) {return new URLSearchParams({business: businessId, invoice: invoiceId, demo: String(dataMode), ...extra});}
 function restorePending() {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) {pending = pendingMemory.get(storageKey); return;}
  try {
   const saved = JSON.parse(raw), command = saved.command;
   if (saved.invoice !== invoiceId || saved.user !== userId || command.business !== businessId || command.demo !== dataMode || !['record', 'reverse'].includes(command.action) || !/^[0-9a-f-]{36}$/i.test(command.commandId) || (command.action === 'record' && command.invoice !== invoiceId)) throw Error();
   pending = saved; pendingMemory.set(storageKey, saved);
  } catch {corruptPending = true;}
 }
 function savePending(command) {
  const value = {user: userId, invoice: invoiceId, command};
  try {sessionStorage.setItem(storageKey, JSON.stringify(value));}
  catch {throw Error('This browser cannot protect a payment retry. Allow session storage or use another browser before recording a payment.');}
  pending = value; pendingMemory.set(storageKey, value);
 }
 function clearPending() {
  pendingMemory.delete(storageKey); pending = undefined;
  try {sessionStorage.removeItem(storageKey);} catch {corruptPending = true;}
 }
 async function load(first = false) {
  setBusy(true); message('Loading payment history…');
  try {
   const result = await api('/api/payments?' + query());
   if (closed) return;
   response = result;
   if (first || !userId) {
    const auth = await api('/api/auth');
    if (!auth.user?.id) throw Error('Sign in again to manage this invoice’s payments.');
    userId = auth.user.id;
    storageKey = ['folio-payment-pending-v1', userId, businessId, invoiceId, dataMode ? 'demo' : 'live'].join(':');
    try {restorePending();} catch {corruptPending = true;}
   }
   if (closed) return;
   setBusy(false);render();
   message(pending ? 'A previous request still needs confirmation. Retry the same request before recording another payment.' : 'Payment history is up to date.');
  } catch (error) {
   if (closed) return;
   message(error.message || 'Payment history could not be loaded.', true);
   content.replaceChildren(button('Try again', () => load(!userId)));
  } finally {setBusy(false);}
 }
 function render() {
  content.replaceChildren();
  const current = response.invoice?.data || {};
  heading.textContent = 'Payments · ' + (current.number || 'Invoice');
  intro.textContent = (dataMode ? 'Demo data · ' : '') + 'Recorded payments and corrections for this invoice. Recording a payment does not collect money.';
  const writable = response.available && response.canWrite && issuedTypes.has(current.type) && ['sent', 'paid'].includes(current.status);
  if (!response.available) content.append(el('p', 'Payment recording is not available yet.', 'fp-notice'));
  else if (!response.canWrite) content.append(el('p', 'You can view payment history. Your role cannot record payments or corrections.', 'fp-notice'));
  else if (!writable) content.append(el('p', 'Payment recording is available for issued invoices. Review this invoice’s status first.', 'fp-notice'));
  if (corruptPending) content.append(el('p', 'A previous request could not be restored safely. Review payment history and contact support before recording another payment.', 'fp-notice fp-error'));
  if (pending) {
   const warning = el('section', null, 'fp-pending');
   warning.append(el('h3', 'Confirm the previous request'), el('p', 'Its result is not confirmed. The same details and retry key are kept in this browser tab so retrying cannot create another payment. You can close this window and return to retry.'));
   const summary = el('dl', null, 'fp-details');
   details(summary, 'Action', pending.command.action === 'reverse' ? 'Reverse payment record' : 'Record payment');
   details(summary, 'Date', pending.command.date);
   if (pending.command.action === 'record') {
    details(summary, 'Amount', amount(pending.command)); details(summary, 'Method', pending.command.method); details(summary, 'Reference', pending.command.reference); details(summary, 'Notes', pending.command.notes);
   } else {
    const original = response.payments.find(p => p.id === pending.command.payment);
    details(summary, 'Payment', original?.data?.number || 'Recorded payment');
    details(summary, 'Amount', original ? amount(original.data, current.currency) : 'Full original recorded amount');
    details(summary, 'Reason', pending.command.reason);
   }
   warning.append(summary, button('Retry same ' + (pending.command.action === 'reverse' ? 'reversal' : 'payment'), () => submit(pending.command), 'fp-primary'));
   content.append(warning);
  }
  const history = el('section', null, 'fp-history'); history.append(el('h3', 'Payment history'));
  const records = [...response.payments].sort((a, b) => String(b.data?.date || '').localeCompare(String(a.data?.date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const reversed = new Set(records.filter(p => p.data?.kind === 'reversal').map(p => p.data.reversalOf));
  if (!records.length) history.append(el('p', 'No payments recorded for this invoice yet.', 'fp-empty'));
  for (const record of records) {
   const d = record.data || {}, reversal = d.kind === 'reversal', legacy = !d.kind;
   const card = el('article', null, 'fp-payment' + (reversal ? ' fp-reversal' : ''));
   const top = el('div', null, 'fp-payment-top');
   top.append(el('h4', reversal ? 'Payment reversal' : legacy ? 'Legacy payment' : d.number || 'Payment receipt'), el('strong', amount(d, current.currency)));
   card.append(top);
   if (legacy) card.append(el('p', 'Earlier payment record. A numbered receipt PDF is not available.', 'fp-muted'));
   if (reversal) card.append(el('p', 'Correction of a payment record. This does not refund money.', 'fp-muted'));
   const info = el('dl', null, 'fp-details');
   details(info, reversal ? 'Reversal date' : 'Payment date', d.date || 'Not recorded');
   details(info, 'Method', d.method || 'Not recorded');
   details(info, 'Reference', d.reference);
   details(info, 'Notes', d.notes);
   if (reversal) {
    const original = records.find(p => p.id === d.reversalOf);
    details(info, 'Reverses', original?.data?.number || 'Earlier payment record'); details(info, 'Reason', d.reason);
   } else if (reversed.has(record.id)) {
    const correction = records.find(p => p.data?.kind === 'reversal' && p.data.reversalOf === record.id);
    details(info, 'Correction', 'Reversed effective ' + (correction?.data?.date || 'date not recorded'));
   }
   card.append(info);
   const actions = el('div', null, 'fp-actions');
   if (d.kind === 'receipt') {
    const downloadStatus = el('p', '', 'fp-download-status'); downloadStatus.setAttribute('role', 'status');
    const download = button('Download receipt PDF', async () => {
     download.disabled = true; downloadStatus.textContent = 'Preparing receipt…'; downloadStatus.classList.remove('fp-error');
     try {await downloadReceipt(query({payment: record.id, format: 'pdf'}), d.number); downloadStatus.textContent = 'Receipt downloaded.';}
     catch (error) {downloadStatus.textContent = error.message || 'The receipt could not be downloaded.'; downloadStatus.classList.add('fp-error');}
     finally {download.disabled = false;}
    });
    actions.append(download); card.append(downloadStatus);
   }
   if (!reversal && !reversed.has(record.id) && writable && !pending && !corruptPending) actions.append(button('Reverse record', () => renderForm(record)));
   if (actions.childNodes.length) card.append(actions);
   history.append(card);
  }
  content.append(history);
  if (writable && !pending && !corruptPending) renderForm();
 }
 function renderForm(original) {
  if (pending || corruptPending || busy) return;
  content.querySelector('.fp-form')?.remove();
  const form = el('form', null, 'fp-form');
  const title = el('h3', original ? 'Reverse payment record' : 'Record payment'); form.append(title);
  if (original) form.append(el('p', 'Reverse the full ' + amount(original.data, response.invoice.data.currency) + ' recorded on ' + (original.data.date || 'an earlier date') + '. This corrects the record; it does not send a cash refund.', 'fp-muted'));
  else form.append(el('p', 'Enter money already received. Partial payments and customer credits remain visible in dated balances.', 'fp-muted'));
  const fields = el('div', null, 'fp-fields'); form.append(fields);
  function field(name, label, options = {}) {
   const wrap = el('div', null, 'fp-field' + (options.wide ? ' fp-wide' : ''));
   const id = uid + '-' + name, caption = el('label', label); caption.htmlFor = id;
   const input = el(options.textarea ? 'textarea' : 'input'); input.id = id; input.name = name; input.required = options.required === true;
   if (!options.textarea) input.type = options.type || 'text';
   if (options.maxLength) input.maxLength = options.maxLength;
   if (options.value != null) input.value = options.value;
   if (options.min) input.min = options.min;
   if (options.inputMode) input.inputMode = options.inputMode;
   if (options.pattern) input.pattern = options.pattern;
   wrap.append(caption, input); fields.append(wrap); return input;
  }
  let amountInput;
  if (!original) amountInput = field('amount', 'Amount (' + response.invoice.data.currency + ')', {required: true, inputMode: 'decimal', pattern: '[0-9]+([.][0-9]{1,2})?', maxLength: 16});
  form.append(el('p','Business time zone: '+businessTimeZone(timeZone),'fp-muted'));
  field('date', original ? 'Reversal date' : 'Payment date', {required: true, type: 'date', value: businessDate(new Date(),timeZone), min: original?.data?.date});
  if (original) field('reason', 'Reason for reversal', {required: true, textarea: true, maxLength: 1000, wide: true});
  else {
   field('method', 'Payment method', {required: true, maxLength: 100});
   field('reference', 'Reference (optional)', {maxLength: 500});
   field('notes', 'Notes (optional)', {textarea: true, maxLength: 5000, wide: true});
  }
  const actions = el('div', null, 'fp-actions'), save = el('button', original ? 'Confirm reversal' : 'Record payment', 'fp-primary'); save.type = 'submit'; actions.append(save);
  if (original) actions.append(button('Cancel reversal', () => {renderForm();}));
  form.append(actions); content.append(form);
  if (original) {form.scrollIntoView({block: 'nearest'}); form.querySelector('input,textarea')?.focus();}
  form.onsubmit = event => {
   event.preventDefault(); if (busy || pending || corruptPending) return;
   if (amountInput && (!/^\d+(\.\d{1,2})?$/.test(amountInput.value) || Number(amountInput.value) <= 0 || Number(amountInput.value) > 1e10)) {
    amountInput.setCustomValidity('Enter a positive amount with up to two decimal places.'); amountInput.reportValidity(); return;
   }
   const values = new FormData(form);
   const command = original
    ? {action: 'reverse', business: businessId, payment: original.id, demo: dataMode, date: values.get('date'), reason: String(values.get('reason')).trim()}
    : {action: 'record', business: businessId, invoice: invoiceId, version: response.invoice.version, demo: dataMode, amount: String(values.get('amount')).trim(), date: values.get('date'), method: String(values.get('method')).trim(), reference: String(values.get('reference')).trim(), notes: String(values.get('notes')).trim(), currency: response.invoice.data.currency};
   command.commandId = crypto.randomUUID();
   submit(command);
  };
  if (amountInput) amountInput.oninput = () => amountInput.setCustomValidity('');
 }
 async function submit(command) {
  if (busy) return;
  try {if (!pending) savePending(command);}
  catch (error) {message(error.message, true); return;}
  setBusy(true);
  content.querySelectorAll('button,input,textarea').forEach(node => {node.disabled = true;});
  message(command.action === 'reverse' ? 'Confirming reversal…' : 'Recording payment…');
  let result;
  try {
   result = await api('/api/payments', {method: 'POST', body: JSON.stringify(command)});
   if (!result.record?.id) throw Error('Payment confirmation was incomplete. Retry the same request.');
  } catch (error) {
   const definite = [400, 401, 403, 404, 409, 422].includes(error.status) && !pending?.uncertain;
   if (definite) clearPending();
   else {pending.uncertain=true;pendingMemory.set(storageKey,pending);try{sessionStorage.setItem(storageKey,JSON.stringify(pending))}catch{corruptPending=true}}
   setBusy(false);
   render();
   message((error.message || 'The request could not be confirmed.') + (definite ? ' Review the details before trying again.' : ' Retry the same request to confirm the result. Its details are locked to avoid a duplicate.'), true);
   return;
  }
  clearPending();
  setBusy(false);
  await load();
  if (!closed) message(command.action === 'reverse' ? 'Payment record reversed. No money was refunded.' : 'Payment recorded.');
  try {await onSaved?.(result);}
  catch {if (!closed) message('The payment was saved, but the balance list could not refresh. Close this window and review balances again.', true);}
 }
 await load(true);
}
