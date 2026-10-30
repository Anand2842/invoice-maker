import{identity,json,sb,uuid}from'../../../../lib/supabase';
import{ledgerLinesGET}from'../../../../lib/ledger-lines-api.mjs';
export const GET=(req:Request)=>ledgerLinesGET(req,{identity,json,sb,uuid});
