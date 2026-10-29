function microphoneStatus(devices){
  const total=devices.length,open=devices.filter(d=>d.micEnabled!==false).length;
  return {total,open,muted:total>0&&open===0};
}
function toggleMicrophones(devices){
  const mute=microphoneStatus(devices).open>0;
  for(const device of devices)device.micEnabled=!mute;
  return microphoneStatus(devices);
}
module.exports={microphoneStatus,toggleMicrophones};
