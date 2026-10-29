// Compatibility contract for existing single-invoice incoming payment records.
// Multi-invoice allocations, reversals and transactional posting use a later RPC.
export const invoiceTypes = ['invoice', 'gst-invoice', 'commercial-invoice'];
export const issuedStatuses = ['sent', 'paid', 'partially_paid'];

export function paymentMinor(value) {
 if (!['number', 'string'].includes(typeof value) || String(value).length > 64 || !/^\d+(\.\d{1,2})?$/.test(String(value))) {
  throw Error('Payment amount must have at most two decimal places');
 }
 const [whole, fraction = ''] = String(value).split('.');
 const amount = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
 if (!Number.isSafeInteger(amount) || amount <= 0) {
  throw Error('Payment amount must be positive and within the supported range');
 }
 return amount;
}

export function paymentForInvoice(payment, invoice, {business, demo}) {
 if (!invoice || invoice.id.toLowerCase() !== payment.documentId.toLowerCase() || invoice.business_id.toLowerCase() !== business.toLowerCase() || invoice.demo !== demo || invoice.archived || invoice.collection !== 'documents') {
  throw Error('Choose an invoice in this business and data mode');
 }
 if (!invoiceTypes.includes(invoice.data.type) || !issuedStatuses.includes(invoice.data.status)) {
  throw Error('Payments require an issued invoice');
 }
 if (payment.currency && payment.currency !== invoice.data.currency) throw Error('Payment currency differs from its invoice');
 if (payment.direction && payment.direction !== 'incoming') throw Error('Only incoming invoice payments are supported');
 paymentMinor(payment.amount);
 return {...payment, documentId: invoice.id, currency: invoice.data.currency, direction: 'incoming'};
}
