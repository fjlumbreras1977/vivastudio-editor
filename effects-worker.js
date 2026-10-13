importScripts('effects-dsp.bundle.js');
onmessage=({data})=>{
  try{
    const channels=processVoiceEffects(data.channels,data.rate,data.settings,value=>postMessage({type:'progress',value}));
    postMessage({type:'done',channels},channels.map(channel=>channel.buffer));
  }catch(error){postMessage({type:'error',message:error.message||'No se pudo procesar la afinación.'});}
};
