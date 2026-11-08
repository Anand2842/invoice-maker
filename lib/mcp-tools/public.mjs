import {z} from 'zod/v4';
import {hsnCatalog} from '../hsn-sac.mjs';
import {searchHsn} from '../../public/hsn-search.js';
import {validGstinFormat} from '../gst-fields.mjs';
import {validGstinChecksum} from '../gst-portal.mjs';
import {calculate} from '../../public/document-export.js';

const sample=z.boolean().default(false).describe('Sample context; public calculations never access saved records.');
const amount=z.string().regex(/^(0|[1-9]\d{0,9})\.\d{2}$/).describe('Non-negative amount with exactly two decimal places, at most 9999999999.99.');
const money=n=>{const v=BigInt(n);return `${v/100n}.${String(v%100n).padStart(2,'0')}`};
const states=['','Jammu and Kashmir','Himachal Pradesh','Punjab','Chandigarh','Uttarakhand','Haryana','Delhi','Rajasthan','Uttar Pradesh','Bihar','Sikkim','Arunachal Pradesh','Nagaland','Manipur','Mizoram','Tripura','Meghalaya','Assam','West Bengal','Jharkhand','Odisha','Chhattisgarh','Madhya Pradesh','Gujarat',null,'Dadra and Nagar Haveli and Daman and Diu','Maharashtra',null,'Karnataka','Goa','Lakshadweep','Kerala','Tamil Nadu','Puducherry','Andaman and Nicobar Islands','Telangana','Andhra Pradesh','Ladakh'];
const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
export const publicTools={
 find_hsn_code:{description:'Find HSN/SAC reference codes; any suggested GST rate requires applicability review.',inputSchema:z.object({query:z.string().trim().min(1).max(120),limit:z.number().int().min(1).max(20).default(20),sample}).strict(),run:({query,limit})=>({items:searchHsn(hsnCatalog.entries,query,limit).map(r=>({code:r.code,description:r.description,type:r.type,typical_gst_rate:r.gstRate??null})),next_cursor:null,reference_version:hsnCatalog.version,notice:'Reference suggestions, not a classification or tax-rate ruling.'})},
 check_gstin:{description:'Check GSTIN format, state code and checksum locally; does not verify registration or ownership.',inputSchema:z.object({gstin:z.string().max(500),sample}).strict(),run:({gstin})=>{const value=gstin.trim().toUpperCase(),format=validGstinFormat(value),valid=format&&validGstinChecksum(value);return{valid,reason:!format?'GSTIN must have a recognised state code and valid 15-character format.':!valid?'GSTIN checksum does not match.':'Format and checksum match; registration and ownership have not been verified.',state:format?(states[Number(value.slice(0,2))]||({'97':'Other Territory','99':'Centre Jurisdiction'})[value.slice(0,2)]):null}}},
 calculate_gst:{description:'Calculate GST in INR from an explicit tax rate and supply-state choice, without saving anything.',inputSchema:z.object({amount,rate:z.number().min(0).max(100).multipleOf(0.01),inclusive:z.boolean().default(false),same_state:z.boolean(),currency:z.literal('INR').default('INR'),sample}).strict(),run:({amount,rate,inclusive,same_state,currency})=>{
  let totals;
  if(!inclusive){totals=calculate({type:'invoice',currency,taxType:'GST',gstMode:same_state?'split':'igst',date:'2000-01-01',seller:{name:'Calculation'},buyer:{name:'Calculation'},items:[{name:'Calculation',quantity:1,rate:amount,taxRate:rate}]}).totals.minor;}
  else{const total=BigInt(amount.replace('.','')),denominator=10000n+BigInt(Math.round(rate*100));const taxable=(total*10000n+denominator/2n)/denominator,tax=total-taxable,cgst=same_state?tax/2n:0n;totals={taxable,tax,cgst,sgst:same_state?tax-cgst:0n,igst:same_state?0n:tax,total};}
  return{currency,...Object.fromEntries(['taxable','cgst','sgst','igst','tax','total'].map(k=>[k,money(totals[k])])),notice:'Calculation only. Confirm the rate and place of supply before using it on a document.'};
 }}
};
export function registerPublicTools(server,{log=()=>{}}={}){for(const[name,tool]of Object.entries(publicTools))server.registerTool(name,{description:tool.description,inputSchema:tool.inputSchema,annotations},async input=>{const start=performance.now();let outcome='ok';try{const data=tool.run(input);return{content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data}}catch{outcome='error';return{isError:true,content:[{type:'text',text:'The calculation could not be completed. Check the input values.'}]}}finally{log({tool:name,user:null,business:null,outcome,duration_ms:Math.round(performance.now()-start)})}})}
