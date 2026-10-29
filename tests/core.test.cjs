const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocketServer } = require('ws');
const { origin, validateTab, pointer } = require('../electron/model.cjs');
const { request, allowed, Connection } = require('../electron/pikvm.cjs');
const { merge, normalize } = require('../electron/events.cjs');
const { encodeHid } = require('../electron/hid.cjs');
test('codifica HID binário compatível com KVMD, incluindo coordenadas negativas',()=>{
  assert.deepEqual([...encodeHid('key',{key:'KeyA',state:true})],[1,1,75,101,121,65]);
  assert.deepEqual([...encodeHid('key',{key:'KeyA',state:false})],[1,0,75,101,121,65]);
  assert.deepEqual([...encodeHid('mouse_button',{button:'left',state:true})],[2,1,108,101,102,116]);
  assert.deepEqual([...encodeHid('mouse_move',{to:{x:-32768,y:32767}})],[3,128,0,127,255]);
  assert.deepEqual([...encodeHid('mouse_relative',{delta:{x:-5,y:127}})],[4,0,251,127]);
  assert.deepEqual([...encodeHid('mouse_wheel',{delta:{x:0,y:-5}})],[5,0,0,251]);
  assert.throws(()=>encodeHid('mouse_move',{to:{x:32768,y:0}}));assert.throws(()=>encodeHid('key',{key:'KeyA',state:1}));
});
test('compatibilidade com eventos agrupados do KVMD 4.176 e eventos antigos',()=>{
  assert.deepEqual(normalize({event_type:'atx',event:{enabled:true}}),[{event_type:'atx_state',event:{enabled:true}}]);
  assert.deepEqual(normalize({event_type:'info',event:{system:{kvmd:{version:'4.176'}}}}),[{event_type:'info_system_state',event:{kvmd:{version:'4.176'}}}]);
  assert.deepEqual(normalize({event_type:'gpio',event:{model:{scheme:{}},state:{outputs:{}}}}).map(e=>e.event_type),['gpio_model_state','gpio_state']);
  assert.deepEqual(normalize({event_type:'hid_state',event:{online:true}}),[{event_type:'hid_state',event:{online:true}}]);
  const next=merge({enabled:true,leds:{power:false,hdd:false},storage:{images:{old:{}}}},{leds:{power:true},storage:{images:{}}});
  assert.equal(next.enabled,true);assert.deepEqual(next.leds,{power:true,hdd:false});assert.deepEqual(next.storage.images,{});
});
test('normaliza a URL e rejeita esquemas e credenciais embutidas', () => {
  assert.equal(origin('192.0.2.10/kvm/'), 'https://192.0.2.10');
  assert.equal(origin('https://pikvm.local:8443/kvm/?x=1'), 'https://pikvm.local:8443');
  for (const url of ['file:///C:/x','javascript:alert(1)','https://admin:secret@host']) assert.throws(() => origin(url));
});
test('preserva quatro atribuições ao alternar layouts e remove equipamentos desconhecidos', () => {
  const t=validateTab({id:'t',name:'Sala',layout:2,slots:['a','b','invalid','a'],fit:'fill'},[{id:'a'},{id:'b'}]);
  assert.deepEqual(t.slots,['a','b',null,'a']); assert.equal(t.fit,'fill');
  assert.throws(()=>validateTab({...t,layout:3},[]));
});
test('mouse considera barras pretas, proporção e coordenadas absolutas', () => {
  const box={left:100,top:100,width:1000,height:1000},image={width:1920,height:1080};
  assert.equal(pointer(600,150,box,image),null);
  const center=pointer(600,600,box,image); assert.ok(Math.abs(center.x)<=1 && Math.abs(center.y)<=1);
  assert.deepEqual(pointer(100,100,box,image,'fill'),{x:-32768,y:-32768});
  assert.deepEqual(pointer(1100,1100,box,image,'fill'),{x:32767,y:32767});
});
test('API é restrita às rotas e métodos implementados',()=>{
  assert.ok(allowed('POST','/api/atx/power?action=on')); assert.ok(allowed('GET','/api/info'));
  assert.equal(allowed('DELETE','/api/info'),false); assert.equal(allowed('POST','/api/auth/logout'),false);
  assert.equal(allowed('GET','https://example.com/api/info'),false);
});
test('cliente HTTP autentica, trata falhas e transmite corpo de texto', async t=>{
  const server=http.createServer((req,res)=>{ assert.equal(req.headers['x-kvmd-user'],'operator'); assert.equal(req.headers['x-kvmd-passwd'],'private');
    if(req.url==='/forbidden'){res.writeHead(403).end();return;}
    let text='';req.on('data',b=>text+=b);req.on('end',()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,result:{text,method:req.method}}));});
  }); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const d={url:`http://127.0.0.1:${server.address().port}`,username:'operator',password:'private'};
  assert.deepEqual(await request(d,'/api/hid/print',{method:'POST',body:'Olá\nMundo'}),{text:'Olá\nMundo',method:'POST'});
  await assert.rejects(request(d,'/forbidden'),/403/);
});
test('WebSocket recebe estado, envia eventos e encerra sem reconectar',async t=>{
  const wss=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise(resolve=>wss.on('listening',resolve));
  t.after(()=>wss.close()); let socket, received;
  wss.on('connection',(ws,req)=>{socket=ws;assert.equal(req.headers['x-kvmd-user'],'admin');ws.send(JSON.stringify({event_type:'hid_state',event:{online:true}})); ws.on('message',(b,binary)=>received={bytes:b,binary});});
  const conn=new Connection({url:`http://127.0.0.1:${wss.address().port}`,username:'admin',password:'secret'},()=>{});t.after(()=>conn.stop());
  await new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{if(conn.states.hid_state){clearInterval(timer);resolve();}else if(Date.now()-start>3000){clearInterval(timer);reject(new Error('Sem estado WS'));}},10);});
  conn.send('key',{key:'KeyA',state:true});await new Promise(resolve=>socket.once('message',resolve));
  assert.equal(received.binary,true);assert.deepEqual([...received.bytes],[1,1,75,101,121,65]); conn.stop();assert.equal(conn.stopped,true);
});
