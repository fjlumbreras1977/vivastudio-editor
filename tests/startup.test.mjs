import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSplashController,initWebStartupSplash,finishWebStartupSplash} from '../startup.js';

function clock(){
  let time=0,id=0;const tasks=new Map();
  return {now:()=>time,setTimer(fn,delay){const key=++id;tasks.set(key,{fn,at:time+delay});return key;},clearTimer:key=>tasks.delete(key),
    tick(delta){const end=time+delta;for(;;){const next=[...tasks].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;tasks.delete(next[0]);next[1].fn();}time=end;},get count(){return tasks.size;}};
}
function setup(options={}){const c=clock(),closed=[];const splash=createSplashController({...c,...options,onClose:()=>closed.push(c.now())});return {c,splash,closed};}

test('la portada se mantiene 2500 ms desde que está pintada, con el editor listo',()=>{const {c,splash,closed}=setup();splash.ready();c.tick(800);assert.equal(closed.length,0);splash.imageReady();c.tick(2499);assert.equal(closed.length,0);c.tick(1);assert.deepEqual(closed,[3300]);assert.equal(c.count,0);});
test('si la preparación del editor es lenta, espera después de los 2500 ms',()=>{const {c,splash,closed}=setup();splash.imageReady();c.tick(4000);assert.deepEqual(closed,[]);splash.ready();assert.deepEqual(closed,[4000]);});
test('el tiempo de una pestaña oculta no cuenta como portada visible',()=>{const {c,splash,closed}=setup();splash.ready();splash.imageReady();c.tick(1000);splash.visibility(false);c.tick(10000);assert.equal(closed.length,0);splash.visibility(true);c.tick(1499);assert.equal(closed.length,0);c.tick(1);assert.deepEqual(closed,[12500]);});
test('si se abre en segundo plano, empieza a contar al mostrar la pestaña',()=>{const {c,splash,closed}=setup({visible:false});splash.ready();splash.imageReady();c.tick(20000);assert.equal(closed.length,0);splash.visibility(true);c.tick(2500);assert.deepEqual(closed,[22500]);});
test('cancelar por imagen o arranque fallido permite continuar y limpia el temporizador',()=>{const {c,splash,closed}=setup();splash.imageReady();c.tick(100);splash.cancel();splash.cancel();splash.ready();c.tick(10000);assert.deepEqual(closed,[100]);assert.equal(c.count,0);});

function eventTarget(){const handlers=new Map();return {addEventListener(type,fn){handlers.set(type,fn);},removeEventListener(type,fn){if(handlers.get(type)===fn)handlers.delete(type);},emit:type=>handlers.get(type)?.(),get listeners(){return handlers.size;}};}
test('integración: bloquea la elección, espera decode y dos fotogramas, y devuelve el foco',async()=>{
  const c=clock(),raf=new Map();let nextFrame=0,focus=0,decoded=false;const attrs=new Set(),classes=new Set(['web-starting']);
  const splash={hidden:false},screen={hidden:false,hasAttribute:name=>attrs.has(name),setAttribute:name=>attrs.add(name),removeAttribute:name=>attrs.delete(name)};
  const image={...eventTarget(),complete:true,naturalWidth:907,decode:async()=>{decoded=true;}};
  const doc={...eventTarget(),visibilityState:'visible',documentElement:{classList:{remove:name=>classes.delete(name)}},getElementById:id=>({webStartupSplash:splash,webStartupImage:image,startScreen:screen,emptyBlank:{focus:()=>focus++}}[id])};
  const win=eventTarget(),previous={};
  for(const [key,value] of Object.entries({document:doc,window:win,performance:{now:c.now},setTimeout:c.setTimer,clearTimeout:c.clearTimer,requestAnimationFrame:fn=>{const id=++nextFrame;raf.set(id,fn);return id;},cancelAnimationFrame:id=>raf.delete(id)})){previous[key]=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
  try{
    const controller=initWebStartupSplash();controller.ready();assert.ok(attrs.has('inert'));assert.equal(splash.hidden,false);await Promise.resolve();assert.ok(decoded);
    c.tick(1000);assert.equal(splash.hidden,false);
    const frame=()=>{const entries=[...raf];raf.clear();entries.forEach(([,fn])=>fn());};frame();c.tick(20);assert.equal(splash.hidden,false);frame();c.tick(2499);assert.equal(splash.hidden,false);c.tick(1);
    assert.equal(splash.hidden,true);assert.equal(attrs.has('inert'),false);assert.equal(classes.has('web-starting'),false);assert.equal(focus,1);assert.equal(doc.listeners,0);assert.equal(image.listeners,0);assert.equal(win.listeners,0);assert.equal(c.count,0);finishWebStartupSplash();
  }finally{for(const [key,descriptor] of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});

test('el HTML entregado contiene la imagen seleccionada byte por byte y no necesita un recurso remoto',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const match=html.match(/<img id="webStartupImage" src="data:image\/jpeg;base64,([A-Za-z0-9+/=]+)"/);
  assert.ok(match);assert.deepEqual(Buffer.from(match[1],'base64'),fs.readFileSync(new URL('../portada-vass.jpg',import.meta.url)));
  assert.ok(html.includes('object-fit:contain'));assert.ok(html.includes('data-studio-version="1.16.0"'));
  assert.ok(html.includes('startupSplash.ready()'));assert.ok(html.includes('function showStartupError(e){finishWebStartupSplash();'));
});
