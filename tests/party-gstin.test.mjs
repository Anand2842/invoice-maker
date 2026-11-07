import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRecord} from '../lib/business.mjs';

test('Client and vendor GSTINs are checked and normalised; empty is allowed',()=>{
 for(const collection of ['clients','vendors']){
  assert.throws(()=>validateRecord(collection,{name:'Tester Traders',gstin:'27BAD'}),/15 characters/);
  assert.throws(()=>validateRecord(collection,{name:'Tester Traders',gstin:'00ABCDE1234F1Z5'}),/15 characters/);
  assert.equal(validateRecord(collection,{name:'Tester Traders',gstin:' 27abcde1234f1z5 '}).gstin,'27ABCDE1234F1Z5');
  assert.equal(validateRecord(collection,{name:'Tester Traders',gstin:''}).gstin,'');
  assert.equal(validateRecord(collection,{name:'Tester Traders'}).gstin,undefined);
 }
});
