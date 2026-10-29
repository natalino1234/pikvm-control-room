const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function load(getUserMedia){const context=vm.createContext({navigator:{mediaDevices:{getUserMedia}}});vm.runInContext(fs.readFileSync(require.resolve('../ui/microphone.js'),'utf8'),context);return new context.MicrophoneSource();}
test('microfone compartilhado captura uma vez, clona por PiKVM e libera ao desligar o último',async()=>{
  let calls=0,sourceStopped=false;const clones=[];
  const source={stop(){sourceStopped=true;},clone(){const track={stopped:false,stop(){this.stopped=true;}};clones.push(track);return track;}};
  const mic=load(async options=>{calls++;assert.equal(options.video,false);return {getTracks:()=>[source],getAudioTracks:()=>[source]};});
  const [a,b]=await Promise.all([mic.acquire(),mic.acquire()]);assert.equal(calls,1);assert.notEqual(a.track,b.track);
  a.release();assert.equal(clones[0].stopped,true);assert.equal(clones[1].stopped,false);assert.equal(sourceStopped,false);
  b.release();assert.equal(clones[1].stopped,true);assert.equal(sourceStopped,true);assert.equal(mic.users.size,0);
});
test('negação de permissão não deixa captura pendente nem impede nova tentativa',async()=>{
  let calls=0;const mic=load(async()=>{calls++;throw Object.assign(new Error('Bloqueado'),{name:'NotAllowedError'});});
  await assert.rejects(mic.acquire(),/Bloqueado/);await assert.rejects(mic.acquire(),/Bloqueado/);assert.equal(calls,2);assert.equal(mic.users.size,0);assert.equal(mic.pending,null);
});
