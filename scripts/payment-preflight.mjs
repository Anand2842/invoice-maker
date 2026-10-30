import postgres from 'postgres';import{writeFile}from'node:fs/promises';import{auditPaymentRecords}from'../lib/payment-audit.mjs';import{businessDate}from'../public/business-date.js';
process.stdout.write('Ready for private read-only audit configuration JSON on stdin (input is hidden).\n');
if(process.stdin.isTTY)process.stdin.setRawMode(true);let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.includes('\n'))break}if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();
const input=JSON.parse(raw.trim()),c=input.connection;
const sql=postgres({host:c.host,port:c.port||5432,database:c.database||'postgres',username:c.username||'postgres',password:c.password,ssl:'require',max:1,connect_timeout:15,onnotice:()=>{}});
try{
 const report=await sql.begin(async tx=>{
  await tx`set transaction isolation level repeatable read, read only`;
  const records=await tx`select id,business_id,collection,demo,archived,data-'editorSnapshot'-'logo'-'signature' as data from public.billing_records where collection in ('documents','payments') order by id limit 100001`;
  if(records.length>100000)throw Error('Audit exceeds 100,000 records; no partial audit is reported');
  const functions=await tx`select p.proname,p.prosecdef as security_definer,pg_get_userbyid(p.proowner) as owner from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname like 'billing_%' order by p.proname`;
  const triggers=await tx`select event_object_table,trigger_name,action_timing,event_manipulation from information_schema.triggers where event_object_schema='public' and event_object_table like 'billing_%' order by trigger_name`;
  const policies=await tx`select tablename,policyname,cmd,roles,qual,with_check from pg_policies where schemaname='public' and tablename like 'billing_%' order by tablename,policyname`;
  const grants=await tx`select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name like 'billing_%' and grantee in ('anon','authenticated','PUBLIC') order by table_name,grantee,privilege_type`;
  const ledger=await tx`select to_regclass('supabase_migrations.schema_migrations') as name`;
  const migrations=ledger[0].name?await tx`select version from supabase_migrations.schema_migrations order by version`:null;
  return{readOnly:true,repeatableRead:true,productionMutation:false,...auditPaymentRecords(records,{asOf:input.asOf||businessDate()}),functions,triggers,policies,grants,migrations};
 });
 if(input.output)await writeFile(input.output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({readOnly:true,records:report.records,payments:report.payments,issues:report.issues.length,counts:report.counts,output:input.output||null}));
}catch(error){console.error(JSON.stringify({error:String(error.message).replaceAll(c.password||'\u0000','[redacted]')}));process.exitCode=1}finally{await sql.end({timeout:2});process.exit(process.exitCode||0)}
