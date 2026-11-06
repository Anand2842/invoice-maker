import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentDatabase} from './helpers/payment-db.mjs';
import {auditGET} from '../lib/audit-api.mjs';

const trail=(f,actor,args)=>f.as(actor,async db=>(await db.query('select public.billing_audit_trail($1,$2,$3,$4,$5,$6) r',[f.business,args.demo??false,args.area??null,args.at??null,args.key??null,args.size??50])).rows[0].r);

test('audit trail merges record, ledger and team history with role and data-mode isolation',async()=>{const f=await paymentDatabase();try{
 await f.as(f.owner,db=>db.query("insert into billing_records(business_id,collection,data,demo,created_by) values($1,'clients',$2,false,$3),($1,'clients',$4,true,$3)",[f.business,{name:'Real Co'},f.owner,{name:'Demo Co'}]));
 await f.invoice();
 await f.as(f.owner,db=>db.query("select public.billing_ledger_setup($1,false,'2026-10-01')",[f.business]));
 await f.as(f.owner,db=>db.query("select public.billing_team_invite($1,'new.person@example.test','viewer',$2)",[f.business,'a'.repeat(64)]));
 const owner=await trail(f,f.owner,{});
 assert.equal(owner.owner,true);
 assert.deepEqual([...new Set(owner.entries.map(e=>e.area))].sort(),['ledger','records','team']);
 assert.ok(owner.entries.some(e=>e.area==='records'&&e.details.label==='Real Co'&&e.action==='created'));
 assert.ok(!owner.entries.some(e=>e.details.label==='Demo Co'),'demo records stay out of the real trail');
 assert.ok(owner.entries.every((e,i,a)=>!i||a[i-1].at>=e.at),'newest first');
 const viewer=await trail(f,f.viewer,{});
 assert.equal(viewer.owner,false);assert.ok(!viewer.entries.some(e=>e.area==='team'),'team changes are owner-only');
 assert.ok(viewer.entries.length>0);
 const demo=await trail(f,f.owner,{demo:true,area:'records'});assert.deepEqual(demo.entries.map(e=>e.details.label),['Demo Co']);
 // Keyset pagination walks every entry exactly once.
 const seen=[];let cursor={};for(let i=0;i<20;i++){const p=await trail(f,f.owner,{size:2,...cursor});seen.push(...p.entries.map(e=>e.key));if(!p.next)break;cursor={at:p.next.at,key:p.next.key}}
 assert.deepEqual(seen,owner.entries.map(e=>e.key));
 await assert.rejects(trail(f,f.outsider,{}),/do not have access/);
 await assert.rejects(trail(f,f.owner,{area:'secrets'}),/valid audit area/);
 await assert.rejects(trail(f,f.owner,{at:new Date().toISOString()}),/Invalid audit cursor/);
}finally{await f.close()}});

test('audit API validates the query before calling the database',async()=>{
 const json=(d,s=200)=>Response.json(d,{status:s}),calls=[];const sb=async(path,access,init)=>{calls.push(JSON.parse(init.body));return{ok:true,status:200,data:{owner:true,entries:[],next:null}}};
 const get=(qs,user={id:'u',access:'tok'})=>auditGET(new Request('https://folio.test/api/audit?'+qs),{json,sb,identity:async()=>user});
 const b='11111111-1111-4111-8111-111111111111';
 assert.equal((await get('business='+b,null)).status,401);
 assert.equal((await get('business=nope')).status,400);
 assert.equal((await get(`business=${b}&area=secrets`)).status,400);
 assert.equal((await get(`business=${b}&at=2026-11-01T00:00:00Z`)).status,400,'cursor needs both parts');
 assert.equal((await get(`business=${b}&demo=true&area=ledger&at=2026-11-01T00:00:00Z&key=ledger:1`)).status,200);
 assert.deepEqual(calls,[{business:b,data_mode:true,area:'ledger',cursor_at:'2026-11-01T00:00:00Z',cursor_key:'ledger:1',page_size:50}]);
});
