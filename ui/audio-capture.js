class AudioCapture {
  constructor(id,direction,track){this.id=id;this.direction=direction;this.track=track;this.closed=false;this.pending=new Map();this.start().catch(error=>console.error('Captura de legendas:',error.message));}
  async start(){
    const context=this.context=new AudioContext({sampleRate:16000});await context.audioWorklet.addModule('pcm-worklet.js');if(this.closed){await context.close();return;}
    this.source=context.createMediaStreamSource(new MediaStream([this.track]));this.node=new AudioWorkletNode(context,'pcm-monitor');this.gain=context.createGain();this.gain.gain.value=0;
    this.node.port.onmessage=({data})=>{if(data.flushed){this.pending.get(data.flushed)?.();this.pending.delete(data.flushed);return;}const pcm=new Uint8Array(data.pcm);window.room.audioPcm({id:this.id,direction:this.direction,pcm,start:Date.now()-pcm.length/32});};
    this.source.connect(this.node);this.node.connect(this.gain);this.gain.connect(context.destination);await context.resume();
  }
  async flush(){if(!this.node)return;const token=crypto.randomUUID();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(token);reject(Error('A captura não confirmou o áudio final.'));},2500);this.pending.set(token,()=>{clearTimeout(timer);resolve();});this.node.port.postMessage({flush:token});});}
  stop(){if(this.closed)return;this.closed=true;if(!this.node){this.context?.close().catch(()=>{});return;}this.node.port.postMessage({flush:'stop'});this.source.disconnect();setTimeout(()=>{this.node.disconnect();this.gain.disconnect();this.node.port.close();this.context.close().catch(()=>{});},80);}
}
