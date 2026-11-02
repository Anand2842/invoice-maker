import{cashMinor,uuid}from'../public/cash/model.mjs';
export const mockRefundNotice='Mock provider simulation only. No actual refund, payment or funds movement occurs.';
export function simulateRefund(request,attempt){
 if(!uuid(request?.id)||request.demo!==true||!['cash','vendor-credit'].includes(request.source_kind)||!uuid(request.source_id)||typeof request.currency!=='string'||! /^[A-Z]{3}$/.test(request.currency)||!['success','failure','timeout-once','timeout-always'].includes(request.scenario)||!Number.isSafeInteger(attempt)||attempt<1||attempt>5)throw Error('Choose an immutable demo refund request and dispatch attempt');
 cashMinor(request.amount,{positive:true,command:true});
 const status=request.scenario==='failure'?'failed':request.scenario==='timeout-always'||request.scenario==='timeout-once'&&attempt===1?'timeout':'succeeded';
 return Object.freeze({providerMode:'mock',simulationOnly:true,fundsMovedByFolio:false,providerId:'mock-refund-'+request.id.toLowerCase(),idempotencyKey:request.id.toLowerCase(),status});
}
