import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProject,makeTrackEffects,trackEffects,hasTrackEffects,validateTrackEffects,packProject,unpackProject,makeClip,cloneProject} from '../core.js';
import {makeVintageCurve,createLiveNativeTrackEffects} from '../effects.js';
import {AudioEngine} from '../engine.js';

test('EQ vintage es independiente por pista, se conserva en proyectos y mantiene compatibles las sesiones anteriores',async()=>{
  const project=makeProject();project.tracks[0].effects.vintage.enabled=true;project.tracks[0].effects.vintage.model='warm';project.tracks[0].effects.vintage.midGain=4;
  assert.equal(project.tracks[1].effects.vintage.enabled,false);assert.ok(hasTrackEffects(project.tracks[0]));
  const loaded=await unpackProject(packProject({project,sources:{}}));assert.deepEqual(loaded.project,project);
  for(const track of project.tracks)delete track.effects.vintage;
  const previous=await unpackProject(packProject({project,sources:{}}));assert.equal(trackEffects(previous.project.tracks[0]).vintage.enabled,false);assert.equal(hasTrackEffects(previous.project.tracks[0]),false);
});
test('rechaza valores no finitos, rangos inválidos y caracteres desconocidos del nuevo efecto',()=>{
  for(const mutate of [v=>v.saturation=NaN,v=>v.warmth=2,v=>v.output=18,v=>v.lowFrequency=1,v=>v.bandwidth=0,v=>v.model='unknown',v=>v.enabled=1]){const e=makeTrackEffects();mutate(e.vintage);assert.throws(()=>validateTrackEffects(e),/vintage/);}
});
test('la saturación colorea una onda, respeta el silencio y el modo sin saturación es lineal',()=>{
  const neutral=makeVintageCurve(0),curves=['classic','warm','dirty'].map(model=>makeVintageCurve(.65,model));
  for(let i=0;i<neutral.length;i++)assert.ok(Math.abs(neutral[i]-(i/4096*2-1))<1e-7);
  for(const curve of curves){assert.equal(curve[2048],0);assert.ok(curve.every(v=>Number.isFinite(v)&&Math.abs(v)<=1.000001));assert.notDeepEqual(curve,neutral);}
  assert.notDeepEqual(curves[0],curves[1]);assert.notDeepEqual(curves[1],curves[2]);
  // A pure sine gains real higher harmonic content after the nonlinear curve.
  const amplitude=(curve,harmonic)=>{let sin=0,cos=0;for(let i=0;i<4096;i++){const phase=2*Math.PI*i/4096,x=.4*Math.sin(phase),at=(x+1)*2048,k=Math.floor(at),mix=at-k,y=curve[k]*(1-mix)+curve[k+1]*mix;sin+=y*Math.sin(phase*harmonic);cos+=y*Math.cos(phase*harmonic);}return Math.hypot(sin,cos)*2/4096;};
  assert.ok(amplitude(curves[0],3)>.025);assert.ok(amplitude(curves[1],2)>.025);assert.ok(amplitude(neutral,3)<1e-6);
});

class Param{constructor(){this.value=0;}setValueAtTime(v){this.value=v;}linearRampToValueAtTime(){}setTargetAtTime(v){this.value=v;}cancelScheduledValues(){}}
class Node{constructor(kind){this.kind=kind;this.connected=[];for(const key of ['gain','frequency','Q','pan','threshold','knee','ratio','attack','release','delayTime'])this[key]=new Param();}connect(node){this.connected.push(node);}disconnect(){this.disconnected=true;}start(...args){this.started=args;}stop(){this.stopped=true;}}
class Context{constructor(){this.currentTime=0;this.sampleRate=44100;this.state='running';this.created=[];this.destination=new Node('destination');}node(kind){const node=new Node(kind);this.created.push(node);return node;}createGain(){return this.node('gain');}createBiquadFilter(){return this.node('filter');}createWaveShaper(){return this.node('shape');}createStereoPanner(){return this.node('pan');}createAnalyser(){return this.node('analyser');}createBufferSource(){return this.node('source');}createDelay(){return this.node('delay');}}
test('los controles vintage cambian en una ruta existente y el bypass recupera el original',()=>{
  const ctx=new Context(),track=makeProject().tracks[0],input=ctx.createGain(),fx=createLiveNativeTrackEffects(ctx,input,track),connections=input.connected.slice();
  const dry=fx.nodes.filter(n=>n.kind==='gain')[3],wet=fx.nodes.filter(n=>n.kind==='gain')[4];assert.equal(dry.gain.value,1);assert.equal(wet.gain.value,0);
  track.effects.vintage={...track.effects.vintage,enabled:true,midFrequency:2300,midGain:5,bandwidth:1.2,mix:.6};fx.update(track.effects);
  assert.deepEqual(input.connected,connections);assert.equal(dry.gain.value,.4);assert.equal(wet.gain.value,.6);assert.ok(ctx.created.some(n=>n.type==='peaking'&&n.frequency.value===2300&&n.gain.value===5&&n.Q.value===1.2));
  track.effects.vintage.enabled=false;fx.update(track.effects);assert.equal(dry.gain.value,1);assert.equal(wet.gain.value,0);fx.dispose();assert.equal(fx.nodes.length,0);
});
test('ajustar y cancelar el efecto preserva el cursor, las fuentes y la reproducción de otras pistas',async()=>{
  const ctx=new Context(),project=makeProject(),buffer={length:441000,numberOfChannels:1,sampleRate:44100,duration:10};project.tracks[0].clips=[makeClip('s','Voz',10)];project.tracks[1].clips=[makeClip('s','Música',10)];
  const engine=new AudioEngine(new Map([['s',buffer]]));engine.context=ctx;
  await engine.play(project,0,10,0,{liveTrackId:project.tracks[0].id});ctx.currentTime=2;const cursor=engine.time,chain=engine.chains.get(project.tracks[0].id),other=engine.nodes.find(n=>n.kind==='source'&&n.trackId===project.tracks[1].id);engine.beginTrackEffectsPreview(project.tracks[0].id);
  const draft=cloneProject(project);draft.tracks[0].effects.vintage.enabled=true;draft.tracks[0].effects.vintage.saturation=.6;
  assert.equal(await engine.previewTrackEffects(draft,project.tracks[0].id),'native');assert.equal(engine.time,cursor);assert.equal(engine.chains.get(project.tracks[0].id),chain);assert.equal(other.stopped,undefined);assert.equal(project.tracks[0].effects.vintage.enabled,false);
  await engine.restoreTrackEffectsPreview(project,project.tracks[0].id);assert.equal(engine.chains.get(project.tracks[0].id),chain);assert.equal(engine.time,cursor);assert.equal(other.stopped,undefined);engine.stop();
});
