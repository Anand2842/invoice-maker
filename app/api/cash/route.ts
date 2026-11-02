import{identity,json,sb,uuid,originAllowed,readObject}from'../../../lib/supabase';import{cashGET,cashPOST}from'../../../lib/cash-api.mjs';
const dependencies={identity,json,sb,uuid,originAllowed,readObject};
export const GET=(req:Request)=>cashGET(req,dependencies);
export const POST=(req:Request)=>cashPOST(req,dependencies);
