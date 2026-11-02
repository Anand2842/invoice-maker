import{identity,json,sb,uuid}from'../../../../lib/supabase';
import{cashStatementGET}from'../../../../lib/settlement-statement-api.mjs';
export const GET=(req:Request)=>cashStatementGET(req,{identity,json,sb,uuid});
