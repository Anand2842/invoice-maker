import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export async function paymentDatabase(){
 const db=new PGlite();
 await db.exec(`
  create role anon; create role authenticated;
  create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema public,auth to authenticated,anon;
  grant execute on function auth.uid() to authenticated,anon;
  create schema storage;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
 `);
 const migrations=new URL('../../supabase/migrations/',import.meta.url);
 // Sharing uses pgcrypto, outside this WASM engine and the payment dependency graph.
 for(const file of (await readdir(migrations)).filter(f=>f.endsWith('.sql')&&f!=='202610230001_document_sharing.sql').sort())await db.exec(await readFile(new URL(file,migrations),'utf8'));
 const owner=randomUUID(),viewer=randomUUID(),outsider=randomUUID(),business=randomUUID();
 await db.query('insert into auth.users(id) values($1),($2),($3)',[owner,viewer,outsider]);
 await db.query("insert into public.billing_businesses(id,owner_id,name) values($1,$2,'Synthetic payment test business')",[business,owner]);
 await db.query("insert into public.billing_members(business_id,user_id,role) values($1,$2,'viewer')",[business,viewer]);
 const as=async(actor,fn)=>{await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);await db.exec('set local role authenticated');const result=await fn(db);await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}};
 const invoice=async(patch={},mode=false)=>{
  const data={type:'invoice',number:'TEST-'+randomUUID(),date:'2026-10-01',dueDate:'2026-10-20',currency:'INR',status:'sent',taxType:'NONE',seller:{name:'Seller snapshot'},buyer:{name:'Buyer snapshot'},items:[{name:'Work',quantity:1,rate:100}],...patch};
  return as(owner,async db=>(await db.query("insert into public.billing_records(business_id,collection,data,demo,created_by) values($1,'documents',$2,$3,$4) returning *",[business,data,mode,owner])).rows[0]);
 };
 const record=async(source,data={},key=randomUUID(),actor=owner)=>as(actor,async db=>(await db.query('select public.billing_record_payment($1,$2,$3,$4,$5,$6) result',[business,source.id,source.version,key,{amount:'25.00',date:'2026-10-10',method:'Bank transfer',...data},source.demo])).rows[0].result);
 const reverse=async(payment,data={},key=randomUUID(),actor=owner)=>as(actor,async db=>(await db.query('select public.billing_reverse_payment($1,$2,$3,$4,$5) result',[business,payment.id,key,{date:'2026-10-29',reason:'Correct duplicate record',...data},payment.demo])).rows[0].result);
 return {db,owner,viewer,outsider,business,as,invoice,record,reverse,close:()=>db.close()};
}
