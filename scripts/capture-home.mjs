import { chromium } from '/Users/raunakpatel/.npm/_npx/af752b90495482d7/node_modules/playwright-core/index.mjs';
import fs from 'node:fs/promises';
import {SourceAssets,mirrorPage,revealPage} from './mirror-source.mjs';
const root='/Users/raunakpatel/Downloads/bill/folio';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const assets=new SourceAssets(root+'/dist/assets/ref','/assets/ref');
const captures={};
for(const [layout,width] of [['desktop',1440],['tablet',1024],['mobile',390]]) {
 const page=await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:1});
 await page.goto('https://www.refrens.com/',{waitUntil:'domcontentloaded'});
 await page.waitForTimeout(2000);await revealPage(page);
 await page.screenshot({path:`${root}/artifacts/source/reference-${layout}.png`,fullPage:true});
 captures[layout]=await mirrorPage(page,{assets});
 await fs.mkdir(root+'/dist/layouts',{recursive:true});
 await fs.writeFile(`${root}/dist/layouts/${layout}.html`,captures[layout].body);
 await fs.writeFile(`${root}/artifacts/source/capture-${layout}.html`,captures[layout].html);
 console.log(layout,'captured',captures[layout].html.length,'bytes');
 await page.close();
}
const extraStyles=[];
const styles=new Set();
for(const capture of Object.values(captures))for(const match of capture.head.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)){
 if(styles.has(match[2]))continue;styles.add(match[2]);extraStyles.push(`<style${match[1]}>${match[2]}</style>`)
}
let head=captures.desktop.head.replace(/<style[^>]*>[\s\S]*?<\/style>/g,'').replace(/<meta[^>]*name="framer-search-index[^>]*>/g,'');
head+='\n'+extraStyles.join('\n')+'\n<link rel="stylesheet" href="/mirror-controls.css">';
await fs.writeFile(root+'/dist/index.html','<!doctype html>\n<html lang="en-IN"><head>'+head+'</head><body data-layout="desktop">'+captures.desktop.body+'<script type="module" src="/mirror.js"></script><script type="module" src="/layout.js"></script></body></html>');
await fs.writeFile(root+'/artifacts/source/asset-failures.json',JSON.stringify(assets.failures,null,2));
console.log('assets',assets.entries.size,'failures',assets.failures.length);
await browser.close();
