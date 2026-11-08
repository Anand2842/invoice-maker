import test from 'node:test';
import assert from 'node:assert/strict';
import{readFile,readdir}from'node:fs/promises';
import{join}from'node:path';

const page=p=>readFile(new URL('../public/'+p,import.meta.url),'utf8');

test('privacy and terms pages exist, are not indexed yet, and say plainly what is and is not done',async()=>{
 const privacy=await page('privacy/index.html'),terms=await page('terms/index.html');
 for(const html of[privacy,terms]){assert.match(html,/noindex/);assert.match(html,/Draft for legal review/);assert.match(html,/to be added/)}
 assert.match(privacy,/billing_access/);assert.match(privacy,/do not sell your data/i);assert.match(privacy,/locked state/);
 assert.match(terms,/does not file GST returns/);assert.match(terms,/practice only/i);
});

test('the privacy claim "no advertising or analytics trackers" stays true',async()=>{
 const bad=/googletagmanager|google-analytics|gtag\(|plausible\.io|posthog|mixpanel|hotjar|clarity\.ms|_vercel\/insights|connect\.facebook\.net/i;
 const scan=async dir=>{for(const e of await readdir(new URL('../public/'+dir,import.meta.url),{withFileTypes:true})){
  const rel=join(dir,e.name);
  if(e.isDirectory()){if(!['vendor','assets'].includes(e.name))await scan(rel);continue}
  if(/\.(html|js|mjs)$/.test(e.name))assert.ok(!bad.test(await page(rel)),'tracker found in public/'+rel)}};
 await scan('');
});

test('every public page links to Privacy and Terms in the footer',async()=>{
 for(const p of['home.html','index.html','roadmap/index.html','for-cas/index.html','privacy/index.html','terms/index.html']){
  const html=await page(p);assert.match(html,/href="\/privacy\/"/,p);assert.match(html,/href="\/terms\/"/,p)}
});
