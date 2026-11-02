import{identity,json,sb,uuid,originAllowed,readObject}from'../../../../lib/supabase';
import{sourcesGET,sourcesPOST}from'../../../../lib/source-accounting-api.mjs';
const dependencies={identity,json,sb,uuid,originAllowed,readObject};
export const GET=(req:Request)=>sourcesGET(req,dependencies);
export const POST=(req:Request)=>sourcesPOST(req,dependencies);
