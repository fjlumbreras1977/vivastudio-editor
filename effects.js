import {trackEffects} from './core.js';
export class TrackEffectsProcessor{
  constructor(workerFactory=()=>new Worker(new URL('./effects-worker.js',import.meta.url))){this.workerFactory=workerFactory;this.cache=new WeakMap();this.entries=new Set();this.jobs=new Set();this.clock=0;}
  cancel(){for(const job of [...this.jobs])job.cancel();}
  clear(){this.cancel();this.cache=new WeakMap();this.entries.clear();}
  remember(source,key,buffer){
    let cache=this.cache.get(source);if(!cache){cache=new Map();this.cache.set(source,cache);}
    const entry={buffer,key,cache,size:buffer.length*buffer.numberOfChannels*4,touched:++this.clock};cache.set(key,entry);this.entries.add(entry);
    let bytes=0;for(const item of this.entries)bytes+=item.size;
    while((bytes>96*1024*1024||this.entries.size>8)&&this.entries.size>1){const oldest=[...this.entries].filter(item=>item!==entry).sort((a,b)=>a.touched-b.touched)[0];bytes-=oldest.size;oldest.cache.delete(oldest.key);this.entries.delete(oldest);}
  }
  process(source,settings,progress){
    return new Promise((resolve,reject)=>{
      let worker;try{worker=this.workerFactory();}catch(error){reject(Error('No se pudo iniciar el procesador de tono: '+error.message));return;}
      let ended=false;const job={cancel:()=>{const error=Error('Procesamiento cancelado');error.name='AbortError';finish(error);}};
      const finish=(error,value)=>{if(ended)return;ended=true;this.jobs.delete(job);worker.terminate();error?reject(error):resolve(value);};this.jobs.add(job);
      worker.onmessage=({data})=>{if(data.type==='progress')progress(data.value);else if(data.type==='done')finish(null,data.channels);else if(data.type==='error')finish(Error(data.message));};
      worker.onerror=()=>finish(Error('No se pudo procesar el tono o la afinación de esta pista.'));
      try{const channels=Array.from({length:source.numberOfChannels},(_,ch)=>source.getChannelData(ch).slice());worker.postMessage({channels,rate:source.sampleRate,settings},channels.map(channel=>channel.buffer));}catch(error){finish(error);}
    });
  }
  async prepare(project,sources,context,progress=()=>{}){
    const prepared=new Map(),tasks=[];let totalFrames=0;
    for(const track of project.tracks){
      const effects=trackEffects(track),settings={pitch:{...effects.pitch},autotune:{...effects.autotune}};
      if((!settings.pitch.enabled||settings.pitch.semitones===0)&&(!settings.autotune.enabled||settings.autotune.amount===0))continue;
      const key=JSON.stringify(settings);
      for(const sourceId of new Set(track.clips.map(clip=>clip.source))){
        const source=sources.get(sourceId);if(!source)continue;
        const cached=this.cache.get(source)?.get(key),destination=track.id+':'+sourceId;
        if(cached){cached.touched=++this.clock;prepared.set(destination,cached.buffer);}else{tasks.push({source,sourceId,settings,key,destination,label:track.name});totalFrames+=source.length;}
      }
    }
    let completed=0;
    for(const task of tasks){
      const cached=this.cache.get(task.source)?.get(task.key);
      if(cached){prepared.set(task.destination,cached.buffer);completed+=task.source.length;continue;}
      progress(completed/totalFrames,task.label);
      const channels=await this.process(task.source,task.settings,value=>progress((completed+value*task.source.length)/totalFrames,task.label));
      if(!Array.isArray(channels)||channels.length!==task.source.numberOfChannels||channels.some(channel=>channel.length!==task.source.length))throw Error('El procesador de efectos devolvió audio incompleto.');
      const buffer=context.createBuffer(channels.length,task.source.length,task.source.sampleRate);channels.forEach((channel,ch)=>buffer.copyToChannel(channel,ch));
      this.remember(task.source,task.key,buffer);prepared.set(task.destination,buffer);completed+=task.source.length;
    }
    if(tasks.length)progress(1,'');return prepared;
  }
}
export function makeReverbImpulse(context,decay){
  const length=Math.ceil(context.sampleRate*decay),buffer=context.createBuffer(2,length,context.sampleRate);
  for(let ch=0;ch<2;ch++){const data=buffer.getChannelData(ch);let seed=12345+ch*971;
    for(let i=0;i<length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=seed/4294967296*2-1,attack=Math.min(1,i/(context.sampleRate*.008));data[i]=noise*attack*Math.exp(-6.9*i/length);}
  }
  return buffer;
}
export function createNativeTrackEffects(context,input,track){
  const settings=trackEffects(track),nodes=[];let output=input;
  if(settings.phone.enabled&&settings.phone.mix>0){
    const dry=context.createGain(),wet=context.createGain(),sum=context.createGain(),hp=context.createBiquadFilter(),lp=context.createBiquadFilter(),shape=context.createWaveShaper();
    dry.gain.value=1-settings.phone.mix;wet.gain.value=settings.phone.mix;hp.type='highpass';hp.frequency.value=settings.phone.lowCut;hp.Q.value=Math.SQRT1_2;lp.type='lowpass';lp.frequency.value=settings.phone.highCut;lp.Q.value=Math.SQRT1_2;
    const curve=new Float32Array(4096),drive=settings.phone.drive;
    for(let i=0;i<curve.length;i++){const x=i/(curve.length-1)*2-1,k=1+drive*9;curve[i]=drive>0?Math.tanh(k*x)/Math.tanh(k):x;}shape.curve=curve;shape.oversample='2x';
    output.connect(dry);dry.connect(sum);output.connect(hp);hp.connect(lp);lp.connect(shape);shape.connect(wet);wet.connect(sum);output=sum;nodes.push(dry,wet,sum,hp,lp,shape);
  }
  if(settings.reverb.enabled&&settings.reverb.mix>0){
    const dry=context.createGain(),wet=context.createGain(),sum=context.createGain(),delay=context.createDelay(.2),reverb=context.createConvolver();
    dry.gain.value=1-settings.reverb.mix;wet.gain.value=settings.reverb.mix;delay.delayTime.value=settings.reverb.preDelay;reverb.normalize=true;reverb.buffer=makeReverbImpulse(context,settings.reverb.decay);
    output.connect(dry);dry.connect(sum);output.connect(delay);delay.connect(reverb);reverb.connect(wet);wet.connect(sum);output=sum;nodes.push(dry,wet,sum,delay,reverb);
  }
  return {output,nodes};
}
