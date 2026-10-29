const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {WebSocket,WebSocketServer}=require('ws');
const {attachMediaBridge}=require('../electron/media-bridge.cjs');
test('proxy local autentica no PiKVM, preserva mensagens binárias e rejeita origens externas',async t=>{
  const remote=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>remote.once('listening',r));
  remote.on('connection',(ws,req)=>{assert.equal(req.headers['x-kvmd-user'],'operator');assert.equal(req.headers['x-kvmd-passwd'],'private');assert.equal(req.url,'/api/media/ws');ws.on('message',(data,binary)=>ws.send(data,{binary}));});
  const server=http.createServer();const close=attachMediaBridge(server,{token:'token',owner:'window1',getDevice:id=>{assert.equal(id,'d1');return {url:`http://127.0.0.1:${remote.address().port}`,username:'operator',password:'private'};}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{close();server.close();for(const s of remote.clients)s.terminate();remote.close();});
  const url=`ws://127.0.0.1:${server.address().port}/token/h264/d1?owner=window1&slot=0`;
  const local=new WebSocket(url,{origin:'file://'});await new Promise((r,j)=>{local.once('open',r);local.once('error',j);});
  const reply=new Promise(r=>local.once('message',(bytes,binary)=>r({bytes,binary})));local.send(Buffer.from([1,1,0,255]));
  const received=await reply;assert.equal(received.binary,true);assert.deepEqual([...received.bytes],[1,1,0,255]);local.terminate();
  const rejected=new WebSocket(url,{origin:'https://example.com'});await assert.rejects(new Promise((r,j)=>{rejected.once('open',r);rejected.once('error',j);}),/socket|hang|closed/i);
});
