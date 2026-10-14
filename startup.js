// Un único temporizador retira la portada, aunque el editor o la imagen sigan cargando.
export function createSplashController({duration=5000,setTimer=setTimeout,clearTimer=clearTimeout,onClose=()=>{}}={}){
  let closed=false,timer=null;
  function close(){
    if(closed)return;
    closed=true;
    if(timer!==null){clearTimer(timer);timer=null;}
    onClose();
  }
  timer=setTimer(close,duration);
  return {
    // Se conserva la llamada del arranque; ya no condiciona la duración de la portada.
    ready(){},
    cancel:close,
    get closed(){return closed;}
  };
}

let activeWebSplash=null;
export function initWebStartupSplash(){
  const splash=document.getElementById('webStartupSplash'),image=document.getElementById('webStartupImage'),screen=document.getElementById('startScreen');
  if(!splash)return {ready(){},cancel(){}};
  const originalInert=screen?.hasAttribute('inert')??false;
  screen?.setAttribute('inert','');
  function cleanup(){
    document.documentElement.classList.remove('web-starting');
    splash.hidden=true;
    // Retirarla del DOM evita que las reglas de los botones vuelvan a mostrarla.
    splash.remove();
    if(screen&&!originalInert)screen.removeAttribute('inert');
    image?.removeEventListener('error',failed);
    window.removeEventListener('pagehide',pagehide);
    if(screen&&!screen.hidden&&document.visibilityState!=='hidden')document.getElementById('emptyBlank')?.focus({preventScroll:true});
  }
  const controller=createSplashController({onClose:cleanup});
  activeWebSplash=controller;
  function failed(){controller.cancel();}
  function pagehide(){controller.cancel();}
  image?.addEventListener('error',failed);
  window.addEventListener('pagehide',pagehide);
  if(image?.complete&&!image.naturalWidth)failed();
  return controller;
}

export function finishWebStartupSplash(){
  activeWebSplash?.cancel();
  document.documentElement.classList.remove('web-starting');
  const splash=document.getElementById('webStartupSplash');
  if(splash){splash.hidden=true;splash.remove();}
}
