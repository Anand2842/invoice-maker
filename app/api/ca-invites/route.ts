import{identity,json,sb,uuid,originAllowed,readObject}from'../../../lib/supabase';
import{caInvitesGET,caInvitesPOST}from'../../../lib/ca-invites-api.mjs';
const dependencies={identity,json,sb,uuid,originAllowed,readObject};
export const GET=(req:Request)=>caInvitesGET(req,dependencies);
export const POST=(req:Request)=>caInvitesPOST(req,dependencies);
