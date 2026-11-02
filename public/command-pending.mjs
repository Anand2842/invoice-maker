// Persist before sending. A rejection after a lost response cannot disprove a prior commit.
export function writePending(storage,key,value){
 const raw=JSON.stringify(value);storage.setItem(key,raw);
 if(storage.getItem(key)!==raw)throw Error('Retry storage could not be verified. Nothing was sent.');
 return value;
}
export function clearPending(storage,key){
 storage.removeItem(key);
 if(storage.getItem(key)!==null)throw Error('The confirmed retry request could not be cleared.');
}
export function readPending(storage,key,context,validate){
 const raw=storage.getItem(key);if(raw===null)return null;
 const saved=JSON.parse(raw);
 if(saved?.version!==1||saved.user!==context.user||typeof saved.uncertain!=='boolean'||saved.payload?.business!==context.business||saved.payload?.demo!==context.demo)throw Error('The saved request context needs review.');
 validate(saved.payload);return saved;
}
export function retainPending(wasUncertain,status){return wasUncertain||!(status>=400&&status<500)}
