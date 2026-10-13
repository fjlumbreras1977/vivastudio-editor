import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProject,cloneProject,packProject,unpackProject,validateProject} from '../core.js';

test('annotations retain exact positions, multiline notes and Unicode through portable project saving',async()=>{
  const project=makeProject();project.markers=[{id:'marker_1',time:65.125,text:'Revisar la entrada de música.\nBajar la voz aquí · próxima sesión 🎧'},{id:'marker_2',time:180,text:''}];
  const copy=cloneProject(project);copy.markers[0].text='Otra nota';assert.notEqual(copy.markers[0].text,project.markers[0].text);
  const restored=await unpackProject(packProject({project,sources:{}}));assert.deepEqual(restored.project.markers,project.markers);
});
test('projects made before annotations were introduced remain readable',async()=>{
  const project=makeProject();delete project.markers;
  const raw={project,sources:{}};assert.doesNotThrow(()=>validateProject(raw));assert.deepEqual((await unpackProject(packProject(raw))).project,project);
});
test('malformed annotation positions, texts and identities are rejected without accepting unsafe identifiers',()=>{
  const raw={project:makeProject(),sources:{}},valid={id:'marker_1',time:1,text:'Nota'};
  for(const marker of [null,{...valid,time:-1},{...valid,time:Infinity},{...valid,text:{}},{...valid,id:'x" onclick="evil'},{...valid,id:raw.project.tracks[0].id}]){
    raw.project.markers=[marker];assert.throws(()=>validateProject(raw),/anotación/);
  }
  raw.project.markers=[valid,{...valid}];assert.throws(()=>validateProject(raw),/anotación/);
  raw.project.markers={};assert.throws(()=>validateProject(raw),/anotaciones/);
});
