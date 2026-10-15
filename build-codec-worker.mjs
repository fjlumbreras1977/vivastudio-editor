import fs from 'node:fs';
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
const base64=name=>fs.readFileSync(new URL(name,import.meta.url)).toString('base64');
export function codecLibraries(){
  const original=read('vendor/libflac.min.wasm.js'),from='var Module=Module||{};';
  if(original.split(from).length!==2)throw Error('Revisa la inicialización de libflacjs antes de compilar.');
  const flac=original.replace(from,'var Module={wasmBinary:self.VIVA_FLAC_WASM_BYTES};');
  const license=read('vendor/libflacjs-LICENSE.txt')+'\n'+read('vendor/wasm-media-encoders-LICENSE.txt')+'\n'+read('vendor/libogg-LICENSE.txt')+'\n'+read('vendor/libvorbis-LICENSE.txt')+'\n'+read('vendor/libFLAC-LICENSE.txt');
  return '/* '+license.replaceAll('*/','* /')+' */\n'+
    `function vivaWasmBytes(base64){return Uint8Array.from(atob(base64),character=>character.charCodeAt(0));}\n`+
    `self.loadVivaFlac=async function(){if(!self.Flac){self.VIVA_FLAC_WASM_BYTES=vivaWasmBytes(${JSON.stringify(base64('vendor/libflac.min.wasm.wasm'))});(function(){${flac}\n})();}const api=self.Flac;if(!api.isReady())await new Promise(resolve=>api.on('ready',resolve));return api;};\n`+
    `self.loadVivaOgg=async function(){if(!self.WasmMediaEncoder){(function(){${read('vendor/WasmMediaEncoder.min.js')}\n}).call(self);}return self.WasmMediaEncoder.createEncoder('audio/ogg',vivaWasmBytes(${JSON.stringify(base64('vendor/ogg.wasm'))}));};\n`;
}
export function codecWorker(){const libraries=codecLibraries();fs.writeFileSync(new URL('codec-libraries.bundle.js',import.meta.url),libraries);return libraries+'\n'+read('codec-worker.js').replace("importScripts('codec-libraries.bundle.js');",'');}
