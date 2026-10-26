import {writeFile} from 'node:fs/promises';
process.stdout.write('Ready for hidden test configuration\n');if(process.stdin.isTTY)process.stdin.setRawMode(true);let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.includes('\n'))break}if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();const c=JSON.parse(raw.trim()),results=[];let cookie='';const base='http://127.0.0.1:4173';
const check=(name,pass)=>{results.push({name,status:pass?'PASS':'FAIL'});if(!pass)throw Error(name)};
async function req(path,body,method='GET'){const response=await fetch(base+path,{method,signal:AbortSignal.timeout(30000),headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});const text=await response.text();let data;try{data=JSON.parse(text)}catch{}return{status:response.status,response,text,data}}
try{
 let r=await req('/api/auth',{action:'login',email:c.email,password:c.password},'POST');check('Owner login',r.status===200);cookie=r.response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 const read=async id=>(await req('/api/records?'+new URLSearchParams({business:c.business,collection:'documents',id,demo:'true'}))).data.records[0];
 const invoice=await read(c.invoice),credit=await read(c.credit);
 check('Saved editor snapshot contains no temporary inert lock',!/<form[^>]*\binert\b/.test(invoice.data.editorSnapshot.html));
 check('HSN selection and description persisted',invoice.data.items[0].hsn==='998314'&&invoice.data.items[0].description==='Information technology design and development services');
 check('Place of supply and unit code persisted',invoice.data.gstReporting.placeOfSupply==='29'&&invoice.data.items[0].uqc==='NA');
 check('Unchanged original parties remain canonical',JSON.stringify(invoice.data.seller)===JSON.stringify(credit.data.seller)&&JSON.stringify(invoice.data.buyer)===JSON.stringify(credit.data.buyer));
 r=await req('/api/records',{business:c.business,collection:'documents',id:credit.id,version:credit.version,data:{...credit.data,items:[{...credit.data.items[0],rate:2000}]}},'PATCH');check('Over-credit returns actionable rejection',r.status===400&&r.data.error==='Issued credits cannot exceed invoice plus issued debit notes');
 const p=new URLSearchParams({business:c.business,from:'2026-08-01',to:'2026-08-31',demo:'true',type:'gstr-3b'});r=await req('/api/reports/gst?'+p);check('Fresh report still reconciles taxable output',r.status===200&&r.data.gstr3b.sup_details.osup_det.txval===101400&&r.data.gstr3b.itc.net.camt===8);check('Review issues identify the right collection',r.data.issues.find(x=>x.code==='ITC_REVIEW').collection==='expenses');
 r=await req('/api/reports/gst?'+p+'&format=csv');check('Final 3B CSV includes readable ITC sections',r.status===200&&r.text.includes('4 ITC reviewed reversals')&&r.text.includes('4 ITC net'));
 await writeFile(c.directory+'/final-backend-tests.json',JSON.stringify({date:new Date().toISOString(),results},null,2));console.log(JSON.stringify({pass:results.length,fail:0}));
}catch(e){await writeFile(c.directory+'/final-backend-tests.json',JSON.stringify({results,error:e.message},null,2));console.log(JSON.stringify({error:e.message,results}));process.exitCode=1}finally{process.exit(process.exitCode||0)}
