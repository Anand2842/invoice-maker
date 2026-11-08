import{identity,json,sb}from'../../../lib/supabase';
import{loadDashboard}from'../../../lib/dashboard-load.mjs';
import{overviewGET}from'../../../lib/overview-api.mjs';
export const GET=(req:Request)=>overviewGET(req,{identity,json,sb,loadDashboard});
