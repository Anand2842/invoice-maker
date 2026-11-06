import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentDatabase} from './helpers/payment-db.mjs';

test('direct receipts cannot settle more than the invoice outside the cash workspace; reversals restore capacity',async()=>{const f=await paymentDatabase();try{
 const invoice=await f.invoice(),version=async()=>(await f.db.query('select version from billing_records where id=$1',[invoice.id])).rows[0].version;
 const pay=async amount=>f.record({...invoice,version:await version()},{amount});
 const first=await pay('60.00');
 await assert.rejects(pay('40.01'),/exceeds the dated invoice obligation/);
 await pay('40.00');
 await assert.rejects(pay('0.01'),/exceeds the dated invoice obligation/);
 await f.reverse(first.record);
 await pay('60.00');
 const paid=(await f.db.query("select sum(amount)::text total from billing_payment_events where document_id=$1 and kind='receipt'",[invoice.id])).rows[0].total;
 assert.equal(paid,'160.00');
}finally{await f.close()}});
