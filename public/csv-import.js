// CSV import mapping shared by the import page (preview) and the server (authoritative validation).
// Accepts inbill exports and common spreadsheet/Tally column names.
export const IMPORT_COLLECTIONS=['clients','vendors','items'];
const party={name:['name','clientname','vendorname','customername','suppliername','partyname','ledgername','company','companyname','displayname'],email:['email','emailaddress','emailid'],phone:['phone','mobile','phonenumber','mobilenumber','mobileno','contactnumber'],address:['address','mailingaddress','billingaddress','address1'],gstin:['gstin','gstinuin','gstnumber','gst','taxid']};
export const IMPORT_FIELDS={clients:party,vendors:party,items:{name:['name','itemname','stockitem','stockitemname','product','productname'],sku:['sku','itemcode','code','partno'],rate:['rate','unitprice','price','sellingprice','salesprice'],quantity:['quantity','qty','openingqty','openingquantity'],reorderLevel:['reorderlevel','reorder','minstock','minimumstock']}};
const NUMERIC=new Set(['rate','quantity','reorderLevel']);
export const MAX_IMPORT_ROWS=2000;

// RFC 4180: quoted fields, doubled quotes, CRLF/LF, optional UTF-8 BOM.
export function parseCsv(text){
 const rows=[];let row=[],field='',quoted=false,i=0;text=String(text).replace(/^﻿/,'');
 for(;i<text.length;i++){const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++}else quoted=false}else field+=c}
  else if(c==='"'&&field==='')quoted=true;
  else if(c===',')row.push(field),field='';
  else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field=''}
  else field+=c}
 if(quoted)throw Error('The file has an unclosed quote');
 if(field!==''||row.length)row.push(field),rows.push(row);
 return rows.filter(r=>r.some(v=>v.trim()!==''));
}
const key=h=>String(h).toLowerCase().replace(/[^a-z0-9]/g,'');
// Undo the formula guard inbill adds to exported text cells ('=SUM… becomes =SUM… text again; it is stored, never evaluated).
const clean=v=>{const t=String(v??'').trim();return /^'[=+@-]/.test(t)?t.slice(1):t};

export function mapImport(collection,rows){
 const fields=IMPORT_FIELDS[collection];if(!fields)throw Error('Choose clients, vendors or items');
 if(rows.length<2)throw Error('The file needs a header row and at least one record');
 if(rows.length-1>MAX_IMPORT_ROWS)throw Error(`Import at most ${MAX_IMPORT_ROWS} records at a time`);
 const header=rows[0].map(key),columns={},unknown=[];
 header.forEach((h,i)=>{const field=Object.keys(fields).find(f=>fields[f].includes(h));if(field&&!(field in columns))columns[field]=i;else if(!field&&rows[0][i].trim())unknown.push(rows[0][i].trim())});
 if(!('name' in columns))throw Error('Add a Name column (for example "Name", "Party name" or "Item name")');
 const records=rows.slice(1).map((r,n)=>{const data={};for(const [field,i] of Object.entries(columns)){let v=clean(r[i]);if(NUMERIC.has(field)){v=v.replace(/[,₹\s]/g,'').replace(/^rs\.?/i,'');data[field]=v===''?0:v}else if(v)data[field]=field==='gstin'?v.toUpperCase():v}
  if(collection==='items')for(const f of NUMERIC)if(!(f in data))data[f]=0;
  return{line:n+2,data}});
 return{records,columns:Object.keys(columns),unknown};
}
