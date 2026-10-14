// Cuenta tiempo visible; el editor puede prepararse mientras aparece la portada.
export function createSplashController({duration=2500,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,onClose=()=>{},visible=true}={}){
  let imageReady=false,editorReady=false,closed=false,elapsed=0,started=null,timer=null;
  function pause(){if(started!==null){elapsed+=Math.max(0,now()-started);started=null;}if(timer!==null){clearTimer(timer);timer=null;}}
  function close(){if(closed)return;closed=true;pause();onClose();}
  function update(){
    if(closed)return;
    if(!visible||!imageReady){pause();return;}
    if(elapsed>=duration){if(editorReady)close();return;}
    if(started===null)started=now();
    if(timer===null)timer=setTimer(()=>{timer=null;pause();update();},Math.max(0,duration-elapsed));
  }
  return {
    imageReady(){imageReady=true;update();},
    ready(){editorReady=true;update();},
    visibility(value){pause();visible=Boolean(value);update();},
    cancel:close,
    get closed(){return closed;}
  };
}

let activeWebSplash=null;
export function initWebStartupSplash(){
  const splash=document.getElementById('webStartupSplash'),image=document.getElementById('webStartupImage'),screen=document.getElementById('startScreen');
  if(!splash||!image)return {ready(){},cancel(){}};
  const originalInert=screen?.hasAttribute('inert')??false;
  screen?.setAttribute('inert','');
  let frame1=null,frame2=null,imageTimeout=null,preparingImage=false;
  function cleanup(){
    document.documentElement.classList.remove('web-starting');splash.hidden=true;
    if(screen&&!originalInert)screen.removeAttribute('inert');
    image.removeEventListener('load',loaded);image.removeEventListener('error',failed);
    document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pagehide);
    if(frame1!==null)cancelAnimationFrame(frame1);if(frame2!==null)cancelAnimationFrame(frame2);
    if(imageTimeout!==null)clearTimeout(imageTimeout);
    if(screen&&!screen.hidden)document.getElementById('emptyBlank')?.focus({preventScroll:true});
  }
  const controller=createSplashController({onClose:cleanup,visible:document.visibilityState!=='hidden'});
  activeWebSplash=controller;
  function visibility(){controller.visibility(document.visibilityState!=='hidden');}
  function failed(){controller.cancel();}
  function pagehide(){controller.cancel();}
  async function loaded(){
    if(preparingImage||controller.closed)return;
    if(!image.naturalWidth){failed();return;}
    preparingImage=true;
    try{if(image.decode)await image.decode();}catch{if(!image.naturalWidth){failed();return;}}
    if(controller.closed)return;
    if(imageTimeout!==null){clearTimeout(imageTimeout);imageTimeout=null;}
    // Dos fotogramas garantizan que la imagen haya tenido ocasión de pintarse.
    frame1=requestAnimationFrame(()=>{frame1=null;frame2=requestAnimationFrame(()=>{frame2=null;controller.imageReady();});});
  }
  image.addEventListener('load',loaded);image.addEventListener('error',failed);
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',pagehide);
  // Una imagen dañada o una petición fallida no puede bloquear el editor.
  imageTimeout=setTimeout(failed,10000);
  if(image.complete)loaded();
  return controller;
}

export function finishWebStartupSplash(){
  activeWebSplash?.cancel();
  document.documentElement.classList.remove('web-starting');
  const splash=document.getElementById('webStartupSplash');if(splash)splash.hidden=true;
}
