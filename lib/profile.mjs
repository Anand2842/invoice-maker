export const profileFields=['name','currency','logo_path','address','phone','email','gstin','pan','bank_name','bank_account','bank_ifsc','bank_upi','default_terms','default_notes','default_tax_rate','invoice_prefix','invoice_next_number','brand_color'];
export function validateProfile(input,business){
 const out={};for(const key of profileFields)if(Object.hasOwn(input,key))out[key]=input[key];
 if(!Object.keys(out).length)throw Error('No profile changes supplied');
 for(const [key,value] of Object.entries(out)){
  if(['default_tax_rate','invoice_next_number'].includes(key))continue;
  if(key==='logo_path'&&value===null)continue;
  if(typeof value!=='string')throw Error(key+' must be text');out[key]=value.trim();
  const max=['default_terms','default_notes'].includes(key)?5000:key==='address'?2000:500;
  if(out[key].length>max)throw Error(key+' is too long');
 }
 if(out.name!==undefined&&(!out.name||out.name.length>180))throw Error('Business name must have 1–180 characters');
 if(out.currency!==undefined&&!/^[A-Z]{3}$/.test(out.currency))throw Error('Use a three-letter currency');
 if(out.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))throw Error('Enter a valid business email');
 if(out.gstin&&!/^[0-9]{2}[A-Z0-9]{13}$/.test(out.gstin))throw Error('GSTIN must have 15 characters, beginning with two digits');
 if(out.pan&&!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(out.pan))throw Error('Enter a valid PAN format');
 if(out.bank_ifsc&&!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(out.bank_ifsc))throw Error('Enter a valid 11-character IFSC');
 if(out.bank_upi&&!/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(out.bank_upi))throw Error('Enter a valid UPI ID');
 if(out.invoice_prefix!==undefined&&!/^[A-Za-z0-9-]{1,20}$/.test(out.invoice_prefix))throw Error('Prefix must have 1–20 letters, digits or hyphens');
 if(out.brand_color!==undefined&&!/^#[0-9a-f]{6}$/i.test(out.brand_color))throw Error('Select a valid brand color');
 if(out.logo_path&&(!out.logo_path.startsWith(business+'/')||out.logo_path.includes('..')||!/^[a-zA-Z0-9/._-]+$/.test(out.logo_path)))throw Error('Logo must belong to this business');
 if(out.default_tax_rate!==undefined){out.default_tax_rate=Number(out.default_tax_rate);if(!Number.isFinite(out.default_tax_rate)||out.default_tax_rate<0||out.default_tax_rate>100)throw Error('Default tax rate must be between 0 and 100');}
 if(out.invoice_next_number!==undefined){out.invoice_next_number=Number(out.invoice_next_number);if(!Number.isSafeInteger(out.invoice_next_number)||out.invoice_next_number<1||out.invoice_next_number>999999998)throw Error('Next number must be a positive whole number below 999999999');}
 return out;
}
export function cloneDocument(data,date){
 const keys=['type','currency','seller','buyer','items','taxType','gstMode','notes','terms','customFields','shipping','transport','taxDetails','logo','template','brandColor'];
 const out=Object.fromEntries(keys.filter(k=>data[k]!==undefined).map(k=>[k,structuredClone(data[k])]));
 return{...out,number:'PENDING',date,dueDate:'',status:'draft'};
}
