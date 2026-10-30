import{ledgerCommand}from'./model.mjs';
export function readLedgerPending(storage,key,context){const raw=storage.getItem(key);if(!raw)return null;const saved=JSON.parse(raw);if(saved.version!==1||saved.user!==context.user||saved.command?.business!==context.business||saved.command?.demo!==context.demo||typeof saved.uncertain!=='boolean'||!['post','reverse'].includes(saved.command?.action))throw Error('The saved ledger command context needs review.');ledgerCommand(saved.command);return saved}
export function writeLedgerPending(storage,key,saved){const serialized=JSON.stringify(saved);storage.setItem(key,serialized);if(storage.getItem(key)!==serialized)throw Error('Ledger retry storage could not be verified.');return saved}
export function clearLedgerPending(storage,key){storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('The confirmed ledger retry command could not be cleared.');}
// A later rejection cannot prove that an earlier uncertain request failed to commit.
export function keepLedgerPending(wasUncertain,status){return wasUncertain||!(status>=400&&status<500)}
