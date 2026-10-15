import test from 'node:test';
import assert from 'node:assert/strict';
import {playheadScrollLeft} from '../timeline.js';
const view={position:0,zoom:200,scrollLeft:0,clientWidth:900,scrollWidth:26000,controlsWidth:228};
const next=options=>playheadScrollLeft({...view,...options});
test('rebobinar devuelve la vista al principio a cualquier zoom y anchura de cabecera',()=>{
  for(const zoom of [5,36,200])for(const controlsWidth of [184,228])
    assert.equal(next({position:0,zoom,controlsWidth,scrollLeft:6000}),0);
});
test('la reproducción avanza de forma continua manteniendo el cursor en el área de ondas',()=>{
  let scrollLeft=0;
  for(let frame=0;frame<=2400;frame++){
    const position=frame/20,previous=scrollLeft;
    scrollLeft=next({position,scrollLeft});
    const x=view.controlsWidth+position*view.zoom-scrollLeft;
    assert.ok(x>=view.controlsWidth&&x<=view.clientWidth);
    assert.ok(scrollLeft>=previous&&scrollLeft-previous<=view.zoom/20+.001);
  }
  assert.ok(scrollLeft>20000);
});
test('el seguimiento descuenta los controles fijos para no ocultar la línea bajo ellos',()=>{
  const position=10,scrollLeft=next({position,scrollLeft:2100});
  const x=view.controlsWidth+position*view.zoom-scrollLeft;
  assert.equal(x,view.controlsWidth+64);
});
test('un salto hacia delante revela el destino sin desbordar el borde derecho',()=>{
  const position=50,scrollLeft=next({position});
  assert.equal(view.controlsWidth+position*view.zoom-scrollLeft,view.clientWidth-64);
});
test('el retorno de un bucle revela su comienzo y el tiempo cero al instante',()=>{
  let scrollLeft=next({position:100});
  scrollLeft=next({position:2,scrollLeft});
  assert.ok(2*view.zoom>=scrollLeft);
  assert.equal(next({position:0,scrollLeft}),0);
});
test('funciona en una ventana estrecha y después de cambiar el zoom',()=>{
  for(const clientWidth of [240,380,600,1200])for(const zoom of [5,36,200]){
    const position=30,scrollLeft=next({position,zoom,clientWidth,scrollLeft:7000});
    const x=view.controlsWidth+position*zoom-scrollLeft;
    assert.ok(x>=view.controlsWidth&&x<=clientWidth);
  }
});
test('no desplaza innecesariamente una vista donde el cursor ya tiene espacio',()=>{
  assert.equal(next({position:5,scrollLeft:800}),800);
  assert.equal(next({position:1,zoom:36,scrollWidth:900}),0);
});
test('respeta el final del contenido y las dimensiones transitorias de una vista oculta',()=>{
  assert.equal(next({position:500}),view.scrollWidth-view.clientWidth);
  assert.equal(next({position:10,clientWidth:100,scrollLeft:500}),500);
  assert.equal(next({position:NaN,scrollLeft:500}),500);
});
