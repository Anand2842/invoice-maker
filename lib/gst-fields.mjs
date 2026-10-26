export const GST_STATES=new Set(['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','26','27','29','30','31','32','33','34','35','36','37','38','97','99']);
export const GST_CATEGORIES=['taxable','zero-rated','nil-rated','exempt','non-gst'];
export const UQC=new Set(['BAG','BAL','BDL','BKL','BOU','BOX','BTL','BUN','CAN','CBM','CCM','CMS','CTN','DOZ','DRM','GGK','GMS','GRS','GYD','KGS','KLR','KME','LTR','MLT','MTR','MTS','NOS','PAC','PCS','PRS','QTL','ROL','SET','SQF','SQM','SQY','TBS','TGM','THD','TON','TUB','UGS','UNT','YDS','OTH','NA']);
export const validGstinFormat=value=>typeof value==='string'&&/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(value)&&GST_STATES.has(value.slice(0,2));
export function validateGstFields(data){
 const reporting=data.gstReporting;
 if(reporting!==undefined&&reporting!==null){
  if(typeof reporting!=='object'||Array.isArray(reporting))throw Error('GST reporting details must be an object');
  if(reporting.category&&!GST_CATEGORIES.includes(reporting.category))throw Error('Choose a valid GST supply classification');
  if(reporting.placeOfSupply&&!GST_STATES.has(reporting.placeOfSupply))throw Error('Choose a valid two-digit place-of-supply code');
 }
 for(const item of data.items||[])if(item.uqc&&!UQC.has(item.uqc))throw Error('Use a supported GST unit code, for example NOS, KGS, or NA for services');
}
