import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProject,makeTrackEffects,trackEffects,hasTrackEffects,validateTrackEffects,packProject,unpackProject,makeClip,cloneProject,trackEffectsTail} from '../core.js';
import {binauralPosition,createBinauralTrackEffects,createLiveNativeTrackEffects} from '../effects.js';
import {AudioEngine} from '../engine.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
class Param{constructor(){this.value=0;this.targets=[];}setValueAtTime(v){this.value=v;}linearRampToValueAtTime(){}setTargetAtTime(v,t,s){this.value=v;this.targets.push({v,t,s});}cancelScheduledValues(){}}
class Node{constructor(kind){this.kind=kind;this.connected=[];for(const key of ['gain','frequency','Q','pan','threshold','knee','ratio','attack','release','delayTime','positionX','positionY','positionZ'])this[key]=new Param();}connect(node){this.connected.push(node);}disconnect(){this.disconnected=true;}start(...args){this.started=args;}stop(){this.stopped=true;}}
class Context{constructor(){this.currentTime=0;this.sampleRate=44100;this.state='running';this.created=[];this.destination=new Node('destination');}node(kind){const n=new Node(kind);this.created.push(n);return n;}createGain(){return this.node('gain');}createBiquadFilter(){return this.node('filter');}createWaveShaper(){return this.node('shape');}createStereoPanner(){return this.node('pan');}createPanner(){return this.node('hrtf');}createAnalyser(){return this.node('analyser');}createBufferSource(){return this.node('source');}createDelay(){return this.node('delay');}}
test('Binaural 3D se inicia apagado, es independiente por pista y conserva proyectos anteriores',async()=>{
 const project=makeProject();assert.equal(project.tracks[0].effects.binaural.enabled,false);project.tracks[0].effects.binaural={enabled:true,azimuth:-70,elevation:25,distance:3,mix:.8,output:2};assert.ok(hasTrackEffects(project.tracks[0]));assert.equal(project.tracks[1].effects.binaural.enabled,false);
 const loaded=await unpackProject(packProject({project,sources:{}}));assert.deepEqual(loaded.project,project);
 for(const track of project.tracks)delete track.effects.binaural;
 const previous=await unpackProject(packProject({project,sources:{}}));assert.equal(trackEffects(previous.project.tracks[0]).binaural.enabled,false);assert.equal(hasTrackEffects(previous.project.tracks[0]),false);
});
test('Binaural 3D rechaza niveles, posiciones y datos no válidos',()=>{
 for(const mutate of [b=>b.enabled=1,b=>b.azimuth=181,b=>b.elevation=-91,b=>b.distance=0,b=>b.distance=21,b=>b.mix=1.1,b=>b.output=13,b=>b.azimuth=NaN,b=>b.elevation=Infinity]){const effects=makeTrackEffects();mutate(effects.binaural);assert.throws(()=>validateTrackEffects(effects),/Binaural/);}
});
test('las posiciones representan frente, izquierda, derecha, detrás, altura y distancia',()=>{
 for(const [azimuth,elevation,distance,expected] of [[0,0,1,[0,0,-1]],[-90,0,2,[-2,0,0]],[90,0,1,[1,0,0]],[180,0,1,[0,0,1]],[0,90,3,[0,3,0]],[0,-90,1,[0,-1,0]]]){const p=binauralPosition({azimuth,elevation,distance});[p.x,p.y,p.z].forEach((n,i)=>near(n,expected[i]));near(Math.hypot(p.x,p.y,p.z),distance);}
});
test('la ruta binaural usa HRTF real del navegador y mantiene el bypass original',()=>{
 const ctx=new Context(),input=ctx.createGain(),settings=makeTrackEffects().binaural,fx=createBinauralTrackEffects(ctx,input,settings),[dry,wet,sum]=fx.nodes;
 assert.equal(ctx.created.filter(n=>n.kind==='hrtf').length,0);assert.equal(dry.gain.value,1);assert.equal(wet.gain.value,0);
 fx.update({...settings,enabled:true,azimuth:-90,distance:2,mix:.75,output:6});const p=ctx.created.find(n=>n.kind==='hrtf');assert.equal(p.panningModel,'HRTF');assert.equal(p.channelCount,1);assert.equal(p.channelCountMode,'explicit');assert.equal(p.distanceModel,'inverse');assert.equal(p.refDistance,1);assert.equal(p.rolloffFactor,.5);near(p.positionX.value,-2);near(p.positionZ.value,0);assert.equal(dry.gain.value,.25);near(wet.gain.value,.75*Math.pow(10,6/20));assert.ok(p.connected.includes(wet)&&wet.connected.includes(sum));
 fx.update({...settings,enabled:true,azimuth:90,elevation:30,distance:3,mix:1});assert.equal(ctx.created.filter(n=>n.kind==='hrtf').length,1);assert.ok(p.positionX.targets.length>0);near(p.positionY.value,1.5);
 fx.update({...settings,enabled:false});assert.equal(dry.gain.value,1);assert.equal(wet.gain.value,0);
});
test('un navegador sin HRTF no simula el efecto con un simple balance',()=>{
 const ctx=new Context();ctx.createPanner=undefined;const settings=makeTrackEffects().binaural,fx=createBinauralTrackEffects(ctx,ctx.createGain(),settings);
 assert.throws(()=>fx.update({...settings,enabled:true}),/no permite Binaural/);assert.equal(fx.nodes[0].gain.value,1);assert.equal(fx.nodes[1].gain.value,0);
});
test('el nodo creado al activar el efecto se desconecta al finalizar la escucha',()=>{
 const ctx=new Context(),track=makeProject().tracks[0],fx=createLiveNativeTrackEffects(ctx,ctx.createGain(),track);track.effects.binaural.enabled=true;fx.update(track.effects);const p=ctx.created.find(n=>n.kind==='hrtf');assert.ok(fx.nodes.includes(p));fx.dispose();assert.equal(p.disconnected,true);assert.equal(fx.nodes.length,0);
});
test('editar y cancelar Binaural 3D conserva el cursor, las fuentes y las otras pistas',async()=>{
 const ctx=new Context(),project=makeProject(),buffer={length:441000,numberOfChannels:1,sampleRate:44100,duration:10};project.tracks[0].clips=[makeClip('s','Voz',10)];project.tracks[1].clips=[makeClip('s','Música',10)];
 const engine=new AudioEngine(new Map([['s',buffer]]));engine.context=ctx;await engine.play(project,0,10,undefined,{liveTrackId:project.tracks[0].id});ctx.currentTime=2;const cursor=engine.time,chain=engine.chains.get(project.tracks[0].id),sources=engine.nodes.filter(n=>n.kind==='source');engine.beginTrackEffectsPreview(project.tracks[0].id);
 const draft=cloneProject(project);draft.tracks[0].effects.binaural.enabled=true;draft.tracks[0].effects.binaural.azimuth=90;assert.equal(await engine.previewTrackEffects(draft,project.tracks[0].id),'native');assert.equal(engine.time,cursor);assert.equal(engine.chains.get(project.tracks[0].id),chain);assert.ok(sources.every(n=>!n.stopped));assert.equal(project.tracks[0].effects.binaural.enabled,false);assert.equal(engine.outputEnd,10.1);
 await engine.restoreTrackEffectsPreview(project,project.tracks[0].id);assert.equal(engine.time,cursor);assert.ok(sources.every(n=>!n.stopped));assert.equal(engine.outputEnd,10);engine.stop();assert.equal(ctx.created.find(n=>n.kind==='hrtf').disconnected,true);
});
test('la exportación estéreo programa el mismo HRTF y conserva el final del audio',async()=>{
 let ctx;class OfflineContext extends Context{constructor(channels,frames,rate){super();this.channels=channels;this.frames=frames;this.sampleRate=rate;ctx=this;}startRendering(){return Promise.resolve({numberOfChannels:this.channels,length:this.frames,sampleRate:this.sampleRate});}}
 const previous=globalThis.OfflineAudioContext;globalThis.OfflineAudioContext=OfflineContext;try{
 const project=makeProject(),track=project.tracks[0];track.clips=[makeClip('s','Voz',3)];track.effects.binaural={enabled:true,azimuth:180,elevation:20,distance:2,mix:1,output:-2};const engine=new AudioEngine(new Map([['s',{length:132300,numberOfChannels:1,sampleRate:44100,duration:3}]]));const rendered=await engine.render(project,1,3);assert.equal(rendered.numberOfChannels,2);assert.equal(rendered.length,Math.ceil(2.1*44100));const p=ctx.created.find(n=>n.kind==='hrtf');assert.equal(p.panningModel,'HRTF');near(p.positionY.value,2*Math.sin(20*Math.PI/180));assert.ok(p.positionZ.value>0);assert.deepEqual(ctx.created.find(n=>n.kind==='source').started,[0,1,2]);
 }finally{if(previous===undefined)delete globalThis.OfflineAudioContext;else globalThis.OfflineAudioContext=previous;}
});
test('la cola binaural se suma a la reverb y respeta mezcla cero, pistas muteadas y rango',()=>{
 const project=makeProject(),t=project.tracks[0];t.clips=[makeClip('s','Voz',3)];t.effects.binaural.enabled=true;assert.equal(trackEffectsTail(project),.1);t.effects.reverb.enabled=true;near(trackEffectsTail(project),1.92);t.effects.binaural.mix=0;near(trackEffectsTail(project),1.82);t.mute=true;assert.equal(trackEffectsTail(project),0);t.mute=false;assert.equal(trackEffectsTail(project,4,5),0);
});
