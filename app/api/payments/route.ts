import{identity,json,sb,uuid,originAllowed,readObject}from'../../../lib/supabase';
import{paymentGET,paymentPOST}from'../../../lib/payment-api.mjs';
const dependencies={identity,json,sb,uuid,originAllowed,readObject};
export const GET=(req:Request)=>paymentGET(req,dependencies);
export const POST=(req:Request)=>paymentPOST(req,dependencies);
