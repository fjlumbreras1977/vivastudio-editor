const loadedContexts=new WeakSet();
export class MicrophoneRecorder{
  constructor(context){this.context=context;this.stream=null;this.node=null;this.source=null;this.silent=null;this.analyser=null;this.chunks=[];this.length=0;this.stopping=false;this.mode=null;this.nativeRecorder=null;this.nativeChunks=[];this.nativeFinished=null;this.captureError=null;}
  async start(deviceId){
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw Error('La grabación requiere permiso de micrófono y una dirección admitida por el navegador. Prueba el editor con HTTPS.');
      this.stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:deviceId?{exact:deviceId}:undefined,echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      for(const track of this.stream.getTracks())track.addEventListener?.('ended',()=>this.onEnded?.());
      this.source=this.context.createMediaStreamSource(this.stream);
      this.silent=this.context.createGain();this.silent.gain.value=0;
      this.analyser=this.context.createAnalyser();this.analyser.fftSize=256;
      this.source.connect(this.analyser);
      this.chunks=[];this.length=0;this.nativeChunks=[];this.captureError=null;this.stopping=false;
      const localFile=globalThis.location?.protocol==='file:';
      let workletError;
      if(!localFile&&this.context.audioWorklet&&typeof AudioWorkletNode!=='undefined'){
        try{
          if(!loadedContexts.has(this.context)){await this.context.audioWorklet.addModule(new URL('./record-worklet.js',import.meta.url));loadedContexts.add(this.context);}
          this.node=new AudioWorkletNode(this.context,'viva-recorder',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
          this.node.port.onmessage=({data})=>{if(data.type==='data'){this.chunks.push(data.channels);this.length+=data.channels[0].length;}if(data.type==='flushed')this.resolveStop?.();};
          this.source.connect(this.node);this.node.connect(this.silent);this.silent.connect(this.context.destination);this.mode='worklet';
        }catch(e){workletError=e;try{this.node?.disconnect();}catch{}this.node=null;}
      }
      if(!this.node){
        if(typeof MediaRecorder==='undefined')throw Error('Este navegador no ofrece una captura de audio compatible. Abre el editor en un navegador actualizado o en tu hosting con HTTPS.');
        const candidates=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'];
        const mimeType=typeof MediaRecorder.isTypeSupported==='function'?candidates.find(type=>MediaRecorder.isTypeSupported(type)):undefined;
        const options={audioBitsPerSecond:256000};if(mimeType)options.mimeType=mimeType;
        try{this.nativeRecorder=new MediaRecorder(this.stream,options);}catch{this.nativeRecorder=new MediaRecorder(this.stream);}
        this.nativeFinished=new Promise(resolve=>{this.nativeRecorder.onstop=resolve;});
        this.nativeRecorder.ondataavailable=({data})=>{if(data?.size)this.nativeChunks.push(data);};
        this.nativeRecorder.onerror=event=>{this.captureError=event.error||Error('El navegador interrumpió la captura de audio.');this.onEnded?.();};
        this.analyser.connect(this.silent);this.silent.connect(this.context.destination);
        this.nativeRecorder.start(1000);this.mode='native';this.workletError=workletError;
      }
      this.startedAt=this.context.currentTime;
    }catch(e){this.cleanup();throw e;}
  }
  async stop(){
    if(this.stopping)return null;this.stopping=true;
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
    if(this.nativeRecorder?.state==='recording'||this.nativeRecorder?.state==='paused'){try{this.nativeRecorder.stop();}catch{}}
    try{this.source?.disconnect();}catch{}try{this.node?.disconnect();}catch{}try{this.silent?.disconnect();}catch{}try{this.analyser?.disconnect();}catch{}
    this.stream?.getTracks().forEach(t=>t.stop());this.node=null;this.stream=null;this.nativeRecorder=null;
  }
}
