import test from 'node:test';
import assert from 'node:assert/strict';
import{paymentDatabase}from'./helpers/payment-db.mjs';

const APP='claude-app',OTHER='other-app';
// Run as a user whose token carries an OAuth client_id (an AI connector app).
const asApp=(f,actor,client,fn)=>f.as(actor,async db=>{await db.query('select set_config($1,$2,true)',['request.jwt.claims',JSON.stringify({client_id:client})]);return fn(db)});
const rows=async(db,sql,args=[])=>(await db.query(sql,args)).rows;
const withUserColumns=async f=>{await f.db.exec('alter table auth.users add column if not exists email text, add column if not exists raw_user_meta_data jsonb')};
const grant=(f,actor,app=APP,draft=false)=>f.as(actor,db=>db.query('select public.billing_connector_grant_set($1,$2,$3) id',[f.business,app,draft]));

test('without a grant an app sees nothing; with a read grant it can read but never write',async()=>{
 const f=await paymentDatabase();await withUserColumns(f);
 try{
  const inv=await f.invoice();
  const readBusiness=(actor,client)=>(client?asApp(f,actor,client,db=>rows(db,'select id from public.billing_businesses where id=$1',[f.business])):f.as(actor,db=>rows(db,'select id from public.billing_businesses where id=$1',[f.business])));
  const readRecords=(actor,client)=>asApp(f,actor,client,db=>rows(db,'select id from public.billing_records where business_id=$1',[f.business]));

  assert.equal((await readBusiness(f.owner,APP)).length,0,'no grant, no business');
  assert.equal((await readRecords(f.owner,APP)).length,0,'no grant, no records');

  await grant(f,f.owner);
  assert.equal((await readBusiness(f.owner,APP)).length,1);
  assert.equal((await readRecords(f.owner,APP)).length,1);
  assert.equal((await readBusiness(f.owner,OTHER)).length,0,'a grant is for one app only');

  // Reads allowed, writes refused for everything that goes through the central check.
  assert.equal(await asApp(f,f.owner,APP,async db=>(await rows(db,'select public.billing_can_access($1,false) a',[f.business]))[0].a),true);
  assert.equal(await asApp(f,f.owner,APP,async db=>(await rows(db,'select public.billing_can_access($1,true) a',[f.business]))[0].a),false);
  await assert.rejects(asApp(f,f.owner,APP,db=>db.query("insert into public.billing_records(business_id,collection,data,demo,created_by) values($1,'clients','{\"name\":\"x\"}',false,$2)",[f.business,f.owner])),/row-level security|violates/);
  const before=(await f.db.query('select data from public.billing_records where id=$1',[inv.id])).rows[0].data;
  const changed=await asApp(f,f.owner,APP,db=>rows(db,"update public.billing_records set data=data||'{\"notes\":\"hacked\"}' where id=$1 returning id",[inv.id]));
  assert.equal(changed.length,0);assert.deepEqual((await f.db.query('select data from public.billing_records where id=$1',[inv.id])).rows[0].data,before);

  // The same user on the website is unaffected.
  assert.equal((await readBusiness(f.owner)).length,1);
  assert.equal(await f.as(f.owner,async db=>(await rows(db,'select public.billing_can_access($1,true) a',[f.business]))[0].a),true);
 }finally{await f.close()}
});

test('a draft grant does not widen what the central check allows, and owner-only commands stay refused',async()=>{
 const f=await paymentDatabase();await withUserColumns(f);
 try{
  await grant(f,f.owner,APP,true);
  assert.equal(await asApp(f,f.owner,APP,async db=>(await rows(db,'select public.billing_can_access($1,true) a',[f.business]))[0].a),false);
  assert.equal(await asApp(f,f.owner,APP,async db=>(await rows(db,'select public.billing_is_owner($1) a',[f.business]))[0].a),false);
  await assert.rejects(asApp(f,f.owner,APP,db=>db.query('select public.billing_team_list($1)',[f.business])),/Only the business owner/);
  await assert.rejects(asApp(f,f.owner,APP,db=>db.query("select public.billing_delete_business($1,'Synthetic payment test business')",[f.business])),/Business unavailable/);
  assert.equal((await f.db.query('select count(*)::int n from public.billing_business_deletions')).rows[0].n,0);
  // It cannot edit or create a business.
  assert.equal((await asApp(f,f.owner,APP,db=>rows(db,"update public.billing_businesses set name='Pwned' where id=$1 returning id",[f.business]))).length,0);
  await assert.rejects(asApp(f,f.owner,APP,db=>db.query("insert into public.billing_businesses(owner_id,name) values($1,'New')",[f.owner])),/row-level security|violates/);
  assert.equal((await f.db.query('select name from public.billing_businesses where id=$1',[f.business])).rows[0].name,'Synthetic payment test business');
 }finally{await f.close()}
});

test('revoking a grant, losing access yourself, or deleting the business cuts the app off at once',async()=>{
 const f=await paymentDatabase();await withUserColumns(f);
 try{
  const id=(await grant(f,f.viewer)).rows[0].id;
  const seesBusiness=()=>asApp(f,f.viewer,APP,async db=>(await rows(db,'select id from public.billing_businesses where id=$1',[f.business])).length);
  assert.equal(await seesBusiness(),1);
  assert.equal((await f.as(f.viewer,db=>rows(db,'select public.billing_connector_grant_revoke($1) r',[id])))[0].r,true);
  assert.equal(await seesBusiness(),0,'revoked');
  await grant(f,f.viewer);assert.equal(await seesBusiness(),1);
  await f.db.query('delete from public.billing_members where user_id=$1',[f.viewer]);
  assert.equal(await seesBusiness(),0,'the user no longer has access themselves');
  await grant(f,f.owner);
  await f.as(f.owner,db=>db.query("select public.billing_delete_business($1,'Synthetic payment test business')",[f.business]));
  assert.equal(await asApp(f,f.owner,APP,async db=>(await rows(db,'select id from public.billing_businesses where id=$1',[f.business])).length),0);
  assert.ok((await f.db.query("select 1 from public.billing_team_audit where action like 'connector_%'")).rows.length>=3);
 }finally{await f.close()}
});

test('only your own website session can manage grants: an app cannot grant itself, and strangers cannot grant access to your business',async()=>{
 const f=await paymentDatabase();await withUserColumns(f);
 try{
  await assert.rejects(asApp(f,f.owner,APP,db=>db.query('select public.billing_connector_grant_set($1,$2,true)',[f.business,APP])),/signed in on the website/);
  await assert.rejects(grant(f,f.outsider),/Business unavailable/);
  await grant(f,f.owner);
  await assert.rejects(asApp(f,f.owner,APP,db=>db.query('select public.billing_connector_grants_list()')),/signed in on the website/);
  const list=(await f.as(f.owner,db=>rows(db,'select public.billing_connector_grants_list() r')))[0].r;assert.equal(list.length,1);assert.equal(list[0].app,APP);
  const nobody=(await f.as(f.outsider,db=>rows(db,'select public.billing_connector_grants_list() r')))[0].r;assert.equal(nobody.length,0);
  await assert.rejects(f.as(f.owner,db=>db.query('select * from public.billing_connector_grants')),/permission denied/);
  // Setting the grant again replaces the old one instead of stacking.
  await grant(f,f.owner,APP,true);
  assert.equal((await f.db.query('select count(*)::int n from public.billing_connector_grants where revoked_at is null')).rows[0].n,1);
 }finally{await f.close()}
});

test('the CRM writer helper also refuses connector tokens',async()=>{
 const f=await paymentDatabase();await withUserColumns(f);
 try{
  // The helper is internal (not callable by signed-in users), so call it directly with the token claims set.
  const writer=async claims=>{await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);await f.db.query("select set_config('request.jwt.claims',$1,false)",[claims]);const r=(await f.db.query('select public.billing_crm_writer($1,$2) w',[f.business,f.owner])).rows[0].w;await f.db.query("select set_config('request.jwt.claims','',false)");return r};
  assert.equal(await writer(''),true);
  assert.equal(await writer(JSON.stringify({client_id:APP})),false);
 }finally{await f.close()}
});

test('an accounting reviewer with a read grant is still not a reviewer when acting through an app',async()=>{
 const f=await paymentDatabase();await withUserColumns(f);
 try{
  await f.db.query("insert into public.billing_accounting_reviewers(business_id,user_id,enabled,qualification_note,granted_by) values($1,$2,true,'test reviewer',$3)",[f.business,f.viewer,f.owner]);
  await grant(f,f.viewer);
  const can=async claims=>{await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.viewer]);await f.db.query("select set_config('request.jwt.claims',$1,false)",[claims]);const r=(await f.db.query('select public.billing_accounting_can_review($1) r',[f.business])).rows[0].r;await f.db.query("select set_config('request.jwt.claims','',false)");return r};
  assert.equal(await can(''),true,'on the website the reviewer can review');
  assert.equal(await can(JSON.stringify({client_id:APP})),false,'through an app they cannot');
 }finally{await f.close()}
});
