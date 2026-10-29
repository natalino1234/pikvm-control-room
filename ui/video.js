/* Implementação do protocolo Janus/uStreamer e Direct H.264. Sem bibliotecas remotas. */
(function(root){
  class PiKVMVideo {
    constructor({element,base,id,owner,slot,mode='auto',onState,audioOnly=false,receiveAudio=true,microphoneEnabled=false,microphoneMuted=false,microphoneSource=null,onLevel}) {
      Object.assign(this,{element,base,id,owner,slot,mode,onState,audioOnly,receiveAudio,microphoneEnabled,microphoneMuted,microphoneSource,onLevel});this.disposed=false;this.generation=0;this.resources=[];this.report={};
      this.img=element.querySelector('img');this.video=element.querySelector('video');this.canvas=element.querySelector('canvas');
      this.audio={enabled:false,volume:1};this.start(mode==='auto'?'webrtc':mode);
    }
    url(kind) {const u=new URL(this.base);u.pathname=u.pathname.replace('/stream/',`/${kind}/`)+encodeURIComponent(this.id);u.search=new URLSearchParams({owner:this.owner,slot:this.slot,v:Date.now()});if(kind!=='stream')u.protocol='ws:';return u.href;}
    emit(state){this.report={...this.report,...state};this.element.dataset.transport=this.report.transport||'';this.element.dataset.status=this.report.status||'';this.onState?.(this.report);}
    timer(fn,ms,interval=false){const id=interval?setInterval(fn,ms):setTimeout(fn,ms);this.resources.push(()=>interval?clearInterval(id):clearTimeout(id));return id;}
    cleanup(){this.generation++;for(const close of this.resources.splice(0).reverse()){try{close();}catch{}}this.pc=null;this.ws=null;this.decoder=null;this.video.pause();if(this.video.srcObject){this.video.srcObject.getTracks().forEach(t=>t.stop());this.video.srcObject=null;}this.img.removeAttribute('src');}
    stop(){this.disposed=true;this.cleanup();}
    start(kind){
      if(this.disposed)return;this.cleanup();this.kind=kind;this.frames=0;this.hasFrame=false;this.report={};
      this.img.classList.toggle('hidden',kind!=='mjpeg');this.video.classList.toggle('hidden',kind!=='webrtc');this.canvas.classList.toggle('hidden',kind!=='h264');
      this.emit({transport:kind,status:'connecting',audio:false,error:'',frames:0});
      const generation=this.generation;
      const fail=error=>{if(this.disposed||generation!==this.generation)return;const message=error?.message||String(error||'Conexão de mídia encerrada.');
        this.emit({status:'error',error:message});this.cleanup();
        const next=this.mode==='auto'?(kind==='webrtc'?'h264':kind==='h264'?'mjpeg':'mjpeg'):kind;
        this.timer(()=>this.start(next),this.mode==='auto'&&kind!=='mjpeg'?200:2500);
      };
      const ready=()=>{if(this.disposed||generation!==this.generation)return;this.hasFrame=true;this.emit({status:'playing',error:'',frames:++this.frames});};
      this.timer(()=>{if(!this.hasFrame)fail(new Error(`${kind==='webrtc'?'WebRTC':kind==='h264'?'H.264 direto':'MJPEG'} não recebeu ${this.audioOnly?'áudio':'vídeo'} no tempo esperado.`));},kind==='webrtc'?20000:10000);
      try{if(kind==='webrtc')this.webrtc(ready,fail,generation);else if(kind==='h264')this.direct(ready,fail,generation);else this.mjpeg(ready,fail);}catch(error){fail(error);}
    }
    mjpeg(ready,fail){
      this.img.onload=ready;this.img.onerror=()=>fail(new Error('Stream MJPEG indisponível.'));
      this.resources.push(()=>{this.img.onload=null;this.img.onerror=null;this.img.removeAttribute('src');});this.img.src=this.url('stream');
    }
    playback(enabled,volume){this.audio={enabled,volume:Math.max(0,Math.min(1,volume))};this.video.muted=!enabled;this.video.volume=this.audio.volume;if(enabled&&this.video.srcObject)this.video.play().catch(()=>this.emit({error:'Clique no vídeo para autorizar a reprodução do áudio.'}));}
    muteMicrophone(muted){
      this.microphoneMuted=!!muted;
      if(this.micTrack)this.micTrack.enabled=!this.microphoneMuted;
      const active=!!this.micTrack&&!this.microphoneMuted;
      if(this.report.micMuted!==this.microphoneMuted||this.report.micActive!==active)this.emit({micMuted:this.microphoneMuted,micActive:active,micConnected:!!this.micTrack});
    }
    size(){return this.kind==='webrtc'?{width:this.video.videoWidth,height:this.video.videoHeight}:this.kind==='h264'?{width:this.canvas.width,height:this.canvas.height}:{width:this.img.naturalWidth,height:this.img.naturalHeight};}
    socket(kind,fail){
      const ws=this.ws=new WebSocket(this.url(kind));ws.binaryType='arraybuffer';ws.onerror=()=>fail(new Error(`Não foi possível conectar ${kind==='janus'?'ao Janus/WebRTC':'ao H.264 direto'}.`));ws.onclose=()=>fail(new Error('Conexão de mídia encerrada.'));
      this.resources.push(()=>{ws.onclose=null;ws.onerror=null;ws.onmessage=null;ws.onopen=null;ws.close();});return ws;
    }
    webrtc(ready,fail,generation){
      if(!root.RTCPeerConnection)throw new Error('WebRTC indisponível neste aplicativo.');
      const ws=this.socket('janus',fail);let session,handle,features={},peer=null,answering=false,lastFrames=0,lastProgress=performance.now();const candidates=[];
      const send=(janus,body={},target=true)=>{if(ws.readyState===1)ws.send(JSON.stringify({janus,transaction:crypto.randomUUID(),...(session?{session_id:session}:{}),...(target&&handle?{handle_id:handle}:{}),...body}));};
      const plugin=(body,jsep)=>send('message',{body,...(jsep?{jsep}: {})});
      this.resources.push(()=>{if(ws.readyState===1&&session)send('destroy',{},false);peer?.close();});
      ws.onopen=()=>send('create',{},false);
      ws.onmessage=async event=>{
        if(this.disposed||generation!==this.generation)return;
        try{
          const msg=JSON.parse(event.data);
          if(msg.janus==='error')throw new Error(msg.error?.reason||'Erro Janus.');
          if(msg.janus==='success'&&msg.data?.id){if(!session){session=msg.data.id;send('attach',{plugin:'janus.plugin.ustreamer',opaque_id:`control-room-${crypto.randomUUID()}`},false);this.timer(()=>send('keepalive',{},false),20000,true);}else if(!handle){handle=msg.data.id;plugin({request:'features'});}}
          const data=msg.plugindata?.data;
          if(data?.error||data?.error_code)throw new Error(data.error||`uStreamer ${data.error_code}`);
          if(data?.result?.status==='features'){
            features=data.result.features||{};this.emit({audio:!!features.audio,micSupported:!!features.mic,features});
            plugin({request:'watch',params:{orientation:0,audio:this.receiveAudio&&!!features.audio,mic:this.microphoneEnabled&&!!features.mic,camera:false}});
          }
          if(msg.janus==='hangup'||msg.janus==='timeout'||msg.janus==='detached')throw new Error(msg.reason||'Sessão WebRTC encerrada.');
          if(msg.janus==='trickle'&&msg.candidate){if(peer?.remoteDescription)await peer.addIceCandidate(msg.candidate.completed?null:msg.candidate);else candidates.push(msg.candidate);}
          if(msg.jsep&&!answering){
            answering=true;peer?.close();const ice=features.ice;
            peer=this.pc=new RTCPeerConnection({iceServers:ice?.url?[{urls:ice.url}]:[],bundlePolicy:'max-bundle'});
            this.video.srcObject=new MediaStream();this.playback(this.audio.enabled,this.audio.volume);
            peer.onicecandidate=e=>send('trickle',{candidate:e.candidate?e.candidate.toJSON():{completed:true}});
            peer.onconnectionstatechange=()=>{if(peer.connectionState==='failed')fail(new Error('WebRTC falhou ao conectar por ICE/UDP.'));};
            peer.ontrack=e=>{
              if('jitterBufferTarget' in e.receiver){try{e.receiver.jitterBufferTarget=0;}catch{}}
              if('playoutDelayHint' in e.receiver){try{e.receiver.playoutDelayHint=0;}catch{}}
              if(this.audioOnly&&e.track.kind==='video')return;
              this.video.srcObject.addTrack(e.track);this.video.play().catch(()=>{});
              if(e.track.kind==='audio'&&this.audioOnly){ready();this.meter(e.track,generation);}
            };
            this.video.onloadeddata=ready;this.resources.push(()=>this.video.onloadeddata=null);
            await peer.setRemoteDescription(msg.jsep);
            if(this.disposed||generation!==this.generation)return;
            for(const c of candidates.splice(0))await peer.addIceCandidate(c.completed?null:c);
            let mic=null,micError='';
            if(this.microphoneEnabled&&features.mic){
              try{mic=await this.microphoneSource.acquire();if(this.disposed||generation!==this.generation){mic.release();return;}this.micTrack=mic.track;mic.track.enabled=!this.microphoneMuted;this.resources.push(()=>{if(this.micTrack===mic.track)this.micTrack=null;mic.release();});}
              catch(error){micError=error.name==='NotAllowedError'?'Acesso ao microfone bloqueado no Windows.':`Microfone indisponível: ${error.message}`;}
            }
            for(const tr of peer.getTransceivers()){
              if(tr.receiver.track.kind==='video'){tr.direction=this.audioOnly?'inactive':'recvonly';continue;}
              const receive=this.receiveAudio&&!!features.audio;
              tr.direction=mic?(receive?'sendrecv':'sendonly'):(receive?'recvonly':'inactive');
              if(mic)await tr.sender.replaceTrack(mic.track);
            }
            this.emit({micSupported:!!features.mic,micActive:!!mic&&!this.microphoneMuted,micConnected:!!mic,micMuted:this.microphoneMuted,micError});
            const answer=await peer.createAnswer();answer.sdp=answer.sdp.replace('useinbandfec=1','useinbandfec=1;stereo=1');await peer.setLocalDescription(answer);
            if(this.disposed||generation!==this.generation)return;
            plugin({request:'start'},{type:peer.localDescription.type,sdp:peer.localDescription.sdp});answering=false;
            if(this.audioOnly&&mic)ready();
            this.timer(async()=>{
              if(!peer||peer.connectionState==='closed')return;
              try{const stats=await peer.getStats();if(this.disposed||generation!==this.generation)return;let videoStats,audioStats,micStats;const codecs=new Map();stats.forEach(s=>{if(s.type==='codec')codecs.set(s.id,s);if(s.type==='outbound-rtp'&&s.kind==='audio')micStats=s;if(s.type==='inbound-rtp'){if(s.kind==='video')videoStats=s;if(s.kind==='audio')audioStats=s;}});
                if(videoStats){const frames=videoStats.framesDecoded||0;if(frames>lastFrames){ready();lastProgress=performance.now();}lastFrames=frames;this.emit({frames,codec:codecs.get(videoStats.codecId)?.mimeType,packetsLost:videoStats.packetsLost||0,bufferMs:videoStats.jitterBufferEmittedCount?Math.round(videoStats.jitterBufferDelay/videoStats.jitterBufferEmittedCount*1000):0,bytes:videoStats.bytesReceived||0});}
                if(audioStats)this.emit({audio:true,audioBytes:audioStats.bytesReceived||0,audioLevel:audioStats.audioLevel||0,audioCodec:codecs.get(audioStats.codecId)?.mimeType});
                if(micStats)this.emit({micBytes:micStats.bytesSent||0,micPackets:micStats.packetsSent||0});
                if(this.hasFrame&&!this.audioOnly&&performance.now()-lastProgress>15000)fail(new Error('WebRTC parou de receber quadros.'));
              }catch(error){if(generation===this.generation)fail(error);}
            },1000,true);
          }
        }catch(error){fail(error);}
      };
    }
    meter(track,generation){
      this.stopMeter?.();
      const context=new AudioContext(),source=context.createMediaStreamSource(new MediaStream([track])),analyser=context.createAnalyser();analyser.fftSize=512;source.connect(analyser);context.resume().catch(()=>{});
      const samples=new Float32Array(analyser.fftSize);let lastSound=0,timer,closed=false;
      this.stopMeter=()=>{if(closed)return;closed=true;clearInterval(timer);source.disconnect();analyser.disconnect();context.close().catch(()=>{});this.onLevel?.({level:0,active:false});};
      this.resources.push(this.stopMeter);
      timer=this.timer(()=>{if(this.disposed||generation!==this.generation)return;analyser.getFloatTimeDomainData(samples);let sum=0;for(const value of samples)sum+=value*value;const rms=Math.sqrt(sum/samples.length);if(rms>.008)lastSound=Date.now();this.onLevel?.({level:Math.min(1,rms*8),active:Date.now()-lastSound<450,lastSound});},80,true);
    }
    direct(ready,fail,generation){
      if(!root.VideoDecoder)throw new Error('Decodificador H.264 indisponível.');
      const ws=this.socket('h264',fail);let codec='',decoder=null,timestamp=0,needKey=true,lastFrame=performance.now();
      this.resources.push(()=>{if(decoder&&decoder.state!=='closed')decoder.close();});
      this.timer(()=>{if(ws.readyState===1)ws.send(new Uint8Array([0]));if(this.hasFrame&&performance.now()-lastFrame>15000)fail(new Error('H.264 direto parou de receber quadros.'));},1000,true);
      ws.onmessage=event=>{
        if(this.disposed||generation!==this.generation)return;
        try{
          if(typeof event.data==='string'){
            const msg=JSON.parse(event.data);if(msg.event_type!=='media')return;const format=msg.event.video?.h264;
            if(!format)throw new Error('O PiKVM não oferece H.264 direto.');codec=`avc1.${format.profile_level_id}`;
            ws.send(JSON.stringify({event_type:'start',event:{type:'video',format:'h264'}}));return;
          }
          const data=new Uint8Array(event.data);if(data[0]!==1)return;const key=!!data[1];
          if(needKey&&!key)return;
          if(!decoder){decoder=this.decoder=new VideoDecoder({output:frame=>{try{if(this.disposed||generation!==this.generation)return;if(this.canvas.width!==frame.displayWidth||this.canvas.height!==frame.displayHeight){this.canvas.width=frame.displayWidth;this.canvas.height=frame.displayHeight;}this.canvas.getContext('2d',{alpha:false,desynchronized:true}).drawImage(frame,0,0);lastFrame=performance.now();ready();}finally{frame.close();}},error:fail});decoder.configure({codec,optimizeForLatency:true});}
          // Descarta a fila e solicita outro quadro chave se o cliente ficar para trás.
          if(decoder.decodeQueueSize>4){decoder.reset();decoder.configure({codec,optimizeForLatency:true});needKey=true;if(ws.readyState===1)ws.send(new Uint8Array([0]));if(!key)return;}
          needKey=false;decoder.decode(new EncodedVideoChunk({type:key?'key':'delta',timestamp:timestamp+=Math.max(1,Math.round(performance.now()*1000)-timestamp),data:data.subarray(2)}));
          this.emit({codec:'video/H264',audio:false});
        }catch(error){fail(error);}
      };
    }
  }
  root.PiKVMVideo=PiKVMVideo;
})(globalThis);
