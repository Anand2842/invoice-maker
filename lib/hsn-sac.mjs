import catalog from '../public/data/hsn-sac.json' with {type:'json'};
import {validHsnFormat,searchHsn} from '../public/hsn-search.js';
export{validHsnFormat};export const hsnCatalog=catalog;
export const findHsn=code=>catalog.entries.find(r=>r.code===String(code))||null;
export const lookupHsn=query=>searchHsn(catalog.entries,query);
