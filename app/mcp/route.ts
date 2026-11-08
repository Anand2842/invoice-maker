import {createPublicMcp} from '../../lib/mcp-server.mjs';
const handler=createPublicMcp({enabled:process.env.INBILL_MCP_ENABLED==='true',origin:process.env.INBILL_MCP_ORIGIN||'https://inbill.live',clientKey:(req:Request)=>process.env.VERCEL?req.headers.get('x-vercel-forwarded-for')||'shared':'local',log:(event:unknown)=>console.info(JSON.stringify(event))});
export const POST=handler;
export const GET=handler;
export const DELETE=handler;
