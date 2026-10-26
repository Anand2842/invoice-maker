import {writeFile,mkdir} from 'node:fs/promises';
process.stdout.write('Ready for hidden test configuration\n');if(process.stdin.isTTY)process.stdin.setRawMode(true);let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.includes('\n'))break}if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();const c=JSON.parse(raw.trim()),results=[];let cookie='';const base='http://127.0.0.1:4173';
const check=(name,pass,details='')=>{results.push({name,status:pass?'PASS':'FAIL',details});if(!pass)throw Error(name+': '+details)};
async function req(path,body,method='GET',auth=true){const response=await fetch(base+path,{method,signal:AbortSignal.timeout(30000),headers:{Origin:base,'Content-Type':'application/json',...(auth?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const bytes=new Uint8Array(await response.arrayBuffer());let data;try{data=JSON.parse(new TextDecoder().decode(bytes))}catch{}return{status:response.status,response,bytes,data}}
async function login(email){const r=await req('/api/auth',{action:'login',email,password:c.password},'POST');check('Login '+(email===c.email?'owner':'isolated account'),r.status===200);cookie=r.response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')}
const suffix=String(Date.now()).slice(-8),records=[];
async function create(data,collection='documents'){const r=await req('/api/records',{business:c.business,collection,demo:true,data},'POST');check('Save '+(data.number||data.name),r.status===201,r.data?.error);records.push(r.data.record);return r.data.record}
const params=new URLSearchParams({business:c.business,from:'2026-08-01',to:'2026-08-31',type:'gstr-1',demo:'true'}),reportPath='/api/reports/gst?';
try{
 await mkdir(c.directory,{recursive:true});let r=await req(reportPath+params,null,'GET',false);check('Anonymous report denied',r.status===401);
 await login(c.email);
 const d={type:'gst-invoice',number:'R'+suffix,date:'2026-08-15',currency:'INR',status:'sent',seller:{name:'GST Demo Studio',gstin:'29AAAAA0000A1Z5'},buyer:{name:'GST Demo Buyer',gstin:'29BBBBB1111B1Z6'},taxType:'GST',gstMode:'split',gstReporting:{category:'taxable',placeOfSupply:'29'},template:'compact',items:[{name:'Design services',hsn:'998314',uqc:'NA',quantity:1,rate:1000,taxRate:18,cessRate:2}]};
 const invoice=await create(d);
 const credit=await create({...d,type:'credit-note',number:'C'+suffix,date:'2026-08-16',originalDocumentId:invoice.id,originalDocumentNumber:d.number,originalDocumentDate:d.date,adjustmentReason:'Synthetic partial return',items:[{...d.items[0],rate:100}]});
 await create({...d,number:'L'+suffix,buyer:{name:'Large consumer'},gstMode:'igst',gstReporting:{category:'taxable',placeOfSupply:'27'},items:[{...d.items[0],rate:100000,cessRate:0}]});
 await create({...d,number:'S'+suffix,buyer:{name:'Retail consumer'},items:[{...d.items[0],rate:500,cessRate:0}]});
 const draft=await create({...d,number:'D'+suffix,status:'draft'});
 const foreign=await create({...d,number:'F'+suffix,currency:'USD'});
 await create({name:'GST demo reviewed '+suffix,date:d.date,amount:118,taxableAmount:100,vendorGstin:d.buyer.gstin,inputCgst:9,inputSgst:9,itcStatus:'Eligible',reconciled2B:'Yes',reversalCgst:1,reversalSgst:1},'expenses');
 await create({name:'GST demo unreviewed '+suffix,date:d.date,amount:118,taxableAmount:100,vendorGstin:d.buyer.gstin,inputCgst:9,inputSgst:9},'expenses');
 r=await req(reportPath+params);check('Authenticated report returns no-store JSON',r.status===200&&r.response.headers.get('cache-control').includes('no-store'),r.data?.error);const report=r.data;
 check('B2B invoice and registered credit classified',report.rows.some(x=>x.id===invoice.id&&x.section==='B2B')&&report.rows.some(x=>x.id===credit.id&&x.section==='CDNR'));
 check('B2CL and B2CS both present',report.rows.some(x=>x.number==='L'+suffix&&x.section==='B2CL')&&report.rows.some(x=>x.number==='S'+suffix&&x.section==='B2CS'));
 check('Draft and foreign documents excluded',!report.rows.some(x=>[draft.id,foreign.id].includes(x.id))&&report.issues.some(x=>x.recordId===foreign.id&&x.code==='FOREIGN_CURRENCY'));
 check('Workpaper explicitly rejects portal-ready claim',report.portalReady===false&&report.schema==='folio-gst-workpaper-v1');
 check('Unreviewed input tax disclosed',report.gstr3b.itc.unreviewedExpenseIds.length>0);
 await writeFile(c.directory+'/api-gstr1.json',JSON.stringify(report,null,2));
 r=await req(reportPath+params+'&format=csv');check('GSTR-1 CSV has attachment and saved numbers',r.status===200&&r.response.headers.get('content-disposition').includes('attachment')&&new TextDecoder().decode(r.bytes).includes(d.number));await writeFile(c.directory+'/api-gstr1.csv',r.bytes);
 params.set('type','gstr-3b');r=await req(reportPath+params+'&format=csv');check('GSTR-3B CSV includes ITC and reverse charge summaries',r.status===200&&new TextDecoder().decode(r.bytes).includes('reviewed reversals')&&new TextDecoder().decode(r.bytes).includes('3.1(d)'));await writeFile(c.directory+'/api-gstr3b.csv',r.bytes);
 params.set('demo','false');r=await req(reportPath+params);check('Demo records isolated from real reports',r.status===200&&!r.data.rows.some(x=>records.some(record=>record.id===x.id)));
 params.set('demo','true');
 const invalid=new URLSearchParams(params);invalid.set('from','2026-02-30');r=await req(reportPath+invalid);check('Invalid calendar date rejected',r.status===400);
 invalid.set('from','2026-08-01');invalid.set('type','bad');r=await req(reportPath+invalid);check('Invalid report type rejected',r.status===400);
 r=await req('/api/records',{business:c.business,collection:'documents',demo:true,data:{...d,number:'BAD'+suffix,gstReporting:{category:'taxable',placeOfSupply:'ZZ'}}},'POST');check('Invalid reporting fields rejected before save',r.status===400);
 for(const [label,record] of [['invoice',invoice],['credit-note',credit]]){r=await req('/api/documents/preview?'+new URLSearchParams({business:c.business,id:record.id}));check(label+' PDF still renders with reporting data',r.status===200&&new TextDecoder().decode(r.bytes.slice(0,5))==='%PDF-');await writeFile(c.directory+'/api-'+label+'.pdf',r.bytes)}
 await login(c.otherEmail);r=await req(reportPath+params);check('Other account cannot report on owner business',r.status===404);
 const browser={invoice:invoice.id,credit:credit.id,business:c.business,from:'2026-08-01',to:'2026-08-31'};
 await writeFile(c.directory+'/gst-backend-tests.json',JSON.stringify({date:new Date().toISOString(),results,browser},null,2));console.log(JSON.stringify({pass:results.length,fail:0,browser}));
}catch(e){await writeFile(c.directory+'/gst-backend-tests.json',JSON.stringify({results,error:e.message},null,2));console.log(JSON.stringify({error:e.message,results}));process.exitCode=1}finally{process.exit(process.exitCode||0)}
