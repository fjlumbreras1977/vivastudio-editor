// Pitch processing keeps the original sample count and never changes playback rate.
const FX_SCALES={chromatic:[0,1,2,3,4,5,6,7,8,9,10,11],major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10],majorPentatonic:[0,2,4,7,9],minorPentatonic:[0,3,5,7,10]};
function nearestScaleNote(midi,root,scale){
  const allowed=FX_SCALES[scale]||FX_SCALES.chromatic;let best=Math.round(midi),distance=Infinity;
  for(let note=Math.floor(midi)-12;note<=Math.ceil(midi)+12;note++){
    if(!allowed.includes(((note-root)%12+12)%12))continue;
    const d=Math.abs(note-midi);if(d<distance){distance=d;best=note;}
  }
  return best;
}
function detectVoicePitch(samples,sampleRate,center,minHz=60,maxHz=1000){
  const step=Math.max(1,Math.round(sampleRate/11025)),rate=sampleRate/step,count=640;
  const x=new Float64Array(count);let energy=0,mean=0;
  for(let i=0;i<count;i++){
    const at=Math.round(center)+(i-count/2)*step;let v=0;
    for(let k=0;k<step;k++)v+=samples[at+k]||0;
    x[i]=v/step;mean+=x[i];
  }
  mean/=count;for(let i=0;i<count;i++){x[i]-=mean;energy+=x[i]*x[i];}
  if(energy/count<.000004)return null;
  const first=Math.max(2,Math.floor(rate/maxHz)),last=Math.min(Math.floor(rate/minHz),count/2-1),window=count-last;
  if(last<=first)return null;
  const difference=new Float64Array(last+1);let total=0;
  for(let lag=1;lag<=last;lag++){
    let sum=0;for(let i=0;i<window;i++){const d=x[i]-x[i+lag];sum+=d*d;}
    total+=sum;difference[lag]=total?sum*lag/total:1;
  }
  let lag=-1,best=first;
  for(let i=first;i<=last;i++){
    if(difference[i]<difference[best])best=i;
    if(difference[i]<.18){lag=i;while(lag<last&&difference[lag+1]<difference[lag])lag++;break;}
  }
  if(lag<0){if(difference[best]>.28)return null;lag=best;}
  const a=difference[lag-1]??difference[lag],b=difference[lag],c=difference[lag+1]??b;
  const denominator=2*(2*b-a-c),refined=lag+(Math.abs(denominator)>1e-12?(c-a)/denominator:0);
  // Refine at the original rate to avoid high-note bias from downsampling.
  const approximate=refined*step,lo=Math.max(2,Math.floor(approximate)-step),hi=Math.ceil(approximate)+step;
  const differences=new Float64Array(hi+2);let selected=lo;
  for(let n=lo-1;n<=hi+1;n++){let sum=0;for(let i=0;i<1024;i++){const at=Math.round(center)-512+i,d=(samples[at]||0)-(samples[at+n]||0);sum+=d*d;}differences[n]=sum;if(n>=lo&&n<=hi&&sum<differences[selected])selected=n;}
  const left=differences[selected-1],middle=differences[selected],right=differences[selected+1],bottom=2*(2*middle-left-right);
  const period=selected+(Math.abs(bottom)>1e-12?(right-left)/bottom:0),frequency=sampleRate/period;
  return frequency>=minHz*.95&&frequency<=maxHz*1.05?{frequency,confidence:1-b}:null;
}
function createFFT(size){
  const bits=Math.log2(size),reverse=new Uint32Array(size);
  for(let i=0;i<size;i++){let n=i,r=0;for(let b=0;b<bits;b++){r=(r<<1)|(n&1);n>>>=1;}reverse[i]=r;}
  return (real,imag,inverse=false)=>{
    for(let i=0;i<size;i++){const j=reverse[i];if(j>i){let v=real[i];real[i]=real[j];real[j]=v;v=imag[i];imag[i]=imag[j];imag[j]=v;}}
    for(let length=2;length<=size;length*=2){
      const half=length/2,angle=(inverse?2:-2)*Math.PI/length,wr=Math.cos(angle),wi=Math.sin(angle);
      for(let start=0;start<size;start+=length){let cr=1,ci=0;
        for(let j=0;j<half;j++){
          const a=start+j,b=a+half,tr=cr*real[b]-ci*imag[b],ti=cr*imag[b]+ci*real[b];
          real[b]=real[a]-tr;imag[b]=imag[a]-ti;real[a]+=tr;imag[a]+=ti;
          const next=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=next;
        }
      }
    }
    if(inverse)for(let i=0;i<size;i++){real[i]/=size;imag[i]/=size;}
  };
}
function processVoiceEffects(channels,sampleRate,settings,progress=()=>{}){
  const length=channels[0]?.length||0,pitch=settings.pitch?.enabled?settings.pitch.semitones:0,auto=settings.autotune;
  if(!length||(!pitch&&(!auto?.enabled||!auto.amount))){progress(1);return channels.map(c=>c.slice());}
  const size=2048,hop=256,bins=size/2+1,fft=createFFT(size),window=new Float64Array(size),normalization=new Float32Array(length);
  for(let i=0;i<size;i++)window[i]=.5-.5*Math.cos(2*Math.PI*i/size);
  const states=channels.map(()=>({real:new Float64Array(size),imag:new Float64Array(size),last:new Float64Array(bins),phase:new Float64Array(bins),initialized:new Uint8Array(bins),magnitude:new Float64Array(bins),frequency:new Float64Array(bins),initialPhase:new Float64Array(bins),dominant:new Float64Array(bins),output:new Float32Array(length)}));
  const frames=Math.ceil((length+size/2)/hop);let correction=0,lastProgress=-1;
  for(let frame=0,start=-size/2;start<length;frame++,start+=hop){
    let target=0;
    if(auto?.enabled&&auto.amount>0){
      let reference=channels[0],best=0;
      for(const channel of channels){let energy=0;for(let i=0;i<size;i+=16){const v=channel[start+i]||0;energy+=v*v;}if(energy>best){best=energy;reference=channel;}}
      const detected=detectVoicePitch(reference,sampleRate,start+size/2,auto.minHz,auto.maxHz);
      if(detected){const midi=69+12*Math.log2(detected.frequency/440)+pitch,nearest=nearestScaleNote(midi,auto.root,auto.scale),delta=nearest-midi;target=Math.abs(delta*100)<=auto.tolerance?0:delta*auto.amount;}
      const speed=Math.max(0,auto.speed)/1000,alpha=speed===0?1:1-Math.exp(-hop/sampleRate/speed);
      correction+=(target-correction)*alpha;
    }
    const ratio=Math.pow(2,(pitch+correction)/12);
    for(let i=0;i<size;i++){const at=start+i;if(at>=0&&at<length)normalization[at]+=window[i]*window[i];}
    for(let ch=0;ch<channels.length;ch++){
      const state=states[ch],input=channels[ch],{real,imag,last,phase,initialized,magnitude,frequency,initialPhase,dominant,output}=state;
      for(let i=0;i<size;i++){real[i]=(input[start+i]||0)*window[i];imag[i]=0;}
      fft(real,imag);magnitude.fill(0);frequency.fill(0);dominant.fill(0);
      for(let i=0;i<bins;i++){
        const mag=Math.hypot(real[i],imag[i]),angle=Math.atan2(imag[i],real[i]);
        let delta=angle-last[i]-2*Math.PI*hop*i/size;last[i]=angle;delta-=2*Math.PI*Math.round(delta/(2*Math.PI));
        const trueBin=i+delta*size/(2*Math.PI*hop),mapped=i*ratio,base=Math.floor(mapped),part=mapped-base;
        for(let k=0;k<2;k++){const j=base+k,weight=k?part:1-part;if(j>=bins||weight<=0)continue;const power=mag*weight;magnitude[j]+=power;frequency[j]+=power*trueBin*ratio;if(power>dominant[j]){dominant[j]=power;initialPhase[j]=angle;}}
      }
      real.fill(0);imag.fill(0);
      for(let i=0;i<bins;i++){
        if(magnitude[i]<1e-10)continue;
        if(!initialized[i]){phase[i]=initialPhase[i];initialized[i]=1;}else phase[i]+=2*Math.PI*hop/size*frequency[i]/magnitude[i];
        phase[i]%=2*Math.PI;real[i]=magnitude[i]*Math.cos(phase[i]);imag[i]=magnitude[i]*Math.sin(phase[i]);
        if(i>0&&i<size/2){real[size-i]=real[i];imag[size-i]=-imag[i];}
      }
      fft(real,imag,true);
      for(let i=0;i<size;i++){const at=start+i;if(at>=0&&at<length)output[at]+=real[i]*window[i];}
    }
    const percent=Math.floor(frame/frames*100);if(percent!==lastProgress&&percent%2===0){lastProgress=percent;progress(frame/frames);}
  }
  const result=states.map(({output})=>{for(let i=0;i<length;i++)output[i]=normalization[i]>1e-8?output[i]/normalization[i]:0;return output;});
  progress(1);return result;
}
