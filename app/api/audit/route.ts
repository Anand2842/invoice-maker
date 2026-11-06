import{identity,json,sb}from'../../../lib/supabase';import{auditGET}from'../../../lib/audit-api.mjs';export const GET=(req:Request)=>auditGET(req,{identity,json,sb});
