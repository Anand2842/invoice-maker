// All-businesses overview for accountants: one row per business the signed-in user can reach, using the same figures
// as each business's dashboard. Reads only. The user's own token is used, so row-level security decides what is visible.
export const OVERVIEW_LIMIT=50,OVERVIEW_CONCURRENCY=5;

async function mapLimit(items,limit,fn){
 const out=new Array(items.length);let next=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i],i)}}));
 return out;
}

export async function overviewGET(req,{identity,json,sb,loadDashboard}){
 const user=await identity(req);if(!user)return json({error:'Sign in to see your businesses'},401);
 const demo=new URL(req.url).searchParams.get('demo')==='true';
 const list=await sb('/rest/v1/billing_businesses?'+new URLSearchParams({select:'id,name,currency,time_zone,owner_id',order:'name.asc',limit:String(OVERVIEW_LIMIT+1)}),user.access);
 if(!list.ok)return json({error:'Unable to load your businesses'},502);
 const all=list.data||[],truncated=all.length>OVERVIEW_LIMIT,shown=all.slice(0,OVERVIEW_LIMIT);
 const memberships=await sb('/rest/v1/billing_members?'+new URLSearchParams({select:'business_id,role',user_id:'eq.'+user.id}),user.access);
 const roleOf=new Map((memberships.ok?memberships.data||[]:[]).map(m=>[m.business_id,m.role]));
 const rows=await mapLimit(shown,OVERVIEW_CONCURRENCY,async b=>{
  const row={id:b.id,name:b.name,currency:b.currency,role:b.owner_id===user.id?'owner':roleOf.get(b.id)||'viewer'};
  try{
   const r=await loadDashboard(sb,user.access,{id:b.id,name:b.name,currency:b.currency,time_zone:b.time_zone},demo);
   if(!r.ok)return{...row,error:'Could not load this business. Try again.'};
   const s=r.summary;
   return{...row,stillToCollect:s.totalPending,overdueAmount:s.totalOverdue,overdueCount:s.overdueDocuments.length,issuedThisMonth:s.totalRevenue,drafts:s.draftCount,needsReview:(s.balanceIssues||[]).length>0};
  }catch{return{...row,error:'Could not load this business. Try again.'}}
 });
 const totals=new Map();
 for(const r of rows){if(r.error)continue;const t=totals.get(r.currency)||{currency:r.currency,stillToCollect:0,overdueAmount:0,businessesWithOverdue:0};t.stillToCollect+=r.stillToCollect;t.overdueAmount+=r.overdueAmount;if(r.overdueCount>0)t.businessesWithOverdue++;totals.set(r.currency,t)}
 const round=n=>Math.round(n*100)/100;
 return json({demo,truncated,limit:OVERVIEW_LIMIT,businesses:rows,totals:[...totals.values()].map(t=>({...t,stillToCollect:round(t.stillToCollect),overdueAmount:round(t.overdueAmount)}))});
}
