import {LiveVoiceEffects} from './effects-live-dsp.js';
class VivaLiveEffectsProcessor extends AudioWorkletProcessor {
  constructor(options){
    super();this.voice=new LiveVoiceEffects(sampleRate,options.processorOptions?.settings);this.closed=false;
    this.port.onmessage=({data})=>{if(data.type==='settings')this.voice.setSettings(data.settings);if(data.type==='stop')this.closed=true;};
  }
  process(inputs,outputs){if(this.closed)return false;this.voice.process(inputs[0]||[],outputs[0]||[]);return true;}
}
registerProcessor('viva-live-effects',VivaLiveEffectsProcessor);
