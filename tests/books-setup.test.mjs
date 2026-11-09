import test from 'node:test';
import assert from 'node:assert/strict';
import{startBooks,booksOn,fiscalYearStart}from'../public/books-setup.js';

test('the books start on 1 April of the current Indian financial year',()=>{
 assert.equal(fiscalYearStart('2026-11-09'),'2026-04-01');assert.equal(fiscalYearStart('2026-04-01'),'2026-04-01');
 assert.equal(fiscalYearStart('2027-03-31'),'2026-04-01');assert.equal(fiscalYearStart('2027-01-15'),'2026-04-01');
});

const ACCOUNTS=[['1000','cash'],['1100','receivable'],['2100','tax'],['4000','income'],['4900','rounding']].map(([code,id])=>({code,id}));
const fakeApi=({fail={},accounts=ACCOUNTS}={})=>{const calls=[];const api=async(path,opts={})=>{const body=opts.body?JSON.parse(opts.body):null;calls.push({path:path.split('?')[0],body});
 for(const[k,msg]of Object.entries(fail))if(opts.method==='POST'&&path.startsWith(k))throw Error(msg);
 if(path.startsWith('/api/ledger?'))return{accounts};return{ok:true}};api.calls=calls;return api};

test('it sets up the ledger, maps the five standard accounts, and posts from the start date',async()=>{
 const api=fakeApi();await startBooks(api,{business:'b1',start:'2026-04-01',today:'2026-11-09'});
 assert.deepEqual(api.calls.map(c=>c.path),['/api/ledger','/api/ledger','/api/accounting/sources']);
 assert.deepEqual(api.calls[0].body,{action:'setup',business:'b1',demo:false,date:'2026-04-01'});
 const src=api.calls[2].body;assert.deepEqual(src.accounts,{receivable:'receivable',income:'income',tax:'tax',cash:'cash',rounding:'rounding'});assert.equal(src.date,'2026-04-01');assert.equal(src.demo,false);assert.equal(src.reviewed,true);
});

test('running it twice is fine, but real failures and missing accounts are reported',async()=>{
 await startBooks(fakeApi({fail:{'/api/ledger':'Ledger already exists'}}),{business:'b1',start:'2026-04-01',today:'2026-11-09'});
 await startBooks(fakeApi({fail:{'/api/accounting/sources':'Source accounting is already configured'}}),{business:'b1',start:'2026-04-01',today:'2026-11-09'});
 await assert.rejects(startBooks(fakeApi({fail:{'/api/accounting/sources':'Database unavailable'}}),{business:'b1',start:'2026-04-01',today:'2026-11-09'}),/Database unavailable/);
 await assert.rejects(startBooks(fakeApi({accounts:ACCOUNTS.slice(0,3)}),{business:'b1',start:'2026-04-01',today:'2026-11-09'}),/standard accounts could not be found/);
});

test('booksOn reports whether automatic posting is configured, and false when it cannot tell',async()=>{
 assert.equal(await booksOn(async()=>({configured:true}),'b1','2026-11-09'),true);
 assert.equal(await booksOn(async()=>({configured:false}),'b1','2026-11-09'),false);
 assert.equal(await booksOn(async()=>{throw Error('x')},'b1','2026-11-09'),false);
});
