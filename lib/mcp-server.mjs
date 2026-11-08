import {McpServer,createMcpHandler} from '@modelcontextprotocol/server';
import {registerPublicTools} from './mcp-tools/public.mjs';

export function createPublicMcp({enabled=false,origin='https://inbill.live',clientKey=()=> 'shared',now=Date.now,log=()=>{}}={}){
 const expected=new URL(origin),buckets=new Map();
 const handler=createMcpHandler(()=>{const server=new McpServer({name:'inbill',version:'0.1.0'});registerPublicTools(server,{log});return server},{legacy:'stateless',responseMode:'json',maxRequestBodySize:100*1024});
 return async request=>{
  const headers={'Cache-Control':'no-store'};
  const fail=(error,status,extra={})=>Response.json({error},{status,headers:{...headers,...extra}});
  if(!enabled)return fail('inbill MCP is temporarily unavailable.',503);
  const url=new URL(request.url);
  if(url.host!==expected.host||request.headers.get('origin')&&request.headers.get('origin')!==expected.origin)return fail('This origin is not allowed.',403);
  if(!['POST','GET','DELETE'].includes(request.method))return fail('Method not allowed.',405,{Allow:'POST, GET, DELETE'});
  // shortcut: per-instance abuse limit; require an edge-wide IP limit before public release.
  const time=now(),key=clientKey(request);for(const[k,v]of buckets)if(v.until<=time)buckets.delete(k);
  if(!buckets.has(key)&&buckets.size>=10000)return fail('Too many requests. Try again shortly.',429,{'Retry-After':'60'});
  const bucket=buckets.get(key)||{count:0,until:time+60000};buckets.set(key,bucket);if(++bucket.count>60)return fail('Too many requests. Try again shortly.',429,{'Retry-After':String(Math.ceil((bucket.until-time)/1000))});
  // Stage 1 never reads browser cookies, bearer tokens or the business database.
  try{const response=await handler.fetch(request);response.headers.set('Cache-Control','no-store');return response}catch{return fail('The MCP request could not be completed.',500)}
 };
}
