import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream} from 'pdf-lib';
import {build, buildWithImages} from '../public/document-export.js';

const doc={type:'invoice',number:'INV-001',date:'2026-10-20',currency:'INR',seller:{name:'Acme Demo'},buyer:{name:'Zürich – ‘Studio’ €'},items:[{name:'Design',quantity:2,rate:150,taxRate:18}],taxType:'GST',gstMode:'split'};
const loadFonts=async()=>({regular:new Uint8Array(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf',import.meta.url))),bold:new Uint8Array(await readFile(new URL('../public/fonts/NotoSans-Bold.ttf',import.meta.url)))});
const name=s=>PDFName.of(s);
const lookup=(pdf,dict,key)=>pdf.context.lookup(dict.get(name(key)));
function decoded(stream){assert.ok(stream instanceof PDFRawStream);const filter=stream.dict.get(name('Filter'));return filter?.toString()==='/FlateDecode'?inflateSync(stream.contents):stream.contents;}
function sfnt(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), tables=new Map(), count=view.getUint16(4);
 for(let i=0;i<count;i++){const p=12+i*16,tag=String.fromCharCode(...bytes.subarray(p,p+4)),offset=view.getUint32(p+8),length=view.getUint32(p+12);assert.ok(offset+length<=bytes.length,`${tag} table is in bounds`);tables.set(tag,{offset,length,checksum:view.getUint32(p+4)});}
 const table=tag=>{const t=tables.get(tag);assert.ok(t,`missing ${tag}`);return t.offset;};
 const head=table('head'),maxp=table('maxp'),hhea=table('hhea'),loca=table('loca'),glyf=table('glyf'),hmtx=table('hmtx');
 const numGlyphs=view.getUint16(maxp+4),longLoca=view.getInt16(head+50)===1,metrics=view.getUint16(hhea+34),units=view.getUint16(head+18);
 function glyphOffset(id){return longLoca?view.getUint32(loca+4*id):view.getUint16(loca+2*id)*2;}
 function advance(id){return view.getUint16(hmtx+4*Math.min(id,metrics-1));}
 function glyph(cp){
  const c=table('cmap'),n=view.getUint16(c+2);let chosen=0,fmt=0;
  for(let i=0;i<n;i++){const pos=c+4+8*i,sub=c+view.getUint32(pos+4),f=view.getUint16(sub);if(f===12){chosen=sub;fmt=12;break;}if(f===4){chosen=sub;fmt=4;}}
  if(fmt===12){let lo=0,hi=view.getUint32(chosen+12)-1;while(lo<=hi){const mid=(lo+hi)>>1,p=chosen+16+mid*12,start=view.getUint32(p),end=view.getUint32(p+4);if(cp<start)hi=mid-1;else if(cp>end)lo=mid+1;else return view.getUint32(p+8)+cp-start;}return 0;}
  assert.equal(fmt,4);const segs=view.getUint16(chosen+6)/2,end=chosen+14,start=end+2*segs+2,delta=start+2*segs,range=delta+2*segs;
  for(let i=0;i<segs;i++)if(cp<=view.getUint16(end+2*i)){if(cp<view.getUint16(start+2*i))return 0;const d=view.getInt16(delta+2*i),r=view.getUint16(range+2*i);if(!r)return(cp+d)&65535;const p=range+2*i+r+2*(cp-view.getUint16(start+2*i)),g=view.getUint16(p);return g?(g+d)&65535:0;}return 0;
 }
 function components(id,out=new Set()){
  if(out.has(id))return out;out.add(id);const begin=glyf+glyphOffset(id),end=glyf+glyphOffset(id+1);if(end-begin<10||view.getInt16(begin)>=0)return out;
  let p=begin+10,flags;do{flags=view.getUint16(p);const child=view.getUint16(p+2);components(child,out);p+=4+(flags&1?4:2)+(flags&8?2:flags&64?4:flags&128?8:0);}while(flags&32);return out;
 }
 return {bytes,view,tables,numGlyphs,units,glyph,glyphOffset,advance,components};
}
function checksum(bytes){let sum=0;for(let i=0;i<bytes.length;i+=4)sum=(sum+(((bytes[i]||0)*0x1000000)+((bytes[i+1]||0)<<16)+((bytes[i+2]||0)<<8)+(bytes[i+3]||0)))>>>0;return sum;}
function checkSfnt(font,original,used){
 assert.equal(checksum(font.bytes),0xb1b0afba,'head.checkSumAdjustment');
 for(const [tag,t]of font.tables){const bytes=font.bytes.slice(t.offset,t.offset+t.length);if(tag==='head')bytes.fill(0,8,12);assert.equal(checksum(bytes),t.checksum,`${tag} checksum`);}
 assert.equal(font.numGlyphs,original.numGlyphs,'glyph IDs remain stable');
 const allowed=new Set([0]);for(const g of used)original.components(g,allowed);
 for(let i=0;i<font.numGlyphs;i++){
  const length=font.glyphOffset(i+1)-font.glyphOffset(i),before=original.glyphOffset(i+1)-original.glyphOffset(i);
  if(!allowed.has(i))assert.equal(length,0,`unused glyph ${i} removed`);
  else if(before)assert.ok(length>0,`used glyph or component ${i} retained`);
 }
}
function widths(pdf,descendant){
 const array=lookup(pdf,descendant,'W');assert.ok(array instanceof PDFArray);const a=array.asArray().map(x=>pdf.context.lookup(x)),out=new Map();
 for(let i=0;i<a.length;){const start=Number(a[i++].toString()),next=a[i++];if(next instanceof PDFArray){next.asArray().forEach((v,j)=>out.set(start+j,Number(pdf.context.lookup(v).toString())));}else{const end=Number(next.toString()),width=Number(a[i++].toString());for(let g=start;g<=end;g++)out.set(g,width);}}return out;
}

test('WinAnsi output is byte-for-byte unchanged',async()=>{
 const expected='ec6065eda6696d48cb85763e1e7d03cc6ea4febb9bd53eaf2bbaf68e4d2c91f9';
 for(const result of [build(doc),await buildWithImages(doc,{loadFonts:()=>{throw Error('WinAnsi must not load fonts');}})])assert.equal(createHash('sha256').update(result.bytes).digest('hex'),expected);
});

test('Unicode embeds searchable, correctly subsetted regular and bold fonts with true widths',async()=>{
 const sample='Łódź Ελληνικά Москва ₹ ō ș ğ Việt';
 const result=await buildWithImages({...doc,seller:{name:sample},buyer:{name:sample},items:[{name:sample,description:sample,quantity:2,rate:150,taxRate:18}]},{loadFonts});
 assert.ok(result.bytes.length<=120000,`one-page invoice is ${result.bytes.length} bytes`);assert.equal(result.pageCount,1);assert.equal(result.totals.total,354);
 const pdf=await PDFDocument.load(result.bytes),fonts=pdf.context.enumerateIndirectObjects().map(([,v])=>v).filter(v=>v instanceof PDFDict&&v.get(name('Subtype'))===name('Type0'));
 assert.equal(fonts.length,2,'regular and bold Type0 fonts');
 const originals=await loadFonts();
 for(const font of fonts){
  assert.equal(font.get(name('Encoding')),name('Identity-H'));const descendants=lookup(pdf,font,'DescendantFonts');const descendant=pdf.context.lookup(descendants.get(0));
  assert.equal(descendant.get(name('Subtype')),name('CIDFontType2'));assert.equal(descendant.get(name('CIDToGIDMap')),name('Identity'));
  const descriptor=lookup(pdf,descendant,'FontDescriptor');for(const key of ['Flags','FontBBox','Ascent','Descent','CapHeight','ItalicAngle','StemV'])assert.ok(descriptor.has(name(key)),key);
  const embedded=lookup(pdf,descriptor,'FontFile2');assert.equal(embedded.dict.get(name('Filter')),name('FlateDecode'));
  const subset=sfnt(new Uint8Array(decoded(embedded)));const bold=font.get(name('BaseFont')).toString().toLowerCase().includes('bold');const original=sfnt(originals[bold?'bold':'regular']);
  const cmap=Buffer.from(decoded(lookup(pdf,font,'ToUnicode'))).toString('ascii');const available=widths(pdf,descendant),used=[];
  for(const ch of new Set(sample)){
   const cp=ch.codePointAt(0),gid=original.glyph(cp);assert.ok(gid,`${ch} covered by font`);used.push(gid);
   assert.match(cmap,new RegExp(`<${gid.toString(16).padStart(4,'0')}>\\s*<${cp.toString(16).padStart(4,'0')}>`,'i'),`ToUnicode for ${ch}`);
   assert.equal(available.get(gid),Math.round(original.advance(gid)*1000/original.units),`width for ${ch}`);
  }
  // Many other labels are rendered as well; collect their glyphs from the ToUnicode CMap.
  for(const match of cmap.matchAll(/<([0-9a-f]{4})>\s*<([0-9a-f]{4,8})>/gi))used.push(parseInt(match[1],16));
  checkSfnt(subset,original,used);
 }
 const streams=pdf.context.enumerateIndirectObjects().map(([,v])=>v).filter(v=>v instanceof PDFRawStream&&v.dict.get(name('Filter'))===name('FlateDecode'));
 assert.ok(streams.length>=4,'font and page content streams use Flate compression');
});

for(const [label,text] of [['Devanagari','नमस्ते'],['Bengali','বাংলা'],['Tamil','தமிழ்'],['Telugu','తెలుగు'],['Gujarati','ગુજરાતી'],['Gurmukhi','ਪੰਜਾਬੀ'],['Kannada','ಕನ್ನಡ'],['Malayalam','മലയാളം'],['Odia','ଓଡ଼ିଆ'],['Arabic','العربية'],['Hebrew','עברית'],['Thai','ไทย'],['CJK','日本語'],['emoji','😀']])test(`unsupported ${label} directs the user to browser print`,async()=>{
 await assert.rejects(buildWithImages({...doc,buyer:{name:text}},{loadFonts}),error=>{assert.match(error.message,/Print\s*\/\s*Save as PDF/i);assert.match(error.message,new RegExp(label,'i'));return true;});
});

test('Unicode wrapping and right alignment use the embedded font advances',async()=>{
 const original=sfnt((await loadFonts()).bold), word='Ł'.repeat(70), amount='INR 300.00';
 const result=await buildWithImages({...doc,items:[{name:word,quantity:2,rate:150,taxRate:18}]},{loadFonts});
 const pdf=await PDFDocument.load(result.bytes),contents=pdf.context.lookup(pdf.getPages()[0].node.get(name('Contents')));
 const stream=contents instanceof PDFArray?contents.asArray().map(x=>Buffer.from(decoded(pdf.context.lookup(x))).toString('ascii')).join('\n'):Buffer.from(decoded(contents)).toString('ascii');
 const glyph=original.glyph('Ł'.codePointAt(0)).toString(16).padStart(4,'0');
 const runs=[...stream.matchAll(/BT \/F2 9 Tf [^\n]*? 1 0 0 1 ([\d.]+) ([\d.]+) Tm <([0-9a-f]+)> Tj ET/gi)];
 const repeated=runs.filter(m=>m[3].toLowerCase().match(new RegExp(`^(?:${glyph})+$`,'i')));
 const perLine=Math.floor(207/(Math.round(original.advance(original.glyph('Ł'.codePointAt(0)))*1000/original.units)*9/1000));
 const expected=[];for(let left=70;left>0;left-=perLine)expected.push(Math.min(left,perLine));
 assert.deepEqual(repeated.map(m=>m[3].length/4),expected);
 assert.ok(repeated.every(m=>Number(m[1])===70));
 const amountHex=[...amount].map(c=>original.glyph(c.codePointAt(0)).toString(16).padStart(4,'0')).join('');
 const amountRun=runs.find(m=>m[3].toLowerCase()===amountHex);assert.ok(amountRun,'pre-tax amount is drawn');
 const w=[...amount].reduce((sum,c)=>sum+Math.round(original.advance(original.glyph(c.codePointAt(0)))*1000/original.units),0)*9/1000;
 assert.ok(Math.abs(Number(amountRun[1])+w-(595.28-44-8))<0.002,'amount aligns at the right table edge');
});

const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
test('Unicode survives artwork embedding in the async server-compatible path',async()=>{
 const result=await buildWithImages({...doc,buyer:{name:'Москва'},logo:pixel,signature:pixel},{loadFonts});
 const pdf=await PDFDocument.load(result.bytes),objects=pdf.context.enumerateIndirectObjects().map(([,value])=>value);
 assert.ok(objects.some(value=>value instanceof PDFDict&&value.get(name('Subtype'))===name('Type0')));
 assert.equal(objects.filter(value=>value instanceof PDFRawStream&&value.dict.get(name('Subtype'))===name('Image')).length>=2,true);
 assert.deepEqual(result.warnings,[]);
});

test('missing font glyph reports its script and the print fallback',async()=>{
 await assert.rejects(buildWithImages({...doc,buyer:{name:'ᚠ'}},{loadFonts}),/Runic.*Print \/ Save as PDF/i);
});
