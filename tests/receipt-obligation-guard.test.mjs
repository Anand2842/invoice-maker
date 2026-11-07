import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentDatabase} from './helpers/payment-db.mjs';

test('direct receipts cannot settle more than the invoice outside the cash workspace; reversals restore capacity',async()=>{const f=await paymentDatabase();try{
 const invoice=await f.invoice(),version=async()=>(await f.db.query('select version from billing_records where id=$1',[invoice.id])).rows[0].version;
 const pay=async(amount,date='2026-10-10')=>f.record({...invoice,version:await version()},{amount,date});
 const first=await pay('60.00');
 await assert.rejects(pay('40.01'),/exceeds the dated invoice obligation/);
 await pay('40.00');
 await assert.rejects(pay('0.01'),/exceeds the dated invoice obligation/);
 await f.reverse(first.record);
 await assert.rejects(pay('60.00'),/exceeds the dated invoice obligation/,'backdating before the reversal would overpay 10-28 October');
 await pay('60.00','2026-10-29');
 const paid=(await f.db.query("select sum(amount)::text total from billing_payment_events where document_id=$1 and kind='receipt'",[invoice.id])).rows[0].total;
 assert.equal(paid,'160.00');
}finally{await f.close()}});

test('a later reversal does not license an earlier-dated overpayment of a legacy invoice',async()=>{const f=await paymentDatabase();try{
 const invoice=await f.invoice(),version=async()=>(await f.db.query('select version from billing_records where id=$1',[invoice.id])).rows[0].version;
 const first=await f.record({...invoice,version:await version()},{amount:'100.00',date:'2026-10-10'});
 await f.reverse(first.record,{date:'2026-10-20'});
 await assert.rejects(f.record({...invoice,version:await version()},{amount:'100.00',date:'2026-10-11'}),/exceeds the dated invoice obligation/,'settled twice between 11 and 19 October');
 await f.record({...invoice,version:await version()},{amount:'100.00',date:'2026-10-20'});
}finally{await f.close()}});
