// Integración del HTML completo con DOM, reloj de audio y geometría simulados.
// Requiere jsdom. VIVA_DOM_RUNTIME puede apuntar al package.json de otro runtime.
import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(process.env.VIVA_DOM_RUNTIME||import.meta.url);
const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const results=[];
for(const url of ['https://example.test/estudio/','file:///C:/VIVA/index.html']){
  let viewport=900,controls=228,mainLeft=0,barLeft=0;
  const frames=[],contexts=[],errors=[],timers=new Set(),checks=[];
  class Param{constructor(){this.value=0;}setValueAtTime(){}linearRampToValueAtTime(){}setTargetAtTime(){}cancelScheduledValues(){}}
  class Node{constructor(){for(const key of ['gain','pan','frequency','Q','threshold','knee','ratio','attack','release'])this[key]=new Param();this.fftSize=256;}connect(){}disconnect(){}start(){}stop(){}getFloatTimeDomainData(data){data.fill(.1);}}
  class Buffer{constructor(ch,length,rate){this.numberOfChannels=ch;this.length=length;this.sampleRate=rate;this.duration=length/rate;this.channels=Array.from({length:ch},()=>new Float32Array(length));}getChannelData(i){return this.channels[i];}copyToChannel(data,i){this.channels[i].set(data);}}
  class Context{constructor(){this.currentTime=0;this.sampleRate=44100;this.state='suspended';this.destination=new Node();contexts.push(this);}async resume(){this.state='running';}createBuffer(...args){return new Buffer(...args);}createGain(){return new Node();}createStereoPanner(){return new Node();}createBiquadFilter(){return new Node();}createDynamicsCompressor(){return new Node();}createAnalyser(){return new Node();}createBufferSource(){return new Node();}}
  const vc=new VirtualConsole();vc.on('jsdomError',error=>errors.push(error.message));
  const dom=new JSDOM(html,{url,runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
    Object.assign(w,{AudioContext:Context,Blob,TextEncoder,TextDecoder,requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){}});
    Object.defineProperty(w.navigator,'mediaDevices',{value:{enumerateDevices:async()=>[],addEventListener(){}}});
    w.indexedDB={open(){throw Error('Autoguardado no disponible en esta prueba');}};
    w.HTMLCanvasElement.prototype.getContext=()=>({beginPath(){},moveTo(){},lineTo(){},stroke(){}});
    w.Element.prototype.setPointerCapture=()=>{};w.Element.prototype.releasePointerCapture=()=>{};
    w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
    w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
    w.getComputedStyle=()=>({getPropertyValue:key=>key==='--track-width'?controls+'px':'108px'});
    w.setTimeout=(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);fn();},ms===5000?0:ms);timers.add(timer);return timer;};
    w.clearTimeout=timer=>{timers.delete(timer);clearTimeout(timer);};
  }});
  const w=dom.window,d=w.document,scroll=d.querySelector('#arrangeScroll'),bar=d.querySelector('#timelineScroll');
  const width=()=>parseFloat(d.querySelector('#timeline').style.width)||0;
  const max=()=>Math.max(0,width()-viewport),bound=value=>Math.max(0,Math.min(max(),value));
  Object.defineProperties(scroll,{clientWidth:{get:()=>viewport},offsetWidth:{get:()=>viewport+16},clientLeft:{get:()=>0},scrollWidth:{get:width},scrollLeft:{get:()=>bound(mainLeft),set:value=>{mainLeft=bound(value);}}});
  Object.defineProperties(bar,{clientWidth:{get:()=>viewport-controls},scrollWidth:{get:()=>parseFloat(d.querySelector('#timelineScrollContent').style.width)||0},scrollLeft:{get:()=>bound(barLeft),set:value=>{barLeft=bound(value);}}});
  d.querySelector('#rulerTicks').getBoundingClientRect=()=>({left:0,top:0,width:width(),height:36});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  const record=name=>checks.push(name);
  const visible=()=>{
    const x=parseFloat(d.querySelector('#playhead').style.left)-scroll.scrollLeft;
    assert.ok(x>=controls-1&&x<=viewport+1,`cursor visible: ${x} dentro de ${controls}–${viewport}`);
    assert.ok(Math.abs(bar.scrollLeft-scroll.scrollLeft)<=.5,'barra horizontal sincronizada');
    assert.equal(scroll.scrollTop,123,'sin desplazamiento vertical');
  };
  const scale=value=>{d.querySelector('#zoomRange').value=value;d.querySelector('#zoomRange').dispatchEvent(new w.Event('input'));};
  const play=async()=>{await d.querySelector('#playBtn').onclick();await settle();assert.equal(d.querySelector('#playBtn use').getAttribute('href'),'#i-pause');};
  const stop=async()=>{await d.querySelector('#stopBtn').onclick();await settle();};
  const step=async seconds=>{contexts[0].currentTime+=seconds;assert.ok(frames.length);frames.shift()();await settle();};
  const pointer=(type,x)=>{const event=new w.MouseEvent(type,{button:0,clientX:x,bubbles:true,cancelable:true});Object.defineProperty(event,'pointerId',{value:1});d.querySelector('#rulerTicks').dispatchEvent(event);};
  try{
    await settle();await d.querySelector('#emptyDemo').onclick();await settle();
    assert.equal(d.documentElement.dataset.studioVersion,'1.18.1');assert.equal(d.querySelectorAll('.clip').length,3);
    scale(200);scroll.scrollTop=123;scroll.scrollLeft=4000;scroll.dispatchEvent(new w.Event('scroll'));
    d.querySelector('#rewindBtn').click();assert.equal(scroll.scrollLeft,0);visible();record('rebobinar en pausa devuelve la barra y el cursor al inicio');
    await play();let previous=0;
    for(let i=0;i<90;i++){await step(.25);visible();assert.ok(scroll.scrollLeft>=previous);previous=scroll.scrollLeft;}
    assert.ok(scroll.scrollLeft>3500);record('seguimiento continuo durante 90 fotogramas con zoom 200');
    scroll.scrollLeft=0;await step(.1);visible();record('el cursor se recupera si se desplaza manualmente la vista mientras suena');
    d.querySelector('#rewindBtn').click();await settle();assert.equal(scroll.scrollLeft,0);visible();
    assert.equal(d.querySelector('#playBtn use').getAttribute('href'),'#i-pause');await step(2);visible();record('rebobinar durante la reproducción conserva el estado y muestra el comienzo');
    await step(7);scale(5);visible();assert.equal(scroll.scrollLeft,0);scale(200);visible();record('el cursor permanece visible al reducir y ampliar el zoom');
    viewport=440;controls=184;w.dispatchEvent(new w.Event('resize'));visible();record('el seguimiento se adapta a una ventana estrecha');
    await stop();scroll.scrollLeft=1400;scroll.dispatchEvent(new w.Event('scroll'));const paused=scroll.scrollLeft;await step(3);assert.equal(scroll.scrollLeft,paused);record('en pausa se permite desplazar la vista libremente');
    viewport=900;controls=228;w.dispatchEvent(new w.Event('resize'));scale(200);scroll.scrollLeft=0;
    pointer('pointerdown',400);pointer('pointermove',800);pointer('pointerup',800);
    d.querySelector('#loopBtn').click();await play();await step(5);visible();
    assert.ok(parseFloat(d.querySelector('#playhead').style.left)<controls+3*200);record('un bucle devuelve la vista a su comienzo');
    await stop();d.querySelector('#loopBtn').click();
    [...d.querySelectorAll('.clip-play')].at(-1).click();await settle();await settle();visible();assert.ok(scroll.scrollLeft>3000);await step(.5);visible();record('la escucha aislada de un bloque lejano también sigue el cursor');
    await step(10);visible();assert.equal(d.querySelector('#playBtn use').getAttribute('href'),'#i-play');record('al finalizar el audio la línea continúa visible');
    scroll.scrollLeft=2000;d.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));assert.equal(scroll.scrollLeft,0);visible();record('la tecla Inicio sincroniza el rebobinado');
    assert.deepEqual(errors,[]);results.push({url,checks,errors});
  }finally{for(const timer of timers)clearTimeout(timer);dom.window.close();}
}
if(process.env.VIVA_DOM_REPORT)fs.writeFileSync(process.env.VIVA_DOM_REPORT,JSON.stringify({version:'1.18.1',model:'DOM y AudioContext simulados; no es una prueba de navegador real',results},null,2)+'\n');
console.log(JSON.stringify({addresses:results.length,checks:results.reduce((n,result)=>n+result.checks.length,0),errors:results.flatMap(result=>result.errors)}));
