import{inventoryGET,inventoryPOST}from'../lib/inventory-api.mjs';
import{crmGET,crmPOST}from'../lib/crm-api.mjs';
import{ordersGET,ordersPOST}from'../lib/sales-orders-api.mjs';
import{reviewGET,reviewPOST}from'../lib/accounting-review-api.mjs';
import{cashStatementGET}from'../lib/settlement-statement-api.mjs';
import{mockRefundGET,mockRefundPOST}from'../lib/mock-refund-api.mjs';
import{creditGET,creditPOST}from'../lib/credit-refund-api.mjs';
import{cashGET,cashPOST}from'../lib/cash-api.mjs';import{cashReportRecords}from'../lib/cash-report-records.mjs';
import{expenseGET,expensePOST}from'../lib/expense-api.mjs';
import{lifecycleGET,lifecyclePOST}from'../lib/document-lifecycle-api.mjs';import{sourcesGET,sourcesPOST}from'../lib/source-accounting-api.mjs';
import{validateRecord}from'../lib/business.mjs';
// Disposable in-memory PostgreSQL + real payment handlers for browser QA only.
// No production connection, credentials, provider sends, or real financial transactions.
import {createServer} from 'node:http';import{readFile}from'node:fs/promises';import path from'node:path';import{fileURLToPath}from'node:url';
import{vendorStatementGET}from'../lib/vendor-statement-api.mjs';
import{bankGET,bankPOST}from'../lib/bank-api.mjs';import{vendorBillsGET,vendorBillsPOST}from'../lib/vendor-bills-api.mjs';import{ledgerLinesGET}from'../lib/ledger-lines-api.mjs';
import{ledgerGET,ledgerPOST}from'../lib/ledger-api.mjs';import{teamGET,teamPOST}from'../lib/team-api.mjs';import{statementPrintHTML}from'../lib/print-document.mjs';import{printResponse}from'../lib/print-response.mjs';
import{paymentDatabase}from'../tests/helpers/payment-db.mjs';import{clientStatement}from'../lib/statements.mjs';import{paymentGET,paymentPOST}from'../lib/payment-api.mjs';
const f=await paymentDatabase(),root=fileURLToPath(new URL('../public/',import.meta.url));
const zone=process.argv.find(arg=>arg.startsWith('--time-zone='))?.slice('--time-zone='.length)||'Asia/Kolkata';
await f.db.query("update public.billing_businesses set name='Folio SQL QA — synthetic data',time_zone=$1 where id=$2",[zone,f.business]);
await f.db.exec('alter table auth.users add column email text,add column email_confirmed_at timestamptz');
await f.db.query("update auth.users set email='qa@example.test',email_confirmed_at=now() where id=$1",[f.owner]);
const client=(await f.as(f.owner,db=>db.query("insert into public.billing_records(business_id,collection,data,demo,created_by) values($1,'clients',$2,true,$3) returning *",[f.business,{name:'Northstar Demo Studio',email:'client@example.test',phone:'9000000000',address:'Synthetic address'},f.owner]))).rows[0];
await f.as(f.owner,db=>db.query("insert into public.billing_records(business_id,collection,data,demo,created_by) values($1,'vendors',$2,true,$3)",[f.business,{name:'Synthetic supplier',email:'supplier@example.test'},f.owner]));
const business=(await f.db.query('select * from public.billing_businesses where id=$1',[f.business])).rows[0];
await f.invoice({number:'QA-INV-001',seller:{name:business.name},buyer:{name:'Northstar Demo Studio'},clientId:client.id,items:[{name:'Design work',quantity:1,rate:1000}]},true);
const second=await f.invoice({number:'QA-INV-002',seller:{name:business.name},buyer:{name:'Northstar Demo Studio'},clientId:client.id,items:[{name:'Development work',quantity:1,rate:2000}]},true);
await f.record(second,{amount:'750.00'});
if(process.argv.includes('--full-workspace')){
 await f.as(f.owner,db=>db.query("select public.billing_ledger_setup($1,true,'2026-10-01')",[f.business]));
 const accounts=(await f.db.query('select id,code from public.billing_ledger_accounts where business_id=$1 and demo',[f.business])).rows;const account=code=>accounts.find(a=>a.code===code).id;
 const j={kind:'opening',date:'2026-10-01',description:'Synthetic opening balance',entries:[{account_id:account('1000'),debit:'1000.00',credit:'0'},{account_id:account('3000'),debit:'0',credit:'1000.00'}]};
 await f.as(f.owner,db=>db.query('select public.billing_ledger_post($1,true,gen_random_uuid(),$2)',[f.business,j]));
}
let loseConfirmation=process.argv.includes('--lose-first-confirmation');
const sb=async(route,access,init={})=>{
 try{
  const u=new URL(route,'https://fixture.invalid');let result;
  if(u.pathname.startsWith('/rest/v1/rpc/')){
   const a=JSON.parse(init.body||'{}');
   const rpc=u.pathname.split('/').pop();if(/^billing_(inventory|crm|sales|ledger|team|bank|vendor_bill|vendor_bills|vendor_payment|vendor|document|auto_posting|source|expense|cash|credit_refund|refund|mock_refund|customer_credit|invoice_payment|accounting_review)_/.test(rpc)&&Object.keys(a).every(k=>/^[a-z_]+$/.test(k))){result=await f.as(f.owner,db=>db.query('select public.'+rpc+'('+Object.keys(a).map((k,i)=>k+' => $'+(i+1)).join(',')+') result',Object.values(a)));return{ok:true,status:200,data:result.rows[0].result}}
   if(u.pathname.endsWith('/billing_payment_readiness')){
    if(process.argv.includes('--commands-unavailable'))return{ok:false,status:404,data:{code:'PGRST202'}};
    result=await f.as(f.owner,db=>db.query('select public.billing_payment_readiness($1) result',[a.business]));
   }else if(u.pathname.endsWith('/billing_record_payment'))result=await f.as(f.owner,db=>db.query('select public.billing_record_payment($1,$2,$3,$4,$5,$6) result',[a.business,a.invoice_id,a.expected_version,a.command_id,a.payment_data,a.data_mode]));
   else if(u.pathname.endsWith('/billing_reverse_payment'))result=await f.as(f.owner,db=>db.query('select public.billing_reverse_payment($1,$2,$3,$4,$5) result',[a.business,a.payment_id,a.command_id,a.reversal_data,a.data_mode]));
   else return{ok:false,status:404,data:{code:'PGRST202'}};
   return{ok:true,status:200,data:result.rows[0].result};
  }
  if(u.pathname!=='/rest/v1/billing_records')throw Error('Unknown fixture route');
  const columns={business_id:'business_id',id:'id',collection:'collection',demo:'demo',archived:'archived','data->>documentId':"data->>'documentId'",'data->>reversalOf':"data->>'reversalOf'",'data->>kind':"data->>'kind'"},where=[],values=[];
  for(const [key,column]of Object.entries(columns))if(u.searchParams.has(key)){const value=u.searchParams.get(key);if(!value.startsWith('eq.'))throw Error('Unsupported fixture filter');values.push(value.slice(3));where.push(column+'=$'+values.length)}
  const limit=Math.min(501,Number(u.searchParams.get('limit')||501));
  result=await f.as(f.owner,db=>db.query('select * from public.billing_records where '+(where.join(' and ')||'true')+' order by created_at,id limit '+limit,values));
  return{ok:true,status:200,data:result.rows};
 }catch(error){return{ok:false,status:400,data:{code:error.code,message:error.message}}}
};
const dependencies={identity:async()=>({id:f.owner,access:'synthetic-session'}),json:(data,status=200)=>Response.json(data,{status}),sb,uuid:v=>typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v),originAllowed:req=>!req.headers.get('origin')||req.headers.get('origin')===new URL(req.url).origin,readObject:req=>req.json()};
const respond=async(res,response)=>{res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:5180');
  if(['/api/inventory','/api/crm','/api/orders','/api/payments','/api/ledger','/api/ledger/entries','/api/team','/api/banking','/api/vendor-bills','/api/reports/vendor-statement','/api/documents/lifecycle','/api/accounting/sources','/api/expenses','/api/cash','/api/credits','/api/mock-refunds','/api/reports/cash-statement','/api/accounting/review'].includes(url.pathname)){
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2097152)throw Error('Request too large')}
   const request=new Request(url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:raw}:{})});
   const handlers=url.pathname==='/api/inventory'?[inventoryGET,inventoryPOST]:url.pathname==='/api/crm'?[crmGET,crmPOST]:url.pathname==='/api/orders'?[ordersGET,ordersPOST]:url.pathname==='/api/accounting/review'?[reviewGET,reviewPOST]:url.pathname==='/api/reports/cash-statement'?[cashStatementGET,null]:url.pathname==='/api/mock-refunds'?[mockRefundGET,mockRefundPOST]:url.pathname==='/api/credits'?[creditGET,creditPOST]:url.pathname==='/api/cash'?[cashGET,cashPOST]:url.pathname==='/api/expenses'?[expenseGET,expensePOST]:url.pathname==='/api/documents/lifecycle'?[lifecycleGET,lifecyclePOST]:url.pathname==='/api/accounting/sources'?[sourcesGET,sourcesPOST]:url.pathname==='/api/reports/vendor-statement'?[vendorStatementGET,null]:url.pathname==='/api/ledger/entries'?[ledgerLinesGET,null]:url.pathname==='/api/banking'?[bankGET,bankPOST]:url.pathname==='/api/vendor-bills'?[vendorBillsGET,vendorBillsPOST]:url.pathname==='/api/ledger'?[ledgerGET,ledgerPOST]:url.pathname==='/api/team'?[teamGET,teamPOST]:[paymentGET,paymentPOST];const result=await handlers[req.method==='POST'?1:0](request,dependencies);
   if(req.method==='POST'&&loseConfirmation&&result.ok){loseConfirmation=false;return respond(res,Response.json({error:'Synthetic lost confirmation after committed command'},{status:502}))}
   return respond(res,result);
  }
  if(url.pathname==='/api/records'&&['POST','PATCH'].includes(req.method)){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());
   if(body.business!==f.business||body.collection!=='documents'||typeof body.demo!=='boolean')throw Error('Choose the disposable fixture document scope');const data=validateRecord('documents',body.data);
   const result=await f.as(f.owner,db=>req.method==='POST'?db.query("insert into billing_records(business_id,collection,data,demo,created_by) values($1,'documents',$2,$3,$4) returning *",[f.business,data,body.demo,f.owner]):db.query('update billing_records set data=$1 where id=$2 and business_id=$3 and version=$4 and demo=$5 returning *',[data,body.id,f.business,body.version,body.demo]));
   return respond(res,Response.json(result.rows[0]?{record:result.rows[0]}:{error:'Document changed'},{status:result.rows[0]?req.method==='POST'?201:200:409}));
  }
  if(req.method!=='GET')return respond(res,Response.json({error:'Fixture endpoint unavailable'},{status:405}));
  if(url.pathname==='/api/auth')return respond(res,Response.json({user:process.argv.includes('--guest')?null:{id:f.owner,email:'qa@example.test'}}));
  if(url.pathname==='/api/workspace')return respond(res,Response.json({businesses:[business],user:{id:f.owner,email:'qa@example.test'}}));
  if(url.pathname==='/api/records'){const rows=await f.as(f.owner,db=>db.query('select * from public.billing_records where business_id=$1 and collection=$2 and demo=$3 and ($4::uuid is null or id=$4) and archived=$5',[business.id,url.searchParams.get('collection'),url.searchParams.get('demo')==='true',url.searchParams.get('id')||null,url.searchParams.get('archived')==='true']));return respond(res,Response.json({records:rows.rows,nextOffset:null}))}
  if(url.pathname==='/api/reports/statement'){
   const demo=url.searchParams.get('demo')==='true';
   const rows=(await f.as(f.owner,db=>db.query('select * from public.billing_records where business_id=$1 and demo=$2',[business.id,demo]))).rows;
   rows.push(...await cashReportRecords(sb,'synthetic-session',business.id,demo));const report={...clientStatement(rows,business,Object.fromEntries(url.searchParams)),demo};if(url.searchParams.get('format')==='print')return respond(res,printResponse(statementPrintHTML(report)));return respond(res,Response.json(report));
  }
  const pathname=url.pathname==='/inventory/'?'/inventory/index.html':url.pathname==='/crm/'?'/crm/index.html':url.pathname==='/orders/'?'/orders/index.html':url.pathname==='/accounting/review/'?'/accounting/review/index.html':url.pathname==='/reports/cash-statement/'?'/reports/cash-statement.html':url.pathname==='/mock-refunds/'?'/mock-refunds/index.html':url.pathname==='/credits/'?'/credits/index.html':url.pathname==='/cash/'?'/cash/index.html':url.pathname==='/invoice-editor'||url.pathname==='/invoice-editor/'?'/invoice-editor-shell.html':url.pathname==='/expenses/'?'/expenses/index.html':url.pathname==='/banking/'?'/banking/index.html':url.pathname==='/payables/'?'/payables/index.html':url.pathname==='/accounting/source-postings/'?'/accounting/source-postings.html':url.pathname==='/accounting/general-ledger/'?'/accounting/general-ledger.html':url.pathname==='/accounting/'?'/accounting/index.html':url.pathname==='/team/'?'/team/index.html':url.pathname==='/clients/'?'/clients/index.html':url.pathname==='/receivables/'?'/receivables/index.html':url.pathname==='/reports/vendor-statement/'?'/reports/vendor-statement.html':url.pathname==='/reports/statements/'?'/reports/statements.html':url.pathname==='/settings/'?'/settings/index.html':url.pathname;
  const file=path.resolve(root,'.'+decodeURIComponent(pathname));if(!file.startsWith(root))throw Error('Not found');
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.woff2':'font/woff2','.json':'application/json'};
  const content=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(content);
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}))}
});
if(process.argv.includes('--self-check')){try{const{previewHTTPChecks}=await import('./preview-http-selfcheck.mjs');console.log(JSON.stringify(await previewHTTPChecks(server,{business:f.business,extra:['/api/inventory','/api/crm','/api/orders','/inventory/','/crm/','/orders/']}),null,2));}finally{await f.close();server.close();}}else server.listen(5180,'127.0.0.1',()=>console.log('Disposable SQL QA: http://127.0.0.1:5180/receivables/?demo=true'));
process.on('SIGINT',()=>{server.close();f.close().finally(()=>process.exit(0))});
