const loadedContexts=new WeakSet();
export class MicrophoneRecorder{
  constructor(context){this.context=context;this.stream=null;this.node=null;this.source=null;this.silent=null;this.analyser=null;this.analysers=[];this.splitter=null;this.chunks=[];this.length=0;this.stopping=false;this.mode=null;this.nativeRecorder=null;this.nativeChunks=[];this.nativeFinished=null;this.captureError=null;this.signalSeen=false;this.peak=0;}
  async resumeInput(){if(this.context.state&&this.context.state!=='running'&&this.context.state!=='closed')await this.context.resume();}
  async openInput(deviceId){
    if(!navigator.mediaDevices?.getUserMedia)throw Error('La grabación requiere permiso de micrófono. Abre el editor con HTTPS y permite el acceso al micrófono.');
    if(this.context.state==='closed')throw Error('El motor de audio está cerrado. Vuelve a abrir el editor.');
    // The permission dialog can suspend audio: resume before and after it.
    await this.resumeInput();
    const audio={echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:{ideal:2}};
    if(deviceId)audio.deviceId={exact:deviceId};
    try{this.stream=await navigator.mediaDevices.getUserMedia({audio,video:false});}
    catch(e){
      if(e.name!=='OverconstrainedError'||e.constraint==='deviceId')throw e;
      this.stream=await navigator.mediaDevices.getUserMedia({audio:deviceId?{deviceId:{exact:deviceId}}:true,video:false});
    }
    const tracks=this.stream.getAudioTracks?.()??this.stream.getTracks().filter(t=>!t.kind||t.kind==='audio');
    this.inputTrack=tracks.find(t=>t.readyState!=='ended');
    if(!this.inputTrack)throw Error('La entrada elegida no proporciona audio activo. Elige otro micrófono.');
    this.inputTrack.enabled=true;
    this.inputTrack.addEventListener?.('ended',()=>{if(!this.stopping)this.onEnded?.();});
    this.inputName=this.inputTrack.label||'Entrada del sistema';
    this.inputDeviceId=this.inputTrack.getSettings?.().deviceId||deviceId||'';
    await this.resumeInput();
    this.source=this.context.createMediaStreamSource(this.stream);
    this.silent=this.context.createGain();this.silent.gain.value=0;
    this.analyser=this.context.createAnalyser();this.analyser.fftSize=1024;this.analysers=[this.analyser];
    // Meter separate channels, avoiding cancellation of opposite polarities.
    if(typeof this.context.createChannelSplitter==='function'){
      const count=Math.max(1,Math.min(32,this.inputTrack.getSettings?.().channelCount||2));
      this.splitter=this.context.createChannelSplitter(count);this.source.connect(this.splitter);
      for(let i=0;i<count;i++){const analyser=i===0?this.analyser:this.context.createAnalyser();analyser.fftSize=1024;if(i)this.analysers.push(analyser);this.splitter.connect(analyser,i);analyser.connect(this.silent);}
    }else{this.source.connect(this.analyser);this.analyser.connect(this.silent);}
    this.silent.connect(this.context.destination);
    this.signalSeen=false;this.peak=0;this.startedWall=performance.now();
  }
  async test(deviceId){try{this.stopping=false;await this.openInput(deviceId);this.mode='test';}catch(e){this.cleanup();throw e;}}
  signal(){
    let peak=0;
    if(this.stream)for(const analyser of this.analysers){const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData?.(data);for(const value of data)peak=Math.max(peak,Math.abs(value));}
    this.peak=Math.max(this.peak,peak);if(peak>0.00001)this.signalSeen=true;
    return {peak,db:peak?20*Math.log10(peak):-Infinity,level:Math.max(0,Math.min(1,(20*Math.log10(peak||1e-8)+72)/72)),muted:!!this.inputTrack?.muted,ended:this.inputTrack?.readyState==='ended',suspended:!!this.context.state&&this.context.state!=='running',elapsed:this.startedWall===undefined?0:(performance.now()-this.startedWall)/1000};
  }
  async start(deviceId){
    try{
      this.mode=null;this.chunks=[];this.length=0;this.nativeChunks=[];this.captureError=null;this.stopping=false;
      await this.openInput(deviceId);
      // Direct capture does not depend on playback, mute/solo or output routing.
      let nativeError;
      if(typeof MediaRecorder!=='undefined'){
        try{
          const candidates=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'];
          const mimeType=typeof MediaRecorder.isTypeSupported==='function'?candidates.find(type=>MediaRecorder.isTypeSupported(type)):undefined;
          const options={audioBitsPerSecond:256000};if(mimeType)options.mimeType=mimeType;
          try{this.nativeRecorder=new MediaRecorder(this.stream,options);}catch{this.nativeRecorder=new MediaRecorder(this.stream);}
          this.nativeFinished=new Promise(resolve=>{this.nativeRecorder.onstop=resolve;});
          this.nativeRecorder.ondataavailable=({data})=>{if(data?.size)this.nativeChunks.push(data);};
          this.nativeRecorder.onerror=event=>{this.captureError=event.error||Error('El navegador interrumpió la captura de audio.');this.onEnded?.();};
          this.nativeRecorder.start(250);this.mode='native';
        }catch(e){nativeError=e;if(this.nativeRecorder?.state==='recording')try{this.nativeRecorder.stop();}catch{}this.nativeRecorder=null;this.nativeFinished=null;this.nativeChunks=[];}
      }
      if(this.mode!=='native'){
        if(globalThis.location?.protocol==='file:'||!this.context.audioWorklet||typeof AudioWorkletNode==='undefined')throw nativeError||Error('Este navegador no ofrece una captura de audio compatible. Abre el editor en un navegador actualizado con HTTPS.');
        if(!loadedContexts.has(this.context)){await this.context.audioWorklet.addModule(new URL('./record-worklet.js',import.meta.url));loadedContexts.add(this.context);}
        this.node=new AudioWorkletNode(this.context,'viva-recorder',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'});
        this.node.port.onmessage=({data})=>{if(data.type==='data'){this.chunks.push(data.channels);this.length+=data.channels[0].length;}if(data.type==='flushed')this.resolveStop?.();};
        this.source.connect(this.node);this.node.connect(this.silent);this.mode='worklet';
      }
      this.startedAt=this.context.currentTime;this.startedWall=performance.now();
    }catch(e){this.cleanup();throw e;}
  }
  async stop(){
    if(this.stopping)return null;this.stopping=true;
    if(this.mode==='test'){this.cleanup();return null;}
    if(this.mode==='native')return this.stopNative();
    if(!this.node)return null;
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('No se pudo finalizar la grabación. Inténtalo de nuevo.')),3000);this.resolveStop=()=>{clearTimeout(timeout);resolve();};this.node.port.postMessage({type:'stop'});}).catch(e=>{this.cleanup();throw e;});
    const channels=[new Float32Array(this.length),new Float32Array(this.length)];let offset=0;
    for(const chunk of this.chunks){channels[0].set(chunk[0],offset);channels[1].set(chunk[1],offset);offset+=chunk[0].length;}
    this.cleanup();if(!this.length)return null;
    const buffer=this.context.createBuffer(2,this.length,this.context.sampleRate);channels.forEach((ch,i)=>buffer.copyToChannel(ch,i));this.chunks=[];return buffer;
  }
  async stopNative(){
    let timer;const recorder=this.nativeRecorder;
    try{
      if(recorder.state!=='inactive')recorder.stop();
      await Promise.race([this.nativeFinished,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('El navegador no ha finalizado la captura de audio.')),5000);})]);
      clearTimeout(timer);
      const blob=new Blob(this.nativeChunks,{type:recorder.mimeType||this.nativeChunks[0]?.type||'audio/webm'});
      this.backupBlob=blob;this.cleanup();this.nativeChunks=[];
      if(!blob.size)return null;
      if(this.captureError){this.captureError.recordingBlob=blob;throw this.captureError;}
      try{return await this.context.decodeAudioData(await blob.arrayBuffer());}
      catch{const error=Error('La toma se ha grabado, pero el navegador no pudo convertirla para editarla. Se descargará una copia del audio original.');error.recordingBlob=blob;throw error;}
    }catch(e){clearTimeout(timer);this.cleanup();throw e;}
  }
  cleanup(){
    this.stopping=true;
    if(this.nativeRecorder?.state==='recording'||this.nativeRecorder?.state==='paused'){try{this.nativeRecorder.stop();}catch{}}
    for(const node of [this.source,this.node,this.silent,this.splitter,...this.analysers])try{node?.disconnect();}catch{}
    this.stream?.getTracks().forEach(t=>t.stop());this.node=null;this.stream=null;this.nativeRecorder=null;this.source=null;this.analyser=null;this.analysers=[];this.splitter=null;this.silent=null;
  }
}
