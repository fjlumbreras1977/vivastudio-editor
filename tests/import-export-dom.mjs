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
  const frames=[],contexts=[],errors=[],timers=new Set(),checks=[],readers=[],decodes=[];let modalOpens=0,modalCloses=0;
  class Param{constructor(){this.value=0;}setValueAtTime(){}linearRampToValueAtTime(){}setTargetAtTime(){}cancelScheduledValues(){}}
  class Node{constructor(){for(const key of ['gain','pan','frequency','Q','threshold','knee','ratio','attack','release'])this[key]=new Param();this.fftSize=256;}connect(){}disconnect(){}start(){}stop(){}getFloatTimeDomainData(data){data.fill(.1);}}
  class Buffer{constructor(ch,length,rate){this.numberOfChannels=ch;this.length=length;this.sampleRate=rate;this.duration=length/rate;this.channels=Array.from({length:ch},()=>new Float32Array(length));}getChannelData(i){return this.channels[i];}copyToChannel(data,i){this.channels[i].set(data);}}
  class Context{constructor(){this.currentTime=0;this.sampleRate=44100;this.state='suspended';this.destination=new Node();contexts.push(this);}async resume(){this.state='running';}decodeAudioData(data){return new Promise((resolve,reject)=>decodes.push({resolve,reject,data}));}createBuffer(...args){return new Buffer(...args);}createGain(){return new Node();}createStereoPanner(){return new Node();}createBiquadFilter(){return new Node();}createDynamicsCompressor(){return new Node();}createAnalyser(){return new Node();}createBufferSource(){return new Node();}}
  const vc=new VirtualConsole();vc.on('jsdomError',error=>errors.push(error.message));
  const dom=new JSDOM(html,{url,runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
    Object.assign(w,{AudioContext:Context,Blob,File,FileReader:class{readAsArrayBuffer(file){this.file=file;readers.push(this);}},TextEncoder,TextDecoder,requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){}});
    Object.defineProperty(w.navigator,'mediaDevices',{value:{enumerateDevices:async()=>[],addEventListener(){}}});
    w.indexedDB={open(){throw Error('Autoguardado no disponible en esta prueba');}};
    w.HTMLCanvasElement.prototype.getContext=()=>({beginPath(){},moveTo(){},lineTo(){},stroke(){}});
    w.Element.prototype.setPointerCapture=()=>{};w.Element.prototype.releasePointerCapture=()=>{};
    w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');if(this.id==='importProgressDialog')modalOpens++;};
    w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');if(this.id==='importProgressDialog')modalCloses++;this.dispatchEvent(new w.Event('close'));};
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

  const waitFor=async(fn)=>{for(let i=0;i<60;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Espera DOM agotada');};
  const begin=(files,initial=false)=>{if(initial)d.querySelector('#emptyImport').click();return d.querySelector('#audioInput').onchange({target:{files,value:''}});};
  const read=async()=>{await waitFor(()=>readers.length);const reader=readers.shift();reader.onprogress({lengthComputable:true,loaded:1,total:4});assert.equal(d.querySelector('#importProgressBar').value,25);reader.result=await reader.file.arrayBuffer();reader.onload();await waitFor(()=>decodes.length);return decodes.shift();};
  const popup=()=>d.querySelector('#importProgressDialog');
  const file=name=>new File([new Uint8Array([1,2,3,4])],name,{type:'audio/wav'});
  try{
    await settle();assert.equal(d.documentElement.dataset.studioVersion,VERSION);
    let loading=begin([file('fallo.wav')],true);assert.equal(popup().open,true);assert.equal(d.querySelector('.app').hasAttribute('inert'),true);assert.equal(d.querySelector('#taskProgress').hidden,true);record('la importación inicial abre una ventana emergente y retira el progreso fijo');
    let decode=await read();assert.match(d.querySelector('#importProgressLabel').textContent,/fallo.wav/);assert.equal(d.querySelector('#importProgressBar').hasAttribute('value'),false);const cancel=new w.Event('cancel',{cancelable:true});popup().dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);assert.equal(popup().open,true);record('el mensaje identifica el archivo y Escape no oculta una carga en curso');
    decode.reject(Error('Archivo inválido'));await loading;assert.equal(popup().open,false);assert.equal(d.querySelector('#startScreen').hidden,false);assert.equal(d.querySelector('#emptyImport').disabled,false);assert.equal(d.querySelectorAll('.clip').length,0);record('un error cierra la ventana y permite volver a importar desde el inicio');
    loading=begin([file('entrevista.wav')],true);decode=await read();decode.resolve(new Buffer(2,44100,44100));await loading;assert.equal(popup().open,false);assert.equal(d.querySelector('.app').hasAttribute('inert'),false);assert.equal(d.querySelectorAll('.clip').length,1);assert.equal(d.querySelector('#taskProgress').hidden,true);record('la carga correcta cierra la ventana automáticamente y deja la onda disponible');
    const opened=modalOpens,closed=modalCloses;loading=begin([file('no válido.wav'),file('segunda toma.wav')]);decode=await read();decode.reject(Error('Archivo inválido'));await waitFor(()=>readers.length);assert.equal(popup().open,true);assert.equal(modalOpens,opened+1);assert.equal(modalCloses,closed);decode=await read();assert.match(d.querySelector('#importProgressLabel').textContent,/2\/2/);decode.resolve(new Buffer(1,22050,44100));await loading;assert.equal(popup().open,false);assert.equal(modalOpens,opened+1);assert.equal(modalCloses,closed+1);assert.equal(d.querySelectorAll('.clip').length,2);record('una selección de varios archivos usa una ventana hasta terminar todo el lote, incluso con un fallo parcial');
    const all=[...d.querySelector('#exportFormat').options].map(option=>option.value);assert.deepEqual(all,['mp3','wav','flac','ogg']);record('el selector ofrece MP3, WAV, FLAC y OGG Vorbis');
    d.querySelector('#exportBtn').click();
    for(const format of all){const select=d.querySelector('#exportFormat');select.value=format;select.dispatchEvent(new w.Event('change'));for(const [id,type] of [['Bitrate','mp3'],['OggQuality','ogg'],['FlacBits','flac']]){assert.equal(d.querySelector('#export'+id+'Field').hidden,type!==format);assert.equal(d.querySelector('#export'+id).disabled,type!==format);}assert.ok(d.querySelector('#exportFormatHint').textContent.length>10);}
    record('cada formato muestra únicamente sus ajustes de calidad y mantiene disponibles las cuatro opciones de contenido');
    d.querySelector('#exportFormat').value='flac';d.querySelector('#exportFormat').dispatchEvent(new w.Event('change'));d.querySelector('#exportFlacBits').value='16';d.querySelector('#exportFlacBits').dispatchEvent(new w.Event('change'));assert.match(d.querySelector('#exportAudioSpec').textContent,/16 bits/);d.querySelector('#exportDialog').close();d.querySelector('#exportBtn').click();assert.equal(d.querySelector('#exportFormat').value,'flac');assert.equal(d.querySelector('#exportFlacBits').value,'16');record('la ventana recuerda el formato elegido y actualiza la profundidad FLAC');
    assert.deepEqual(errors,[]);results.push({url,checks,errors});
  }finally{for(const timer of timers)clearTimeout(timer);dom.window.close();}
}
if(process.env.VIVA_DOM_REPORT)fs.writeFileSync(process.env.VIVA_DOM_REPORT,JSON.stringify({version:VERSION,model:'DOM, audio y carga simulados; no es una prueba de navegador real',results},null,2)+'\n');
console.log(JSON.stringify({addresses:results.length,checks:results.reduce((n,result)=>n+result.checks.length,0),errors:results.flatMap(result=>result.errors)}));
