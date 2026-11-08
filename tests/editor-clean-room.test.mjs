import test from 'node:test';
import assert from 'node:assert/strict';
import{readdir,readFile}from'node:fs/promises';

// The new editor is written from scratch. Nothing from the captured Refrens editor may appear in it.
const FORBIDDEN=/refrens|disco-|react-datepicker|toastui|css-[0-9a-z]{6}-|LineItems_|BusinessDetails_/i;

test('public/editor contains none of the captured editor\'s names, classes or libraries',async()=>{
 const dir=new URL('../public/editor/',import.meta.url);
 const files=(await readdir(dir)).filter(f=>/\.(js|mjs|css|html)$/.test(f));
 assert.ok(files.length>=5,'the new editor files exist');
 for(const f of files){const text=await readFile(new URL(f,dir),'utf8');const hit=text.match(FORBIDDEN);assert.equal(hit,null,f+' contains '+(hit&&hit[0]))}
});

test('the PDF engine no longer exposes a Refrens-named global',async()=>{
 const text=await readFile(new URL('../public/document-export.js',import.meta.url),'utf8');
 assert.ok(!/RefrensDocumentExport/.test(text));
});
