/* Somente análise: a saída permanece em silêncio; não reproduz o microfone. */
class PCMMonitor extends AudioWorkletProcessor{
  constructor(){super();this.samples=new Int16Array(16000);this.used=0;this.port.onmessage=e=>{if(e.data?.flush){this.flush();this.port.postMessage({flushed:e.data.flush});}};}
  flush(){if(!this.used)return;const pcm=this.samples.slice(0,this.used);this.port.postMessage({pcm:pcm.buffer},[pcm.buffer]);this.used=0;}
  process(inputs){const channels=inputs[0];if(channels?.length){for(let i=0;i<channels[0].length;i++){let x=0;for(const c of channels)x+=c[i]||0;x/=channels.length;this.samples[this.used++]=Math.max(-32768,Math.min(32767,Math.round(x*32767)));if(this.used===16000)this.flush();}}return true;}
}
registerProcessor('pcm-monitor',PCMMonitor);
