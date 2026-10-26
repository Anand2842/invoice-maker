// Keep signed numeric amounts usable in spreadsheets; neutralize formula-like text.
export function csvCell(value){
 const numeric=typeof value==='number'&&Number.isFinite(value);
 let text=typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'');
 if(!numeric&&/^[\t\r\n ]*[=+@-]/.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
}
export function csv(rows){
 if(!rows.length)return '';
 const keys=[...new Set(rows.flatMap(Object.keys))];
 return[keys.map(csvCell).join(','),...rows.map(row=>keys.map(key=>csvCell(row[key])).join(','))].join('\r\n');
}
