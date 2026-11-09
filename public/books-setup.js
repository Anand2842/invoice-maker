// Turns on automatic books for a business: the standard chart of accounts, and posting of issued invoices and payments
// from a start date. Calling it is the owner's confirmation of the standard accounts and the start date, so it must only
// run after they click. Safe to run twice.
export const fiscalYearStart=iso=>{const[y,m]=iso.split('-').map(Number);return(m>=4?y:y-1)+'-04-01'};

export async function startBooks(api,{business,demo=false,start,today}){
 const post=(path,body)=>api(path,{method:'POST',body:JSON.stringify(body)});
 try{await post('/api/ledger',{action:'setup',business,demo,date:start})}catch(e){if(!/already|exists/i.test(e.message))throw e}
 const ledger=await api('/api/ledger?'+new URLSearchParams({business,demo:String(demo),from:start,to:today}));
 const acct=code=>(ledger.accounts||[]).find(a=>a.code===code)?.id;
 const accounts={receivable:acct('1100'),income:acct('4000'),tax:acct('2100'),cash:acct('1000'),rounding:acct('4900')};
 if(Object.values(accounts).some(v=>!v))throw Error('The standard accounts could not be found. Open Books to set them up.');
 try{await post('/api/accounting/sources',{business,demo,reviewed:true,date:start,accounts})}catch(e){if(!/already|exists|configured|immutable/i.test(e.message))throw e}
 return{ledger,acct};
}
export const booksOn=async(api,business,today,demo=false)=>{try{return Boolean((await api('/api/accounting/sources?'+new URLSearchParams({business,demo:String(demo),date:today}))).configured)}catch{return false}};
