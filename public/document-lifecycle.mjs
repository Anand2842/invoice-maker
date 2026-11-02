import{dateISO}from'./banking/model.mjs';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const statuses=['sent','paid','partially_paid'];
// A SQL guard binds managed metadata to its private immutable issue/cancel rows.
// Legacy cancellations have no invented date and remain explicitly excluded.
export function documentLifecycle(data){
 const meta=data?.lifecycle;if(meta==null)return{managed:false,issued:statuses.includes(data?.status),cancelledOn:null,origin:'legacy'};
 if(!meta||typeof meta!=='object'||Array.isArray(meta)||meta.version!==1||!uuid(meta.issueId)||!['issue','legacy-snapshot'].includes(meta.origin)||!statuses.includes(meta.issuedStatus)||dateISO(meta.issuedOn)!==data.date)throw Error('Invalid managed document issue metadata');
 let cancelledOn=null;if(data.status==='cancelled'){cancelledOn=dateISO(meta.cancelledOn);if(!uuid(meta.cancellationId)||cancelledOn<meta.issuedOn||typeof meta.reason!=='string'||!meta.reason.trim())throw Error('Invalid dated document cancellation')}
 else if(data.status!==meta.issuedStatus||meta.cancelledOn!=null)throw Error('Document status differs from its managed lifecycle');
 return{managed:true,issued:true,cancelledOn,origin:meta.origin,issueId:meta.issueId};
}
export function documentEffectiveAt(data,date){const lifecycle=documentLifecycle(data);return lifecycle.issued&&data.date<=date&&(!lifecycle.cancelledOn||lifecycle.cancelledOn>date)}
