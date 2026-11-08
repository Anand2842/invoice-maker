import test from 'node:test';
import assert from 'node:assert/strict';
import{caInvitesGET,caInvitesPOST}from'../lib/ca-invites-api.mjs';

const json=(body,status=200)=>({status,body});
const uuid=v=>/^[0-9a-f-]{36}$/.test(String(v));
const T='a'.repeat(64);
function run(body,{user={id:'u',access:'tok'},origin=true,reply={ok:true,data:true},seen=[]}={}){
 return caInvitesPOST({url:'https://app.test/api/ca-invites'},{identity:async()=>user,json,uuid,originAllowed:()=>origin,readObject:async()=>body,randomToken:()=>'f'.repeat(64),
  sb:async(path,access,opts)=>{seen.push({path,access,body:JSON.parse(opts.body)});return reply}});
}

test('signed-out, foreign-origin and malformed requests are refused before the database is touched',async()=>{
 const seen=[];
 assert.equal((await run({action:'create'},{user:null,seen})).status,401);
 assert.equal((await run({action:'create'},{origin:false,seen})).status,403);
 assert.equal((await run({action:'info',token:'short'},{seen})).status,400);
 assert.equal((await run({action:'redeem',token:T,business:'nope'},{seen})).status,400);
 assert.equal((await run({action:'revoke',invite:'nope'},{seen})).status,400);
 assert.equal((await run({action:'delete-everything'},{seen})).status,400);
 assert.equal(seen.length,0);
});

test('creating a link returns it with the secret in the # fragment only, and sends the database nothing but the secret',async()=>{
 const seen=[];const r=await run({action:'create'},{seen,reply:{ok:true,data:'11111111-1111-4111-8111-111111111111'}});
 assert.equal(r.status,201);
 const url=new URL(r.body.link);assert.equal(url.pathname,'/start/');assert.equal(url.search,'');assert.equal(url.hash,'#ca='+'f'.repeat(64));
 assert.match(r.body.message,/No email has been sent/);
 assert.deepEqual(seen[0].body,{raw_token:'f'.repeat(64)});assert.equal(seen[0].access,'tok');
});

test('redeem and revoke pass through the user\'s own token and database refusals become clear errors',async()=>{
 const seen=[];
 const ok=await run({action:'redeem',token:T,business:'11111111-1111-4111-8111-111111111111'},{seen,reply:{ok:true,data:{business:'b',role:'admin',alreadyMember:false}}});
 assert.equal(ok.status,200);assert.equal(ok.body.shared,true);assert.equal(seen[0].path,'/rest/v1/rpc/billing_ca_invite_redeem');
 const denied=await run({action:'redeem',token:T,business:'11111111-1111-4111-8111-111111111111'},{reply:{ok:false,data:{code:'42501',message:'Only the business owner can add their accountant'}}});
 assert.equal(denied.status,403);assert.match(denied.body.error,/Only the business owner/);
 const stale=await run({action:'redeem',token:T,business:'11111111-1111-4111-8111-111111111111'},{reply:{ok:false,data:{code:'22023',message:'This invitation link is not valid any more'}}});
 assert.equal(stale.status,400);
 const odd=await run({action:'create'},{reply:{ok:false,data:{code:'XX000',message:'internal secret detail'}}});
 assert.equal(odd.status,502);assert.ok(!/secret detail/.test(odd.body.error),'database text must not leak');
});

test('listing needs sign-in',async()=>{
 assert.equal((await caInvitesGET({url:'x'},{identity:async()=>null,json,sb:async()=>({})})).status,401);
 const r=await caInvitesGET({url:'x'},{identity:async()=>({id:'u',access:'t'}),json,sb:async()=>({ok:true,data:[{id:'1'}]})});
 assert.deepEqual(r.body,{invites:[{id:'1'}]});
});
