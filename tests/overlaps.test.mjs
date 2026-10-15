import test from 'node:test';
import assert from 'node:assert/strict';
import {audioOverlaps,projectOverlapState} from '../overlaps.js';
const clip=(id,start,duration)=>({id,start,duration});
test('marca únicamente el intervalo compartido por dos bloques',()=>{
  assert.deepEqual(audioOverlaps([clip('a',0,5),clip('b',3,6)]),[{start:3,end:5,clipIds:['a','b']}]);
});
test('detecta un bloque totalmente oculto dentro de otro',()=>{
  assert.deepEqual(audioOverlaps([clip('a',0,10),clip('b',2,3)]),[{start:2,end:5,clipIds:['a','b']}]);
});
test('detecta dos o más bloques que coinciden completamente',()=>{
  assert.deepEqual(audioOverlaps([clip('c',4,5),clip('a',4,5),clip('b',4,5)]),[{start:4,end:9,clipIds:['a','b','c']}]);
});
test('los bloques consecutivos y los pequeños errores de coma flotante no generan avisos',()=>{
  assert.deepEqual(audioOverlaps([clip('a',0,.1+.2),clip('b',.3,4)]),[]);
  assert.deepEqual(audioOverlaps([clip('a',0,2),clip('b',2,2),clip('c',5,1)]),[]);
});
test('muestra el número y los bloques correctos en las distintas zonas de una superposición triple',()=>{
  assert.deepEqual(audioOverlaps([clip('a',0,10),clip('b',2,4),clip('c',4,4)]),[
    {start:2,end:4,clipIds:['a','b']},{start:4,end:6,clipIds:['a','b','c']},{start:6,end:8,clipIds:['a','c']}
  ]);
});
test('dos zonas contiguas con participantes distintos conservan sus nombres',()=>{
  assert.deepEqual(audioOverlaps([clip('a',0,6),clip('b',1,2),clip('c',3,2)]),[
    {start:1,end:3,clipIds:['a','b']},{start:3,end:5,clipIds:['a','c']}
  ]);
});
test('audios de pistas diferentes no se consideran superpuestos entre sí',()=>{
  const tracks=[{id:'one',clips:[clip('a',0,5)]},{id:'two',clips:[clip('b',0,5)]}];
  assert.deepEqual([...projectOverlapState(tracks).values()].map(value=>value.ranges),[[],[]]);
});
test('el destino provisional de un arrastre actualiza ambas pistas sin cambiar el proyecto',()=>{
  const tracks=[{id:'one',clips:[clip('a',0,5),clip('c',2,2)]},{id:'two',clips:[clip('b',0,5)]}],before=JSON.stringify(tracks);
  const state=projectOverlapState(tracks,new Map([['a','two']]));
  assert.deepEqual(state.get('one').ranges,[]);
  assert.deepEqual(state.get('two').ranges,[{start:0,end:5,clipIds:['a','b']}]);
  assert.equal(JSON.stringify(tracks),before);
});
test('ignora entradas incompletas y no depende del offset de la fuente',()=>{
  assert.deepEqual(audioOverlaps([{...clip('a',0,3),offset:100},clip('b',1,1),clip('c',NaN,5),clip('d',0,0)]),[{start:1,end:2,clipIds:['a','b']}]);
});
