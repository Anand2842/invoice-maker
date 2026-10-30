// Disposable in-memory PostgreSQL + real payment handlers for browser QA only.
// No production connection, credentials, provider sends, or real financial transactions.
import {createServer} from 'node:http';import{readFile}from'node:fs/promises';import path from'node:path';import{fileURLToPath}from'node:url';
import{paymentDatabase}from'../tests/helpers/payment-db.mjs';import{clientStatement}from'../lib/statements.mjs';import{paymentGET,paymentPOST}from'../lib/payment-api.mjs';
const f=await paymentDatabase(),root=fileURLToPath(new URL('../public/',import.meta.url));
const zone=process.argv.find(arg=>arg.startsWith('--time-zone='))?.slice('--time-zone='.length)||'Asia/Kolkata';
await f.db.query("update public.billing_businesses set name='Folio SQL QA — synthetic data',time_zone=$1 where id=$2",[zone,f.business]);
const business=(await f.db.query('select * from public.billing_businesses where id=$1',[f.business])).rows[0];
await f.invoice({number:'QA-INV-001',seller:{name:business.name},buyer:{name:'Northstar Demo Studio'},items:[{name:'Design work',quantity:1,rate:1000}]},true);
const second=await f.invoice({number:'QA-INV-002',seller:{name:business.name},buyer:{name:'Northstar Demo Studio'},items:[{name:'Development work',quantity:1,rate:2000}]},true);
await f.record(second,{amount:'750.00'});
let loseConfirmation=process.argv.includes('--lose-first-confirmation');
const sb=async(route,access,init={})=>{
 try{
  const u=new URL(route,'https://fixture.invalid');let result;
  if(u.pathname.startsWith('/rest/v1/rpc/')){
   const a=JSON.parse(init.body||'{}');
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
  if(url.pathname==='/api/payments'){
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536)throw Error('Request too large')}
   const request=new Request(url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:raw}:{})});
   const result=await(req.method==='POST'?paymentPOST:paymentGET)(request,dependencies);
   if(req.method==='POST'&&loseConfirmation&&result.status===201){loseConfirmation=false;return respond(res,Response.json({error:'Synthetic lost confirmation after committed payment'},{status:502}))}
   return respond(res,result);
  }
  if(req.method!=='GET')return respond(res,Response.json({error:'Fixture endpoint unavailable'},{status:405}));
  if(url.pathname==='/api/auth')return respond(res,Response.json({user:{id:f.owner,email:'qa@example.test'}}));
  if(url.pathname==='/api/workspace')return respond(res,Response.json({businesses:[business]}));
  if(url.pathname==='/api/records')return respond(res,Response.json({records:[],nextOffset:null}));
  if(url.pathname==='/api/reports/statement'){
   const demo=url.searchParams.get('demo')==='true';
   const rows=(await f.as(f.owner,db=>db.query('select * from public.billing_records where business_id=$1 and demo=$2',[business.id,demo]))).rows;
   return respond(res,Response.json({...clientStatement(rows,business,Object.fromEntries(url.searchParams)),demo}));
  }
  const pathname=url.pathname==='/receivables/'?'/receivables/index.html':url.pathname==='/reports/statements/'?'/reports/statements.html':url.pathname==='/settings/'?'/settings/index.html':url.pathname;
  const file=path.resolve(root,'.'+decodeURIComponent(pathname));if(!file.startsWith(root))throw Error('Not found');
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.woff2':'font/woff2','.json':'application/json'};
  const content=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(content);
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}))}
});
server.listen(5180,'127.0.0.1',()=>console.log('Disposable SQL QA: http://127.0.0.1:5180/receivables/?demo=true'));
process.on('SIGINT',()=>{server.close();f.close().finally(()=>process.exit(0))});
