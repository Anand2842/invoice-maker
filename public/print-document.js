(() => {
 'use strict';
 const button=document.querySelector('[data-print-document]');
 const status=document.querySelector('[data-print-status]');
 button?.addEventListener('click',()=>{
  if(status)status.textContent='Choose a printer or Save as PDF in your browser’s print dialog. The browser controls the saved file and print settings.';
  window.print();
 });
})();
