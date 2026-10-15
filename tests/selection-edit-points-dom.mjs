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

  const selected=()=>[...d.querySelectorAll('.clip.selected')].map(el=>el.dataset.clip);
  const clickClip=(id,options={})=>{const drag=down(id,null,options);up(drag);};
  const key=(target,key,options={})=>target.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));
  const menu=(id,seconds,target=null)=>{const clip=getClip(id),r=clip.getBoundingClientRect();event(target||clip,'contextmenu',r.left+seconds*36,r.top+40,2);assert.ok(!d.querySelector('#contextMenu').hidden);};
  const action=name=>{const button=d.querySelector(`[data-context="${name}"]`);assert.ok(button, name);assert.equal(button.disabled,false,name+' habilitado');button.click();};
  const points=id=>[...getClip(id).querySelectorAll('.edit-point')].map(el=>Number(el.dataset.point));
  const mark=(id,start,end)=>{menu(id,start);action('start');menu(id,end);action('end');};
  const region=id=>getClip(id).querySelector('.clip-range');
  const volume=id=>getClip(id).querySelector('.volume-envelope').outerHTML;
  try{
    await settle();
    assert.equal(d.querySelector('#clearSelectionBtn').disabled,true);record('quitar selección permanece desactivado antes de iniciar proyecto');
    await d.querySelector('#emptyDemo').onclick();await settle();scale(36);
    const [a,b,c]=[...d.querySelectorAll('.clip')].map(el=>el.dataset.clip);
    clickClip(a);clickClip(c);assert.deepEqual(selected(),[c]);assert.equal(getClip(a).getAttribute('aria-pressed'),'false');assert.equal(getClip(c).getAttribute('aria-pressed'),'true');record('clics normales entre pistas nunca acumulan selecciones');
    for(const id of [a,b,c,a,b]){clickClip(id);assert.deepEqual(selected(),[id]);}record('la selección exclusiva se mantiene tras varios clics y cambios de pista');
    clickClip(a,{ctrlKey:true});assert.deepEqual(new Set(selected()),new Set([a,b]));assert.equal(getClip(a).querySelector('.clip-selection-badge').hidden,false);assert.match(d.querySelector('#selectionInfo').textContent,/2 bloques/);record('Ctrl añade un bloque y el borde, la marca y el contador reflejan el grupo');
    clickClip(a,{ctrlKey:true});assert.deepEqual(selected(),[b]);clickClip(c,{metaKey:true});assert.deepEqual(new Set(selected()),new Set([b,c]));clickClip(c,{shiftKey:true});assert.deepEqual(selected(),[b]);record('Ctrl, Cmd y Mayús permiten añadir y quitar miembros de forma explícita');
    clickClip(a,{ctrlKey:true});let drag=down(a);move(drag,1);assert.equal(d.querySelectorAll('.audio-drag-ghost').length,2);event(drag.clip,'pointercancel',drag.x,drag.y);assert.equal(selected().length,2);record('arrastrar un miembro mueve el grupo y cancelar conserva la selección');
    clickClip(a);assert.deepEqual(selected(),[a]);record('un clic sin arrastre en un miembro deja solo ese bloque activo');
    clickClip(b,{ctrlKey:true});d.querySelector('#clearSelectionBtn').click();assert.deepEqual(selected(),[]);clickClip(a);clickClip(b,{shiftKey:true});key(d.body,'Escape');assert.deepEqual(selected(),[]);record('Quitar selección y Escape retiran todos los bloques marcados');
    clickClip(c);event(getClip(a).querySelector('.volume-point'),'pointerdown',300,150);event(getClip(a).querySelector('.volume-point'),'pointerup',300,150);assert.deepEqual(selected(),[a]);record('editar volumen en otra pista no añade su bloque a una selección previa');
    clickClip(c);mark(a,2,6);assert.deepEqual(selected(),[a]);assert.deepEqual(points(a),[2,6]);assert.equal(region(a).style.display,'block');assert.ok(getClip(a).querySelector('[data-boundary="start"]'));assert.ok(getClip(a).querySelector('[data-boundary="end"]'));record('marcar un fragmento selecciona solo su bloque y muestra I y F');
    const originalVolume=volume(a),widthBefore=getClip(a).style.width;
    menu(a,4);action('remove-start');assert.deepEqual(points(a),[6]);assert.equal(region(a).style.display,'none');assert.equal(getClip(a).style.width,widthBefore);assert.equal(volume(a),originalVolume);assert.equal(d.querySelectorAll('.clip').length,3);record('el menú permite borrar el inicio sin eliminar audio ni cambiar volumen');
    d.querySelector('#undoBtn').click();assert.deepEqual(points(a),[2,6]);assert.equal(region(a).style.display,'block');record('Deshacer restaura el punto y el fragmento seleccionado');
    const end=getClip(a).querySelector('[data-boundary="end"]');menu(a,6,end);action('remove-point');assert.deepEqual(points(a),[2]);assert.equal(region(a).style.display,'none');assert.equal(volume(a),originalVolume);record('clic derecho en F elimina únicamente el punto final');
    d.querySelector('#undoBtn').click();const start=getClip(a).querySelector('[data-boundary="start"]');event(start,'pointerdown',300,150);key(start,'Delete');assert.deepEqual(points(a),[6]);assert.equal(d.querySelectorAll('.clip').length,3);record('Supr con el foco en I borra el límite y no dispara la eliminación de audio');
    d.querySelector('#undoBtn').click();const pointEnd=getClip(a).querySelector('[data-boundary="end"]');key(pointEnd,'Backspace');assert.deepEqual(points(a),[2]);assert.equal(d.querySelectorAll('.clip').length,3);record('Retroceso sobre F tampoco elimina el bloque');
    d.querySelector('#undoBtn').click();menu(a,4);action('remove-end');assert.deepEqual(points(a),[2]);assert.equal(region(a).style.display,'none');record('la opción de borrar el final funciona desde cualquier zona del fragmento');
    d.querySelector('#undoBtn').click();menu(a,4);action('clear-fragment');assert.deepEqual(points(a),[2,6]);assert.equal(region(a).style.display,'none');assert.equal(getClip(a).querySelectorAll('.segment-boundary').length,0);record('quitar solo la selección conserva los cortes y retira las etiquetas I/F');
    menu(a,4);action('select');assert.equal(region(a).style.display,'block');key(d.body,'c',{ctrlKey:true});menu(b,10);action('paste');const pasted=[...d.querySelectorAll('.clip')].find(el=>![a,b,c].includes(el.dataset.clip));assert.equal(pasted.style.width,'144px');assert.deepEqual(selected(),[pasted.dataset.clip]);record('copiar un fragmento y pegarlo en otra pista conserva su duración y selecciona solo la copia');
    mark(a,0,12);assert.ok(getClip(a).querySelector('.edit-point.edge-start'));assert.ok(getClip(a).querySelector('.edit-point.edge-end'));menu(a,5);action('remove-start');assert.equal(region(a).style.display,'none');assert.equal(getClip(a).style.width,widthBefore);record('el límite de inicio se puede quitar aunque coincida con el inicio físico del bloque');
    d.querySelector('#undoBtn').click();const edgeEnd=getClip(a).querySelector('.edit-point.edge-end');key(edgeEnd,'Delete');assert.equal(region(a).style.display,'none');assert.equal(getClip(a).style.width,widthBefore);record('el límite de final físico se borra sin recortar ni borrar el bloque');
    mark(a,2,6);await play();menu(a,3);action('remove-start');assert.equal(d.querySelector('#playBtn use').getAttribute('href'),'#i-pause');await stop();record('borrar un punto con el menú no detiene la reproducción activa');
    menu(a,8);action('marker');const free=getClip(a).querySelector('[data-point="8"]');menu(a,8,free);action('remove-point');assert.ok(!points(a).includes(8));record('también se eliminan los marcadores de corte sin un fragmento seleccionado');
    mark(a,2,6);menu(a,4);action('remove-start');clickClip(b);clickClip(c,{ctrlKey:true});d.querySelector('#undoBtn').click();assert.deepEqual(selected(),[a]);assert.equal(region(a).style.display,'block');record('Deshacer un límite restaura una única selección de fragmento aunque antes hubiera un grupo en otras pistas');
    mark(a,2,6);clickClip(c);assert.equal(region(a).style.display,'none');assert.equal(getClip(a).querySelectorAll('.segment-boundary').length,0);assert.deepEqual(selected(),[c]);record('cambiar de bloque retira la selección anterior y sus etiquetas de límites');
    clearSelection();assert.deepEqual(selected(),[]);assert.deepEqual(errors,[]);record('clic en vacío limpia la selección y la ejecución completa no genera errores');
    results.push({url,checks,errors});
  }finally{for(const timer of timers)clearTimeout(timer);dom.window.close();}
}
if(process.env.VIVA_DOM_REPORT)fs.writeFileSync(process.env.VIVA_DOM_REPORT,JSON.stringify({version:VERSION,model:'DOM, audio y geometría simulados; no es una prueba de navegador real',results},null,2)+'\n');
console.log(JSON.stringify({addresses:results.length,checks:results.reduce((n,result)=>n+result.checks.length,0),errors:results.flatMap(result=>result.errors)}));
