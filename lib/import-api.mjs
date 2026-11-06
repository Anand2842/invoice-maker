import{validateRecord}from'./business.mjs';
import{IMPORT_COLLECTIONS,parseCsv,mapImport}from'../public/csv-import.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,MAX_BYTES=1_000_000,CHUNK=500;
const norm=s=>String(s||'').trim().toLowerCase().replace(/\s+/g,' ');

// Preview (commit:false) or import (commit:true) clients, vendors or items from CSV text.
// Every row goes through the same validateRecord as the single-record form; RLS decides write access.
// Names already in the business (or repeated in the file) are skipped, so re-running an import is safe.
export async function importPOST(req,{identity,json,sb,originAllowed,readObject}){
 if(!originAllowed(req))return json({error:'Origin is not allowed'},403);
 const user=await identity(req);if(!user)return json({error:'Sign in to import records'},401);
 let body;try{body=await readObject(req)}catch{return json({error:'Expected a JSON object'},400)}
 const{business,collection,csv}=body,demo=body.demo===true;
 if(!UUID.test(business||'')||!IMPORT_COLLECTIONS.includes(collection))return json({error:'Select a business and what to import'},400);
 if(typeof csv!=='string'||!csv.trim())return json({error:'Choose a CSV file'},400);
 if(new TextEncoder().encode(csv).length>MAX_BYTES)return json({error:'The file is larger than 1 MB; split it into smaller files'},413);
 let mapped;try{mapped=mapImport(collection,parseCsv(csv))}catch(e){return json({error:e.message},400)}
 const q=new URLSearchParams({business_id:'eq.'+business,collection:'eq.'+collection,demo:'eq.'+demo,archived:'eq.false',select:'name:data->>name',limit:'20000'});
 const existing=await sb('/rest/v1/billing_records?'+q,user.access);
 if(!existing.ok)return json({error:'Unable to read existing records for this business'},existing.status===401?401:403);
 const seen=new Set(existing.data.map(r=>norm(r.name))),ready=[],duplicates=[],errors=[];
 for(const{line,data}of mapped.records){let valid;try{valid=validateRecord(collection,data)}catch(e){errors.push({line,message:e.message});continue}
  const name=norm(valid.name);if(seen.has(name)){duplicates.push({line,name:valid.name});continue}seen.add(name);ready.push(valid)}
 const summary={ready:ready.length,duplicates,errors,columns:mapped.columns,unknownColumns:mapped.unknown};
 if(body.commit!==true)return json({...summary,preview:ready.slice(0,20)});
 let imported=0;
 for(let i=0;i<ready.length;i+=CHUNK){
  const rows=ready.slice(i,i+CHUNK).map(data=>({business_id:business,collection,data,demo,created_by:user.id}));
  const r=await sb('/rest/v1/billing_records',user.access,{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(rows)});
  if(!r.ok)return json({...summary,imported,error:imported?`Imported ${imported} records, then the rest were rejected. Check your permissions and import the file again; already imported names are skipped.`:'Records could not be saved. Only owners and editors can import.'},imported?207:403);
  imported+=rows.length}
 return json({...summary,imported});
}
