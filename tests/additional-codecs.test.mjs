import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
async function encode(format,{bits=24,quality=5,length=44113,channels=2}={}){
 const input=Array.from({length:channels},(_,channel)=>Float32Array.from({length},(_,i)=>Math.sin(2*Math.PI*(channel?887:443)*i/44100)*.35));
 const messages=[];let resolve,reject;const done=new Promise((a,b)=>{resolve=a;reject=b;});
 const context=vm.createContext({Blob,atob,Float32Array,Int16Array,Int32Array,Uint8Array,ArrayBuffer,DataView,TextEncoder,TextDecoder,setTimeout,clearTimeout,console,location:{href:'blob:https://viva.test/codec'},postMessage:data=>{messages.push(data);if(data.type==='done')resolve(data.blob);if(data.type==='error')reject(Error(data.message));}});context.self=context;
 context.importScripts=name=>{assert.equal(name,'codec-libraries.bundle.js');vm.runInContext(read(name),context);};
 vm.runInContext(read('codec-worker.js'),context);await context.onmessage({data:{format,channels:input,rate:44100,bits,quality}});const blob=await done;
 assert.equal(blob.type,format==='flac'?'audio/flac':'audio/ogg');assert.ok(messages.some(message=>message.type==='progress'&&message.value===1));
 return {bytes:Buffer.from(await blob.arrayBuffer()),input};
}
for(const bits of [16,24])test('FLAC '+bits+' bits is lossless, with accurate duration, stereo and MD5',async()=>{
 const {bytes,input}=await encode('flac',{bits}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'viva-flac-')),file=path.join(dir,'audio.flac');
 try{fs.writeFileSync(file,bytes);assert.equal(bytes.subarray(0,4).toString(),'fLaC');const stream=JSON.parse(execFileSync('ffprobe',['-v','quiet','-show_streams','-of','json',file],{encoding:'utf8'})).streams[0];assert.equal(stream.codec_name,'flac');assert.equal(stream.channels,2);assert.equal(stream.sample_rate,'44100');assert.equal(Number(stream.bits_per_raw_sample),bits);assert.ok(Math.abs(Number(stream.duration)-input[0].length/44100)<.000001);
 const bps=bits/8,expected=Buffer.alloc(input[0].length*2*bps),negative=2**(bits-1),positive=negative-1;
 for(let i=0;i<input[0].length;i++)for(let ch=0;ch<2;ch++){const value=input[ch][i];expected.writeIntLE(Math.round(value*(value<0?negative:positive)),(i*2+ch)*bps,bps);}
 const decoded=execFileSync('ffmpeg',['-v','error','-i',file,'-f',bits===16?'s16le':'s24le','-acodec',bits===16?'pcm_s16le':'pcm_s24le','-'],{maxBuffer:2000000});assert.deepEqual(decoded,expected);assert.equal(bytes.subarray(26,42).toString('hex'),crypto.createHash('md5').update(expected).digest('hex'));
 }finally{fs.rmSync(dir,{recursive:true});}
});
for(const quality of [0,5,10])test('OGG Vorbis quality '+quality+' is playable stereo with correct sample count',async()=>{
 const {bytes,input}=await encode('ogg',{quality}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'viva-ogg-')),file=path.join(dir,'audio.ogg');
 try{fs.writeFileSync(file,bytes);assert.equal(bytes.subarray(0,4).toString(),'OggS');assert.ok(bytes.includes(Buffer.from('vorbis')));const stream=JSON.parse(execFileSync('ffprobe',['-v','quiet','-show_streams','-of','json',file],{encoding:'utf8'})).streams[0];assert.equal(stream.codec_name,'vorbis');assert.equal(stream.channels,2);assert.equal(stream.sample_rate,'44100');assert.ok(Math.abs(Number(stream.duration)-input[0].length/44100)<.00001);
 const pcm=execFileSync('ffmpeg',['-v','error','-i',file,'-f','f32le','-acodec','pcm_f32le','-'],{maxBuffer:2000000}),samples=new Float32Array(pcm.buffer,pcm.byteOffset,pcm.length/4);assert.ok(Math.abs(samples.length/2-input[0].length)<256);for(const ch of [0,1]){let dot=0,a=0,b=0;for(let i=1024;i<Math.min(samples.length/2,input[0].length)-1024;i++){const x=samples[i*2+ch],y=input[ch][i];dot+=x*y;a+=x*x;b+=y*y;}assert.ok(dot/Math.sqrt(a*b)>.98);}
 }finally{fs.rmSync(dir,{recursive:true});}
});
test('FLAC handles a final partial mono block',async()=>{const {bytes}=await encode('flac',{bits:24,length:7,channels:1});assert.equal(bytes.subarray(0,4).toString(),'fLaC');});
