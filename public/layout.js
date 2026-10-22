const breakpoints=()=>innerWidth<810?'mobile':innerWidth<1200?'tablet':'desktop';
let current=document.body.dataset.layout||'desktop';
let generation=0;
const cache=new Map();
function localLinks(){
 document.querySelectorAll('a[href]').forEach(link=>{
  let url;try{url=new URL(link.href)}catch{return}
  if(url.hostname==='www.refrens.com'||url.hostname==='refrens.com'){
   if(url.pathname==='/'&&!url.search)link.href='/'+url.hash;
   if(url.pathname==='/free-online-invoice-generator')link.href='/free-online-invoice-generator/'+url.hash;
  }
 });
}
async function changeLayout(){
 const next=breakpoints();if(next===current){localLinks();return}
 const run=++generation;
 try{
  const html=cache.get(next)||await fetch(`/layouts/${next}.html`).then(response=>{if(!response.ok)throw new Error('Layout unavailable');return response.text()});
  if(run!==generation)return;
  cache.set(next,html);
  const ratio=scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight);
  document.body.innerHTML=html;
  document.body.dataset.layout=next;current=next;
  localLinks();window.dispatchEvent(new Event('refrens-layout'));
  requestAnimationFrame(()=>scrollTo(0,ratio*Math.max(0,document.documentElement.scrollHeight-innerHeight)));
 }catch(error){console.error('Responsive layout could not load:',error.message)}
}
if(['#overview','#invoices','#clients','#expenses','#reports','#settings'].includes(location.hash))history.replaceState(null,'',location.pathname);
localLinks();changeLayout();
let resizeTimer;addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(changeLayout,100)});
addEventListener('refrens-layout',localLinks);
