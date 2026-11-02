import{minor}from'./model.mjs';
export function validateSourceReport(data,{business,demo,date}){
 if(!data||data.businessId!==business.toLowerCase()||data.demo!==demo||data.asOf!==date||typeof data.configured!=='boolean'||!Array.isArray(data.accounts)||data.reviewStatus!=='unreviewed'||typeof data.canManage!=='boolean')throw Error('Source reconciliation context was incomplete');
 if(!data.configured)return data;
 if(data.config?.business_id!==business.toLowerCase()||data.config.demo!==demo||data.config.currency!==data.currency||!Array.isArray(data.controls)||data.controls.length!==8||new Set(data.controls.map(c=>c.code)).size!==8||typeof data.arithmeticAgrees!=='boolean'||!Array.isArray(data.limitations)||!data.limitations.every(v=>typeof v==='string'))throw Error('Source reconciliation was incomplete');
 let agrees=true;for(const control of data.controls){if(!['AR','AP','CASH','TAX','ITC','CUSTOMER_ADVANCE','VENDOR_ADVANCE','VENDOR_CREDIT'].includes(control.code)||!['expected','ledger','difference'].every(k=>typeof control[k]==='string'))throw Error('Invalid source control');const expected=minor(control.expected,{signed:true,limit:false}),actual=minor(control.ledger,{signed:true,limit:false}),difference=minor(control.difference,{signed:true,limit:false});if(actual-expected!==difference)throw Error('Source control did not reconcile');agrees=agrees&&difference===0n}
 for(const key of['unpostedManagedDocuments','legacyDocumentsNeedingOpeningReview','foreignDocumentsNeedingFxReview','unpostedExpenses']){if(!Number.isSafeInteger(data[key])||data[key]<0)throw Error('Incomplete source review counts');agrees=agrees&&data[key]===0}
 if(agrees!==data.arithmeticAgrees)throw Error('Source agreement status was inconsistent');return data;
}
