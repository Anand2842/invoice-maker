import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentDatabase} from './helpers/payment-db.mjs';

test('Only the owner can delete a business, only with its exact name, and then nobody can reach it',async()=>{
 const f=await paymentDatabase();
 try{
  const del=(actor,name)=>f.as(actor,db=>db.query('select public.billing_delete_business($1,$2) r',[f.business,name]));
  const visible=actor=>f.as(actor,async db=>(await db.query('select id from public.billing_businesses where id=$1',[f.business])).rows.length);
  const inv=await f.invoice();
  await f.db.query("insert into public.billing_automation_settings(business_id,reminders_enabled,recurring_enabled,updated_by) values($1,true,true,$2)",[f.business,f.owner]);

  await assert.rejects(del(f.viewer,'Synthetic payment test business'),/Business unavailable/);
  await assert.rejects(del(f.outsider,'Synthetic payment test business'),/Business unavailable/);
  await assert.rejects(del(f.owner,'Synthetic'),/Type the business name exactly/);
  await assert.rejects(del(f.owner,null),/Type the business name exactly/);
  assert.equal(await visible(f.owner),1);

  assert.equal((await del(f.owner,'  Synthetic payment test business ')).rows[0].r.deleted,true);
  // Gone for the owner and for team members, including its records.
  assert.equal(await visible(f.owner),0);
  assert.equal(await visible(f.viewer),0);
  assert.equal(await f.as(f.owner,async db=>(await db.query('select count(*)::int n from public.billing_records where id=$1',[inv.id])).rows[0].n),0);
  assert.equal(await f.as(f.owner,async db=>(await db.query('select public.billing_can_access($1,true) a',[f.business])).rows[0].a),false);
  await assert.rejects(f.invoice(),/row-level security|violates/);
  // Memberships removed, outside-facing automation switched off, and it cannot be deleted or edited again.
  assert.equal((await f.db.query('select count(*)::int n from public.billing_members where business_id=$1',[f.business])).rows[0].n,0);
  const s=(await f.db.query('select reminders_enabled,recurring_enabled from public.billing_automation_settings where business_id=$1',[f.business])).rows[0];
  assert.deepEqual(s,{reminders_enabled:false,recurring_enabled:false});
  await assert.rejects(del(f.owner,'Synthetic payment test business'),/Business unavailable/);
  assert.equal(await f.as(f.owner,async db=>(await db.query("update public.billing_businesses set name='Back' where id=$1 returning id",[f.business])).rows.length),0);
  // The deletion record itself is not readable or writable from the app.
  await assert.rejects(f.as(f.owner,db=>db.query('select * from public.billing_business_deletions')),/permission denied/);
 }finally{await f.close()}
});
