import test from 'node:test';
import assert from 'node:assert/strict';
import{randomBytes}from'node:crypto';
import{paymentDatabase}from'./helpers/payment-db.mjs';

const token=()=>randomBytes(32).toString('hex');
// Real Supabase users have these columns; the shared test helper keeps only the id.
const withUserColumns=async f=>{await f.db.exec('alter table auth.users add column if not exists email text, add column if not exists raw_user_meta_data jsonb');await f.db.query("update auth.users set email=id::text||'@example.test'")};
const asConnector=(f,actor,fn)=>f.as(actor,async db=>{await db.query(`select set_config('request.jwt.claims','{"client_id":"some-ai-app"}',true)`);return fn(db)});

// In these tests the accountant is "outsider" and the client is the business "owner".
test('an accountant invites a client; the client agrees; the accountant becomes admin and can edit but not manage the team',async()=>{
 const f=await paymentDatabase();await withUserColumns(f);
 try{
  const raw=token();
  const create=(actor,t=raw)=>f.as(actor,db=>db.query('select public.billing_ca_invite_create($1) id',[t]));
  const info=(actor,t=raw)=>f.as(actor,async db=>(await db.query('select public.billing_ca_invite_info($1) r',[t])).rows[0].r);
  const redeem=(actor,t=raw,b=f.business)=>f.as(actor,db=>db.query('select public.billing_ca_invite_redeem($1,$2) r',[t,b]));

  await create(f.outsider);
  // The raw secret is never stored.
  assert.equal((await f.db.query('select count(*)::int n from public.billing_ca_invites where token_hash=$1',[raw])).rows[0].n,0);
  const i=await info(f.owner);assert.equal(i.valid,true);assert.equal(i.selfInvite,false);assert.match(i.accountant,/@example\.test$/);
  await f.db.query("update auth.users set raw_user_meta_data='{\"name\":\"A. Kapoor\"}' where id=$1",[f.outsider]);
  assert.equal((await info(f.owner)).accountant,'A. Kapoor');
  assert.equal((await info(f.owner,token())).valid,false,'a wrong secret reveals nothing');

  // Only the business owner can add their accountant; the accountant cannot redeem their own link.
  await assert.rejects(redeem(f.viewer),/Only the business owner/);
  await assert.rejects(redeem(f.outsider),/Only the business owner|own client link/);
  const done=(await redeem(f.owner)).rows[0].r;
  assert.equal(done.role,'admin');assert.equal(done.alreadyMember,false);

  // The accountant now reaches the business and can write records, but cannot manage the team.
  const canWrite=await f.as(f.outsider,async db=>(await db.query('select public.billing_can_access($1,true) a',[f.business])).rows[0].a);
  assert.equal(canWrite,true);
  await assert.rejects(f.as(f.outsider,db=>db.query('select public.billing_team_list($1)',[f.business])),/Only the business owner/);
  assert.equal((await f.db.query("select action from public.billing_team_audit where business_id=$1 and action='accountant_added'",[f.business])).rows.length,1);

  // A link works once.
  await assert.rejects(redeem(f.owner),/not valid any more/);
 }finally{await f.close()}
});

test('expired, revoked and unknown links are refused; clients cannot be added to someone else\'s business',async()=>{
 const f=await paymentDatabase();await withUserColumns(f);
 try{
  const make=async()=>{const raw=token();await f.as(f.outsider,db=>db.query('select public.billing_ca_invite_create($1)',[raw]));return raw};
  const redeem=(actor,t,b=f.business)=>f.as(actor,db=>db.query('select public.billing_ca_invite_redeem($1,$2)',[t,b]));

  const expired=await make();await f.db.query("update public.billing_ca_invites set expires_at=now()-interval '1 minute'");
  await assert.rejects(redeem(f.owner,expired),/not valid any more/);

  const revoked=await make();
  const id=(await f.db.query('select id from public.billing_ca_invites where used_at is null and revoked_at is null and expires_at>now() limit 1')).rows[0].id;
  assert.equal(await f.as(f.viewer,async db=>(await db.query('select public.billing_ca_invite_revoke($1) r',[id])).rows[0].r),false,'only the accountant who made it can revoke it');
  assert.equal(await f.as(f.outsider,async db=>(await db.query('select public.billing_ca_invite_revoke($1) r',[id])).rows[0].r),true);
  await assert.rejects(redeem(f.owner,revoked),/not valid any more/);

  await assert.rejects(redeem(f.owner,token()),/not valid any more/);
  const live=await make();
  // The viewer (not the owner) of the business cannot use a link to hand the accountant access.
  await assert.rejects(redeem(f.viewer,live),/Only the business owner/);
  // A different person's business: the outsider's own invite cannot be redeemed by someone who does not own the target.
  await assert.rejects(redeem(f.outsider,live),/Only the business owner|own client link/);
 }finally{await f.close()}
});

test('AI connector tokens can neither create, read, redeem nor list client links',async()=>{
 const f=await paymentDatabase();await withUserColumns(f);
 try{
  const raw=token();
  await assert.rejects(asConnector(f,f.outsider,db=>db.query('select public.billing_ca_invite_create($1)',[raw])),/own account/);
  await f.as(f.outsider,db=>db.query('select public.billing_ca_invite_create($1)',[raw]));
  await assert.rejects(asConnector(f,f.owner,db=>db.query('select public.billing_ca_invite_info($1)',[raw])),/own account/);
  await assert.rejects(asConnector(f,f.owner,db=>db.query('select public.billing_ca_invite_redeem($1,$2)',[raw,f.business])),/own account/);
  await assert.rejects(asConnector(f,f.outsider,db=>db.query('select public.billing_ca_invite_list()')),/own account/);
 }finally{await f.close()}
});

test('the accountant lists only their own links, capped at 20 open ones; the table itself is not readable',async()=>{
 const f=await paymentDatabase();await withUserColumns(f);
 try{
  for(let n=0;n<20;n++)await f.as(f.outsider,db=>db.query('select public.billing_ca_invite_create($1)',[token()]));
  await assert.rejects(f.as(f.outsider,db=>db.query('select public.billing_ca_invite_create($1)',[token()])),/20 open client links/);
  const mine=await f.as(f.outsider,async db=>(await db.query('select public.billing_ca_invite_list() r')).rows[0].r);
  assert.equal(mine.length,20);
  const others=await f.as(f.owner,async db=>(await db.query('select public.billing_ca_invite_list() r')).rows[0].r);
  assert.equal(others.length,0);
  await assert.rejects(f.as(f.outsider,db=>db.query('select * from public.billing_ca_invites')),/permission denied/);
  await assert.rejects(f.as(f.outsider,db=>db.query('select public.billing_ca_invite_create($1)',['short'])),/20 open|Invalid invitation/);
 }finally{await f.close()}
});

test('an accountant who is already a member keeps their role; the link is still used up',async()=>{
 const f=await paymentDatabase();await withUserColumns(f);
 try{
  const raw=token();
  await f.as(f.viewer,db=>db.query('select public.billing_ca_invite_create($1)',[raw]));
  const r=(await f.as(f.owner,db=>db.query('select public.billing_ca_invite_redeem($1,$2) r',[raw,f.business]))).rows[0].r;
  assert.equal(r.alreadyMember,true);assert.equal(r.role,'viewer');
  assert.equal((await f.db.query("select role from public.billing_members where business_id=$1 and user_id=$2",[f.business,f.viewer])).rows[0].role,'viewer');
 }finally{await f.close()}
});
