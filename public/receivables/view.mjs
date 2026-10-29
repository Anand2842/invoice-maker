// Pure view selectors: filtering never changes the financial summary totals.
export const settlementLabels={unpaid:'Unpaid',partial:'Partially paid',settled:'Settled',credit:'Credit balance'};
export function visibleInvoices(rows,{search='',state='all'}={}) {
 const term=search.trim().toLowerCase();
 return rows.filter(row=>{
  if(term&&!`${row.number} ${row.clientName}`.toLowerCase().includes(term))return false;
  if(state==='outstanding')return row.balanceMinor>0;
  if(state==='overdue')return row.balanceMinor>0&&row.daysOverdue>0;
  return state==='all'||row.status===state;
 });
}
export function invoiceURL(row,context){return '/invoice-editor/?'+new URLSearchParams({business:context.business,document:row.type,id:row.documentId,demo:context.demo})}
export function statementURL(context,client=''){return '/reports/statements/?'+new URLSearchParams({business:context.business,demo:context.demo,currency:context.currency,from:context.date.slice(0,7)+'-01',to:context.date,...(client?{client}:{})})}
