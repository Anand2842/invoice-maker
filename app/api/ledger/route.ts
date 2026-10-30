import{identity,json,sb,uuid,originAllowed,readObject}from'../../../lib/supabase';
import{ledgerGET,ledgerPOST}from'../../../lib/ledger-api.mjs';
const dependencies={identity,json,sb,uuid,originAllowed,readObject};
export const GET=(req:Request)=>ledgerGET(req,dependencies);
export const POST=(req:Request)=>ledgerPOST(req,dependencies);
