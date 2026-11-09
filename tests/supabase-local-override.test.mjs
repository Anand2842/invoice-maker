import test from 'node:test';
import assert from 'node:assert/strict';

const PROD='https://digewoxoqblxlfnekjmc.supabase.co';
// Each case loads the module fresh with different settings (the query string defeats the module cache).
const load=async env=>{const saved={u:process.env.INBILL_SUPABASE_URL,k:process.env.INBILL_SUPABASE_KEY};
 if(env.url===undefined)delete process.env.INBILL_SUPABASE_URL;else process.env.INBILL_SUPABASE_URL=env.url;
 if(env.key===undefined)delete process.env.INBILL_SUPABASE_KEY;else process.env.INBILL_SUPABASE_KEY=env.key;
 try{return await import('../lib/supabase.ts?case='+Math.random())}finally{for(const[k,v]of[['INBILL_SUPABASE_URL',saved.u],['INBILL_SUPABASE_KEY',saved.k]])if(v===undefined)delete process.env[k];else process.env[k]=v}};

test('with no settings the real project is used',async()=>{const m=await load({});assert.equal(m.SUPABASE_URL,PROD);assert.match(m.SUPABASE_KEY,/^sb_publishable_/)});

test('a localhost address redirects the app to a local Supabase',async()=>{
 for(const url of['http://127.0.0.1:54321','http://localhost:54321/']){const m=await load({url,key:'local-key'});assert.equal(m.SUPABASE_URL,url.replace(/\/$/,''));assert.equal(m.SUPABASE_KEY,'local-key')}
});

test('any other address is ignored, so no setting can send the real site elsewhere',async()=>{
 for(const url of['https://evil.example.com','http://192.168.1.20:54321','https://127.0.0.1.evil.com','http://localhost.evil.com','not a url','file:///etc/passwd']){
  const m=await load({url,key:'x'});assert.equal(m.SUPABASE_URL,PROD,url);assert.match(m.SUPABASE_KEY,/^sb_publishable_/,url)}
});
