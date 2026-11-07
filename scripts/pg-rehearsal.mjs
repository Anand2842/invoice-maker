// Migration rehearsal on a real PostgreSQL server (not PGlite).
// Usage: PGREHEARSAL_URL=postgres://postgres@127.0.0.1:55432 node scripts/pg-rehearsal.mjs [fresh|upgrade] [baselineMigration]
// Requires PostgreSQL 15+ (migrations use security_invoker views, as on Supabase).
// Creates throwaway databases, emulates the Supabase roles/auth/storage/default privileges,
// applies supabase/migrations in filename order and audits the result. Never connect this to production.
import postgres from 'postgres';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const server=process.env.PGREHEARSAL_URL;
// The real host must be loopback: parse the URL (a username of "localhost" is not a host) and refuse any option
// that could redirect the connection (host/hostaddr/service parameters, multi-host lists, Unix-socket paths).
function localOnly(value){let u;try{u=new URL(value)}catch{return false}
 return /^postgres(ql)?:$/.test(u.protocol)&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&!u.host.includes(',')&&[...u.searchParams.keys()].every(k=>!/^(host|hostaddr|service|options)$/i.test(k))}
if(!server||!localOnly(server))throw Error('Set PGREHEARSAL_URL to a local throwaway PostgreSQL server (localhost only)');
for(const k of ['PGHOST','PGHOSTADDR','PGSERVICE'])if(process.env[k]&&!['localhost','127.0.0.1','::1'].includes(process.env[k]))throw Error(`Unset ${k}; the rehearsal only connects to localhost`);
export const connect=(database='postgres',max=1)=>postgres(server.replace(/\/[^/@]*$/,'')+'/'+database,{onnotice:()=>{},max});
const dir=new URL('../supabase/migrations/',import.meta.url);
const migrations=(await readdir(dir)).filter(f=>f.endsWith('.sql')).sort();

export const SUPABASE_BOOTSTRAP=`
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end$$;
create schema extensions; create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(coalesce(current_setting('request.jwt.claim.sub',true),current_setting('request.jwt.claims',true)::jsonb->>'sub'),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
grant usage on schema public,auth,storage,extensions to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated;
grant select,insert,update,delete on storage.objects to authenticated;
-- Supabase grants these defaults to API roles in public; migrations must revoke what they do not want exposed.
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
`;

export async function freshDatabase(name){const admin=connect();await admin.unsafe(`drop database if exists ${name}`);await admin.unsafe(`create database ${name}`);await admin.end();const sql=connect(name);await sql.unsafe(SUPABASE_BOOTSTRAP);return sql;}
export async function apply(sql,files){const timings=[];for(const file of files){const started=Date.now();try{await sql.begin(tx=>tx.unsafe(readFileSyncCache.get(file)))}catch(e){throw Error(`${file} failed: ${e.message}`)}timings.push([file,Date.now()-started])}return timings;}
const readFileSyncCache=new Map();for(const f of migrations)readFileSyncCache.set(f,await readFile(new URL(f,dir),'utf8'));

// Structural security audit against the real catalog. Intended anonymous entry points, each gated inside SQL by a share
// token, the automation secret, a payment-link token or the webhook HMAC. Any other anon-executable definer is a finding.
export const ANON_ENTRY_POINTS=['billing_open_share','billing_automation_due','billing_automation_generate','billing_automation_failed','billing_email_claim','billing_email_complete','billing_payment_link_open','billing_gateway_mock_capture','billing_gateway_webhook'];
export async function audit(sql){
 const problems=[];
 for(const r of await sql`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`)problems.push(`table without RLS: ${r.relname}`);
 for(const r of await sql`select p.oid::regprocedure::text fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and not exists(select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')`)problems.push(`definer without search_path: ${r.fn}`);
 for(const r of await sql`select p.oid::regprocedure::text fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.prorettype<>'trigger'::regtype and p.proname<>all(${ANON_ENTRY_POINTS}) and has_function_privilege('anon',p.oid,'execute')`)problems.push(`definer executable by anon: ${r.fn}`);
 for(const r of await sql`select c.relname,p.privilege_type from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral (select unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) privilege_type) p where n.nspname='public' and c.relkind='r' and has_table_privilege('anon',c.oid,p.privilege_type)`)problems.push(`anon can ${r.privilege_type} ${r.relname}`);
 const exposed=await sql`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.prorettype<>'trigger'::regtype and has_function_privilege('authenticated',p.oid,'execute')`;
 const definers=await sql`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.prorettype<>'trigger'::regtype`;
 const tables=await sql`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`;
 return{problems,tables:tables[0].n,definers:definers[0].n,authenticatedEntryPoints:exposed[0].n};
}

// Run statements as a Supabase-authenticated user inside one transaction.
export const as=(sql,user,fn)=>sql.begin(async tx=>{await tx.unsafe(`set local role authenticated`);await tx`select set_config('request.jwt.claim.sub',${user},true)`;return fn(tx)});

async function seedBaseline(sql){
 const owner=randomUUID(),viewer=randomUUID();await sql`insert into auth.users(id,email,email_confirmed_at) values(${owner},'owner@example.test',now()),(${viewer},'viewer@example.test',now())`;
 const business=(await as(sql,owner,tx=>tx`insert into public.billing_businesses(name,owner_id) values('Rehearsal Traders',${owner}) returning id`))[0].id;
 await sql`insert into public.billing_members(business_id,user_id,role) values(${business},${owner},'owner'),(${business},${viewer},'viewer') on conflict do nothing`;
 const client=(await as(sql,owner,tx=>tx`insert into public.billing_records(business_id,collection,data) values(${business},'clients',${sql.json({name:'Legacy client',email:'client@example.test'})}) returning id`))[0].id;
 const invoices=[];for(let n=1;n<=5;n++)invoices.push((await as(sql,owner,tx=>tx`insert into public.billing_records(business_id,collection,data) values(${business},'documents',${sql.json({type:'invoice',number:'INV-'+n,status:'Issued',date:'2026-10-0'+n,dueDate:'2026-10-2'+n,currency:'INR',clientId:client,buyer:{name:'Legacy client'},items:[{name:'Service',quantity:1,rate:1000*n,taxRate:18}],totals:{subtotal:1000*n,tax:180*n,total:1180*n}})}) returning id`))[0].id);
 for(const c of['items','expenses','vendors','leads'])await as(sql,owner,tx=>tx`insert into public.billing_records(business_id,collection,data) values(${business},${c},${sql.json(c==='items'?{name:'Widget',quantity:5,rate:10}:c==='expenses'?{name:'Rent',amount:500,date:'2026-10-03'}:{name:'Legacy '+c})})`);
 return{owner,viewer,business,client,invoices};
}
const fingerprint=async sql=>(await sql`select collection,count(*)::int n,md5(string_agg(id::text||data::text||version::text||archived::text,'|' order by id)) h from public.billing_records group by collection order by collection`).map(r=>`${r.collection}:${r.n}:${r.h}`).join(' ');

export {migrations};
const main=import.meta.url===pathToFileURL(process.argv[1]||'').href,mode=process.argv[2]||'fresh';
if(!main){}
else if(mode==='fresh'){
 const sql=await freshDatabase('rehearsal_fresh');const t=Date.now();await apply(sql,migrations);
 const result=await audit(sql);console.log(JSON.stringify({mode,migrations:migrations.length,ms:Date.now()-t,...result},null,1));await sql.end();if(result.problems.length)process.exitCode=1;
}else if(mode==='upgrade'){
 const baseline=process.argv[3]||'202610300002_business_time_zone.sql',cut=migrations.indexOf(baseline);if(cut<0)throw Error('Unknown baseline migration '+baseline);
 const sql=await freshDatabase('rehearsal_upgrade');await apply(sql,migrations.slice(0,cut+1));const seed=await seedBaseline(sql);const before=await fingerprint(sql);
 const pending=migrations.slice(cut+1);const t=Date.now();await apply(sql,pending);const after=await fingerprint(sql);
 const result=await audit(sql);
 // Post-upgrade smoke: legacy data stays readable to members and invisible to outsiders.
 const outsider=randomUUID();await sql`insert into auth.users(id) values(${outsider})`;
 const memberRows=(await as(sql,seed.viewer,tx=>tx`select count(*)::int n from public.billing_records where business_id=${seed.business}`))[0].n;
 const outsiderRows=(await as(sql,outsider,tx=>tx`select count(*)::int n from public.billing_records`))[0].n;
 const ok=before===after&&memberRows===10&&outsiderRows===0&&!result.problems.length;
 console.log(JSON.stringify({mode,baseline,applied:pending.length,ms:Date.now()-t,legacyRecordsUnchanged:before===after,memberRows,outsiderRows,...result},null,1));
 await sql.end();if(!ok)process.exitCode=1;
}else throw Error('Mode must be fresh or upgrade');
