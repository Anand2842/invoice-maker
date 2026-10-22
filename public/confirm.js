export function confirmAction(message){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Confirm action');
  dialog.style.cssText='max-width:440px;padding:24px;border:1px solid #ddd;border-radius:12px;font:16px system-ui';
  const text=document.createElement('p');text.textContent=message;
  const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.autofocus=true;
  const yes=document.createElement('button');yes.textContent='Continue';yes.style.marginLeft='12px';
  let accepted=false;cancel.onclick=()=>dialog.close();yes.onclick=()=>{accepted=true;dialog.close()};
  dialog.onclose=()=>{dialog.remove();resolve(accepted)};dialog.append(text,cancel,yes);document.body.append(dialog);dialog.showModal();
 });
}
