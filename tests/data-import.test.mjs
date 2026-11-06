import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentDatabase} from './helpers/payment-db.mjs';
import {parseCsv,mapImport} from '../public/csv-import.js';
import {importPOST} from '../lib/import-api.mjs';

const json=(data,status=200)=>Response.json(data,{status});
// PostgREST stand-in for the two calls the importer makes, executed under RLS as the signed-in user.
function rest(f){return async(path,access,init={})=>{const url=new URL(path,'http://x'),p=url.searchParams,eq=k=>p.get(k)?.slice(3);
 try{if(!init.method){const rows=await f.as(access,db=>db.query("select data->>'name' as name from billing_records where business_id=$1 and collection=$2 and demo=$3 and archived=$4",[eq('business_id'),eq('collection'),eq('demo')==='true',eq('archived')==='true']));return{ok:true,status:200,data:rows.rows}}
  const rows=JSON.parse(init.body);await f.as(access,async db=>{for(const r of rows)await db.query('insert into billing_records(business_id,collection,data,demo,created_by) values($1,$2,$3,$4,$5)',[r.business_id,r.collection,r.data,r.demo,r.created_by])});return{ok:true,status:201,data:null}}
 catch(e){return{ok:false,status:403,data:{code:e.code,message:e.message}}}}}
const call=(f,actor,body)=>importPOST(new Request('https://folio.test/api/import',{method:'POST',body:JSON.stringify(body)}),{json,sb:rest(f),identity:async()=>actor&&{id:actor,access:actor},originAllowed:()=>true,readObject:r=>r.json()});

test('CSV parser handles quotes, embedded newlines, BOM and CRLF',()=>{
 assert.deepEqual(parseCsv('﻿Name,Address\r\n"Acme, Ltd","Line 1\nLine ""2"""\r\n\r\nB,\n'),[['Name','Address'],['Acme, Ltd','Line 1\nLine "2"'],['B','']]);
 assert.throws(()=>parseCsv('a,"b'),/unclosed quote/);
});

test('column mapping accepts Tally-style headers, strips export formula guards and fills item numbers',()=>{
 const parties=mapImport('clients',parseCsv('Party Name,GSTIN/UIN,Mobile No,Notes\nNorthstar,27bbbbb1111b1z6,9000000000,x\n"\'=cmd",,,'));
 assert.deepEqual(parties.columns,['name','gstin','phone']);assert.deepEqual(parties.unknown,['Notes']);
 assert.deepEqual(parties.records,[{line:2,data:{name:'Northstar',gstin:'27BBBBB1111B1Z6',phone:'9000000000'}},{line:3,data:{name:'=cmd'}}]);
 assert.deepEqual(mapImport('items',parseCsv('Stock Item,Rate\nBolt,"₹1,250.50"')).records[0].data,{name:'Bolt',rate:'1250.50',quantity:0,reorderLevel:0});
 assert.throws(()=>mapImport('items',parseCsv('SKU\nA1')),/Name column/);
 assert.throws(()=>mapImport('leads',parseCsv('Name\nA')),/clients, vendors or items/);
});

test('import previews, validates per row, skips existing and repeated names, and respects roles',async()=>{const f=await paymentDatabase();try{
 await f.as(f.owner,db=>db.query("insert into billing_records(business_id,collection,data,demo,created_by) values($1,'clients',$2,false,$3)",[f.business,{name:'Existing Co'},f.owner]));
 const csv='Name,Email,GSTIN\nNew Co,new@example.test,\nexisting co,,\nBad Mail,not-an-email,\nNew  co,,\nTaxed,,27BBBBB1111B1Z6\n';
 const base={business:f.business,collection:'clients',csv};
 const preview=await (await call(f,f.owner,base)).json();
 assert.equal(preview.ready,2);assert.deepEqual(preview.duplicates.map(d=>d.line),[3,5]);assert.deepEqual(preview.errors,[{line:4,message:'Email is invalid'}]);
 assert.equal((await f.db.query("select count(*)::int n from billing_records where collection='clients'")).rows[0].n,1,'preview writes nothing');
 assert.equal((await call(f,f.viewer,{...base,commit:true})).status,403,'viewers cannot import');
 assert.equal((await call(f,f.outsider,base)).status,200,'outsiders see no existing names but…');
 assert.equal((await call(f,f.outsider,{...base,commit:true})).status,403,'…cannot write into the business');
 const done=await (await call(f,f.owner,{...base,commit:true})).json();assert.equal(done.imported,2);
 const again=await (await call(f,f.owner,{...base,commit:true})).json();assert.equal(again.imported,0,'re-running the same file is a no-op');
 assert.deepEqual((await f.db.query("select data->>'name' n from billing_records where collection='clients' and not demo order by 1")).rows.map(r=>r.n),['Existing Co','New Co','Taxed']);
 assert.equal((await call(f,null,base)).status,401);
 assert.equal((await call(f,f.owner,{...base,collection:'payments'})).status,400);
 assert.equal((await call(f,f.owner,{...base,csv:'x'.repeat(1_000_001)})).status,413);
}finally{await f.close()}});
