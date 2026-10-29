(function(root){
  class MicrophoneSource {
    constructor(){this.users=new Set();this.pending=null;this.stream=null;}
    async acquire(){
      const key=Symbol();this.users.add(key);
      const release=()=>{this.users.delete(key);if(!this.users.size&&this.stream){this.stream.getTracks().forEach(t=>t.stop());this.stream=null;this.pending=null;}};
      try{
        if(!this.pending)this.pending=navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false}).then(stream=>this.stream=stream).catch(error=>{this.pending=null;throw error;});
        const stream=await this.pending,track=stream.getAudioTracks()[0].clone();let done=false;
        return {track,release:()=>{if(done)return;done=true;track.stop();release();}};
      }catch(error){release();throw error;}
    }
  }
  root.MicrophoneSource=MicrophoneSource;
})(globalThis);
