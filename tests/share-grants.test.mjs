import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('share grant migration removes Supabase default write and truncate privileges',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create table public.billing_shares(id integer primary key);alter table public.billing_shares enable row level security;grant all on public.billing_shares to authenticated,anon;insert into public.billing_shares values(1);`);
 await db.exec(await readFile(new URL('../supabase/migrations/202610300001_share_grants.sql',import.meta.url),'utf8'));
 for(const role of ['anon','authenticated']){
  for(const permission of ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']){
   assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,'public.billing_shares',permission])).rows[0].allowed,false,`${role} ${permission}`);
  }
 }
 assert.equal((await db.query("select has_table_privilege('authenticated','public.billing_shares','SELECT') allowed")).rows[0].allowed,true);
 assert.equal((await db.query("select has_table_privilege('anon','public.billing_shares','SELECT') allowed")).rows[0].allowed,false);
 await db.exec('set role authenticated');
 await assert.rejects(()=>db.exec('truncate public.billing_shares'),/permission denied/);
 await db.exec('reset role');
 assert.equal((await db.query('select count(*)::int n from public.billing_shares')).rows[0].n,1);
});
