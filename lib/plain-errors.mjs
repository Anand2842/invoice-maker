// Database checks speak in accounting terms. Before an error reaches a page, the common
// "set this up first" ones are reworded into what to do and where.
const BOOKS='Set up your books first: open Accounting and choose a start date (one time, about a minute).';
const rules=[
 [/^Configure the ledger( first| before .*)?(; legacy expenses remain separate)?$/,BOOKS],
 [/^Configure the ledger and automatic document posting first$/,'Set up your books and turn on automatic postings first (Accounting → Automatic postings).'],
 [/^Configure automatic (invoice and receipt posting|source reconciliation) before .*$/,'Turn on automatic postings first (Accounting → Automatic postings), so invoices and payments reach your books.'],
 [/^Configure (reviewed|demo) cash(\/| and )advance controls (first|before generating this statement)$/,'Set up advances first: open Advances & unapplied cash and confirm the accounts it uses (one time).'],
];
export function plainError(message){
 if(typeof message!=='string')return message;
 for(const[pattern,text]of rules)if(pattern.test(message))return text;
 return message;
}
export function plainErrorBody(data){
 return data&&typeof data==='object'&&!Array.isArray(data)&&typeof data.error==='string'?{...data,error:plainError(data.error)}:data;
}
