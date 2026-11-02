import{identity,json,sb,uuid,originAllowed,readObject}from'../../../lib/supabase';import{expenseGET,expensePOST}from'../../../lib/expense-api.mjs';
const dependencies={identity,json,sb,uuid,originAllowed,readObject};
export const GET=(req:Request)=>expenseGET(req,dependencies);
export const POST=(req:Request)=>expensePOST(req,dependencies);
