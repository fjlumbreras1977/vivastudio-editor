import {createFFT,detectVoicePitch,nearestScaleNote} from './effects-dsp.js';
// Streaming phase vocoder. Ring buffers stay bounded regardless of clip length.
export class LiveVoiceEffects {
  constructor(rate,settings={}){
    this.rate=rate;this.size=2048;this.hop=256;this.ringSize=8192;this.mask=this.ringSize-1;this.latencyFrames=this.size;this.samples=0;this.correction=0;this.pitch=0;this.fft=createFFT(this.size);
    this.window=Float64Array.from({length:this.size},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/this.size));this.weight=new Float64Array(this.ringSize);this.reference=new Float32Array(6144);
    const bins=this.size/2+1;
    this.states=Array.from({length:2},()=>({input:new Float32Array(this.ringSize),output:new Float64Array(this.ringSize),real:new Float64Array(this.size),imag:new Float64Array(this.size),last:new Float64Array(bins),phase:new Float64Array(bins),initialized:new Uint8Array(bins),magnitude:new Float64Array(bins),frequency:new Float64Array(bins),initialPhase:new Float64Array(bins),dominant:new Float64Array(bins)}));
    this.setSettings(settings);this.pitch=this.settings.pitch?.enabled?this.settings.pitch.semitones:0;
  }
  setSettings(settings){this.settings=settings;if(!settings.autotune?.enabled)this.correction=0;}
  frame(){
    const {size,hop,mask,window,settings}=this,start=this.samples-size,bins=size/2+1,auto=settings.autotune;
    const targetPitch=settings.pitch?.enabled?settings.pitch.semitones:0;
    this.pitch+=(targetPitch-this.pitch)*(1-Math.exp(-hop/this.rate/.015));
    if(auto?.enabled&&auto.amount>0){
      let reference=this.states[0],best=-1;
      for(const state of this.states){let energy=0;for(let i=0;i<size;i+=32){const v=start+i<0?0:state.input[(start+i)&mask];energy+=v*v;}if(energy>best){best=energy;reference=state;}}
      const base=this.samples-this.reference.length;
      for(let i=0;i<this.reference.length;i++)this.reference[i]=base+i<0?0:reference.input[(base+i)&mask];
      const detected=detectVoicePitch(this.reference,this.rate,4480,auto.minHz,auto.maxHz);let target=0;
      if(detected){const midi=69+12*Math.log2(detected.frequency/440)+this.pitch,delta=nearestScaleNote(midi,auto.root,auto.scale)-midi;target=Math.abs(delta*100)<=auto.tolerance?0:delta*auto.amount;}
      const alpha=auto.speed===0?1:1-Math.exp(-hop/this.rate/(auto.speed/1000));this.correction+=(target-this.correction)*alpha;
    }else this.correction=0;
    const ratio=2**((this.pitch+this.correction)/12),destination=start+this.latencyFrames;
    for(let i=0;i<size;i++)this.weight[(destination+i)&mask]+=window[i]*window[i];
    for(const state of this.states){
      const {real,imag,last,phase,initialized,magnitude,frequency,initialPhase,dominant}=state;
      for(let i=0;i<size;i++){real[i]=(start+i<0?0:state.input[(start+i)&mask])*window[i];imag[i]=0;}
      this.fft(real,imag);magnitude.fill(0);frequency.fill(0);dominant.fill(0);
      for(let i=0;i<bins;i++){
        const mag=Math.hypot(real[i],imag[i]),angle=Math.atan2(imag[i],real[i]);let delta=angle-last[i]-2*Math.PI*hop*i/size;last[i]=angle;delta-=2*Math.PI*Math.round(delta/(2*Math.PI));
        const trueBin=i+delta*size/(2*Math.PI*hop),mapped=i*ratio,base=Math.floor(mapped),part=mapped-base;
        for(let k=0;k<2;k++){const j=base+k,weight=k?part:1-part;if(j<0||j>=bins||weight<=0)continue;const power=mag*weight;magnitude[j]+=power;frequency[j]+=power*trueBin*ratio;if(power>dominant[j]){dominant[j]=power;initialPhase[j]=angle;}}
      }
      real.fill(0);imag.fill(0);
      for(let i=0;i<bins;i++){
        if(magnitude[i]<1e-10)continue;
        if(!initialized[i]){phase[i]=initialPhase[i];initialized[i]=1;}else phase[i]+=2*Math.PI*hop/size*frequency[i]/magnitude[i];phase[i]%=2*Math.PI;
        real[i]=magnitude[i]*Math.cos(phase[i]);imag[i]=magnitude[i]*Math.sin(phase[i]);if(i>0&&i<size/2){real[size-i]=real[i];imag[size-i]=-imag[i];}
      }
      this.fft(real,imag,true);for(let i=0;i<size;i++)state.output[(destination+i)&mask]+=real[i]*window[i];
    }
  }
  process(input,output){
    const count=output[0]?.length||0;
    for(let i=0;i<count;i++){
      const at=this.samples&this.mask;
      for(let ch=0;ch<2;ch++)this.states[ch].input[at]=(input[ch]||input[0])?.[i]||0;
      const denominator=this.weight[at];
      for(let ch=0;ch<2;ch++){if(output[ch])output[ch][i]=denominator>1e-8?this.states[ch].output[at]/denominator:0;this.states[ch].output[at]=0;}
      this.weight[at]=0;this.samples++;if(this.samples%this.hop===0)this.frame();
    }
  }
}
