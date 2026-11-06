import test from 'node:test';
import assert from 'node:assert/strict';
import {build as bundle} from 'esbuild';
import {loadFonts} from '../lib/pdf-font-data.mjs';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('bundled server fonts match the licensed public assets', async()=>{
 const fonts=loadFonts();
 for(const [name,file] of [['regular','Regular'],['bold','Bold']])
  assert.deepEqual(fonts[name],new Uint8Array(await readFile(new URL(`../public/fonts/NotoSans-${file}.ttf`,import.meta.url))));
});

test('server saved-document rendering embeds Unicode without fetching fonts',async()=>{
 // Bundle the TypeScript entry as the deployment does, then run that bundle in Node.
 const result=await bundle({entryPoints:['lib/document-render.ts'],bundle:true,platform:'node',format:'esm',write:false});
 const dir=await mkdtemp(join(tmpdir(),'folio-pdf-server-'));
 const file=join(dir,'server.mjs');await writeFile(file,result.outputFiles[0].contents);
 const previous=globalThis.fetch, requests=[];
 globalThis.fetch=async input=>{
  const url=new URL(String(input));requests.push(url.pathname);
  if(url.pathname==='/rest/v1/billing_records')return Response.json([{id:'doc',data:{type:'invoice',number:'INV-1',date:'2026-10-20',currency:'INR',seller:{name:'Москва'},buyer:{name:'Łódź'},items:[{name:'Design',quantity:1,rate:10,taxRate:0}],taxType:'NONE'}}]);
  if(url.pathname==='/rest/v1/billing_businesses')return Response.json([{id:'business'}]);
  throw Error('Unexpected network request: '+url.pathname);
 };
 try{
  const {renderSavedDocument}=await import(pathToFileURL(file).href);
  const rendered=await renderSavedDocument('access','business','doc');
  assert.deepEqual(requests,['/rest/v1/billing_records','/rest/v1/billing_businesses']);
  assert.match(new TextDecoder('latin1').decode(rendered.pdf.bytes),/\/Subtype\s*\/Type0/);
  assert.equal(rendered.pdf.totals.total,10);
 }finally{globalThis.fetch=previous;await rm(dir,{recursive:true,force:true})}
});
