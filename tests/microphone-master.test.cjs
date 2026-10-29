const {test}=require('node:test');
const assert=require('node:assert/strict');
const {microphoneStatus,toggleMicrophones}=require('../electron/microphones.cjs');
test('atalho muta todos a partir de estado misto e depois desmuta todos',()=>{
  const devices=[{id:'a'},{id:'b',micEnabled:false},{id:'c',micEnabled:true}];
  assert.deepEqual(microphoneStatus(devices),{total:3,open:2,muted:false});
  assert.deepEqual(toggleMicrophones(devices),{total:3,open:0,muted:true});
  assert.ok(devices.every(d=>d.micEnabled===false));
  assert.deepEqual(toggleMicrophones(devices),{total:3,open:3,muted:false});
  assert.ok(devices.every(d=>d.micEnabled===true));
});
test('sem dispositivos não indica microfone mutado nem cria estado fictício',()=>{
  assert.deepEqual(toggleMicrophones([]),{total:0,open:0,muted:false});
});
