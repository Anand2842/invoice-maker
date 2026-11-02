import{identity,json,sb,uuid,originAllowed,readObject}from'../../../../lib/supabase';
import{lifecycleGET,lifecyclePOST}from'../../../../lib/document-lifecycle-api.mjs';
const dependencies={identity,json,sb,uuid,originAllowed,readObject};
export const GET=(req:Request)=>lifecycleGET(req,dependencies);
export const POST=(req:Request)=>lifecyclePOST(req,dependencies);
