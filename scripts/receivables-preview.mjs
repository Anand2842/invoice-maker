// Local-only visual QA server. Synthetic data; no database, credentials or writes.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {clientStatement} from '../lib/statements.mjs';

const publicRoot=fileURLToPath(new URL('../public/',import.meta.url));
const business={id:'00000000-0000-4000-8000-000000000002',name:'Folio QA — synthetic records',currency:'INR'};
const client={id:'00000000-0000-4000-8000-000000000003',collection:'clients',data:{name:'Northstar Demo Studio'}};
const invoice=(n,amount,patch={})=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,collection:'documents',demo:true,data:{type:'invoice',number:'QA-INV-'+String(n).padStart(3,'0'),date:'2026-10-01',dueDate:'2026-10-20',currency:'INR',status:'sent',taxType:'NONE',clientId:client.id,seller:{name:business.name},buyer:{name:client.data.name},items:[{name:'Synthetic design service',quantity:1,rate:amount}],...patch}});
const records=[client,invoice(10,1000),invoice(11,2000,{dueDate:'2026-10-25'}),invoice(12,1500),invoice(13,500),invoice(14,800,{status:'paid',dueDate:'2026-10-30'}),invoice(15,5000,{date:'2026-11-01',dueDate:'2026-11-15'}),invoice(16,70,{currency:'USD'}),invoice(17,300,{status:'draft'}),invoice(18,400,{status:'cancelled'})];
for(const [n,amount]of [[11,750],[12,1500],[13,650],[15,100]])records.push({id:'qa-payment-'+n,collection:'payments',data:{documentId:invoice(n,0).id,date:'2026-10-10',amount,currency:'INR',direction:'incoming',method:'Bank transfer'}});
const send=(res,status,body,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(type==='application/json'?JSON.stringify(body):body)};
createServer(async(req,res)=>{
 try{
  if(req.method!=='GET')return send(res,405,{error:'Fixture server is read-only'});
  const url=new URL(req.url,'http://127.0.0.1:5180');
  if(url.pathname==='/api/auth')return send(res,200,{user:{id:'qa-user',email:'qa@example.test'}});
  if(url.pathname==='/api/workspace')return send(res,200,{businesses:[business]});
  if(url.pathname==='/api/records')return send(res,200,{records:[client],nextOffset:null});
  if(url.pathname==='/api/reports/statement'){
   if(url.searchParams.get('business')!==business.id)return send(res,404,{error:'Business not found'});
   const demo=url.searchParams.get('demo')==='true';
   return send(res,200,{...clientStatement(demo?records:[],business,Object.fromEntries(url.searchParams)),demo});
  }
  const pathname=url.pathname==='/receivables/'?'/receivables/index.html':url.pathname==='/reports/statements/'?'/reports/statements.html':url.pathname;
  const file=path.resolve(publicRoot,'.'+decodeURIComponent(pathname));
  if(!file.startsWith(publicRoot))return send(res,404,{error:'Not found'});
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.woff2':'font/woff2','.json':'application/json'};
  send(res,200,await readFile(file),types[path.extname(file)]||'application/octet-stream');
 }catch(error){send(res,error.code==='ENOENT'?404:400,{error:error.message})}
}).listen(5180,'127.0.0.1',()=>console.log('Synthetic QA only: http://127.0.0.1:5180/receivables/?demo=true&date=2026-10-29'));
