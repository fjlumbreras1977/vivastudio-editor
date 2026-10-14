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

test('la portada se cierra a los 5000 ms sin esperar al editor',()=>{const {c,splash,closed}=setup();c.tick(4999);assert.equal(splash.closed,false);c.tick(1);assert.deepEqual(closed,[5000]);assert.equal(splash.closed,true);assert.equal(c.count,0);});
test('la preparación del editor no reinicia ni prolonga el temporizador',()=>{const {c,splash,closed}=setup();c.tick(1000);splash.ready();c.tick(3999);assert.deepEqual(closed,[]);c.tick(1);assert.deepEqual(closed,[5000]);splash.ready();c.tick(6000);assert.deepEqual(closed,[5000]);});
test('un arranque lento tampoco mantiene la portada más de cinco segundos',()=>{const {c,splash,closed}=setup();c.tick(10000);assert.deepEqual(closed,[5000]);splash.ready();assert.deepEqual(closed,[5000]);});
test('cancelar por imagen o arranque fallido permite continuar y limpia el temporizador',()=>{const {c,splash,closed}=setup();c.tick(100);splash.cancel();splash.cancel();splash.ready();c.tick(10000);assert.deepEqual(closed,[100]);assert.equal(c.count,0);});

function eventTarget(){const handlers=new Map();return {addEventListener(type,fn){handlers.set(type,fn);},removeEventListener(type,fn){if(handlers.get(type)===fn)handlers.delete(type);},emit:type=>handlers.get(type)?.(),get listeners(){return handlers.size;}};}
function fakePage({imageComplete=true,imageWidth=907,originalInert=false}={}){
  const c=clock();let focus=0;const attrs=new Set(originalInert?['inert']:[]),classes=new Set(['web-starting']);
  const splash={hidden:false,isConnected:true,remove(){this.isConnected=false;}},screen={hidden:false,hasAttribute:name=>attrs.has(name),setAttribute:name=>attrs.add(name),removeAttribute:name=>attrs.delete(name)};
  const image={...eventTarget(),complete:imageComplete,naturalWidth:imageWidth,decode(){throw Error('No debe esperar a decode');}};
  const doc={visibilityState:'visible',documentElement:{classList:{remove:name=>classes.delete(name)}},getElementById:id=>({webStartupSplash:splash.isConnected?splash:null,webStartupImage:image,startScreen:screen,emptyBlank:{focus:()=>focus++}}[id])};
  const win=eventTarget(),previous={};
  for(const [key,value] of Object.entries({document:doc,window:win,setTimeout:c.setTimer,clearTimeout:c.clearTimer,requestAnimationFrame(){throw Error('No debe esperar a un fotograma');}})){previous[key]=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
  return {c,splash,screen,image,doc,win,attrs,classes,get focus(){return focus;},restore(){finishWebStartupSplash();for(const [key,descriptor] of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}};
}
test('integración: retira la imagen y devuelve las opciones y el foco a los cinco segundos',()=>{
  const page=fakePage();try{
    initWebStartupSplash();assert.ok(page.attrs.has('inert'));page.c.tick(4999);assert.equal(page.splash.isConnected,true);page.c.tick(1);
    assert.equal(page.splash.hidden,true);assert.equal(page.splash.isConnected,false);assert.equal(page.attrs.has('inert'),false);assert.equal(page.classes.has('web-starting'),false);assert.equal(page.focus,1);assert.equal(page.image.listeners,0);assert.equal(page.win.listeners,0);assert.equal(page.c.count,0);
  }finally{page.restore();}
});
test('una imagen pendiente y una pestaña oculta no bloquean la retirada de la portada',()=>{
  const page=fakePage({imageComplete:false,imageWidth:0});try{initWebStartupSplash();page.doc.visibilityState='hidden';page.c.tick(5000);assert.equal(page.splash.isConnected,false);assert.equal(page.attrs.has('inert'),false);assert.equal(page.focus,0);}finally{page.restore();}
});
test('un error de imagen retira la portada sin esperar el temporizador',()=>{
  const page=fakePage({imageComplete:false});try{initWebStartupSplash();page.image.emit('error');assert.equal(page.splash.isConnected,false);assert.equal(page.attrs.has('inert'),false);assert.equal(page.c.count,0);}finally{page.restore();}
});
test('al retirarse conserva un bloqueo previo del cuadro de inicio',()=>{
  const page=fakePage({originalInert:true});try{initWebStartupSplash();page.c.tick(5000);assert.equal(page.splash.isConnected,false);assert.equal(page.attrs.has('inert'),true);}finally{page.restore();}
});

test('el HTML entregado contiene la imagen seleccionada byte por byte y no necesita un recurso remoto',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const match=html.match(/<img id="webStartupImage" src="data:image\/jpeg;base64,([A-Za-z0-9+/=]+)"/);
  assert.ok(match);assert.deepEqual(Buffer.from(match[1],'base64'),fs.readFileSync(new URL('../portada-vass.jpg',import.meta.url)));
  assert.ok(html.includes('object-fit:contain'));const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;assert.ok(html.includes(`data-studio-version="${version}"`));
  assert.ok(html.includes('startupSplash.ready()'));assert.ok(html.includes('function showStartupError(e){finishWebStartupSplash();'));
});


test('la portada queda dentro del cuadro de inicio y no oculta el editor alrededor',()=>{
  const template=fs.readFileSync(new URL('../index.template.html',import.meta.url),'utf8');
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../style.css',import.meta.url),'utf8');
  for(const source of [template,html]){
    assert.ok(source.includes('<div id="emptyState" class="empty-state"><div id="webStartupSplash"'));
    assert.equal((source.match(/id="webStartupSplash"/g)||[]).length,1);
  }
  const rule=css.match(/\.web-startup-splash\{([^}]+)\}/)[1];
  assert.ok(rule.includes('position:absolute'));assert.ok(rule.includes('inset:0'));
  assert.ok(css.includes('#startScreen .empty-state{position:relative'));
  assert.ok(css.includes('html.web-starting #emptyState>:not(#webStartupSplash){visibility:hidden}'));
  assert.ok(css.includes('#webStartupSplash[hidden]{display:none}'));
  assert.ok(!css.includes('html.web-starting body>'));
  assert.ok(!rule.includes('position:fixed'));
});
