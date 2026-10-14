import {trackEffects,makeVintageEffects,makeBinauralEffects,dbGain} from './core.js';
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
  if(settings.vintage.enabled&&settings.vintage.mix>0){const vintage=createVintageTrackEffects(context,output,settings.vintage);output=vintage.output;nodes.push(...vintage.nodes);}
  if(settings.reverb.enabled&&settings.reverb.mix>0){
    const dry=context.createGain(),wet=context.createGain(),sum=context.createGain(),delay=context.createDelay(.2),reverb=context.createConvolver();
    dry.gain.value=1-settings.reverb.mix;wet.gain.value=settings.reverb.mix;delay.delayTime.value=settings.reverb.preDelay;reverb.normalize=true;reverb.buffer=makeReverbImpulse(context,settings.reverb.decay);
    output.connect(dry);dry.connect(sum);output.connect(delay);delay.connect(reverb);reverb.connect(wet);wet.connect(sum);output=sum;nodes.push(dry,wet,sum,delay,reverb);
  }
  if(settings.binaural.enabled&&settings.binaural.mix>0){const binaural=createBinauralTrackEffects(context,output,settings.binaural);output=binaural.output;nodes.push(...binaural.nodes);}
  return {output,nodes};
}
// Posición relativa al oyente: frente = -Z, derecha = +X, arriba = +Y.
export function binauralPosition({azimuth,elevation,distance}){
  const a=azimuth*Math.PI/180,e=elevation*Math.PI/180,horizontal=distance*Math.cos(e);
  return {x:horizontal*Math.sin(a),y:distance*Math.sin(e),z:-horizontal*Math.cos(a)};
}
export function createBinauralTrackEffects(context,input,initial=makeBinauralEffects()){
  const dry=context.createGain(),wet=context.createGain(),sum=context.createGain(),nodes=[dry,wet,sum];let spatial=null;
  input.connect(dry);dry.connect(sum);wet.connect(sum);
  const set=(param,value,immediate)=>{if(immediate)param.value=value;else param.setTargetAtTime(value,context.currentTime,.025);};
  function update(settings=makeBinauralEffects(),immediate=false){
    const mix=settings.enabled?settings.mix:0;let created=false;
    if(mix>0&&!spatial){
      if(typeof context.createPanner!=='function')throw Error('Este navegador no permite Binaural 3D. Prueba con Chrome, Edge o Firefox actualizado.');
      const p=context.createPanner();
      try{p.panningModel='HRTF';p.distanceModel='inverse';p.refDistance=1;p.maxDistance=20;p.rolloffFactor=.5;p.coneInnerAngle=p.coneOuterAngle=360;p.channelCount=1;p.channelCountMode='explicit';input.connect(p);p.connect(wet);}
      catch(error){p.disconnect();throw Error('No se pudo activar Binaural 3D: '+error.message);}
      spatial=p;nodes.push(p);created=true;
    }
    if(spatial){const {x,y,z}=binauralPosition(settings);if(spatial.positionX&&spatial.positionY&&spatial.positionZ){set(spatial.positionX,x,immediate||created);set(spatial.positionY,y,immediate||created);set(spatial.positionZ,z,immediate||created);}else spatial.setPosition(x,y,z);}
    set(dry.gain,1-mix,immediate);set(wet.gain,mix*dbGain(settings.output),immediate);
  }
  update(initial,true);
  return {output:sum,nodes,update};
}
// Original VIVA tone circuit; no G-Sonique VST code or impulse responses.
export function makeVintageCurve(saturation,model='classic'){
  const curve=new Float32Array(4097),drive=1+saturation*({classic:7,warm:5,dirty:13}[model]||7),bias=saturation*({classic:.035,warm:.14,dirty:.23}[model]||0);
  const zero=Math.tanh(drive*bias),norm=Math.max(Math.abs(Math.tanh(drive*(1+bias))-zero),Math.abs(Math.tanh(drive*(-1+bias))-zero));
  for(let i=0;i<curve.length;i++){const x=i/(curve.length-1)*2-1;curve[i]=saturation>0?(Math.tanh(drive*(x+bias))-zero)/norm:x;}
  return curve;
}
export function createVintageTrackEffects(context,input,initial){
  const nodes=[];
  const gain=()=>{const n=context.createGain();nodes.push(n);return n;};
  const filter=type=>{const n=context.createBiquadFilter();n.type=type;nodes.push(n);return n;};
  const dry=gain(),wet=gain(),sum=gain(),pre=gain(),post=gain();
  const cut=filter('lowshelf'),bass=filter('peaking'),mid=filter('peaking'),treble=filter('highshelf'),warm=filter('lowshelf'),brilliant=filter('highshelf'),rolloff=filter('lowpass');
  const shape=context.createWaveShaper();shape.oversample='2x';nodes.push(shape);
  const dc=filter('highpass');dc.frequency.value=15;dc.Q.value=Math.SQRT1_2;rolloff.Q.value=Math.SQRT1_2;bass.Q.value=.55;
  input.connect(dry);dry.connect(sum);let last=input;
  for(const node of [pre,cut,bass,mid,treble,warm,brilliant,rolloff,shape,dc,post,wet]){last.connect(node);last=node;}wet.connect(sum);
  let lastShape=null;
  const set=(param,value,immediate)=>{if(immediate)param.value=value;else param.setTargetAtTime(value,context.currentTime,.02);};
  function update(settings=makeVintageEffects(),immediate=false){
    const v=settings,neutral=[v.input,v.lowCut,v.lowBoost,v.midGain,v.highBoost,v.warmth,v.saturation,v.brilliance,v.output].every(n=>n===0),mix=v.enabled&&!neutral?v.mix:0;
    set(dry.gain,1-mix,immediate);set(wet.gain,mix,immediate);set(pre.gain,dbGain(v.input),immediate);set(post.gain,dbGain(v.output),immediate);
    const hz=n=>Math.min(n,context.sampleRate*.45);
    set(cut.frequency,hz(v.lowFrequency*.8),immediate);set(cut.gain,-v.lowCut,immediate);set(bass.frequency,hz(v.lowFrequency),immediate);set(bass.gain,v.lowBoost,immediate);
    set(mid.frequency,hz(v.midFrequency),immediate);set(mid.gain,v.midGain,immediate);set(mid.Q,v.bandwidth,immediate);
    set(treble.frequency,hz(v.highFrequency),immediate);set(treble.gain,v.highBoost,immediate);set(warm.frequency,hz(180),immediate);set(warm.gain,v.warmth*3,immediate);
    set(brilliant.frequency,hz(6500),immediate);set(brilliant.gain,v.brilliance*6-v.warmth*4,immediate);set(rolloff.frequency,hz(20000-v.warmth*12000),immediate);
    const key=v.model+':'+v.saturation;if(key!==lastShape){shape.curve=makeVintageCurve(v.saturation,v.model);lastShape=key;}
  }
  update(initial||makeVintageEffects(),true);
  return {output:sum,nodes,update};
}
// Mutable wet/dry paths preserve scheduled sources while knobs are adjusted.
export function createLiveNativeTrackEffects(context,input,track){
  const nodes=[],timers=new Set();let disposed=false,impulsePath=null,lastDecay=null,lastDrive=null;
  const gain=()=>{const node=context.createGain();nodes.push(node);return node;};
  const phoneDry=gain(),phoneWet=gain(),phoneSum=gain(),hp=context.createBiquadFilter(),lp=context.createBiquadFilter(),shape=context.createWaveShaper();nodes.push(hp,lp,shape);
  hp.type='highpass';lp.type='lowpass';hp.Q.value=lp.Q.value=Math.SQRT1_2;shape.oversample='2x';
  input.connect(phoneDry);phoneDry.connect(phoneSum);input.connect(hp);hp.connect(lp);lp.connect(shape);shape.connect(phoneWet);phoneWet.connect(phoneSum);
  const vintage=createVintageTrackEffects(context,phoneSum,trackEffects(track).vintage);nodes.push(...vintage.nodes);
  const reverbDry=gain(),reverbWet=gain(),sum=gain(),delay=context.createDelay(.2);nodes.push(delay);
  vintage.output.connect(reverbDry);reverbDry.connect(sum);vintage.output.connect(delay);reverbWet.connect(sum);
  const binaural=createBinauralTrackEffects(context,sum,trackEffects(track).binaural);nodes.push(...binaural.nodes);
  const set=(param,value,immediate)=>{if(immediate)param.value=value;else param.setTargetAtTime(value,context.currentTime,.015);};
  const retire=path=>{if(!path)return;try{delay.disconnect(path.convolver);}catch{}for(const node of [path.convolver,path.fade]){try{node.disconnect();}catch{}const i=nodes.indexOf(node);if(i>=0)nodes.splice(i,1);}};
  const update=(effects,immediate=false)=>{
    if(disposed)return;
    const phone=effects.phone,reverb=effects.reverb,pMix=phone.enabled?phone.mix:0,rMix=reverb.enabled?reverb.mix:0;
    vintage.update(effects.vintage||makeVintageEffects(),immediate);
    binaural.update(effects.binaural||makeBinauralEffects(),immediate);for(const node of binaural.nodes)if(!nodes.includes(node))nodes.push(node);
    set(phoneDry.gain,1-pMix,immediate);set(phoneWet.gain,pMix,immediate);set(hp.frequency,phone.lowCut,immediate);set(lp.frequency,phone.highCut,immediate);
    if(phone.drive!==lastDrive){const curve=new Float32Array(4096),k=1+phone.drive*9;for(let i=0;i<curve.length;i++){const x=i/(curve.length-1)*2-1;curve[i]=phone.drive>0?Math.tanh(k*x)/Math.tanh(k):x;}shape.curve=curve;lastDrive=phone.drive;}
    set(reverbDry.gain,1-rMix,immediate);set(reverbWet.gain,rMix,immediate);set(delay.delayTime,reverb.preDelay,immediate);
    if(rMix>0&&lastDecay!==reverb.decay){
      const convolver=context.createConvolver(),fade=gain(),old=impulsePath;nodes.push(convolver);convolver.normalize=true;convolver.buffer=makeReverbImpulse(context,reverb.decay);
      delay.connect(convolver);convolver.connect(fade);fade.connect(reverbWet);fade.gain.value=old&&!immediate?0:1;impulsePath={convolver,fade};lastDecay=reverb.decay;
      if(old){set(old.fade.gain,0,false);set(fade.gain,1,false);const timer=setTimeout(()=>{timers.delete(timer);retire(old);},80);timers.add(timer);}
    }
  };
  update(trackEffects(track),true);
  return {output:binaural.output,nodes,update,dispose(){disposed=true;for(const timer of timers)clearTimeout(timer);timers.clear();for(const node of nodes)try{node.disconnect();}catch{}nodes.length=0;impulsePath=null;}};
}
