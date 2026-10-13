const MANUAL_PDF_BASE64='';
const manualText = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function bindManual(){
  const dialog=document.getElementById('manualDialog');
  const standalone=document.body.classList.contains('manual-page');
  const search=document.getElementById('manualSearch');
  const reader=document.getElementById('manualReader');
  const chapters=[...document.querySelectorAll('[data-manual-chapter]')];
  const links=[...document.querySelectorAll('[data-manual-target]')];
  const index=chapters.map(chapter=>({chapter,text:manualText(chapter.textContent)}));
  const filter=()=>{
    const words=manualText(search.value).trim().split(/\s+/).filter(Boolean);
    let count=0;
    for(const {chapter,text} of index){chapter.hidden=!words.every(word=>text.includes(word));if(!chapter.hidden)count++;}
    for(const link of links)link.hidden=!!document.getElementById(link.dataset.manualTarget)?.hidden;
    document.getElementById('manualResults').textContent=words.length?`${count} ${count===1?'capítulo encontrado':'capítulos encontrados'}`:`${chapters.length} capítulos · guía completa`;
    document.getElementById('manualNoResults').hidden=count>0;
    reader.scrollTop=0;
  };
  search.addEventListener('input',filter);
  document.getElementById('manualClear').onclick=()=>{search.value='';filter();search.focus();};
  for(const link of links)link.onclick=()=>{
    search.value='';filter();
    const chapter=document.getElementById(link.dataset.manualTarget);
    if(!chapter)return;
    for(const item of links){item.classList.toggle('active',item===link);item.removeAttribute('aria-current');}
    link.setAttribute('aria-current','location');
    reader.scrollTop=Math.max(0,chapter.offsetTop-reader.offsetTop);
    chapter.querySelector('h2')?.focus({preventScroll:true});
  };
  const open=()=>{
    if(!dialog||document.querySelector('dialog[open]'))return;
    dialog.showModal();search.focus({preventScroll:true});
  };
  const trigger=document.getElementById('manualBtn');if(trigger)trigger.onclick=open;
  const help=document.getElementById('helpOpenManual');if(help)help.onclick=()=>{document.getElementById('helpDialog').close();open();};
  document.getElementById('manualClose').onclick=()=>{if(dialog)dialog.close();};
  document.getElementById('manualPrint').onclick=()=>{
    document.documentElement.classList.add('printing-manual');
    const finish=()=>document.documentElement.classList.remove('printing-manual');
    window.addEventListener('afterprint',finish,{once:true});
    try{window.print();}catch(error){finish();throw error;}
  };
  const pdfLink=document.getElementById('manualPdf');
  if(pdfLink&&MANUAL_PDF_BASE64)pdfLink.onclick=e=>{
    e.preventDefault();
    const bytes=Uint8Array.from(atob(MANUAL_PDF_BASE64),character=>character.charCodeAt(0));
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download='viva-studio-manual.pdf';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  };
  const downloadButton=document.getElementById('manualDownload');
  if(downloadButton)downloadButton.onclick=()=>{
    const content=document.getElementById('manualDocument').cloneNode(true);
    for(const chapter of content.querySelectorAll('[data-manual-chapter]'))chapter.hidden=false;
    const styles=[...document.querySelectorAll('style')].map(style=>style.textContent).join('\n');
    const html='<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Manual · VIVA AUDIO STUDIO SUITE EDITOR</title><style>'+styles.replace(/<\/style/gi,'<\\/style')+'</style><body class="manual-download"><main class="manual-content">'+content.outerHTML+'</main></body></html>';
    const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download='viva-studio-manual-completo.html';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  };
  if(standalone){document.getElementById('manualClose').hidden=true;if(downloadButton)downloadButton.hidden=true;}
  filter();
}
