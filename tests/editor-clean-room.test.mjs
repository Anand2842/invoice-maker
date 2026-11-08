import test from 'node:test';
import assert from 'node:assert/strict';
import{readdir,readFile,stat}from'node:fs/promises';
import{join}from'node:path';

// The editor is written from scratch. Nothing captured from another company's site may be in the repository.
const FORBIDDEN=/refrens|disco-|react-datepicker|toastui|css-[0-9a-z]{6}-|LineItems_|BusinessDetails_/i;
const ROOT=new URL('../',import.meta.url);
const walk=async(dir,skip=[])=>{const out=[];for(const e of await readdir(new URL(dir+'/',ROOT),{withFileTypes:true})){const rel=join(dir,e.name);if(skip.includes(e.name))continue;if(e.isDirectory())out.push(...await walk(rel,skip));else out.push(rel)}return out};
const exists=async p=>stat(new URL(p,ROOT)).then(()=>true,()=>false);

test('the captured editor and its mirroring tools are gone',async()=>{
 for(const p of['public/free-online-invoice-generator','public/invoice-editor-shell.html','public/invoice-editor','public/hsn-picker.js','scripts/mirror-source.mjs','scripts/capture-home.mjs','scripts/pack-invoice-extras.mjs','app/editor-next'])
  assert.equal(await exists(p),false,p+' must not exist');
 const files=await walk('public',['vendor']);
 const bad=files.filter(f=>/-source\.css$|^public[\\/]+form(-head)?(-mobile)?\.html$/.test(f)||/^public[\\/]assets[\\/]ref/.test(f));
 assert.deepEqual(bad,[]);
});

test('no file in public, app, lib, components or scripts carries the captured editor\'s names, classes or libraries',async()=>{
 const checked=[];
 for(const dir of['public','app','lib','components','scripts']){
  for(const f of await walk(dir,['vendor','node_modules'])){
   if(!/\.(js|mjs|ts|tsx|css|html|json|sh|py)$/.test(f)||f==='lib/pdf-font-data.mjs'||/^tests/.test(f))continue;
   checked.push(f);const hit=(await readFile(new URL(f,ROOT),'utf8')).match(FORBIDDEN);
   assert.equal(hit,null,f+' contains '+(hit&&hit[0]));
  }}
 assert.ok(checked.length>200,'scanned '+checked.length+' files');
});

test('both live editor pages serve the new editor',async()=>{
 for(const r of['app/free-online-invoice-generator/route.ts','app/invoice-editor/route.ts'])assert.match(await readFile(new URL(r,ROOT),'utf8'),/public\/editor\/index\.html\?raw/,r);
 assert.match(await readFile(new URL('public/editor/index.html',ROOT),'utf8'),/\/editor\/editor\.js/);
});

test('generated PDFs do not carry another company\'s name in their metadata',async()=>{
 const m=await import('../public/document-export.js');
 const r=m.build({type:'invoice',currency:'INR',date:'2026-11-09',taxType:'NONE',seller:{name:'S'},buyer:{name:'B'},items:[{name:'X',quantity:1,rate:1}]});
 const text=Buffer.from(r.bytes).toString('latin1');
 assert.ok(!/refrens/i.test(text));assert.match(text,/inbill document export/);
});
