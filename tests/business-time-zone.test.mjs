import test from 'node:test';
import assert from 'node:assert/strict';
import {businessDate,businessTimeZone,validTimeZone,timeZoneOptions,DEFAULT_TIME_ZONE} from '../public/business-date.js';
import {validateProfile} from '../lib/profile.mjs';
import {workflowDocument} from '../lib/workflows.mjs';
import {paymentDatabase} from './helpers/payment-db.mjs';

test('business calendar uses the selected zone across midnight and daylight saving changes',()=>{
 const instant=new Date('2026-01-01T01:30:00Z');
 assert.equal(businessDate(instant,'Asia/Kolkata'),'2026-01-01');
 assert.equal(businessDate(instant,'America/Los_Angeles'),'2025-12-31');
 assert.equal(businessDate(instant,'UTC'),'2026-01-01');
 assert.equal(businessDate(new Date('2026-03-08T04:30:00Z'),'America/New_York'),'2026-03-07');
 assert.equal(businessDate(new Date('2026-03-09T04:30:00Z'),'America/New_York'),'2026-03-09');
 assert.equal(businessTimeZone(undefined),DEFAULT_TIME_ZONE);
 assert.equal(businessTimeZone('Mars/Olympus'),DEFAULT_TIME_ZONE);
});
test('time zone input rejects offsets and non-zones, preserving selected IANA aliases',()=>{
 for(const invalid of ['',null,34,'Mars/Olympus','+05:30','INR']){
  assert.equal(validTimeZone(invalid),false);
  assert.throws(()=>validateProfile({time_zone:invalid},'business'),/time zone|must be text/);
 }
 assert.deepEqual(validateProfile({time_zone:' America/New_York '},'business'),{time_zone:'America/New_York'});
 assert.ok(timeZoneOptions('Asia/Kolkata').includes('Asia/Kolkata'));
 assert.ok(timeZoneOptions().includes('UTC'));
});
test('workflow dates use business time zone without re-dating recurring invoice schedules',()=>{
 const lead={id:'12345678-1234-4234-8234-123456789012',collection:'leads',data:{name:'Client',amount:100}};
 const business={name:'Seller',currency:'USD',time_zone:'America/Los_Angeles'};
 const now=new Date('2026-01-01T01:30:00Z');
 assert.equal(workflowDocument(lead,business,'lead-quotation',now).document.date,'2025-12-31');
 const subscription={...lead,collection:'subscriptions',data:{name:'Client',amount:100,status:'Active',nextDate:'2026-02-10',frequency:'Monthly'}};
 assert.equal(workflowDocument(subscription,business,'subscription-invoice',now).document.date,'2026-02-10');
});
test('database validates business time zone, preserves dated records and retains owner boundary',async t=>{
 const f=await paymentDatabase();t.after(()=>f.close());const {db,owner,viewer,business,as}=f;
 const invoice=await f.invoice();
 const before=(await db.query('select * from public.billing_businesses where id=$1',[business])).rows[0];
 assert.equal(before.time_zone,'Asia/Kolkata');
 const changed=await as(owner,db=>db.query("update public.billing_businesses set time_zone='America/Los_Angeles' where id=$1 returning *",[business]));
 assert.equal(changed.rows[0].profile_version,before.profile_version+1);
 assert.equal(changed.rows[0].time_zone,'America/Los_Angeles');
 await assert.rejects(()=>as(owner,db=>db.query("update public.billing_businesses set time_zone='Mars/Olympus' where id=$1",[business])),/IANA business time zone/);
 const denied=await as(viewer,db=>db.query("update public.billing_businesses set time_zone='UTC' where id=$1 returning id",[business]));assert.equal(denied.rows.length,0);
 assert.equal((await db.query('select data from public.billing_records where id=$1',[invoice.id])).rows[0].data.date,invoice.data.date);
});
