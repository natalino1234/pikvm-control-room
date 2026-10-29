const { WebSocket, WebSocketServer } = require('ws');
// Credenciais ficam no processo principal. O renderer usa somente o token local.
function attachMediaBridge(server, { token, owner, getDevice }) {
  const gateway = new WebSocketServer({ noServer:true, maxPayload:2*1024*1024 });
  const pairs = new Set();
  server.on('upgrade',(req,socket,head)=>{
    const url = new URL(req.url,'http://localhost'), parts=url.pathname.split('/');
    if(parts[1]!==token || !['janus','h264'].includes(parts[2]) || url.searchParams.get('owner')!==owner || !['0','1','2','3'].includes(url.searchParams.get('slot')) || !['file://','null'].includes(req.headers.origin)) { socket.destroy();return; }
    let device;try{device=getDevice(decodeURIComponent(parts[3]));}catch{socket.destroy();return;}
    gateway.handleUpgrade(req,socket,head,local=>{
      const target = new URL(parts[2]==='janus'?'/janus/ws':'/api/media/ws',device.url);target.protocol=target.protocol==='https:'?'wss:':'ws:';
      const options={rejectUnauthorized:!device.insecure,handshakeTimeout:10000,headers:{'X-KVMD-User':device.username,'X-KVMD-Passwd':device.password}};
      const remote=parts[2]==='janus'?new WebSocket(target,'janus-protocol',options):new WebSocket(target,options);
      const pair={local,remote};pairs.add(pair); const queued=[];let queuedSize=0;
      const close=()=>{pairs.delete(pair);local.terminate();remote.terminate();};
      remote.on('open',()=>{for(const [data,binary] of queued)remote.send(data,{binary});queued.length=0;});
      local.on('message',(data,binary)=>{if(remote.readyState===WebSocket.OPEN)remote.send(data,{binary});else if(remote.readyState===WebSocket.CONNECTING){queuedSize+=data.length;if(queuedSize>256*1024)return close();queued.push([data,binary]);}});
      remote.on('message',(data,binary)=>{if(local.readyState!==WebSocket.OPEN)return;if(local.bufferedAmount>8*1024*1024)return close();local.send(data,{binary});});
      for(const ws of [local,remote]){ws.on('error',close);ws.on('close',close);}
    });
  });
  return ()=>{for(const {local,remote} of pairs){local.terminate();remote.terminate();}pairs.clear();gateway.close();};
}
module.exports={attachMediaBridge};
