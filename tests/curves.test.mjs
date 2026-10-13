import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProject,makeClip,curveFraction,setVolumeCurve,volumeEnvelope,envelope,addVolumePoint,removeVolumePoint,splitClip,trimClip,sliceClip,duplicateClip,shiftVolumeCurve,adjustVolumeLevel,cloneProject,packProject,unpackProject,validateProject} from '../core.js';
import {AudioEngine} from '../engine.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function fixture(){const project=makeProject(),clip=makeClip('audio','Voz',10,2);clip.offset=2;clip.volumePoints=[{time:0,gain:1,curve:6},{time:5,gain:.2,curve:-8},{time:10,gain:1}];project.tracks[0].clips=[clip];return {project,clip};}
test('curved transitions remain continuous, monotonic and bounded by their two endpoint gains',()=>{
  close(curveFraction(.5,6),1/(Math.exp(3)+1));close(curveFraction(.5,-6),1-curveFraction(.5,6));close(curveFraction(.37,0),.37);
  for(const curve of [-12,-6,0,6,12]){let previous=0;for(let i=0;i<=100;i++){const value=curveFraction(i/100,curve);assert.ok(value>=previous&&value>=0&&value<=1);previous=value;}close(curveFraction(0,curve),0);close(curveFraction(1,curve),1);}
  const {clip}=fixture();close(volumeEnvelope(clip,0),1);close(volumeEnvelope(clip,5),.2);close(volumeEnvelope(clip,10),1);assert.ok(volumeEnvelope(clip,2.5)>.9);setVolumeCurve(clip,0,0);close(volumeEnvelope(clip,2.5),.6);
});
test('adding and removing a volume point preserves the complete original curved envelope',()=>{
  const {project,clip}=fixture(),original=cloneProject(clip),point=addVolumePoint(project,clip.id,4.3);
  close(point.time,2.3);close(clip.volumePoints[0].curve,2.76);close(point.curve,3.24);
  for(let t=0;t<=10;t+=.03125)close(volumeEnvelope(clip,t),volumeEnvelope(original,t));
  removeVolumePoint(project,clip.id,point.time);for(let t=0;t<=10;t+=.03125)close(volumeEnvelope(clip,t),volumeEnvelope(original,t));
});
test('splitting and copying a fragment retain the curved gain at every original source time',()=>{
  const {project,clip}=fixture(),original=cloneProject(clip),right=splitClip(project,clip.id,5.125);
  for(let t=0;t<=10;t+=.03125)close(t<=3.125?volumeEnvelope(clip,t):volumeEnvelope(right,t-3.125),volumeEnvelope(original,t));
  const fragment=sliceClip(original,3.2,9.4);for(let t=0;t<=fragment.duration;t+=.03125)close(volumeEnvelope(fragment,t),volumeEnvelope(original,t+1.2));
});
test('trimming and revealing more source audio preserve curves and extend endpoint levels',()=>{
  const {clip}=fixture(),original=cloneProject(clip);trimClip(clip,'left',.75,16);trimClip(clip,'right',-2.5,16);
  for(let t=0;t<=clip.duration;t+=.03125)close(volumeEnvelope(clip,t),volumeEnvelope(original,t+.75));
  const expanded=cloneProject(original);trimClip(expanded,'left',-.75,16);trimClip(expanded,'right',2,16);
  for(let t=0;t<=expanded.duration;t+=.03125)close(volumeEnvelope(expanded,t),volumeEnvelope(original,t-.75));
});
test('curves survive duplication, level changes and portable project saving independently',async()=>{
  const {project,clip}=fixture(),copy=duplicateClip(project,clip.id);setVolumeCurve(copy,0,-4);assert.equal(clip.volumePoints[0].curve,6);
  const original=cloneProject(clip);shiftVolumeCurve(clip,.1);for(let t=0;t<=10;t+=.25)close(volumeEnvelope(clip,t),volumeEnvelope(original,t)+.1);
  adjustVolumeLevel(clip,200,'percent','increase');assert.equal(clip.volumePoints[0].curve,6);for(let t=0;t<=10;t+=.25)close(volumeEnvelope(clip,t),(volumeEnvelope(original,t)+.1)*3);
  const raw={project,sources:{audio:{rate:44100,channels:[new Float32Array(16*44100).buffer]}}};const restored=await unpackProject(packProject(raw));assert.deepEqual(restored.project.tracks[0].clips[0].volumePoints,clip.volumePoints);
  for(const value of [NaN,Infinity,13,-13,'6']){restored.project.tracks[0].clips[0].volumePoints[0].curve=value;assert.throws(()=>validateProject(restored),/volumen/);}
});
class Param{constructor(){this.value=0;this.events=[];}setValueAtTime(v,t){this.events.push([v,t]);}linearRampToValueAtTime(v,t){this.events.push([v,t]);}cancelScheduledValues(t){this.cancelledAt=t;this.events=[];}}
class Node{constructor(){for(const key of ['gain','pan','frequency','Q'])this[key]=new Param();this.connected=[];}connect(n){this.connected.push(n);}start(...args){this.started=args;}}
class Context{constructor(){this.created=[];this.destination=new Node();this.currentTime=0;}node(){const n=new Node();this.created.push(n);return n;}createGain(){return this.node();}createStereoPanner(){return this.node();}createBiquadFilter(){return this.node();}createBufferSource(){const n=this.node();n.source=true;return n;}}
test('playback and export automation sample the actual curve while seeking and preserve live sources',()=>{
  const {project,clip}=fixture();clip.fadeOut=2;const ctx=new Context(),engine=new AudioEngine(new Map([['audio',{duration:16}]]));
  engine.nodes=engine.schedule(ctx,project,3.2,11,5,ctx.destination).sourceNodes;const source=engine.nodes.find(n=>n.source),gain=source.connected[0].gain;assert.ok(gain.events.length>100);
  for(const [value,time] of gain.events)close(value,envelope(clip,1.2+time-5));
  engine.context=ctx;engine.running=true;engine.position=3.2;engine.startTime=5;ctx.currentTime=8;const start=source.started;setVolumeCurve(clip,0,-6);engine.updateClip(clip);
  assert.equal(gain.cancelledAt,8);assert.equal(source.started,start);assert.equal(engine.nodes.find(n=>n.source),source);
  for(const [value,time] of gain.events)close(value,envelope(clip,4.2+time-8));
});
