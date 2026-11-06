import{folioProduct}from'./product-config.mjs';
import{mockGsp}from'./mock-gsp-provider.mjs';
// A future provider implements irn(payload, context) and ewayBill(payload, context).
export function gspProvider(mode=folioProduct.providerMode){if(mode==='mock')return mockGsp;throw Error('The configured GSP provider is unavailable')}
