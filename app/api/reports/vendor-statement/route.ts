import{identity,json,sb,uuid}from'../../../../lib/supabase';
import{vendorStatementGET}from'../../../../lib/vendor-statement-api.mjs';
export const GET=(req:Request)=>vendorStatementGET(req,{identity,json,sb,uuid});
