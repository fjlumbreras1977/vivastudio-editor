import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProject,makeClip,makeTrackEffects,validateProject,validateTrackEffects,trackEffectsTail,packProject,unpackProject,joinAudioPlan} from '../core.js';
import {processVoiceEffects,detectVoicePitch,nearestScaleNote} from '../effects-dsp.js';
import {TrackEffectsProcessor,makeReverbImpulse,createNativeTrackEffects} from '../effects.js';
import {AudioEngine} from '../engine.js';
const rate=44100,sine=(frequency,length=rate)=>Float32Array.from({length},(_,i)=>.3*Math.sin(2*Math.PI*frequency*i/rate));
const frequency=data=>detectVoicePitch(data,rate,Math.floor(data.length*.6),40,2000)?.frequency;
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<Math.max(1.2,expected*.006),actual+' vs '+expected);
class Param{constructor(){this.value=0;}setValueAtTime(){}linearRampToValueAtTime(){}setTargetAtTime(v){this.value=v;}}
class Node{constructor(type){this.kind=type;this.connected=[];for(const k of ['gain','pan','frequency','Q','threshold','knee','ratio','attack','release','delayTime'])this[k]=new Param();}connect(node){this.connected.push(node);}disconnect(){this.disconnected=true;}start(...args){this.started=args;}stop(){this.stopped=true;}}
class Buffer{constructor(ch,length,sampleRate){this.numberOfChannels=ch;this.length=length;this.sampleRate=sampleRate;this.duration=length/sampleRate;this.channels=Array.from({length:ch},()=>new Float32Array(length));}getChannelData(ch){return this.channels[ch];}copyToChannel(data,ch){this.channels[ch].set(data);}}
class Context{constructor(){this.sampleRate=rate;this.currentTime=0;this.state='running';this.destination=new Node('destination');this.created=[];}node(type){const node=new Node(type);this.created.push(node);return node;}createBuffer(...args){return new Buffer(...args);}createGain(){return this.node('gain');}createStereoPanner(){return this.node('pan');}createBiquadFilter(){return this.node('filter');}createDynamicsCompressor(){return this.node('compressor');}createAnalyser(){return this.node('analyser');}createBufferSource(){return this.node('source');}createDelay(max){const n=this.node('delay');n.max=max;return n;}createConvolver(){return this.node('convolver');}createWaveShaper(){return this.node('shaper');}}
class WorkerMock{constructor(){this.terminated=false;}postMessage(data){queueMicrotask(()=>{if(this.terminated)return;const channels=processVoiceEffects(data.channels,data.rate,data.settings);this.onmessage({data:{type:'done',channels}});});}terminate(){this.terminated=true;}}
test('pitch raises and lowers actual frequency without moving samples or altering the source',()=>{
  const input=sine(440),original=input.slice();
  for(const semitones of [-12,7,12]){const settings=makeTrackEffects();settings.pitch={enabled:true,semitones};const result=processVoiceEffects([input],rate,settings)[0];assert.equal(result.length,input.length);near(frequency(result),440*2**(semitones/12));assert.ok(result.every(Number.isFinite));}
  assert.deepEqual(input,original);
});
test('Autotune detects voiced pitch, follows the chosen scale and responds to its intensity',()=>{
  const input=sine(430),settings=makeTrackEffects();settings.autotune.enabled=true;settings.autotune.speed=0;settings.autotune.tolerance=0;
  near(frequency(processVoiceEffects([input],rate,settings)[0]),440);
  settings.autotune.root=1;settings.autotune.scale='major';near(frequency(processVoiceEffects([input],rate,settings)[0]),440*2**(-1/12));
  settings.autotune.scale='chromatic';settings.autotune.amount=.5;near(frequency(processVoiceEffects([input],rate,settings)[0]),Math.sqrt(430*440));
  settings.autotune.amount=0;assert.deepEqual(processVoiceEffects([input],rate,settings)[0],input);
  assert.equal(nearestScaleNote(60.8,0,'major'),60);assert.equal(nearestScaleNote(60.8,2,'major'),61);
});
test('silence is not tuned and stereo channels retain their independent pitched content',()=>{
  const settings=makeTrackEffects();settings.autotune.enabled=true;assert.equal(detectVoicePitch(new Float32Array(rate),rate,rate/2),null);assert.ok(processVoiceEffects([new Float32Array(rate)],rate,settings)[0].every(v=>v===0));
  settings.autotune.enabled=false;settings.pitch={enabled:true,semitones:12};const result=processVoiceEffects([sine(440),sine(660)],rate,settings);near(frequency(result[0]),880);near(frequency(result[1]),1320);assert.equal(result[0].length,result[1].length);
});
test('new effects are independent per track, portable, validated, and old projects remain valid',async()=>{
  const p=makeProject();p.tracks[0].effects.reverb.enabled=true;assert.equal(p.tracks[1].effects.reverb.enabled,false);
  const raw={project:p,sources:{}};const loaded=await unpackProject(packProject(raw));assert.deepEqual(loaded.project.tracks[0].effects,p.tracks[0].effects);
  for(const t of p.tracks)delete t.effects;assert.doesNotThrow(()=>validateProject(raw));
  for(const mutate of [e=>e.pitch.semitones=Infinity,e=>e.phone.lowCut=4000,e=>e.autotune.minHz=1200,e=>e.autotune.root=12,e=>e.autotune.scale='unsafe',e=>e.reverb.decay=-1]){const e=makeTrackEffects();mutate(e);assert.throws(()=>validateTrackEffects(e));}
});
test('joining does not bake track effects twice and reverb tails include only audible overlapping tracks',()=>{
  const p=makeProject(),a=makeClip('s','A',2),b=makeClip('s','B',2,2);p.tracks[0].clips=[a,b];p.tracks[0].effects.reverb={enabled:true,mix:.5,decay:2,preDelay:.1};p.tracks[0].effects.pitch={enabled:true,semitones:7};
  assert.equal(trackEffectsTail(p),2.1);assert.equal(trackEffectsTail(p,5,6),0);p.tracks[0].mute=true;assert.equal(trackEffectsTail(p),0);p.tracks[0].mute=false;
  const joined=joinAudioPlan(p,[a.id,b.id]);assert.deepEqual(joined.project.tracks[0].effects,makeTrackEffects());assert.equal(p.tracks[0].effects.pitch.semitones,7);
});
test('native telephone and reverb route separate wet/dry signals and use stereo decay impulses',()=>{
  const ctx=new Context(),track=makeProject().tracks[0],input=ctx.createGain();track.effects.phone.enabled=true;track.effects.phone.mix=.4;track.effects.reverb.enabled=true;track.effects.reverb.mix=.2;
  const fx=createNativeTrackEffects(ctx,input,track);assert.ok(fx.output!==input);assert.equal(ctx.created.find(n=>n.type==='highpass').frequency.value,300);assert.equal(ctx.created.find(n=>n.type==='lowpass').frequency.value,3400);assert.equal(ctx.created.find(n=>n.kind==='shaper').curve.length,4096);
  const impulse=makeReverbImpulse(ctx,2);assert.equal(impulse.numberOfChannels,2);assert.equal(impulse.length,rate*2);assert.notDeepEqual(impulse.channels[0],impulse.channels[1]);assert.ok(impulse.channels[0].every(Number.isFinite));assert.ok(Math.abs(impulse.channels[0].at(-1))<.002);
});
test('processed buffers are reused at identical settings while originals remain editable',async()=>{
  const ctx=new Context(),buffer=ctx.createBuffer(1,rate,rate);buffer.copyToChannel(sine(440),0);const original=buffer.getChannelData(0).slice(),p=makeProject();p.tracks[0].clips=[makeClip('s','Voz',1)];p.tracks[0].effects.pitch={enabled:true,semitones:12};let workers=0;
  const processor=new TrackEffectsProcessor(()=>{workers++;return new WorkerMock();}),sources=new Map([['s',buffer]]),key=p.tracks[0].id+':s';
  const first=await processor.prepare(p,sources,ctx),second=await processor.prepare(p,sources,ctx);assert.equal(workers,1);assert.equal(first.get(key),second.get(key));near(frequency(first.get(key).getChannelData(0)),880);assert.deepEqual(buffer.getChannelData(0),original);
  p.tracks[0].effects.pitch.semitones=-12;const changed=await processor.prepare(p,sources,ctx);assert.equal(workers,2);near(frequency(changed.get(key).getChannelData(0)),220);
});
test('cancelling a pending effect stops its worker and releases the job',async()=>{
  const processor=new TrackEffectsProcessor(()=>({postMessage(){},terminate(){this.terminated=true;}})),ctx=new Context(),buffer=ctx.createBuffer(1,rate,rate),p=makeProject();p.tracks[0].clips=[makeClip('s','Voz',1)];p.tracks[0].effects.pitch={enabled:true,semitones:7};
  const pending=processor.prepare(p,new Map([['s',buffer]]),ctx);processor.cancel();await assert.rejects(pending,{name:'AbortError'});assert.equal(processor.jobs.size,0);
});
test('playback and offline export schedule processed sources at the same offsets and preserve the reverb tail',async()=>{
  const ctx=new Context(),buffer=ctx.createBuffer(1,rate,rate);buffer.copyToChannel(sine(430),0);const p=makeProject(),clip=makeClip('s','Voz',.5,.2);clip.offset=.25;p.tracks[0].clips=[clip];p.tracks[0].effects.pitch={enabled:true,semitones:12};p.tracks[0].effects.reverb={enabled:true,mix:.3,decay:1,preDelay:.05};
  const engine=new AudioEngine(new Map([['s',buffer]]));engine.context=ctx;engine.effectsProcessor=new TrackEffectsProcessor(()=>new WorkerMock());await engine.play(p,.2,.7);const source=ctx.created.find(n=>n.kind==='source');near(frequency(source.buffer.getChannelData(0)),860);source.started.forEach((value,i)=>assert.ok(Math.abs(value-[.035,.25,.5][i])<1e-9));assert.equal(engine.outputEnd,1.75);
  const chain=engine.chains.get(p.tracks[0].id);p.tracks[0].mute=true;engine.updateTrack(p.tracks[0],p);assert.equal(chain.gain.gain.value,0,'muting the output also silences reverb tails');p.tracks[0].mute=false;engine.stop();
  let offline;const prior=globalThis.OfflineAudioContext;globalThis.OfflineAudioContext=class extends Context{constructor(ch,frames,sampleRate){super();offline=this;this.frames=frames;this.sampleRate=sampleRate;}async startRendering(){return this.createBuffer(2,this.frames,this.sampleRate);}};
  try{const rendered=await engine.render(p,.2,.7);assert.ok(Math.abs(rendered.length-1.55*rate)<=1);assert.ok(Math.abs(offline.created.find(n=>n.kind==='source').started[2]-.5)<1e-9,'the tail does not schedule audio beyond the selected range');}finally{globalThis.OfflineAudioContext=prior;}
});
