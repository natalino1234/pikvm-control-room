const { app, BrowserWindow, ipcMain, screen, safeStorage, dialog, Menu, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { randomUUID, randomBytes } = require('node:crypto');
const model = require('./model.cjs');
const { request, Connection, allowed } = require('./pikvm.cjs');
const { attachMediaBridge } = require('./media-bridge.cjs');
const { encodeHid } = require('./hid.cjs');
const {microphoneStatus,toggleMicrophones}=require('./microphones.cjs');
const {Transcription}=require('./transcription.cjs');
let transcription;const audioFlushes=new Map();
async function flushAudio(id){const hub=windows.get('audio-hub');if(!hub||hub.isDestroyed())throw Error('A sessão de áudio não está disponível para finalizar.');const token=randomUUID();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{audioFlushes.delete(token);reject(Error('O áudio final não foi confirmado. Tente encerrar novamente.'));},4000);audioFlushes.set(token,result=>{clearTimeout(timer);audioFlushes.delete(token);result.error?reject(Error(result.error)):resolve();});hub.webContents.send('flush-audio',{id,token});});}
let audioFocus = null;
const mediaReports = new Map();
const audioReports = new Map(),audioLevels=new Map();
let state, configPath, mediaBase, server, selected = null;
const windows = new Map(), subscribers = new Map(), connections = new Map(), held = new Map();
const mediaRequests = new Map();
function clearMedia(owner) { for (const [key, stream] of mediaRequests) if (key.startsWith(`${owner}:`)) { stream.request.destroy(); stream.response.destroy(); mediaRequests.delete(key); } }
const token = randomBytes(32).toString('hex');
if (process.env.PIKVM_DATA_DIR) app.setPath('userData', path.resolve(process.env.PIKVM_DATA_DIR));
function save() {
  const dest = `${configPath}.tmp`;
  fs.writeFileSync(dest, JSON.stringify(state, null, 2)); fs.renameSync(dest, configPath);
}
function device(id) {
  const d = state.devices.find(d => d.id === id); if (!d) throw new Error('PiKVM não encontrado.');
  let password = '';
  if (d.secret) password = safeStorage.decryptString(Buffer.from(d.secret, 'base64'));
  else if (d.defaultPassword) password = 'admin';
  return { ...d, password };
}
function publicState() { return { devices: state.devices.map(({ secret, defaultPassword, ...d }) => ({ ...d, hasPassword: !!(secret || defaultPassword) })), transcription:transcription?.snapshot(), windows: state.windows, selected, audioFocus, microphones:microphoneStatus(state.devices),mediaReports:[...mediaReports.values()],audioReports:[...audioReports.values()],audioLevels:[...audioLevels.values()] }; }
function broadcast(channel, value) { for (const w of windows.values()) if (!w.isDestroyed()) w.webContents.send(channel, value); }
function changed() { save(); broadcast('state', publicState()); }
function toggleAllMicrophones(sender){if(sender)release(sender);const result=toggleMicrophones(state.devices);changed();return result;}
function syncConnections() {
  const wanted = new Set([...subscribers.values()].flat());
  for (const [id, conn] of connections) if (!wanted.has(id)) { conn.stop(); connections.delete(id); }
  for (const id of wanted) if (!connections.has(id) && state.devices.some(d => d.id === id)) {
    try { connections.set(id, new Connection(device(id), event => broadcast('device-event', { id, ...event }))); }
    catch (error) { broadcast('device-event', { id, event_type: 'connection', event: { status: 'offline', error: error.message } }); }
  }
}
function release(sender) {
  const keys = held.get(sender); if (!keys) return;
  for (const { id, type, key } of keys.values()) connections.get(id)?.send(type, type === 'key' ? { key, state: false } : { button: key, state: false });
  held.delete(sender);
}
function displays() { return screen.getAllDisplays().map((d, i) => ({ id: d.id, name: d.label || `Monitor ${i + 1}`, bounds: d.bounds, primary: d.id === screen.getPrimaryDisplay().id })); }
function openWindow(config, central = false, audioHub=false) {
  const monitor = screen.getAllDisplays().find(d => d.id === config.displayId) || screen.getPrimaryDisplay();
  const b = monitor.workArea;
  const w = new BrowserWindow({ x: b.x + 32, y: b.y + 32, width: central ? 500 : Math.min(1440, b.width - 64), height: Math.min(940, b.height - 64), minWidth: central ? 420 : 720, minHeight: 520, backgroundColor: '#0c1017', title: central ? 'Central • PiKVM Control Room' : 'PiKVM Control Room', autoHideMenuBar: true,
    show:!audioHub, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, autoplayPolicy:'no-user-gesture-required',backgroundThrottling:false } });
  windows.set(config.id, w); w.roomId = config.id;
  const senderId = w.webContents.id;
  // Quatro streams por origem: uma porta por janela evita o limite HTTP/1.1
  // do Chromium bloquear streams quando vários monitores estão em uso.
  const windowMedia = central ? null : http.createServer(server.listeners('request')[0]);
  const closeBridge = windowMedia ? attachMediaBridge(windowMedia,{token,owner:config.id,getDevice:device}) : ()=>{};
  w.mediaReady = windowMedia ? new Promise(resolve => windowMedia.listen(0,'127.0.0.1',()=>{w.mediaBase=`http://127.0.0.1:${windowMedia.address().port}/${token}/stream/`;resolve();})) : Promise.resolve();
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.loadFile(path.join(__dirname, audioHub?'../ui/audio.html':'../ui/index.html'), { query: { window: config.id, central: central ? '1' : '0' } });
  let microphoneShortcutHeld=false;
  w.on('blur', () => {microphoneShortcutHeld=false;release(w.webContents.id);});
  w.on('closed', () => { subscribers.delete(senderId); release(senderId); clearMedia(config.id); closeBridge(); windowMedia?.close(); windows.delete(config.id); syncConnections();if(!audioHub&&[...windows.keys()].every(id=>id==='audio-hub'))app.quit(); });
  w.webContents.on('before-input-event', (event, input) => {
    if((input.code==='KeyM'||input.key?.toLowerCase()==='m')&&(microphoneShortcutHeld||(input.type==='keyDown'&&input.control&&input.shift&&!input.alt&&!input.meta))){
      event.preventDefault();
      if(input.type==='keyUp')microphoneShortcutHeld=false;
      else if(input.type==='keyDown'){microphoneShortcutHeld=true;if(!input.isAutoRepeat)toggleAllMicrophones(senderId);}
      return;
    }
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { event.preventDefault(); w.setFullScreen(!w.isFullScreen()); }
    if (input.key === 'F10') { event.preventDefault(); release(w.webContents.id); w.webContents.send('escape-controls'); }
  });
  if (!central&&!audioHub) { if (config.fullscreen) w.setFullScreen(true); else w.maximize(); }
  const full = () => { if (!central) { config.fullscreen = w.isFullScreen(); changed(); } w.webContents.send('fullscreen', w.isFullScreen()); };
  w.on('enter-full-screen', full); w.on('leave-full-screen', full);
  return w;
}
function checkedSender(event) {
  if (![...windows.values()].some(w => !w.isDestroyed() && w.webContents.id === event.sender.id)) throw new Error('Janela não autorizada.');
}
function handle(name, fn) { ipcMain.handle(name, async (event, ...args) => { checkedSender(event); try { return { ok: true, data: await fn(event, ...args) }; } catch (error) { return { ok: false, error: error.message }; } }); }
function register() {
  handle('boot', async e => { const w=BrowserWindow.fromWebContents(e.sender);await w.mediaReady;return { ...publicState(), displays: displays(), mediaBase:w.mediaBase || mediaBase, fullscreen:w.isFullScreen() }; });
  handle('save-device', (_e, data) => {
    const old = state.devices.find(d => d.id === data.id);
    const d = { ...old, id: old?.id || randomUUID(), name: String(data.name || 'PiKVM').slice(0, 80), url: model.origin(String(data.url)), username: String(data.username || 'admin'), insecure: !!data.insecure,connectionRevision:(old?.connectionRevision||0)+1 };
    if (data.password) { if (!safeStorage.isEncryptionAvailable()) throw new Error('Criptografia de credenciais indisponível neste Windows.'); d.secret = safeStorage.encryptString(String(data.password)).toString('base64'); }
    else if (old) { d.secret = old.secret; d.defaultPassword = old.defaultPassword; }
    else throw new Error('Informe a senha.');
    if (old) state.devices[state.devices.indexOf(old)] = d; else state.devices.push(d);
    connections.get(d.id)?.stop(); connections.delete(d.id); syncConnections(); changed(); return d.id;
  });
  handle('delete-device', (_e, id) => {
    if(transcription.meetings.has(id))throw Error('Encerre a reunião antes de remover esta conexão.');
    state.devices = state.devices.filter(d => d.id !== id);
    for (const win of state.windows) for (const tab of win.tabs) tab.slots = tab.slots.map(s => s === id ? null : s);
    if (selected === id) selected = null;
    connections.get(id)?.stop(); connections.delete(id); changed();
  });
  handle('save-window', (e, data) => {
    const w = state.windows.find(w => w.id === BrowserWindow.fromWebContents(e.sender).roomId);
    if (!w) throw new Error('Use uma janela de vídeo para editar as abas.');
    if (!Array.isArray(data.tabs) || !data.tabs.length || data.tabs.length > 30) throw new Error('Crie entre 1 e 30 abas.');
    w.tabs = data.tabs.map(t => model.validateTab(t, state.devices)); w.activeTab = w.tabs.some(t => t.id === data.activeTab) ? data.activeTab : w.tabs[0].id; changed();
  });
  handle('select', (e, id, slot=0) => { selected = state.devices.some(d => d.id === id) ? id : null;const owner=BrowserWindow.fromWebContents(e.sender).roomId;if(owner!=='central'){audioFocus={owner,slot,id:selected};broadcast('audio-focus',audioFocus);}broadcast('selection', selected); });
  handle('media-settings', (_e,id,settings)=>{
    const d=state.devices.find(d=>d.id===id);if(!d)throw new Error('PiKVM não encontrado.');
    if(!['auto','webrtc','h264','mjpeg'].includes(settings.transport))throw new Error('Transporte inválido.');
    if(!Number.isInteger(settings.volume)||settings.volume<0||settings.volume>100)throw new Error('Volume inválido.');
    Object.assign(d,{transport:settings.transport,audioEnabled:!!settings.audioEnabled,micEnabled:!!settings.micEnabled,volume:settings.volume});changed();
  });
  handle('microphone-muted',(_e,id,muted)=>{const d=state.devices.find(d=>d.id===id);if(!d||typeof muted!=='boolean')throw new Error('Microfone inválido.');d.micEnabled=!muted;changed();});
  handle('transcription-settings',(_e,settings)=>{if(transcription.running||transcription.installing||transcription.meetings.size)throw Error('Encerre as reuniões e aguarde o processamento para alterar o motor.');if(!['cpu','cuda'].includes(settings.acceleration)||!['tiny','base','small'].includes(settings.model)||!['pt','en','es','auto'].includes(settings.language))throw Error('Configuração inválida.');transcription.stopEngine();state.transcription={acceleration:settings.acceleration,model:settings.model,language:settings.language};changed();return transcription.snapshot();});
  handle('transcription-install',()=>transcription.install());
  handle('captions-enabled',(_e,id,enabled)=>{const d=state.devices.find(d=>d.id===id);if(!d||typeof enabled!=='boolean')throw Error('Conexão inválida.');d.captionsEnabled=enabled;changed();});
  handle('meeting-start',async(_e,id)=>{const d=state.devices.find(d=>d.id===id);if(!d)throw Error('Conexão inválida.');const assigned=state.windows.some(w=>w.tabs.some(t=>t.slots.includes(id)));if(!assigned)throw Error('Atribua este PiKVM a uma área para receber áudio.');await transcription.ensureEngine();const meeting=transcription.startMeeting(d);changed();return meeting;});
  handle('meeting-stop',async(_e,id)=>{await flushAudio(id);transcription.stopMeeting(id);changed();});
  handle('meeting-list',()=>transcription.list());
  handle('meeting-folder',async(_e,id)=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Reunião inválida.');const dir=path.join(transcription.root,'meetings',id);if(!fs.existsSync(dir))throw Error('Pasta não encontrada.');const error=await shell.openPath(dir);if(error)throw Error(error);});
  handle('meeting-review',(_e,id)=>transcription.refine(id));
  ipcMain.on('audio-flushed',(e,result)=>{checkedSender(e);if(BrowserWindow.fromWebContents(e.sender).roomId==='audio-hub')audioFlushes.get(result.token)?.(result);});
  ipcMain.on('audio-pcm',(e,chunk)=>{checkedSender(e);if(BrowserWindow.fromWebContents(e.sender).roomId!=='audio-hub')return;try{transcription.ingest(chunk);}catch(error){transcription.update('error','Falha ao salvar/processar áudio: '+error.message);}});
  handle('toggle-microphones',e=>toggleAllMicrophones(e.sender.id));
  handle('control-selected',()=>{
    const w=windows.get(audioFocus?.owner);if(!w||w.isDestroyed()||audioFocus.id!==selected)throw new Error('Selecione primeiro uma área de vídeo.');
    w.focus();w.webContents.send('activate-control',audioFocus);
  });
  handle('subscribe', (e, ids) => {
    subscribers.set(e.sender.id, ids.filter(id => state.devices.some(d => d.id === id))); syncConnections();
    for (const id of ids) { const c = connections.get(id); if (c) { e.sender.send('device-event', { id, event_type: 'connection', event: { status: c.ws.readyState === 1 ? 'online' : 'connecting' } }); for (const [event_type, event] of Object.entries(c.states)) e.sender.send('device-event', { id, event_type, event }); } }
  });
  handle('api', (_e, id, method, route, body) => { if (!allowed(method, route)) throw new Error('Comando não permitido.'); return request(device(id), route, { method, body }); });
  handle('test-device', (_e, id) => request(device(id), '/api/info'));
  handle('release', e => release(e.sender.id));
  ipcMain.on('audio-status',(e,report)=>{checkedSender(e);if(BrowserWindow.fromWebContents(e.sender).roomId!=='audio-hub')return;audioReports.set(report.id,report);broadcast('audio-state',report);});
  ipcMain.on('audio-level',(e,report)=>{checkedSender(e);if(BrowserWindow.fromWebContents(e.sender).roomId!=='audio-hub')return;audioLevels.set(report.id,report);broadcast('audio-level',report);});
  ipcMain.on('media-status',(e,report)=>{checkedSender(e);const owner=BrowserWindow.fromWebContents(e.sender).roomId;if(!state.devices.some(d=>d.id===report.id)||![0,1,2,3].includes(report.slot))return;const data={...report,owner};mediaReports.set(`${owner}:${report.slot}`,data);broadcast('media-status',data);});
  ipcMain.on('clear-streams', e => { checkedSender(e); clearMedia(BrowserWindow.fromWebContents(e.sender).roomId); });
  ipcMain.on('hid', (e, id, type, data) => {
    checkedSender(e);
    if (!subscribers.get(e.sender.id)?.includes(id) || !['key','mouse_move','mouse_relative','mouse_button','mouse_wheel'].includes(type)) return;
    try{encodeHid(type,data);}catch(error){e.sender.send('hid-error',error.message);return;}
    if (type === 'key' || type === 'mouse_button') {
      const key = type === 'key' ? data.key : data.button; if (typeof key !== 'string' || key.length > 40) return;
      if (!held.has(e.sender.id)) held.set(e.sender.id, new Map());
      const map = held.get(e.sender.id), k = `${id}:${type}:${key}`;
      if (data.state) map.set(k, { id, type, key }); else map.delete(k);
    }
    try { if(!connections.get(id)?.send(type, data))e.sender.send('hid-error','HID sem conexão. Aguarde a reconexão.'); }
    catch(error){e.sender.send('hid-error',error.message);}
  });
  handle('fullscreen', e => { const w = BrowserWindow.fromWebContents(e.sender); w.setFullScreen(!w.isFullScreen()); return w.isFullScreen(); });
  handle('new-window', (_e, displayId) => {
    const w = { id: randomUUID(), displayId, fullscreen: true, tabs: [model.tab()], activeTab: null }; w.activeTab = w.tabs[0].id; state.windows.push(w); changed(); openWindow(w); return w.id;
  });
  handle('move-window', (e, displayId) => {
    const win = BrowserWindow.fromWebContents(e.sender), monitor = screen.getAllDisplays().find(d => d.id === displayId);
    if (!monitor) throw new Error('Monitor desconectado.');
    const config = state.windows.find(w => w.id === win.roomId); if (config) config.displayId = displayId;
    win.setFullScreen(false); win.unmaximize(); win.setBounds(monitor.bounds); win.setFullScreen(true); changed();
  });
  handle('central', () => { const old = windows.get('central'); if (old) { old.focus(); return; } openWindow({ id: 'central' }, true); });
  handle('remove-window', e => { const w = BrowserWindow.fromWebContents(e.sender); if (state.windows.length <= 1) throw new Error('Mantenha ao menos uma janela de vídeo.'); state.windows = state.windows.filter(c => c.id !== w.roomId); changed(); w.close(); });
  handle('snapshot', async (_e, id) => {
    const result = await dialog.showSaveDialog({ title: 'Salvar captura', defaultPath: `pikvm-${Date.now()}.jpg`, filters: [{ name: 'JPEG', extensions: ['jpg'] }] });
    if (result.canceled) return false;
    const image = await request(device(id), '/api/streamer/snapshot'); if (!Buffer.isBuffer(image)) throw new Error('Captura indisponível.'); fs.writeFileSync(result.filePath, image); return true;
  });
  handle('upload', async (e, id) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Enviar imagem para mídia virtual', properties: ['openFile'], filters: [{ name: 'Imagens de disco', extensions: ['iso','img'] }] });
    if (result.canceled) return false;
    const file = result.filePaths[0], d = device(id), url = new URL(`/api/msd/write?image=${encodeURIComponent(path.basename(file))}`, d.url);
    await new Promise((resolve, reject) => {
      const req = (url.protocol === 'https:' ? https : http).request(url, { method: 'POST', rejectUnauthorized: !d.insecure, headers: { 'X-KVMD-User': d.username, 'X-KVMD-Passwd': d.password, 'Content-Length': fs.statSync(file).size, 'Content-Type': 'application/octet-stream' } }, res => {
        let text = ''; res.on('data', b => text += b); res.on('end', () => { try { if (res.statusCode !== 200 || JSON.parse(text).ok === false) throw new Error(`Falha no envio: HTTP ${res.statusCode}`); resolve(); } catch (error) { reject(error); } }); res.on('error', reject);
      });
      req.setTimeout(60000, () => req.destroy(new Error('Envio sem resposta por 60 segundos.'))); req.on('error', reject);
      const input = fs.createReadStream(file); input.on('error', error => req.destroy(error)); req.on('close', () => input.destroy()); input.pipe(req);
    }); return true;
  });
}
async function mediaServer() {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost'); const parts = url.pathname.split('/');
    if (req.method !== 'GET' || parts[1] !== token || parts[2] !== 'stream' || (req.headers.origin && req.headers.origin !== 'null')) { res.writeHead(403).end(); return; }
    let d; try { d = device(parts[3]); } catch { res.writeHead(404).end(); return; }
    const owner = url.searchParams.get('owner'), slot = url.searchParams.get('slot');
    if (!windows.has(owner) || !['0','1','2','3'].includes(slot)) { res.writeHead(403).end(); return; }
    const mediaKey = `${owner}:${slot}`;
    const previous = mediaRequests.get(mediaKey); if (previous) { previous.request.destroy(); previous.response.destroy(); }
    const target = new URL('/streamer/stream', d.url);
    target.searchParams.set('extra_headers', '1'); target.searchParams.set('advance_headers', '1');
    const upstream = (target.protocol === 'https:' ? https : http).get(target, { rejectUnauthorized: !d.insecure, headers: { 'X-KVMD-User': d.username, 'X-KVMD-Passwd': d.password } }, incoming => {
      res.writeHead(incoming.statusCode, { 'Content-Type': incoming.headers['content-type'] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'null', 'X-Content-Type-Options': 'nosniff' }); incoming.pipe(res); incoming.on('error', () => res.destroy());
    });
    mediaRequests.set(mediaKey, {request:upstream,response:res});
    upstream.setTimeout(20000, () => upstream.destroy(new Error('Stream sem resposta.')));
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }); res.on('close', () => { upstream.destroy(); if(mediaRequests.get(mediaKey)?.request === upstream)mediaRequests.delete(mediaKey); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); mediaBase = `http://127.0.0.1:${server.address().port}/${token}/stream/`;
}
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  configPath = path.join(app.getPath('userData'), 'config.json');
  try { state = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (error) {
    if (fs.existsSync(configPath)) { dialog.showErrorBox('Configuração inválida', 'O arquivo de configuração foi preservado. Verifique config.json na pasta de dados do aplicativo.'); app.quit(); return; }
    state = model.initial();
  }
  if (!state.windows.length) { const t = model.tab(state.devices[0]?.id); state.windows.push({ id: randomUUID(), displayId: screen.getPrimaryDisplay().id, fullscreen: false, tabs: [t], activeTab: t.id }); }
  state.transcription ||= {acceleration:'cuda',model:'base',language:'pt'};
  transcription=new Transcription({root:path.join(app.getPath('userData'),'local-asr'),notify:broadcast,getDevice:id=>state.devices.find(d=>d.id===id),getConfig:()=>state.transcription});
  await mediaServer(); register(); save();
  const trustedMic=contents=>contents&&windows.get('audio-hub')?.webContents===contents;
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>callback(permission==='media'&&trustedMic(contents)&&details.mediaTypes?.every(type=>type==='audio')===true));
  session.defaultSession.setPermissionCheckHandler((contents,permission,_origin,details)=>permission==='media'&&trustedMic(contents)&&details.mediaType!=='video');
  for (const w of state.windows) openWindow(w);
  openWindow({id:'audio-hub'},false,true);
  screen.on('display-added', () => broadcast('displays', displays())); screen.on('display-removed', () => broadcast('displays', displays()));
});
app.on('window-all-closed', () => app.quit());
let finishingQuit=false;
app.on('before-quit', e => {if(!finishingQuit&&transcription?.meetings.size){e.preventDefault();finishingQuit=true;Promise.allSettled([...transcription.meetings.keys()].map(flushAudio)).then(()=>{transcription.close();app.quit();});return;} transcription?.close(); for (const c of connections.values()) c.stop(); server?.close(); });
