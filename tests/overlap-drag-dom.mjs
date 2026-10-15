// Integración del HTML completo con DOM, reloj de audio y geometría simulados.
// Requiere jsdom. VIVA_DOM_RUNTIME puede apuntar al package.json de otro runtime.
import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(process.env.VIVA_DOM_RUNTIME||import.meta.url);
const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const VERSION=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
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
    const nativeComputed=w.getComputedStyle.bind(w);w.getComputedStyle=el=>el===w.document.documentElement?{getPropertyValue:key=>key==='--track-width'?controls+'px':'108px'}:nativeComputed(el);
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
  const rows=()=>[...d.querySelectorAll('.track-row')];
  w.HTMLElement.prototype.getBoundingClientRect=function(){
    if(this.id==='timeline')return {left:0,top:64,width:width(),height:500};
    const row=this.closest('.track-row'),index=row?rows().indexOf(row):0,top=100+index*108;
    if(this.classList.contains('track-row'))return {left:0,top,width:viewport,height:108,bottom:top+108};
    if(this.classList.contains('lane'))return {left:controls,top,width:width()-controls,height:108,bottom:top+108};
    if(this.classList.contains('clip'))return {left:controls+parseFloat(this.style.left)-scroll.scrollLeft,top:top+9,width:parseFloat(this.style.width),height:88,bottom:top+97};
    return {left:0,top:0,width:0,height:0,bottom:0};
  };
  const getClip=id=>d.querySelector(`.clip[data-clip="${id}"]`);
  const event=(target,type,x,y,button=0,options={})=>{const e=new w.MouseEvent(type,{button,clientX:x,clientY:y,bubbles:true,cancelable:true,...options});Object.defineProperty(e,'pointerId',{value:1});target.dispatchEvent(e);};
  const clearSelection=()=>rows()[0].querySelector('.lane').dispatchEvent(new w.MouseEvent('click',{bubbles:true,clientX:controls,clientY:130}));
  const down=(id,part=null,options={})=>{const clip=getClip(id),target=part?clip.querySelector(part):clip,r=clip.getBoundingClientRect(),x=r.left+10,y=r.top+20;event(target,'pointerdown',x,y,0,options);return {clip,target,x,y};};
  const move=(drag,rowIndex,delta=0)=>event(drag.clip,'pointermove',drag.x+delta,100+rowIndex*108+25);
  const up=drag=>event(drag.clip,'pointerup',drag.x,drag.y);
  const zones=row=>row.querySelectorAll('.audio-overlap');
  try{
    await settle();await d.querySelector('#emptyDemo').onclick();await settle();scale(36);
    assert.equal(d.documentElement.dataset.studioVersion,VERSION);
    assert.equal(d.querySelectorAll('.audio-overlap').length,0);record('audios simultáneos en pistas distintas no producen avisos');
    const [a,b,c]=[...d.querySelectorAll('.clip')].map(el=>el.dataset.clip);
    clearSelection();let drag=down(a);assert.ok(d.documentElement.classList.contains('hand-pressed'));
    move(drag,1);assert.equal(d.querySelectorAll('.audio-drag-ghost').length,1);
    assert.ok(rows()[1].classList.contains('clip-drop-target'));assert.ok(getClip(a).classList.contains('drag-origin'));
    assert.equal(zones(rows()[1]).length,1);assert.equal(zones(rows()[1])[0].style.left,'108px');assert.equal(zones(rows()[1])[0].style.width,'324px');
    assert.equal(d.querySelectorAll('.audio-drag-overlaps i').length,1);
    assert.ok(getClip(a).title.includes('2 audios superpuestos'));record('el desplazamiento solo vertical muestra destino, onda y solapamiento antes de soltar');
    up(drag);assert.ok(!d.documentElement.classList.contains('hand-pressed'));assert.equal(d.querySelectorAll('.audio-drag-ghost').length,0);
    assert.equal(getClip(a).closest('.track-row'),rows()[1]);assert.equal(d.querySelectorAll('.clip').length,3);
    assert.ok(!rows()[1].querySelector('.track-overlap-warning').hidden);record('al soltar se confirma una sola copia del bloque en la pista destino');
    d.querySelector('#duplicateBtn').click();const duplicate=[...d.querySelectorAll('.clip')].find(el=>![a,b,c].includes(el.dataset.clip)).dataset.clip;
    drag=down(duplicate);move(drag,1,-12*36);up(drag);
    assert.equal(getClip(duplicate).style.left,'0px');assert.equal(zones(rows()[1]).length,2);
    assert.ok(zones(rows()[1])[1].textContent.includes('3 audios'));
    assert.ok(getClip(duplicate).classList.contains('has-overlap'));record('la coincidencia total sigue siendo visible y se distinguen los tramos con tres audios');
    drag=down(duplicate);move(drag,3,72);assert.ok(rows()[3].classList.contains('clip-drop-target'));
    w.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));up(drag);
    assert.equal(getClip(duplicate).closest('.track-row'),rows()[1]);assert.equal(getClip(duplicate).style.left,'0px');
    assert.equal(d.querySelectorAll('.audio-drag-layer').length,0);assert.equal(d.querySelectorAll('.clip-drop-target').length,0);record('Escape restaura posición, pista y avisos y retira la previsualización');
    d.querySelector('#deleteBtn').click();clearSelection();drag=down(a,'.clip-handle.right');
    assert.ok(!d.documentElement.classList.contains('hand-pressed'),'el cursor de recorte conserva su forma');
    event(drag.clip,'pointermove',drag.x-10*36,drag.y);
    assert.equal(getClip(a).style.width,'72px');assert.equal(zones(rows()[1]).length,0);record('el recorte actualiza el aviso en tiempo real antes de soltar');
    event(drag.clip,'pointercancel',drag.x,drag.y);assert.equal(getClip(a).style.width,'432px');assert.equal(zones(rows()[1]).length,1);record('cancelar el recorte recupera el tramo de solapamiento');
    clearSelection();drag=down(a);up(drag);drag=down(c,null,{ctrlKey:true});up(drag);drag=down(c);move(drag,3);
    assert.equal(d.querySelectorAll('.audio-drag-ghost').length,2);assert.equal(d.querySelectorAll('.clip-drop-target').length,2);up(drag);
    assert.equal(getClip(a).closest('.track-row'),rows()[2]);assert.equal(getClip(c).closest('.track-row'),rows()[3]);assert.equal(d.querySelectorAll('.audio-overlap').length,0);record('el arrastre de varios bloques conserva la separación entre pistas y retira avisos resueltos');
    d.querySelector('#undoBtn').click();assert.equal(getClip(a).closest('.track-row'),rows()[1]);assert.equal(zones(rows()[1]).length,1);record('Deshacer recupera posiciones y avisos');
    const button=d.querySelector('#playBtn');event(button,'pointerdown',20,20);assert.ok(d.documentElement.classList.contains('hand-pressed'));event(button,'pointerup',20,20);assert.ok(!d.documentElement.classList.contains('hand-pressed'));
    event(getClip(a),'pointerdown',20,20,2);assert.ok(!d.documentElement.classList.contains('hand-pressed'));record('las zonas con mano se cierran solo durante la pulsación izquierda');
    clearSelection();drag=down(a);move(drag,2);w.dispatchEvent(new w.Event('blur'));
    assert.ok(!d.documentElement.classList.contains('hand-pressed'));assert.equal(d.querySelectorAll('.audio-drag-layer').length,0);assert.equal(getClip(a).closest('.track-row'),rows()[1]);record('perder el foco cancela el gesto sin dejar la mano o el bloque atascados');
    const overlay=rows()[1].querySelector('.overlap-layer');assert.equal(w.getComputedStyle(overlay).pointerEvents,'none');
    assert.ok(getClip(a).querySelector('.volume-point'));assert.deepEqual(errors,[]);record('los indicadores dejan accesibles la onda, los puntos y los controles');
    results.push({url,checks,errors});
  }finally{for(const timer of timers)clearTimeout(timer);dom.window.close();}
}
if(process.env.VIVA_DOM_REPORT)fs.writeFileSync(process.env.VIVA_DOM_REPORT,JSON.stringify({version:VERSION,model:'DOM, audio y geometría simulados; no es una prueba de navegador real',results},null,2)+'\n');
console.log(JSON.stringify({addresses:results.length,checks:results.reduce((n,result)=>n+result.checks.length,0),errors:results.flatMap(result=>result.errors)}));
