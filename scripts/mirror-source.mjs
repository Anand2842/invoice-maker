import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/** Download public presentation assets. Runtime/service scripts are excluded. */
export class SourceAssets {
  constructor(directory, prefix) {
    this.directory = directory;
    this.prefix = prefix.replace(/\/$/, '');
    this.entries = new Map();
    this.failures = [];
    this.active = 0;
    this.queue = [];
  }
  async slot() { if(this.active >= 8) await new Promise(resolve => this.queue.push(resolve)); this.active++; }
  release() {this.active--;this.queue.shift()?.();}
  async local(url) {
    if(!/^https?:\/\//i.test(url)) return url;
    if(this.entries.has(url)) return this.entries.get(url);
    const promise = this.download(url);
    this.entries.set(url,promise);
    return promise;
  }
  async download(url) {
    await this.slot();
    let held = true;
    try {
      const parsed = new URL(url);
      let extension = path.extname(parsed.pathname).toLowerCase();
      if(!/^\.[a-z0-9]{1,6}$/.test(extension)) extension = '.bin';
      if(parsed.hostname==='fonts.googleapis.com') extension='.css';
      const file = crypto.createHash('sha256').update(url).digest('hex').slice(0,20)+extension;
      await fs.mkdir(this.directory,{recursive:true});
      const destination = path.join(this.directory,file);
      try {await fs.access(destination);return `${this.prefix}/${file}`;} catch {}
      const response = await fetch(url,{signal:AbortSignal.timeout(30000)});
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      let bytes = Buffer.from(await response.arrayBuffer());
      this.release(); held = false;
      if(extension === '.css') bytes = Buffer.from(await this.css(bytes.toString(),url));
      await fs.writeFile(destination,bytes);
      return `${this.prefix}/${file}`;
    } catch(error) {
      this.failures.push({url,error:error.message});
      return url;
    } finally {if(held)this.release();}
  }
  async css(css,base) {
    const matches=[...css.matchAll(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/g)];
    const replacements=await Promise.all(matches.map(async match=>{
      if(/^(data:|#|%23)/i.test(match[2]))return null;
      if(match[2].startsWith(this.prefix+'/'))return null;
      let url;try{url=new URL(match[2],base).href}catch{return null}
      return [match[0],`url("${await this.local(url)}")`];
    }));
    for(const pair of replacements)if(pair)css=css.replaceAll(pair[0],pair[1]);
    return css;
  }
}

export async function mirrorPage(page,{assets,base=page.url(),outputFile}={}) {
  const snapshot=await page.evaluate(()=>{
    const clone=document.documentElement.cloneNode(true);
    const originals=[...document.querySelectorAll('img')];
    clone.querySelectorAll('img').forEach((image,index)=>{
      const original=originals[index];
      const selected=original.currentSrc||original.src;
      image.setAttribute('src',selected);
      // These embedded cards use the density-corrected intrinsic image width.
      // Keep the selected source candidate's descriptor and original sizes so
      // localizing the image does not shrink the settled card after it loads.
      const candidate=original.closest('.rf-ai-section')&&original.srcset
        .split(',').map(value=>value.trim().split(/\s+/))
        .find(([url])=>new URL(url,document.baseURI).href===selected);
      if(candidate)image.setAttribute('srcset',[selected,...candidate.slice(1)].join(' '));
      else {image.removeAttribute('srcset');image.removeAttribute('sizes');}
      image.setAttribute('loading','eager');
    });
    const styles=[...document.querySelectorAll('style')];
    clone.querySelectorAll('style').forEach((style,index)=>{
      try {if(!styles[index].textContent.trim())style.textContent=[...styles[index].sheet.cssRules].map(rule=>rule.cssText).join('\n');}catch{}
    });
    clone.querySelectorAll('script,noscript,base,link[rel="modulepreload"],link[rel="preload"][as="script"],link[rel="preconnect"],link[rel="dns-prefetch"],#__framer-editorbar').forEach(el=>el.remove());
    clone.querySelectorAll('[data-framer-hydrate-v2]').forEach(el=>el.removeAttribute('data-framer-hydrate-v2'));
    clone.querySelectorAll('*').forEach(el=>{
      for(const attr of [...el.attributes])if(attr.name.toLowerCase().startsWith('on')||attr.name==='integrity')el.removeAttribute(attr.name);
    });
    clone.querySelectorAll('iframe').forEach(el=>{if(!el.src.includes('youtube.com')&&!el.src.includes('vimeo.com'))el.remove()});
    clone.querySelectorAll('a[href]').forEach(el=>{
      if(/^javascript:/i.test(el.getAttribute('href')))el.setAttribute('href','#');
      else el.setAttribute('href',new URL(el.getAttribute('href'),location.href).href);
    });
    return {head:clone.querySelector('head').innerHTML,body:clone.querySelector('body').innerHTML,html:clone.outerHTML};
  });
  // The captured document is parsed locally without running its scripts.
  // Parse in a detached context with all requests blocked.
  const scratchContext=await page.context().browser().newContext();
  const scratch=await scratchContext.newPage();
  await scratch.route('**/*',route=>route.abort());
  await scratch.setContent(snapshot.html);
  const urls=await scratch.evaluate(()=>{
    const list=[];
    document.querySelectorAll('img[src],video[poster],video[src],source[src],link[rel="icon"][href],link[rel="apple-touch-icon"][href],link[rel="stylesheet"][href]').forEach(el=>{
      for(const attr of ['src','poster','href'])if(el.hasAttribute(attr))list.push(el.getAttribute(attr));
    });return [...new Set(list)];
  });
  const mappings=await Promise.all(urls.map(async url=>[url,await assets.local(new URL(url,base).href)]));
  await scratch.evaluate(mappings=>{
    const map=new Map(mappings);
    document.querySelectorAll('img,video,source,link').forEach(el=>{
      for(const attr of ['src','poster','href']){const value=el.getAttribute(attr);if(map.has(value))el.setAttribute(attr,map.get(value));}
    });
    document.querySelectorAll('.rf-ai-section img[srcset]').forEach(image=>{
      image.setAttribute('srcset',image.getAttribute('srcset').split(',').map(value=>{
        const [url,...descriptor]=value.trim().split(/\s+/);
        return [map.get(url)||url,...descriptor].join(' ');
      }).join(', '));
    });
  },mappings);
  const csses=await scratch.evaluate(()=>[...document.querySelectorAll('style,[style]')].map(el=>({tag:el.tagName,value:el.tagName==='STYLE'?el.textContent:el.getAttribute('style')})));
  const localized=await Promise.all(csses.map(item=>assets.css(item.value||'',base)));
  await scratch.evaluate(values=>{
    document.querySelectorAll('style,[style]').forEach((el,index)=>{if(el.tagName==='STYLE')el.textContent=values[index];else el.setAttribute('style',values[index]);});
  },localized);
  const result=await scratch.evaluate(()=>({html:'<!doctype html>\n'+document.documentElement.outerHTML,head:document.head.innerHTML,body:document.body.innerHTML}));
  await scratchContext.close();
  if(outputFile){await fs.mkdir(path.dirname(outputFile),{recursive:true});await fs.writeFile(outputFile,result.html);}
  return result;
}

export async function revealPage(page) {
  await page.evaluate(()=>document.fonts.ready);
  const height=await page.evaluate(()=>document.documentElement.scrollHeight);
  for(let y=0;y<height;y+=700){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(80)}
  await page.waitForTimeout(700);await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(500);
}
