import postgres from 'postgres';
import {readFile} from 'node:fs/promises';
process.stdout.write('Ready for private database connection JSON on stdin (input is hidden).\n');
if(process.stdin.isTTY)process.stdin.setRawMode(true);
let line='';
for await(const chunk of process.stdin){line+=chunk.toString();if(line.includes('\n'))break;}
if(process.stdin.isTTY)process.stdin.setRawMode(false);
process.stdin.pause();
const input=JSON.parse(line.trim());const c=input.connection;
const sql=postgres({host:c.host,port:5432,database:'postgres',username:'postgres',password:c.password,ssl:'require',max:1,connect_timeout:15,onnotice:()=>{}});
try{
 if(input.operation==='inspect'){
  const tables=await sql`select tablename from pg_tables where schemaname='public' order by tablename`;
  console.log(JSON.stringify({connected:true,tables:tables.map(r=>r.tablename)}));
 }else if(input.operation==='migrate'){
  const query=await readFile(input.path,'utf8');
  await sql.begin(async tx=>{await tx.unsafe(query)});
  const policies=await sql`select tablename,policyname from pg_policies where schemaname='public' and tablename like 'billing_%'`;
  console.log(JSON.stringify({migration:'applied',policyCount:policies.length}));
 }
}catch(e){console.error(JSON.stringify({error:String(e.message).replaceAll(c.password,'[redacted]')}));process.exitCode=1;}
finally{await sql.end({timeout:2});process.exit(process.exitCode||0);}
