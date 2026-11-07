import test from 'node:test';
import assert from 'node:assert/strict';
import {plainError,plainErrorBody} from '../lib/plain-errors.mjs';

test('Setup errors are reworded into what to do next',()=>{
 for(const m of['Configure the ledger first','Configure the ledger before posting paid expenses','Configure the ledger first; legacy expenses remain separate'])assert.match(plainError(m),/^Set up your books first/);
 assert.match(plainError('Configure reviewed cash and advance controls before generating this statement'),/^Set up advances first/);
 assert.match(plainError('Configure demo cash/advance controls first'),/^Set up advances first/);
 assert.match(plainError('Configure automatic invoice and receipt posting before recording TDS'),/automatic postings/);
 assert.equal(plainError('Select a business'),'Select a business');
 assert.deepEqual(plainErrorBody({error:'Configure the ledger first',code:'x'}).code,'x');
 assert.deepEqual(plainErrorBody([1]),[1]);
});
