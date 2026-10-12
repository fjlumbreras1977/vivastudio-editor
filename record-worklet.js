class VivaRecorder extends AudioWorkletProcessor{
  constructor(){super();this.buffers=[new Float32Array(2048),new Float32Array(2048)];this.pos=0;this.active=true;this.port.onmessage=({data})=>{if(data.type==='stop'){this.active=false;this.flush();this.port.postMessage({type:'flushed'});}};}
  flush(){if(!this.pos)return;const channels=this.buffers.map(b=>b.slice(0,this.pos));this.port.postMessage({type:'data',channels},channels.map(c=>c.buffer));this.pos=0;}
  process(inputs){if(!this.active)return true;const input=inputs[0];if(!input?.length)return true;for(let i=0;i<input[0].length;i++){this.buffers[0][this.pos]=input[0][i];this.buffers[1][this.pos]=input[1]?.[i]??input[0][i];if(++this.pos===2048)this.flush();}return true;}
}
registerProcessor('viva-recorder',VivaRecorder);
