import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
// Exercise the actual generated adapter without building or calling the database.
const build=readFileSync(new URL('../scripts/build-vercel.mjs',import.meta.url),'utf8');
const template=build.slice(build.indexOf('const entryJs = ')+16,build.indexOf('\nwriteFileSync(resolve(apiFuncDir, "entry.js")'));
const entry=vm.runInNewContext(template);
async function invoke(path,chunks){
 let calls=0,body;const context={URL,Headers,Request,Buffer,server:{async fetch(req){calls++;body=await req.text();return Response.json({ok:true})}}};
 vm.runInNewContext(entry.replace('import server from "./index.js";','').replace('export default async function handler','globalThis.handler = async function handler'),context);
 const req={method:'POST',url:path,headers:{host:'inbill.live'},async *[Symbol.asyncIterator](){for(const chunk of chunks)yield Buffer.from(chunk)}};
 const headers={},res={setHeader(k,v){headers[k]=v},end(value){this.body=String(value)}};
 await context.handler(req,res);return {calls,body,status:res.statusCode,response:res.body,headers};
}
test('Vercel adapter bounds MCP input while reading chunks, before the SDK or body concatenation',async()=>{
 for(const path of ['/mcp','/mcp/','/mcp?test=1']){
  const r=await invoke(path,['x'.repeat(100*1024),'x']);assert.equal(r.status,413);assert.equal(r.calls,0);assert.equal(r.headers['Cache-Control'],'no-store');
 }
 const valid=await invoke('/mcp',['x'.repeat(100*1024)]);assert.equal(valid.status,200);assert.equal(valid.calls,1);assert.equal(valid.body.length,100*1024);
 const other=await invoke('/api/records',['x'.repeat(100*1024+1)]);assert.equal(other.status,200);
});
