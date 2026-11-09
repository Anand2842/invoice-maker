// One-click sample business. Everything is written with demo=true through the same APIs the screens use, so it
import{startBooks}from'/books-setup.js';
// follows the same rules (issuing, payments, bills, books) and never touches the owner's real records.
import {api} from '/workspace-shell.js';

const iso=d=>d.toISOString().slice(0,10);
const daysAgo=n=>{const d=new Date();d.setUTCDate(d.getUTCDate()-n);return iso(d)};
const key=()=>crypto.randomUUID();
const post=(path,body)=>api(path,{method:'POST',body:JSON.stringify(body)});

const CLIENTS=[
 {name:'Northstar Trading',email:'accounts@northstar.example.test',phone:'9000000101',address:'45 Sample Avenue, Lower Parel, Mumbai',gstState:'Maharashtra',gstin:'27AAAAA0000A1Z5'},
 {name:'Cedar & Co.',email:'billing@cedar.example.test',phone:'9000000102',address:'42 Example Road, Indiranagar, Bengaluru',gstState:'Karnataka',gstin:'29AAAAA0000A1Z5'},
 {name:'Lotus Design Studio',email:'hello@lotus.example.test',phone:'9000000103',address:'7 Park Street, Kolkata',gstState:'West Bengal',gstin:''},
 {name:'Greenleaf Cafe',email:'owner@greenleaf.example.test',phone:'9000000104',address:'3 Lake Road, Pune',gstState:'Maharashtra',gstin:''}];
const VENDORS=[
 {name:'Acme Supplies',email:'sales@acme.example.test',phone:'9000000201',address:'12 Demo Road, Bengaluru',gstin:'29BBBBB1111B1Z6'},
 {name:'Swift Logistics',email:'ops@swift.example.test',phone:'9000000202',address:'88 Transport Nagar, Pune',gstin:''},
 {name:'Prime Properties',email:'rent@prime.example.test',phone:'9000000203',address:'1 Business Park, Mumbai',gstin:''}];
const ITEMS=[
 {name:'LED signage panel 24"',sku:'SIGN-24',hsn:'9405',taxRate:18,quantity:40,rate:4500,reorderLevel:10},
 {name:'A4 copier paper (ream)',sku:'PAP-A4',hsn:'4802',taxRate:12,quantity:200,rate:320,reorderLevel:50},
 {name:'Installation service (per hour)',sku:'SVC-INST',hsn:'9987',taxRate:18,quantity:0,rate:1200,reorderLevel:0},
 {name:'Annual maintenance contract',sku:'SVC-AMC',hsn:'9987',taxRate:18,quantity:0,rate:15000,reorderLevel:0}];
const LEADS=[
 {name:'Riverstone Hotels',email:'purchase@riverstone.example.test',phone:'9000000301',amount:250000,status:'New',notes:'Wants a quotation for 40 room signage units'},
 {name:'Kavya Textiles',email:'owner@kavya.example.test',phone:'9000000302',amount:85000,status:'Contacted',notes:'Follow up after the festival season'},
 {name:'Blue Peak Schools',email:'admin@bluepeak.example.test',phone:'9000000303',amount:120000,status:'Qualified',notes:'Annual stationery contract'}];

async function records(business,collection){return(await api('/api/records?'+new URLSearchParams({business,collection,demo:'true'}))).records}
async function ensureRecords(business,collection,rows){const have=await records(business,collection),out={};
 for(const r of have)out[r.data.name]=r;
 for(const row of rows)if(!out[row.name])out[row.name]=(await post('/api/records',{business,collection,demo:true,data:row})).record;
 return out}

function party(c){return{name:c.name,email:c.email,phone:c.phone,address:c.address,street:c.address,gstin:c.gstin||'',gstState:c.gstState||''}}

export async function seedSampleBusiness(business,progress=()=>{}){
 const ws=await api('/api/workspace'),b=ws.businesses.find(x=>x.id===business);if(!b)throw Error('Choose a business first');
 progress('Adding sample clients, vendors, items and leads…');
 const clients=await ensureRecords(business,'clients',CLIENTS),vendors=await ensureRecords(business,'vendors',VENDORS),items=await ensureRecords(business,'items',ITEMS);await ensureRecords(business,'leads',LEADS);
 const docs=await records(business,'documents');
 if(docs.some(d=>/^SAMPLE-/.test(d.data.number||''))){progress('Sample data is ready.');return}

 progress('Setting up sample books…');
 const start=(()=>{const d=new Date();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-2);return iso(d)})();
 const{ledger,acct}=await startBooks(api,{business,demo:true,start,today:daysAgo(0)});
 // Sample invoices and receipts post to the sample books, so Books shows sales next to the dashboard figures.

 progress('Creating and issuing sample invoices…');
 const seller={name:b.name,email:b.email||'',phone:b.phone||'',address:b.address||'',gstin:b.gstin||'',panNumber:b.pan||''};
 const own=(b.gstin||'').slice(0,2);
 const line=(item,quantity)=>({name:item.data.name,quantity:String(quantity),rate:String(item.data.rate),taxRate:String(item.data.taxRate??18),hsn:item.data.hsn||'',discount:0,discountType:'fixed',cessRate:'0'});
 const invoice=async(number,client,lines,date,due,type='invoice')=>{const c=client.data,their=(c.gstin||'').slice(0,2);
  const data={type,number,date,dueDate:due,currency:b.currency||'INR',taxType:'GST',gstMode:own&&their&&own!==their?'igst':'split',seller,buyer:party(c),clientId:client.id,items:lines,notes:b.default_notes||'Thank you for your business.',terms:b.default_terms||'Payment due within 15 days.',status:'draft',template:'classic',taxDetails:{placeOfSupply:their||own||'',reverseCharge:'No'}};
  return(await post('/api/records',{business,collection:'documents',demo:true,data})).record};
 const issue=async rec=>(await post('/api/documents/lifecycle',{business,document:rec.id,command:key(),demo:true,version:rec.version,action:'issue'})).record;
 const pay=(rec,amount,date,method,reference)=>post('/api/payments',{action:'record',business,commandId:key(),demo:true,invoice:rec.id,version:rec.version,amount:String(amount),date,method,reference});
 const I=n=>items[n];
 const inv1=await issue(await invoice('SAMPLE-INV-001',clients['Northstar Trading'],[line(I('LED signage panel 24"'),12),line(I('Installation service (per hour)'),6)],daysAgo(48),daysAgo(33)));
 const inv2=await issue(await invoice('SAMPLE-INV-002',clients['Cedar & Co.'],[line(I('A4 copier paper (ream)'),50)],daysAgo(30),daysAgo(15)));
 await issue(await invoice('SAMPLE-INV-003',clients['Lotus Design Studio'],[line(I('Annual maintenance contract'),1)],daysAgo(25),daysAgo(10)));
 await issue(await invoice('SAMPLE-INV-004',clients['Greenleaf Cafe'],[line(I('LED signage panel 24"'),2),line(I('Installation service (per hour)'),3)],daysAgo(4),daysAgo(-11)));
 progress('Recording sample payments…');
 await pay(inv1,inv1.data.totals.total,daysAgo(35),'Bank transfer','NEFT-SAMPLE-1');
 await pay(inv2,5000,daysAgo(12),'UPI','UPI-SAMPLE-2');
 await invoice('SAMPLE-QUO-001',clients['Cedar & Co.'],[line(I('LED signage panel 24"'),40),line(I('Installation service (per hour)'),20)],daysAgo(2),daysAgo(-28),'quotation');

 progress('Adding sample bills and expenses…');
 const bill=async(vendor,number,date,due,itemsList,tax)=>{const id=key();const saved=await post('/api/vendor-bills',{action:'save',business,demo:true,bill:id,version:0,command:key(),data:{vendorId:vendor.id,number,date,dueDate:due,currency:b.currency||'INR',accountId:acct('5000'),items:itemsList,taxAmount:String(tax),taxReviewed:true,notes:''}});
  return(await post('/api/vendor-bills',{action:'issue',business,demo:true,bill:id,version:saved.bill.version,command:key()})).bill};
 if(acct('5000')&&acct('1000')){
  const b1=await bill(vendors['Acme Supplies'],'ACME-7781',daysAgo(40),daysAgo(10),[{name:'Signage panels (wholesale)',quantity:'20',rate:'2600'}],9360);
  await post('/api/vendor-bills',{action:'pay',business,demo:true,bill:b1.id,version:b1.version,command:key(),data:{amount:'20000',date:daysAgo(20),accountId:acct('1000'),method:'Bank transfer',reference:'NEFT-SAMPLE-ACME',notes:''}});
  await bill(vendors['Swift Logistics'],'SWL-2290',daysAgo(9),daysAgo(-6),[{name:'Delivery charges, October',quantity:'1',rate:'4800'}],864);
  const exp=await post('/api/records',{business,collection:'expenses',demo:true,data:{name:'Office rent',date:daysAgo(6),amount:35000,category:'Rent',vendor:'Prime Properties',reference:'RENT-SAMPLE',taxableAmount:35000,inputCgst:0,inputSgst:0,inputIgst:0,inputCess:0,reverseCharge:'No',itcStatus:'Ineligible',reconciled2B:'No'}});
  try{await post('/api/expenses',{action:'post',business,expense:exp.record.id,command:key(),demo:true,version:exp.record.version,data:{paidConfirmed:true,taxReviewed:true,taxTreatment:'expense-all',expenseAccount:acct('5000'),cashAccount:acct('1000'),taxAccount:null,currency:b.currency||'INR'}})}catch{/* the expense stays as a record if posting rules differ */}
 }
 // Advances need two extra accounts and a one-time cash setup; do it for the sample books so "record an advance" works straight away.
 try{
  progress('Setting up advances…');
  for(const[code,name,type]of[['2200','Customer advances','liability'],['1400','Vendor advances','asset']])
   if(!acct(code))try{await post('/api/ledger',{business,demo:true,action:'createAccount',code,name,type})}catch(e){if(!/already|exists|duplicate/i.test(e.message))throw e}
  const accounts=(await api('/api/ledger?'+new URLSearchParams({business,demo:'true',from:start,to:daysAgo(0)}))).accounts||[],id=code=>accounts.find(a=>a.code===code)?.id;
  await post('/api/cash',{business,demo:true,action:'setup',command:key(),data:{cutover:daysAgo(0),accounts:{cash:id('1000'),receivable:id('1100'),payable:id('2000'),customerAdvance:id('2200'),vendorAdvance:id('1400')}}});
 }catch{/* advances can still be set up from Advances & unapplied cash */}
 progress('Sample data is ready.');
}
