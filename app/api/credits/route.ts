import{identity,json,sb,uuid,originAllowed,readObject}from'../../../lib/supabase';import{creditGET,creditPOST}from'../../../lib/credit-refund-api.mjs';const dependencies={identity,json,sb,uuid,originAllowed,readObject};
export const GET=(req:Request)=>creditGET(req,dependencies);
export const POST=(req:Request)=>creditPOST(req,dependencies);
