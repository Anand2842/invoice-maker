export const DEFAULT_TIME_ZONE='Asia/Kolkata';
export function validTimeZone(value){
 if(typeof value!=='string'||value.length>100||(value!=='UTC'&&!/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value)))return false;
 try{new Intl.DateTimeFormat('en',{timeZone:value}).format(0);return true}catch{return false}
}
export function businessTimeZone(value){return validTimeZone(value)?value:DEFAULT_TIME_ZONE}
export function businessDate(date=new Date(),timeZone=DEFAULT_TIME_ZONE){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:businessTimeZone(timeZone),year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const value=key=>parts.find(part=>part.type===key).value;
 return `${value('year')}-${value('month')}-${value('day')}`;
}
export function timeZoneOptions(current=DEFAULT_TIME_ZONE){
 const available=typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):['Asia/Kolkata','Asia/Dubai','Asia/Singapore','Asia/Tokyo','Europe/London','Europe/Paris','America/New_York','America/Chicago','America/Los_Angeles','Australia/Sydney'];
 return [...new Set(['UTC',DEFAULT_TIME_ZONE,...available,...(validTimeZone(current)?[current]:[])])].sort();
}
