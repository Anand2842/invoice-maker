import{ledgerDate}from'../public/accounting/model.mjs';
export async function ledgerLinesGET(req,{identity,json,sb,uuid}){
 const user=await identity(req);if(!user)return json({error:'Sign in to view the general ledger'},401);
 const p=new URL(req.url).searchParams,business=p.get('business'),account=p.get('account');let args;
 try{
  if(!uuid(business)||!uuid(account))throw Error('Choose a valid business and ledger account.');
  const from=ledgerDate(p.get('from')),to=ledgerDate(p.get('to'));if(from>to)throw Error('From must be on or before To.');
  const cursor=['afterDate','afterBatch','afterLine'].filter(k=>p.has(k));if(cursor.length!==0&&cursor.length!==3)throw Error('Provide the complete ledger page cursor.');
  const size=p.has('limit')?Number(p.get('limit')):100;if(!Number.isInteger(size)||size<1||size>200)throw Error('Page size must be between 1 and 200.');
  args={business,data_mode:p.get('demo')==='true',account_id:account,from_date:from,to_date:to,page_size:size,after_date:null,after_batch:null,after_line:null,snapshot_number:null};
  if(p.has('snapshot')){const snapshot=p.get('snapshot');if(!/^[0-9]{1,10}$/.test(snapshot)||BigInt(snapshot)>1000000000n)throw Error('Invalid ledger snapshot number.');args.snapshot_number=snapshot}
  if(cursor.length&&!p.has('snapshot'))throw Error('Continue ledger pages with the original snapshot number.');
  if(cursor.length){const date=ledgerDate(p.get('afterDate')),line=Number(p.get('afterLine'));if(date<from||date>to||!uuid(p.get('afterBatch'))||!Number.isInteger(line)||line<1||line>200)throw Error('Invalid ledger page cursor.');Object.assign(args,{after_date:date,after_batch:p.get('afterBatch'),after_line:line})}
 }catch(error){return json({error:error.message},400)}
 try{const result=await sb('/rest/v1/rpc/billing_ledger_lines',user.access,{method:'POST',body:JSON.stringify(args)});
  if(!result.ok){const code=result.data?.code,status=code==='PGRST202'?503:code==='42501'?403:result.status>=500?502:400;return json({error:code==='PGRST202'?'The general ledger is not available yet.':status===403?'This business ledger is unavailable to your account.':code==='P0001'&&typeof result.data?.message==='string'&&result.data.message.length<1000?result.data.message:'The ledger page could not be loaded. Try again.'},status)}
  const data=result.data;if(!data?.account||data.account.id!==account||!Array.isArray(data.rows)||data.rows.length>args.page_size||typeof data.opening!=='string'||typeof data.closing!=='string'||!Object.hasOwn(data,'next')||typeof data.snapshotNumber!=='string')return json({error:'The ledger page was incomplete. No partial results are shown.'},502);
  return json(data);
 }catch{return json({error:'The ledger page could not be loaded. Try again.'},502)}
}
