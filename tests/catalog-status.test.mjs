import test from 'node:test';
import assert from 'node:assert/strict';
import{readFile}from'node:fs/promises';

const catalog=async()=>{const d=JSON.parse(await readFile(new URL('../public/service-catalog.json',import.meta.url),'utf8'));return Array.isArray(d)?d:d.list};

test('every catalog entry has one of the four status words (or is a category shortcut) and a plain description',async()=>{
 const allowed=new Set(['Available','Basic','Simulated','Coming soon','Category shortcut']);
 for(const x of await catalog()){
  assert.ok(allowed.has(x.launchStatus),x.id+' has status '+x.launchStatus);
  assert.ok(typeof x.launchDescription==='string'&&x.launchDescription.length>20,x.id+' needs a description');
 }
});

test('the catalog carries no links back to Refrens and no stale "not included" sentence',async()=>{
 const text=await readFile(new URL('../public/service-catalog.json',import.meta.url),'utf8');
 assert.ok(!/refrens/i.test(text),'a Refrens link or name is still in the catalog');
 assert.ok(!/Live payment collection and message delivery are not included/.test(text),'old blanket disclaimer is back');
});

test('practice-only and not-built items never read as real',async()=>{
 const byId=Object.fromEntries((await catalog()).map(x=>[x.id,x]));
 for(const id of['e-invoicing','e-way-bill']){assert.equal(byId[id].launchStatus,'Simulated');assert.match(byId[id].launchDescription,/practice values, not government registrations/);assert.equal(byId[id].href,'/compliance/')}
 for(const id of['mcp','eagle','api','android-app','ios-app','indiamart','ai-assistant'])assert.equal(byId[id].launchStatus,'Coming soon',id);
 assert.match(byId['gst-billing'].launchDescription,/does not file returns/);
});

test('the Roadmap and CA pages exist and use the same four status words',async()=>{
 const roadmap=await readFile(new URL('../public/roadmap/index.html',import.meta.url),'utf8');
 for(const w of['Available','Basic','Practice only','Coming soon'])assert.ok(roadmap.includes(w),w);
 const cas=await readFile(new URL('../public/for-cas/index.html',import.meta.url),'utf8');
 assert.match(cas,/does not file/);assert.match(cas,/practice only/i);
});
