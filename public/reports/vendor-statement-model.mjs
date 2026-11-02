import{dateISO}from'../banking/model.mjs';
export const agingLabels={current:'Current / not overdue',days1to30:'1–30 days overdue',days31to60:'31–60 days overdue',days61to90:'61–90 days overdue',daysOver90:'Over 90 days overdue'};
export const movementLabels={bill:'Bill issued','bill-reversal':'Bill reversed',payment:'Payment recorded','payment-reversal':'Payment reversed',allocation:'Cash allocated','allocation-release':'Cash allocation released','credit-allocation':'Supplier credit allocated','credit-release':'Supplier credit released'};
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function exactMinor(value){if(typeof value!=='string'||value.length>64||!/^\d+(?:\.\d{1,2})?$/.test(value))throw Error('Statement amounts must be exact nonnegative decimal strings');const[whole,fraction='']=value.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'))}
export function statementMoney(value){const n=exactMinor(value);return(n/100n)+'.'+String(n%100n).padStart(2,'0')}
export function statementSequence(value){if(typeof value!=='string'||!/^\d{1,9}$/.test(value))throw Error('Invalid statement sequence');return BigInt(value)}
const text=(v,max)=>typeof v==='string'&&v.length<=max;
export function validateVendorStatement(data,args){
 if(!data||data.businessId!==args.business||data.demo!==args.data_mode||data.vendor?.id!==args.vendor_id||data.from!==args.from_date||data.to!==args.to_date||!text(data.businessName,1024)||!text(data.vendor.name,1024)||typeof data.vendor.archived!=='boolean'||!['address','email'].every(k=>data.vendor[k]==null||text(data.vendor[k],4096))||typeof data.currency!=='string'||! /^[A-Z]{3}$/.test(data.currency))throw Error('Statement context was incomplete');
 const ceiling=statementSequence(data.snapshotNumber);if(args.snapshot_number!==null&&ceiling!==statementSequence(String(args.snapshot_number)))throw Error('Statement snapshot changed');
 const opening=exactMinor(data.opening),closing=exactMinor(data.closing),charges=exactMinor(data.charges),credits=exactMinor(data.credits);
 if(opening+charges-credits!==closing||!data.aging||Object.keys(agingLabels).reduce((sum,k)=>sum+exactMinor(data.aging[k]),0n)!==closing)throw Error('Statement totals did not reconcile');
 if(!Array.isArray(data.rows)||data.rows.length>args.page_size||typeof data.totalRows!=='string'||!/^\d{1,20}$/.test(data.totalRows)||BigInt(data.totalRows)<BigInt(data.rows.length))throw Error('Statement movements were incomplete');
 let previous=args.after_date?{date:args.after_date,sequence:String(args.after_sequence)}:null,balance=args.after_date?null:opening;
 for(const row of data.rows){
  dateISO(row.date);const seq=statementSequence(row.sequence),charge=exactMinor(row.charge),credit=exactMinor(row.credit),current=exactMinor(row.balance);
  if(!uuid(row.batchId)||!uuid(row.billId)||!Object.hasOwn(movementLabels,row.kind)||!text(row.number,256)||!text(row.reference,500)||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||row.date<data.from||row.date>data.to||seq>ceiling||previous&&(row.date<previous.date||row.date===previous.date&&seq<=statementSequence(previous.sequence)))throw Error('Statement movement order or context was invalid');
  if(['bill','payment-reversal','allocation-release','credit-release'].includes(row.kind)?charge<=0n||credit!==0n:credit<=0n||charge!==0n)throw Error('Statement movement signs were invalid');
  if(balance!==null&&balance+charge-credit!==current)throw Error('Statement running balance did not reconcile');balance=current;previous=row;
 }
 if(!Object.hasOwn(data,'next'))throw Error('Statement page confirmation was incomplete');
 if(data.next!==null){const last=data.rows.at(-1);if(!last||data.next.date!==last.date||data.next.sequence!==last.sequence||data.next.snapshot!==data.snapshotNumber)throw Error('Statement continuation was invalid')}
 else if(data.rows.length&&balance!==closing)throw Error('Statement closing balance did not reconcile');
 return data;
}
