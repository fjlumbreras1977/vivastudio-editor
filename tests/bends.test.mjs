import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProject,makeClip,setVolumeBend,setVolumeCurve,volumeEnvelope,envelope,addVolumePoint,removeVolumePoint,splitClip,sliceClip,trimClip,duplicateClip,cloneProject,shiftVolumeCurve,adjustVolumeLevel,packProject,unpackProject,validateProject} from '../core.js';
import {AudioEngine} from '../engine.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function fixture(x=.3,gain=2){const project=makeProject(),clip=makeClip('s','Voz',10,2);clip.offset=2;clip.volumePoints=[{time:0,gain:.4},{time:10,gain:1}];setVolumeBend(clip,0,x,gain);project.tracks[0].clips=[clip];return {project,clip};}
test('el movimiento horizontal y vertical modifica la curva y conserva los extremos',()=>{
  const {clip}=fixture(),left=volumeEnvelope(clip,2);setVolumeBend(clip,0,.8,2);assert.ok(Math.abs(volumeEnvelope(clip,2)-left)>.1);const original=volumeEnvelope(clip,5);setVolumeBend(clip,0,.8,.1);assert.ok(volumeEnvelope(clip,5)<original);near(volumeEnvelope(clip,0),.4);near(volumeEnvelope(clip,10),1);
  clip.volumePoints=[{time:0,gain:1},{time:10,gain:1}];setVolumeBend(clip,0,.5,2);near(volumeEnvelope(clip,5),1.5);setVolumeBend(clip,0,.5,0);near(volumeEnvelope(clip,5),.5);setVolumeCurve(clip,0,0);near(volumeEnvelope(clip,5),1);assert.equal(clip.volumePoints[0].bend,undefined);
});
test('añadir un punto, recortar, dividir y copiar preservan exactamente la curva bidimensional',()=>{
  for(const x of [0,.01,.3,.8,.99,1]){
    const {project,clip}=fixture(x),original=cloneProject(clip),point=addVolumePoint(project,clip.id,6.25);
    for(let t=0;t<=10;t+=.03125)near(volumeEnvelope(clip,t),volumeEnvelope(original,t));
    removeVolumePoint(project,clip.id,point.time);for(let t=0;t<=10;t+=.03125)near(volumeEnvelope(clip,t),volumeEnvelope(original,t));
    const right=splitClip(project,clip.id,6.4);for(let t=0;t<=10;t+=.03125)near(t<=4.4?volumeEnvelope(clip,t):volumeEnvelope(right,t-4.4),volumeEnvelope(original,t));
    const part=sliceClip(original,4.3,9.1);for(let t=0;t<=part.duration;t+=.03125)near(volumeEnvelope(part,t),volumeEnvelope(original,t+2.3));
    const trimmed=cloneProject(original);trimClip(trimmed,'left',1.2,20);trimClip(trimmed,'right',-2.1,20);for(let t=0;t<=trimmed.duration;t+=.03125)near(volumeEnvelope(trimmed,t),volumeEnvelope(original,t+1.2));
  }
});
test('las curvas bidimensionales conservan independencia, ganancia y proyectos guardados',async()=>{
  const {project,clip}=fixture(),original=cloneProject(clip),copy=duplicateClip(project,clip.id);copy.volumePoints[0].bend.gain=0;assert.equal(clip.volumePoints[0].bend.gain,2);
  shiftVolumeCurve(clip,.3);for(let t=0;t<=10;t+=.1)near(volumeEnvelope(clip,t),volumeEnvelope(original,t)+.3);
  adjustVolumeLevel(clip,100,'percent','increase');for(let t=0;t<=10;t+=.1)near(volumeEnvelope(clip,t),(volumeEnvelope(original,t)+.3)*2);
  const raw={project,sources:{s:{rate:44100,channels:[new Float32Array(1).buffer]}}},restored=await unpackProject(packProject(raw));assert.deepEqual(restored.project,project);
  for(const invalid of [null,{x:NaN,gain:1},{x:2,gain:1},{x:.5,gain:-1},{x:.5,gain:Infinity}]){restored.project.tracks[0].clips[0].volumePoints[0].bend=invalid;assert.throws(()=>validateProject(restored),/volumen/);}
});
class Param{constructor(){this.events=[];}setValueAtTime(value,time){this.events.push([value,time]);}linearRampToValueAtTime(value,time){this.events.push([value,time]);}cancelScheduledValues(){this.events=[];}}
test('reproducción y exportación programan la curva real incluso con extremos iguales',()=>{
  const engine=new AudioEngine(new Map()),{clip}=fixture(.9,2);clip.volumePoints[0].gain=clip.volumePoints[1].gain=1;const param=new Param();engine.automateGain(param,clip,2,12,0);assert.ok(param.events.length>=193);assert.ok(param.events.some(([gain])=>gain>1.4));for(const [gain,time] of param.events)near(gain,envelope(clip,time));
  const source={isClipGain:true,clipId:clip.id,rangeEnd:12,gain:param},identity={};engine.context={currentTime:3};engine.position=2;engine.startTime=0;engine.running=true;engine.nodes=[source,identity];setVolumeBend(clip,0,.2,.1);engine.updateClip(clip);assert.equal(engine.nodes[1],identity);for(const [gain,time] of param.events)near(gain,envelope(clip,time));
});
