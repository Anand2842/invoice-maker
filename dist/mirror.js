// Presentation interactions reconstructed from the observed public Refrens page.
const interactionData = fetch('/states/home-interactions.json').then(response => {
  if (!response.ok) throw new Error('Unable to load presentation states');
  return response.json();
});
let data, overlayType = null, mobileState = 'closed';
let faqClosed = new Map();
const visible = element => element && element.getBoundingClientRect().width > 0;
const selectVisible = selector => [...document.querySelectorAll(selector)].find(visible);
const fragment = html => { const template = document.createElement('template'); template.innerHTML = html.trim(); return template.content.firstElementChild; };
function normalizeLinks(root=document) {
  root.querySelectorAll('a[href]').forEach(link=>{
    let url;try{url=new URL(link.getAttribute('href'),location.href)}catch{return}
    if(url.hostname==='www.refrens.com'||url.hostname==='refrens.com'||url.origin===location.origin){
      if(url.pathname==='/'&&!url.search)link.setAttribute('href','/'+url.hash);
      if(url.pathname==='/free-online-invoice-generator')link.setAttribute('href','/free-online-invoice-generator/'+url.hash);
    }
  });
}
function replace(element, html) { const node = fragment(html); element?.replaceWith(node); normalizeLinks(node); return node; }
function closeOverlay() { document.querySelector('#overlay')?.replaceChildren(); overlayType = null; document.querySelectorAll('[name="Product Trigger"],[name="India Trigger"]').forEach(e => e.setAttribute('aria-expanded','false')); }
function showOverlay(type) {
  if (overlayType === type) return closeOverlay();
  const node = fragment(data.states['overlay:'+type]);
  const previous = document.querySelector('#overlay');
  if (previous) previous.replaceWith(node); else document.querySelector('#main')?.append(node);
  overlayType = type; normalizeLinks(node);
  const portal = node.firstElementChild;
  const dialog = node.querySelector('[role="dialog"]');
  if (portal && dialog) {
    const trigger = document.querySelector(type === 'products' ? '[name="Product Trigger"]' : '[name="India Trigger"]');
    trigger?.setAttribute('aria-expanded','true');
    const anchor = trigger?.getBoundingClientRect();
    // Source desktop popup is centered on the page; country menu is centered on its trigger.
    const width = dialog.getBoundingClientRect().width;
    const left = type === 'products' ? (innerWidth-width)/2 : (anchor ? anchor.x+anchor.width/2-width/2 : (innerWidth-width)/2);
    portal.style.left = `${Math.max(12,Math.min(innerWidth-width-12,left))+scrollX}px`;
    if (anchor) portal.style.top = `${anchor.bottom+29.594+scrollY}px`;
    portal.style.pointerEvents = 'auto';
    dialog.style.opacity = '1';
  }
}
function mobileHeader(state) {
  const header = selectVisible('header');
  const html = data.states['header:mobile:'+state];
  if (!header || !html) return;
  replace(header,html); mobileState = state; prepareControls();
}
function toggleMobilePart(part) {
  const country = mobileState==='country'||mobileState==='both';
  const products = mobileState==='products'||mobileState==='both';
  const nextCountry=part==='country'?!country:country, nextProducts=part==='products'?!products:products;
  mobileHeader(nextCountry&&nextProducts?'both':nextCountry?'country':nextProducts?'products':'open');
}
function prepareControls() {
  document.querySelectorAll('[name="Product Trigger"]:not(:has([name="Product Trigger"])),[name="India Trigger"]:not(:has([name="India Trigger"])),.framer-fhaca [data-framer-name="Feature Tab"] > div > [data-highlight],.framer-m6GoZ [data-framer-name="Top"],header .framer-wb7j18,header .framer-UxQYP').forEach(element => {
    element.setAttribute('role','button'); element.setAttribute('tabindex','0');
  });
  const mobileHeaderRoot=selectVisible('header');
  if((document.body.dataset.layout==='mobile'||innerWidth<810)&&mobileHeaderRoot){
    const icon=mobileHeaderRoot.querySelector('.framer-wb7j18');
    if(mobileHeaderRoot.getAttribute('data-framer-name')==='Closed'){mobileHeaderRoot.setAttribute('role','button');mobileHeaderRoot.tabIndex=0;icon?.removeAttribute('role');icon?.removeAttribute('tabindex');}
  }
  document.querySelectorAll('.framer-m6GoZ').forEach((element,index) => {
    element.dataset.mirrorFaq = String(index);
    element.setAttribute('aria-expanded',element.getAttribute('data-framer-name')==='Open'?'true':'false');
    if (element.getAttribute('data-framer-name')!=='Open') faqClosed.set(index,element.outerHTML);
  });
  document.querySelectorAll('section[aria-roledescription="carousel"]').forEach(section => {
    section.querySelectorAll('button[aria-label="Next"],button[aria-label="Previous"]').forEach(button => button.style.cursor='pointer');
    const list=section.querySelector('ul.framer--carousel');
    if(list&&!list.dataset.mirrorScroll){list.dataset.mirrorScroll='true';list.addEventListener('scroll',()=>syncCarousel(section),{passive:true});}
  });
}
function syncCarousel(section) {
  const list=section.querySelector('ul.framer--carousel');if(!list)return;
  const maximum=Math.max(0,list.scrollWidth-list.clientWidth),offset=list.scrollLeft;
  section.querySelectorAll('button[aria-label="Previous"],button[aria-label="Next"]').forEach(button=>{
    const disabled=button.getAttribute('aria-label')==='Previous'?offset<=1:offset>=maximum-1;
    button.style.opacity=disabled?'0':'1';button.style.pointerEvents=disabled?'none':'auto';button.disabled=disabled;
  });
  const pages=section.querySelectorAll('[aria-label^="Scroll to page"]');
  const current=maximum>0?Math.round(offset/Math.max(1,list.clientWidth)):0;
  pages.forEach((button,index)=>{
    const active=index===current;button.setAttribute('aria-current',active?'true':'false');
    const dot=button.firstElementChild;if(dot)dot.style.opacity=active?'1':'0.5';
  });
  const start=offset<=1?'rgb(0, 0, 0)':'rgba(0, 0, 0, 0)',end=offset>=maximum-1?'rgb(0, 0, 0)':'rgba(0, 0, 0, 0)';
  list.style.maskImage=`linear-gradient(to right, ${start} 0%, rgb(0, 0, 0) 5%, rgb(0, 0, 0) 95%, ${end} 100%)`;
}
function changeCarousel(section,direction,pageIndex=null) {
  const list=section.querySelector('ul.framer--carousel');if(!list)return;
  const maximum=Math.max(0,list.scrollWidth-list.clientWidth);
  const next=Math.max(0,Math.min(maximum,pageIndex===null?list.scrollLeft+direction*list.clientWidth:pageIndex*list.clientWidth));
  list.scrollTo({left:next,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  requestAnimationFrame(()=>syncCarousel(section));
}
let tickerObserver;
let tickerAnimations=[];
function prepareTicker() {
  tickerObserver?.disconnect();tickerAnimations.forEach(animation=>animation.cancel());tickerAnimations=[];
  const tracks=new Map();
  document.querySelectorAll('[data-framer-name="brand logos"] section > ul').forEach(track=>{
    const distance=Math.abs(parseFloat(track.style.left));
    if(!distance)return;
    const animation=track.animate([{transform:'translateX(0px)'},{transform:`translateX(${distance}px)`}],{
      duration:distance/105*1000,iterations:Infinity,easing:'linear'
    });
    animation.pause();animation.currentTime=0;tickerAnimations.push(animation);tracks.set(track.parentElement,animation);
  });
  tickerObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
    const animation=tracks.get(entry.target);if(!animation)return;
    if(entry.isIntersecting)animation.play();else animation.pause();
  }));
  tracks.forEach((animation,section)=>tickerObserver.observe(section));
}
function playVideo(target) {
  const article=target.closest('article');
  const iframe=article?.querySelector('iframe');
  if (iframe) {
    const url=new URL(iframe.src);url.searchParams.set('autoplay','1');iframe.src=url.href;iframe.style.display='block';
    article.querySelectorAll('img,button').forEach(element=>element.style.display='none');
    return true;
  }
  return false;
}
async function boot() {
  data = await interactionData;
  let style=document.querySelector('#mirror-interaction-styles');
  if (!style) { style=document.createElement('style');style.id='mirror-interaction-styles';document.head.append(style); }
  style.textContent=data.css;
  overlayType=null;mobileState='closed';faqClosed=new Map();normalizeLinks();prepareControls();prepareTicker();
}
document.addEventListener('click',async event=>{
  if (!data) { try { data=await interactionData; } catch { return; } }
  const target=event.target instanceof Element?event.target:null;if(!target)return;
  const header=target.closest('header');
  const isMobile=document.body.dataset.layout==='mobile'||innerWidth<810;
  if(header && isMobile){
    if(target.closest('.framer-wb7j18')||(header.getAttribute('data-framer-name')==='Closed'&&!target.closest('a'))){event.preventDefault();mobileHeader(mobileState==='closed'?'open':'closed');return;}
    if(!target.closest('a')){
      const text=target.closest('.framer-UxQYP')?.textContent.trim();
      if(text==='India'){event.preventDefault();toggleMobilePart('country');return;}
      if(text==='Products'){event.preventDefault();toggleMobilePart('products');return;}
    }
  }
  const productTrigger=target.closest('[name="Product Trigger"]');
  const indiaTrigger=target.closest('[name="India Trigger"]');
  if(!isMobile&&(productTrigger||indiaTrigger)){event.preventDefault();showOverlay(productTrigger?'products':'india');return;}
  if(overlayType&&!target.closest('#overlay'))closeOverlay();
  const featureTab=target.closest('.framer-fhaca [data-framer-name="Feature Tab"] > div');
  if(featureTab){
    const name=featureTab.textContent.trim(),html=data.states['feature:'+name],component=featureTab.closest('.framer-fhaca');
    if(html&&component){event.preventDefault();const variables=[...component.style].filter(name=>name.startsWith('--')).map(name=>[name,component.style.getPropertyValue(name)]);const node=replace(component,html);variables.forEach(([name,value])=>node.style.setProperty(name,value));prepareControls();}return;
  }
  const faq=target.closest('.framer-m6GoZ');
  if(faq&&target.closest('[data-framer-name="Top"]')){
    event.preventDefault();const index=Number(faq.dataset.mirrorFaq);const open=faq.getAttribute('data-framer-name')==='Open';
    const html=open?faqClosed.get(index):data.states['faq:'+index];if(html){const node=replace(faq,html);node.dataset.mirrorFaq=String(index);prepareControls();}return;
  }
  const pagination=target.closest('button[aria-label^="Scroll to page"]');
  if(pagination){const section=pagination.closest('section[aria-roledescription="carousel"]');if(section){event.preventDefault();changeCarousel(section,0,Number(pagination.getAttribute('aria-label').match(/\d+/)?.[0]||1)-1);}return;}
  const arrow=target.closest('button[aria-label="Next"],button[aria-label="Previous"]');
  if(arrow){const section=arrow.closest('section[aria-roledescription="carousel"]');if(section){event.preventDefault();changeCarousel(section,arrow.getAttribute('aria-label')==='Next'?1:-1);}return;}
  const play=target.closest('button[aria-label="Play"],article[role="presentation"]');
  if(play&&playVideo(play)){event.preventDefault();return;}
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){closeOverlay();if(mobileState!=='closed')mobileHeader('closed');}
  if((event.key==='Enter'||event.key===' ')&&event.target instanceof Element&&event.target.matches('[role="button"]')){event.preventDefault();event.target.click();}
});
window.addEventListener('refrens-layout',boot);
boot().catch(error=>console.error(error));
