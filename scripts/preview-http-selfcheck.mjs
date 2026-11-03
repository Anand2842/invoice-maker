import{Readable}from'node:stream';
// Exercise the disposable HTTP routing callback without opening a listening
// socket. This verifies synthetic route integration, not browser or hosted auth.
export async function previewHTTPChecks(server,{business,extra=[]}){
 const scope=new URLSearchParams({business,demo:'true',date:'2026-11-02',from:'2026-10-01',to:'2026-11-02'});
 const paths=['/api/auth','/api/workspace','/api/ledger','/api/banking','/api/vendor-bills','/api/expenses','/api/cash','/api/credits','/api/mock-refunds','/api/accounting/review','/accounting/','/banking/','/cash/','/credits/','/payables/','/invoice-editor/',...extra];
 for(const path of paths){const req=Readable.from([]);req.url=path+(path.startsWith('/api/')?'?'+scope:'');req.method='GET';req.headers={};let result;const res={writeHead(status,headers){result={status,headers}},end(body){result.body=Buffer.from(body||'').toString()}};await server.listeners('request')[0](req,res);const expectedStatus=path==='/api/expenses'?400:200;if(result?.status!==expectedStatus)throw Error('Disposable route smoke failed: '+path+' '+result?.status+' '+result?.body);if(path.startsWith('/api/')){const data=JSON.parse(result.body);if(expectedStatus===400&&!data.error)throw Error('Disposable invalid scope was not rejected');if(path==='/api/workspace'&&data.user?.id==null)throw Error('Disposable workspace user is missing');}else if(!result.body.toLowerCase().includes('<html'))throw Error('Disposable page HTML missing: '+path);}
 return{kind:'in-process disposable HTTP routing',paths,checks:paths.length,invalidScopeChecks:['/api/expenses requires an exact expense ID'],browserVerified:false,hostedAuthenticationVerified:false,actualPostgresConcurrencyVerified:false};
}
