/* Uma sessão de áudio por equipamento; não depende de abas, foco ou monitores. */
const sessions=new Map(),microphone=new MicrophoneSource();
let state,base;const captures=new Map();
function syncCaptures(){
 const wanted=new Map();for(const [id,{player}]of sessions){const d=state.devices.find(d=>d.id===id),recording=state.transcription?.meetings?.some(m=>m.deviceId===id);if(!d)continue;const received=player.video.srcObject?.getAudioTracks()[0];if(received)wanted.set(id+":received",{id,direction:"received",track:received});if(player.micTrack)wanted.set(id+":sent",{id,direction:"sent",track:player.micTrack});}
 for(const [key,c]of captures)if(wanted.get(key)?.track!==c.track||c.track.readyState==="ended"){c.stop();captures.delete(key);}
 for(const [key,c]of wanted)if(!captures.has(key)&&c.track.readyState==="live")captures.set(key,new AudioCapture(c.id,c.direction,c.track));
}
setInterval(syncCaptures,250);
function targets(){return new Set(state.windows.flatMap(w=>w.tabs.flatMap(t=>t.slots)).filter(Boolean));}
function sync(){
  const assigned=targets();
  for(const m of state.transcription?.meetings||[])assigned.add(m.deviceId);
  const wanted=new Set(state.devices.filter(d=>assigned.has(d.id)).map(d=>d.id));
  for(const [id,entry]of sessions)if(!wanted.has(id)){entry.player.stop();entry.element.remove();sessions.delete(id);window.room.audioStatus({id,status:'disabled',audio:false,micActive:false});}
  for(const d of state.devices){
    if(!wanted.has(d.id))continue;
    const signature=JSON.stringify([d.url,d.username,d.connectionRevision]);let entry=sessions.get(d.id);
    if(entry&&entry.signature!==signature){entry.player.stop();entry.element.remove();sessions.delete(d.id);entry=null;}
    if(!entry){
      const element=document.createElement('div');element.innerHTML='<img><video autoplay playsinline></video><canvas></canvas>';element.dataset.id=d.id;document.querySelector('#sessions').appendChild(element);
      let last=0,lastStatus='',lastMic='';
      const player=new PiKVMVideo({element,base,id:d.id,owner:'audio-hub',slot:0,mode:'webrtc',audioOnly:true,receiveAudio:true,microphoneEnabled:true,microphoneMuted:d.micEnabled===false,microphoneSource:microphone,
        onState:report=>{const micState=`${report.micActive}:${report.micMuted}:${report.micConnected}`;if(Date.now()-last>800||report.status!==lastStatus||micState!==lastMic){last=Date.now();lastStatus=report.status;lastMic=micState;window.room.audioStatus({id:d.id,...report});}},
        onLevel:level=>window.room.audioLevel({id:d.id,...level})});
      entry={element,player,signature};sessions.set(d.id,entry);
    }
    entry.player.playback(d.audioEnabled!==false,(d.volume??70)/100);
    entry.player.muteMicrophone(d.micEnabled===false);
  }
  window.room.call('subscribe',[...wanted]).catch(()=>{});
}
window.room.on('flush-audio',async request=>{try{await Promise.all([...captures.values()].filter(c=>c.id===request.id).map(c=>c.flush()));window.room.audioFlushed({token:request.token});}catch(error){window.room.audioFlushed({token:request.token,error:error.message});}});
window.room.on('state',value=>{state=value;sync();});
window.addEventListener('beforeunload',()=>{for(const c of captures.values())c.stop();for(const entry of sessions.values())entry.player.stop();});
(async()=>{const boot=await window.room.call('boot');state=boot;base=boot.mediaBase;sync();})();
