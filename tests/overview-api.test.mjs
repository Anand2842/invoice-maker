import test from 'node:test';
import assert from 'node:assert/strict';
import{overviewGET,OVERVIEW_LIMIT,OVERVIEW_CONCURRENCY}from'../lib/overview-api.mjs';

const ME='11111111-1111-4111-8111-111111111111';
const json=(body,status=200)=>({status,body});
const biz=(n,patch={})=>({id:'b'+String(n).padStart(3,'0'),name:'Business '+String(n).padStart(3,'0'),currency:'INR',time_zone:'Asia/Kolkata',owner_id:'someone-else',...patch});
const summary=(patch={})=>({totalPending:1000,totalOverdue:250,overdueDocuments:[{},{}],totalRevenue:5000,draftCount:1,balanceIssues:[],...patch});
function harness({businesses=[biz(1)],members=[],loader=async()=>({ok:true,summary:summary()}),user={id:ME,access:'tok'}}={}){
 const calls={demo:[],inflight:0,maxInflight:0,access:new Set()};
 const sb=async(path,access)=>{calls.access.add(access);
  if(path.startsWith('/rest/v1/billing_businesses'))return{ok:true,data:businesses.slice(0,Number(new URLSearchParams(path.split('?')[1]).get('limit')))};
  if(path.startsWith('/rest/v1/billing_members'))return{ok:true,data:members};
  throw Error('unexpected '+path)};
 const loadDashboard=async(sbFn,access,b,demo)=>{calls.demo.push(demo);calls.inflight++;calls.maxInflight=Math.max(calls.maxInflight,calls.inflight);try{await new Promise(r=>setTimeout(r,2));return await loader(sbFn,access,b,demo)}finally{calls.inflight--}};
 const run=(url='http://x/api/overview')=>overviewGET({url},{identity:async()=>user,json,sb,loadDashboard});
 return{run,calls};
}

test('signed-out visitors are refused',async()=>{
 const h=harness({user:null});assert.equal((await h.run()).status,401);
});

test('each business gets its figures and the right role; the user\'s own token is the only one used',async()=>{
 const h=harness({businesses:[biz(1,{owner_id:ME}),biz(2),biz(3)],members:[{business_id:'b002',role:'admin'}]});
 const r=(await h.run()).body;
 assert.deepEqual(r.businesses.map(b=>b.role),['owner','admin','viewer']);
 assert.equal(r.businesses[0].stillToCollect,1000);assert.equal(r.businesses[0].overdueCount,2);assert.equal(r.businesses[0].issuedThisMonth,5000);
 assert.deepEqual([...h.calls.access],['tok']);
});

test('totals are kept separate per currency and failed businesses are left out of them',async()=>{
 const h=harness({businesses:[biz(1),biz(2,{currency:'USD'}),biz(3),biz(4)],loader:async(sb,a,b)=>b.id==='b004'?{ok:false,status:502,error:'x'}:{ok:true,summary:summary({totalPending:b.currency==='USD'?10.5:100.1,totalOverdue:b.id==='b001'?0:20.2,overdueDocuments:b.id==='b001'?[]:[{}]})}});
 const r=(await h.run()).body;
 const inr=r.totals.find(t=>t.currency==='INR'),usd=r.totals.find(t=>t.currency==='USD');
 assert.equal(inr.stillToCollect,200.2);assert.equal(inr.overdueAmount,20.2);assert.equal(inr.businessesWithOverdue,1);
 assert.equal(usd.stillToCollect,10.5);
 assert.match(r.businesses[3].error,/Could not load/);assert.equal(r.businesses[3].stillToCollect,undefined);
});

test('one business that throws does not break the others',async()=>{
 const h=harness({businesses:[biz(1),biz(2)],loader:async(sb,a,b)=>{if(b.id==='b001')throw Error('boom');return{ok:true,summary:summary()}}});
 const r=(await h.run()).body;assert.ok(r.businesses[0].error);assert.equal(r.businesses[1].stillToCollect,1000);
});

test('at most 50 businesses are shown, 5 are loaded at a time, and the page is told it was cut',async()=>{
 const h=harness({businesses:Array.from({length:OVERVIEW_LIMIT+3},(_,i)=>biz(i+1))});
 const r=(await h.run()).body;
 assert.equal(r.businesses.length,OVERVIEW_LIMIT);assert.equal(r.truncated,true);
 assert.ok(h.calls.maxInflight<=OVERVIEW_CONCURRENCY&&h.calls.maxInflight>1,'max in flight '+h.calls.maxInflight);
});

test('sample data is only read when asked for, and real records are the default',async()=>{
 let h=harness();await h.run();assert.deepEqual(h.calls.demo,[false]);
 h=harness();await h.run('http://x/api/overview?demo=true');assert.deepEqual(h.calls.demo,[true]);
});

test('a user with no businesses gets an empty list, not an error',async()=>{
 const r=(await harness({businesses:[]}).run()).body;assert.deepEqual(r.businesses,[]);assert.deepEqual(r.totals,[]);assert.equal(r.truncated,false);
});
