import{identity,json,sb,uuid,originAllowed,readObject}from'../../../lib/supabase';
import{bankGET,bankPOST}from'../../../lib/bank-api.mjs';
const dependencies={identity,json,sb,uuid,originAllowed,readObject};
export const GET=(req:Request)=>bankGET(req,dependencies);
export const POST=(req:Request)=>bankPOST(req,dependencies);
