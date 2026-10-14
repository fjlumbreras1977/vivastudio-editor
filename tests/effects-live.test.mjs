import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {LiveVoiceEffects} from '../effects-live-dsp.js';
import {detectVoicePitch} from '../effects-dsp.js';
import {AudioEngine} from '../engine.js';
import {createLiveNativeTrackEffects,TrackEffectsProcessor} from '../effects.js';
import {makeProject,makeClip,makeTrackEffects,cloneProject} from '../core.js';
const rate=44100;
const tone=(hz,n=rate*2)=>Float32Array.from({length:n},(_,i)=>.3*Math.sin(2*Math.PI*hz*i/rate));
const frequency=(data,at=data.length*.75)=>detectVoicePitch(data,rate,Math.floor(at),40,2000)?.frequency;
const near=(value,expected)=>assert.ok(Math.abs(value-expected)<2,`${value} vs ${expected}`);
function stream(input,settings,mutate=null){
  const fx=new LiveVoiceEffects(rate,settings),output=[new Float32Array(input[0].length),new Float32Array(input[0].length)];
  let at=0,block=0;
  while(at<input[0].length){if(mutate)mutate(fx,at);const count=Math.min([128,256,64,128][block++%4],input[0].length-at),part=[new Float32Array(count),new Float32Array(count)];fx.process(input.map(channel=>channel.subarray(at,at+count)),part);part.forEach((channel,i)=>output[i].set(channel,at));at+=count;}
  return {fx,output};
}
test('streaming pitch changes actual frequency in bounded stereo buffers and preserves source audio',()=>{
  const input=[tone(440),tone(660)],original=input[0].slice();
  for(const semitones of [-12,12]){const settings=makeTrackEffects();settings.pitch={enabled:true,semitones};const {fx,output}=stream(input,settings);near(frequency(output[0]),440*2**(semitones/12));near(frequency(output[1]),660*2**(semitones/12));assert.ok(output.every(channel=>channel.every(Number.isFinite)));assert.equal(fx.states[0].input.length,8192);assert.equal(fx.states[0].output.length,8192);assert.equal(fx.samples,input[0].length);}
  assert.deepEqual(input[0],original);
});
test('live Autotune follows root, scale and intensity changes while processing a mono voice',()=>{
  const settings=makeTrackEffects();settings.autotune.enabled=true;settings.autotune.speed=0;settings.autotune.tolerance=0;
  const input=tone(430,rate*3);let switched=false;
  const {output}=stream([input],settings,(fx,at)=>{if(at>=rate*1.5&&!switched){switched=true;const changed=cloneProject(settings);changed.autotune.root=1;changed.autotune.scale='major';fx.setSettings(changed);}});
  near(frequency(output[0],rate),440);near(frequency(output[0],rate*2.5),440*2**(-1/12));assert.deepEqual(output[0],output[1]);
  settings.autotune.amount=0;near(frequency(stream([input],settings).output[0]),430);
});
test('pitch and bypass settings change on a running stream and silence stays finite',()=>{
  const settings=makeTrackEffects(),input=tone(440,rate*3);let changed=false;
  const {output}=stream([input],settings,(fx,at)=>{if(at>rate&&!changed){changed=true;const next=makeTrackEffects();next.pitch={enabled:true,semitones:12};fx.setSettings(next);}});
  near(frequency(output[0],rate*.75),440);near(frequency(output[0],rate*2),880);
  settings.autotune.enabled=true;assert.ok(stream([new Float32Array(rate)],settings).output[0].every(value=>value===0));
});
class Param{constructor(){this.value=0;this.events=[];}setValueAtTime(v,t){this.value=v;this.events.push(['set',v,t]);}linearRampToValueAtTime(v,t){this.events.push(['ramp',v,t]);}setTargetAtTime(v,t){this.value=v;this.events.push(['target',v,t]);}cancelScheduledValues(){}}
class Node{constructor(kind){this.kind=kind;this.connected=[];for(const key of ['gain','pan','frequency','Q','threshold','knee','ratio','attack','release','delayTime'])this[key]=new Param();}connect(node){this.connected.push(node);}disconnect(node){if(node)this.connected=this.connected.filter(n=>n!==node);else this.disconnected=true;}start(...args){this.started=args;}stop(time){this.stopped=time??true;}}
class Buffer{constructor(ch,length,sampleRate){this.numberOfChannels=ch;this.length=length;this.sampleRate=sampleRate;this.duration=length/sampleRate;this.channels=Array.from({length:ch},()=>new Float32Array(length));}getChannelData(ch){return this.channels[ch];}copyToChannel(data,ch){this.channels[ch].set(data);}}
class Context{constructor(){this.sampleRate=rate;this.currentTime=0;this.state='running';this.destination=new Node('destination');this.created=[];}node(kind){const n=new Node(kind);this.created.push(n);return n;}createBuffer(...args){return new Buffer(...args);}createGain(){return this.node('gain');}createStereoPanner(){return this.node('pan');}createBiquadFilter(){return this.node('filter');}createDynamicsCompressor(){return this.node('compressor');}createAnalyser(){return this.node('analyser');}createBufferSource(){return this.node('source');}createDelay(){return this.node('delay');}createConvolver(){return this.node('convolver');}createWaveShaper(){return this.node('shaper');}}
const setup=()=>{const ctx=new Context(),p=makeProject(),buffer=ctx.createBuffer(1,rate*4,rate);buffer.copyToChannel(tone(440,rate*4),0);p.tracks[0].clips=[makeClip('s','Voz',4)];p.tracks[1].clips=[makeClip('s','Base',4)];const engine=new AudioEngine(new Map([['s',buffer]]));engine.context=ctx;return {ctx,p,engine,buffer};};
test('native FX nodes update wet/dry, filters and decay without replacing the input or reusing a convolver buffer',()=>{
  const ctx=new Context(),track=makeProject().tracks[0],input=ctx.createGain(),fx=createLiveNativeTrackEffects(ctx,input,track),connections=input.connected.slice();
  track.effects.phone={enabled:true,mix:.7,lowCut:400,highCut:3000,drive:.3};track.effects.reverb={enabled:true,mix:.25,decay:.5,preDelay:.05};fx.update(track.effects);
  assert.deepEqual(input.connected,connections);assert.equal(ctx.created.find(n=>n.type==='highpass').frequency.value,400);assert.equal(ctx.created.find(n=>n.type==='lowpass').frequency.value,3000);const first=ctx.created.find(n=>n.kind==='convolver');assert.equal(first.buffer.length,rate*.5);
  track.effects.reverb.decay=.8;fx.update(track.effects);assert.equal(ctx.created.filter(n=>n.kind==='convolver').length,2);assert.equal(first.buffer.length,rate*.5);fx.dispose();assert.equal(fx.nodes.length,0);
});
test('native adjustments keep the timeline and other tracks running; new pitch settings reuse a live node',async()=>{
  const originalNode=globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode=class extends Node{constructor(ctx,name,options){super('worklet');this.settings=options.processorOptions.settings;this.port={messages:[],postMessage:message=>this.port.messages.push(message)};}};
  const {ctx,p,engine}=setup();let modules=0;ctx.audioWorklet={addModule:async()=>{modules++;}};
  try{
    await engine.play(p,0,4);ctx.currentTime=1;const before=engine.time,other=engine.nodes.find(n=>n.trackId===p.tracks[1].id&&n.kind==='source'),draft=cloneProject(p);draft.tracks[0].effects.reverb.enabled=true;
    await engine.previewTrackEffects(draft,p.tracks[0].id);assert.equal(engine.time,before);assert.equal(other.stopped,undefined);assert.equal(engine.outputEnd,5.82);assert.equal(p.tracks[0].effects.reverb.enabled,false);
    draft.tracks[0].effects.pitch={enabled:true,semitones:12};assert.equal(await engine.previewTrackEffects(draft,p.tracks[0].id),'live');const chain=engine.chains.get(p.tracks[0].id),source=engine.nodes.find(n=>n.trackId===p.tracks[0].id&&n.kind==='source');assert.ok(chain.voice);assert.equal(modules,1);
    draft.tracks[0].effects.pitch.semitones=-7;await engine.previewTrackEffects(draft,p.tracks[0].id);assert.equal(engine.chains.get(p.tracks[0].id),chain);assert.equal(source.stopped,undefined);assert.equal(chain.voice.port.messages.at(-1).settings.pitch.semitones,-7);assert.equal(other.stopped,undefined);assert.equal(engine.time,before);
    await engine.previewTrackEffects(p,p.tracks[0].id);assert.equal(chain.voice.port.messages.at(-1).settings.pitch.enabled,false);assert.equal(engine.outputEnd,4);engine.stop();assert.equal(chain.voice.port.messages.at(-1).type,'stop');assert.equal(engine.retired.size,0);
  }finally{engine.stop();globalThis.AudioWorkletNode=originalNode;}
});
test('unsupported live processing keeps audio playing and ignores stale or cancelled pitch preparation',async()=>{
  const {ctx,p,engine}=setup();let workers=0;
  engine.previewProcessor=new TrackEffectsProcessor(()=>{workers++;return {postMessage({channels}){queueMicrotask(()=>this.onmessage({data:{type:'done',channels}}));},terminate(){}};});
  await engine.play(p,0,4);engine.beginTrackEffectsPreview(p.tracks[0].id);const first=cloneProject(p),second=cloneProject(p);first.tracks[0].effects.pitch={enabled:true,semitones:7};second.tracks[0].effects.pitch={enabled:true,semitones:-7};
  const a=engine.previewTrackEffects(first,p.tracks[0].id),b=engine.previewTrackEffects(second,p.tracks[0].id);assert.equal(engine.running,true);assert.equal(await a,'cancelled');assert.equal(await b,'prepared');assert.equal(workers,1);assert.equal(engine.chains.get(p.tracks[0].id).voiceKey,JSON.stringify({pitch:second.tracks[0].effects.pitch,autotune:second.tracks[0].effects.autotune}));
  assert.equal(await engine.restoreTrackEffectsPreview(p,p.tracks[0].id),'restored');assert.equal(workers,1,'cancel uses the captured original without another preparation');
  const pending=engine.previewTrackEffects(first,p.tracks[0].id);engine.stop();assert.equal(await pending,'cancelled');assert.equal(engine.running,false);
});
test('embedded worklet registers its real streaming processor, accepts settings and stops cleanly',()=>{
  const bundle=fs.readFileSync(new URL('../studio.bundle.js',import.meta.url),'utf8'),script=JSON.parse(bundle.match(/const LIVE_EFFECTS_SCRIPT=(.*?);let effectsWorkletURL/)[1]);let Processor;
  const ctx=vm.createContext({Float32Array,Float64Array,Uint32Array,Uint8Array,sampleRate:rate,AudioWorkletProcessor:class{constructor(){this.port={};}},registerProcessor:(name,klass)=>{assert.equal(name,'viva-live-effects');Processor=klass;}});vm.runInContext(script,ctx);
  const processor=new Processor({processorOptions:{settings:makeTrackEffects()}}),out=[new Float32Array(128),new Float32Array(128)];assert.equal(processor.process([[new Float32Array(128)]],[out]),true);const settings=makeTrackEffects();settings.pitch={enabled:true,semitones:12};processor.port.onmessage({data:{type:'settings',settings}});assert.equal(processor.voice.settings.pitch.semitones,12);processor.port.onmessage({data:{type:'stop'}});assert.equal(processor.process([[]],[out]),false);
});
