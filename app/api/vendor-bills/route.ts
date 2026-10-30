import{identity,json,sb,uuid,originAllowed,readObject}from'../../../lib/supabase';
import{vendorBillsGET,vendorBillsPOST}from'../../../lib/vendor-bills-api.mjs';
const dependencies={identity,json,sb,uuid,originAllowed,readObject};
export const GET=(req:Request)=>vendorBillsGET(req,dependencies);
export const POST=(req:Request)=>vendorBillsPOST(req,dependencies);
