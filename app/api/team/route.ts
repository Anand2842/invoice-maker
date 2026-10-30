import{identity,json,sb,uuid,originAllowed,readObject}from'../../../lib/supabase';
import{teamGET,teamPOST}from'../../../lib/team-api.mjs';
const dependencies={identity,json,sb,uuid,originAllowed,readObject};
export const GET=(req:Request)=>teamGET(req,dependencies);
export const POST=(req:Request)=>teamPOST(req,dependencies);
