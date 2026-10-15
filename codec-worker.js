// FLAC (libFLAC) y OGG Vorbis: codificación local, fuera del hilo de la interfaz.
importScripts('codec-libraries.bundle.js');
function updateFlacStreamInfo(bytes,metadata,total){
  if(bytes.length<42||String.fromCharCode(...bytes.subarray(0,4))!=='fLaC')throw Error('El codificador no produjo un archivo FLAC válido.');
  const put24=(offset,value)=>{bytes[offset]=Math.floor(value/65536)&255;bytes[offset+1]=Math.floor(value/256)&255;bytes[offset+2]=value&255;};
  if(metadata){put24(12,metadata.min_framesize);put24(15,metadata.max_framesize);if(/^[a-f\d]{32}$/i.test(metadata.md5sum))for(let i=0;i<16;i++)bytes[26+i]=parseInt(metadata.md5sum.slice(i*2,i*2+2),16);}
  bytes[21]=(bytes[21]&240)|(Math.floor(total/4294967296)&15);
  for(let i=0;i<4;i++)bytes[22+i]=Math.floor(total/Math.pow(256,3-i))&255;
  return bytes;
}
self.onmessage=async({data})=>{
  let encoder,flac;
  try{
    const {format,channels,rate}=data,total=channels?.[0]?.length;
    if(!['ogg','flac'].includes(format)||!Number.isInteger(rate)||rate<8000||rate>192000||!Array.isArray(channels)||channels.length<1||channels.length>2||!total||channels.some(channel=>!(channel instanceof Float32Array)||channel.length!==total))throw Error('Los datos de exportación no son válidos.');
    const blocks=[],block=16384;let metadata;
    const clean=value=>Number.isFinite(value)?Math.max(-1,Math.min(1,value)):0;
    const save=bytes=>{if(bytes.length)blocks.push(bytes.slice());};
    if(format==='flac'){
      if(![16,24].includes(data.bits))throw Error('Elige FLAC de 16 o 24 bits.');
      flac=await self.loadVivaFlac();encoder=flac.create_libflac_encoder(rate,channels.length,data.bits,5,total,false,0);
      if(!encoder)throw Error('No se pudo preparar el codificador FLAC.');
      if(flac.init_encoder_stream(encoder,save,value=>{metadata=value;})!==0)throw Error('No se pudo iniciar la exportación FLAC.');
      const negative=Math.pow(2,data.bits-1),positive=negative-1;
      for(let offset=0;offset<total;offset+=block){
        const length=Math.min(block,total-offset),pcm=new Int32Array(length*channels.length);
        for(let i=0;i<length;i++)for(let channel=0;channel<channels.length;channel++){const value=clean(channels[channel][offset+i]);pcm[i*channels.length+channel]=Math.round(value*(value<0?negative:positive));}
        if(!flac.FLAC__stream_encoder_process_interleaved(encoder,pcm,length))throw Error('No se pudo codificar un bloque FLAC.');
        self.postMessage({type:'progress',value:(offset+length)/total});
      }
      if(!flac.FLAC__stream_encoder_finish(encoder))throw Error('No se pudo terminar el archivo FLAC.');
      const bytes=new Uint8Array(blocks.reduce((sum,part)=>sum+part.length,0));let offset=0;for(const part of blocks){bytes.set(part,offset);offset+=part.length;}
      updateFlacStreamInfo(bytes,metadata,total);self.postMessage({type:'done',blob:new Blob([bytes],{type:'audio/flac'})});
    }else{
      if(!Number.isFinite(data.quality)||data.quality<0||data.quality>10)throw Error('Elige una calidad OGG entre 0 y 10.');
      encoder=await self.loadVivaOgg();encoder.configure({sampleRate:rate,channels:channels.length,vbrQuality:data.quality});
      for(let offset=0;offset<total;offset+=block){const length=Math.min(block,total-offset),parts=channels.map(channel=>{const part=channel.subarray(offset,offset+length);for(let i=0;i<part.length;i++)part[i]=clean(part[i]);return part;});save(encoder.encode(parts));self.postMessage({type:'progress',value:(offset+length)/total});}
      save(encoder.finalize());self.postMessage({type:'done',blob:new Blob(blocks,{type:'audio/ogg'})});
    }
  }catch(error){self.postMessage({type:'error',message:error?.message||'No se pudo exportar el audio.'});}
  finally{if(flac&&encoder)flac.FLAC__stream_encoder_delete(encoder);}
};
