import{json,sb}from'../../../../lib/supabase';import{webhookPOST}from'../../../../lib/automation-api.mjs';export const POST=(req:Request)=>webhookPOST(req,{json,sb});
