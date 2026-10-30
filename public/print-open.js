import {api} from '/workspace-shell.js';
export async function openPrint(path){
 const url=new URL(path,location.origin);
 if(url.origin!==location.origin||!['/api/payments','/api/reports/statement'].includes(url.pathname)||url.searchParams.get('format')!=='print')throw Error('Choose a supported document to print.');
 const popup=window.open('about:blank','_blank');if(!popup)throw Error('Allow a new tab to open the print view.');popup.opener=null;
 try{
  let response=await fetch(url,{headers:{Accept:'text/html'}});
  if(response.status===401){await api('/api/auth',{method:'POST',body:JSON.stringify({action:'refresh'})});response=await fetch(url,{headers:{Accept:'text/html'}})}
  if(!response.ok){let result;try{result=await response.json()}catch{}throw Error(result?.error||'The print view could not be opened.')}
  if(!response.headers.get('Content-Type')?.includes('text/html'))throw Error('The print response was incomplete. Try again.');
  if(popup.closed)throw Error('The print tab was closed. Open the print view again.');
  popup.location.replace(url.href);
 }catch(error){popup.close();throw error}
}
