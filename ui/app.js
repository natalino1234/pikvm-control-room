/* Renderer sem acesso ao Node: toda comunicação passa pelo preload restrito. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const paths = {
  screen:'M3 4h18v13H3z M8 21h8 M12 17v4', grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  split:'M3 4h18v16H3z M12 4v16', single:'M3 4h18v16H3z', plus:'M12 5v14 M5 12h14',
  expand:'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5', settings:'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  keyboard:'M2 5h20v14H2z M5 9h1 M9 9h1 M13 9h1 M17 9h1 M5 12h1 M9 12h1 M13 12h1 M17 12h1 M7 16h10',
  power:'M12 2v10 M6 5a9 9 0 1 0 12 0', media:'M4 3h16v18H4z M8 3v6h8V3 M8 16h8',
  link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  refresh:'M20 7v5h-5 M4 17v-5h5 M5 8a8 8 0 0 1 13-3l2 3 M4 16l2 3a8 8 0 0 0 13-3',
  close:'M6 6l12 12 M18 6L6 18', edit:'M14 4l6 6 M3 21l5-1L21 7l-5-5L3 15z',
  camera:'M3 6h5l2-3h4l2 3h5v15H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  detach:'M14 3h7v7 M10 14L21 3 M10 3H3v18h18v-7', arrow:'M5 12h14 M13 6l6 6-6 6',
  mouse:'M6 10a6 6 0 0 1 12 0v5a6 6 0 0 1-12 0z M12 4v7', info:'M12 11v6 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.screen}"/></svg>`;
const btn = (action, label, name, cls = '', extra = '') => `<button class="${cls}" data-action="${action}" ${extra}>${name ? icon(name) : ''}${label}</button>`;
const field = (label, content) => `<label class="field">${label}${content}</label>`;
const badge = status => `<i class="dot ${esc(status)}"></i>`;
const query = new URLSearchParams(location.search), windowId = query.get('window'), central = query.get('central') === '1';
let state, monitors = [], mediaBase, selectedId, selectedSlot = 0, focusedSlot = null, section = 'video', armed = null, fullscreen = false, audioFocus=null;
let lastWorkspace = '', subscribed = '', toastTimer, eventTimer, immersive = false, editDeviceId = null, toolbarTimer;
const hoverBlocked=new WeakSet();
const events = {}, imageRetry = new Map();
const players=new Map(),mediaReports=new Map();
const audioReports=new Map(),audioLevels=new Map();
const call = (name, ...args) => window.room.call(name, ...args);
const dev = id => state.devices.find(d => d.id === id);
const currentWindow = () => state.windows.find(w => w.id === windowId);
const activeTab = () => { const w = currentWindow(); return w?.tabs.find(t => t.id === w.activeTab) || w?.tabs[0]; };
const status = id => events[id]?.connection?.status || 'offline';
const subsystem = (name, id = selectedId) => events[id]?.[`${name}_state`] || {};
function toast(message, error = false) { const t = $('#toast'); t.textContent = message; t.className = `show${error ? ' error' : ''}`; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = '', error ? 6500 : 3500); }
function release() { if (armed) { armed = null; call('release').catch(() => {}); document.querySelectorAll('.armed').forEach(el => el.classList.remove('armed')); renderFooter(); } }
function subscribe() {
  const t = activeTab();
  const ids = central ? [selectedId].filter(Boolean) : [...new Set((focusedSlot == null ? t.slots.slice(0, t.layout) : [t.slots[focusedSlot]]).filter(Boolean))];
  if (selectedId && !ids.includes(selectedId)) ids.push(selectedId);
  const key = JSON.stringify(ids); if (key !== subscribed) { subscribed = key; call('subscribe', ids).catch(e => toast(e.message, true)); }
}
function selectDevice(id, slot) {
  release(); selectedId = id; if (slot != null) selectedSlot = slot;
  call('select', id,selectedSlot).catch(() => {}); renderSidebar(); renderControls(); markTiles(); subscribe();updateAudio();
}
function renderHeader() {
  $('#header').innerHTML = `<div class="brand"><span class="brand-mark">${icon('grid')}</span><div><strong>PiKVM <span style="font-weight:400;color:#9eacc0">Control Room</span></strong><small>SEU CENTRO DE OPERAÇÕES</small></div></div><div class="top-actions"><span class="tag">${badge('online')} LOCAL</span>${btn('monitors','<span class="label">Monitores</span>','screen','ghost')}${btn('central','<span class="label">Central separada</span>','detach','ghost')}${btn('fullscreen',fullscreen ? 'Sair da tela cheia' : 'Tela cheia','expand')}</div>`;
}
function renderMicrophoneMaster(){
  const mic=state.microphones||{total:0,open:0,muted:false};
  const text=!mic.total?'Nenhum microfone cadastrado':mic.muted?'TODOS OS MICROFONES MUTADOS':mic.open===mic.total?`Microfones liberados (${mic.total})`:`Microfones liberados: ${mic.open}/${mic.total}`;
  const el=$('#global-mic-bar');el.classList.toggle('all-muted',mic.muted);el.classList.toggle('mixed',mic.open>0&&mic.open<mic.total);el.dataset.muted=String(mic.muted);
  el.innerHTML=`<span class="mic-master-status" role="status" aria-live="polite"><span class="mic-master-dot"></span>${text}</span>${btn('toggle-microphones',mic.muted?'Desmutar todos':'Mutar todos','','mic-master-toggle',`${mic.total?'':'disabled'} title="Ctrl+Shift+M · todas as janelas"`)}<kbd>Ctrl+Shift+M</kbd>`;
}
function renderSidebar() {
  if (central) return;
  const w = currentWindow(), monitor = monitors.find(m => m.id === w.displayId) || monitors.find(m => m.primary);
  $('#sidebar').innerHTML = `<div><div class="row"><span class="eyebrow">Equipamentos</span>${btn('add-device','','plus','ghost icon-btn','title="Adicionar PiKVM"')}</div><div class="device-list">${state.devices.map(d => `<button class="device ${d.id === selectedId ? 'selected' : ''}" data-action="select-device" data-id="${esc(d.id)}" title="Selecionar ${esc(d.name)}">${icon('screen')}<span class="device-name">${esc(d.name)}<small>${esc(new URL(d.url).host)}</small></span><span class="audio-badge" aria-label="Atividade sonora">♫</span>${badge(status(d.id))}</button>`).join('')}</div></div><div><div class="eyebrow">Esta janela</div><div class="monitor-card"><div class="row">${icon('screen')}<span>${esc(monitor?.name || 'Monitor')}</span></div><div class="small muted" style="margin-top:9px">${monitor?.bounds.width || '—'} × ${monitor?.bounds.height || '—'} · ${w.tabs.length} aba(s)</div></div></div><div class="side-bottom"><div class="stack">${btn('add-tab','<span class="label">Nova aba</span>','plus','ghost fill')}${btn('toggle-controls','<span class="label">Mostrar / ocultar central</span>','settings','ghost fill')}</div><div class="side-note">Selecione uma área para direcionar os controles.<br>Entre no quadrante para controlar.</div></div>`;
}
function renderWorkspace(force = false) {
  if (central) return;
  const w = currentWindow(), t = activeTab();
  const key = JSON.stringify([w.tabs,w.activeTab, focusedSlot, state.devices.map(d => [d.id,d.name,d.url,d.transport])]);
  if (!force && key === lastWorkspace) return;
  release();for(const player of players.values())player.stop();players.clear(); window.room.stopStreams(); lastWorkspace = key;
  for (const timer of imageRetry.values()) clearTimeout(timer); imageRetry.clear();
  $('#main').innerHTML = `<div class="workspace-heading"><div><h1>Sala de controle</h1><p>Todos os seus equipamentos. Uma única visão.</p></div><div class="toolbar"><div class="segmented" aria-label="Divisão da janela">${[1,2,4].map(n => btn(`layout-${n}`,'',n === 1 ? 'single' : n === 2 ? 'split' : 'grid',t.layout === n && focusedSlot == null ? 'active' : '',`title="${n} área(s)" aria-label="${n} área(s)"`)).join('')}</div>${btn('immersive','Só vídeo','expand','ghost')}</div></div><nav class="tabs" aria-label="Workspaces">${w.tabs.map(tab => `<button class="tab ${tab.id === t.id ? 'active' : ''}" data-action="tab" data-id="${esc(tab.id)}">${esc(tab.name)}${w.tabs.length > 1 ? `<span class="tab-close" data-action="close-tab" data-id="${esc(tab.id)}" title="Fechar aba">×</span>` : ''}</button>`).join('')}${btn('add-tab','','plus','ghost icon-btn','title="Nova aba"')}${btn('rename-tab','','edit','ghost icon-btn','title="Renomear aba"')}</nav><div class="grid layout-${focusedSlot == null ? t.layout : 1}">${(focusedSlot == null ? Array.from({ length:t.layout }, (_,i) => i) : [focusedSlot]).map(i => tile(t.slots[i], i)).join('')}</div>`;
  renderFullscreenToolbar();
  if (!$('#immersive-exit')) { const b = document.createElement('button'); b.id = 'immersive-exit'; b.className = 'immersive-exit'; b.dataset.action = 'exit-immersive'; b.innerHTML = `${icon('settings')} Exibir controles · F10`; document.body.appendChild(b); }
  document.querySelectorAll('.video').forEach(bindVideo);
  markTiles(); updateTileStatus(); subscribe();updateAudioIndicators();
}
function tile(id, i) {
  const d = dev(id);
  return `<section class="tile" data-slot="${i}" data-id="${esc(id || '')}"><div class="tile-head"><div class="title"><span class="slot-num">0${i+1}</span>${d ? `${badge(status(id))}${esc(d.name)} <small class="transport-label muted"></small><span class="audio-badge" aria-label="Atividade sonora">♫</span><span class="mic-badge" aria-label="Estado do microfone">MIC</span>` : 'Área disponível'}</div><div class="right">${btn('assign','','settings','ghost icon-btn',`data-slot="${i}" title="Escolher equipamento"`)}${d ? btn('focus','','expand','ghost icon-btn',`data-slot="${i}" title="${focusedSlot == null ? 'Ampliar esta área' : 'Voltar à divisão'}"`) : ''}</div></div>${d ? `<div class="video" tabindex="0" data-slot="${i}" data-id="${esc(id)}" aria-label="Vídeo de ${esc(d.name)}. Entre na área para ativar teclado e mouse."><img draggable="false" alt="Stream de ${esc(d.name)}" style="object-fit:${tFit()}"><video autoplay playsinline muted disablepictureinpicture style="object-fit:${tFit()}"></video><canvas style="object-fit:${tFit()}"></canvas><div class="video-placeholder">${icon('screen')}<strong>Conectando ao vídeo</strong><span>Aguardando o stream do PiKVM…</span></div></div>` : `<div class="empty">${icon('plus')}<strong>Adicione um PiKVM</strong><p>Escolha o equipamento desta área</p>${btn('assign','Selecionar equipamento','link','',`data-slot="${i}"`)}</div>`}</section>`;
}
function streamUrl(id,slot) { return `${mediaBase}${encodeURIComponent(id)}?owner=${encodeURIComponent(windowId)}&slot=${slot}&v=${Date.now()}`; }
function tFit() { return activeTab()?.fit || 'contain'; }
function markTiles() { const focus=$('#rdp-toolbar [data-action="focus"]');if(focus)focus.dataset.slot=String(selectedSlot); document.querySelectorAll('.tile').forEach(el => el.classList.toggle('selected', Number(el.dataset.slot) === selectedSlot && !!selectedId && el.dataset.id === selectedId)); }
function updateTileStatus() {
  document.querySelectorAll('.tile[data-id]').forEach(el => { const id = el.dataset.id, dot = el.querySelector('.dot'); if (dot) dot.className = `dot ${status(id)}`;
    const placeholder = el.querySelector('.video-placeholder'); if (placeholder && status(id) === 'offline') { placeholder.classList.remove('hidden'); placeholder.querySelector('strong').textContent = 'Sem conexão'; placeholder.querySelector('span').textContent = events[id]?.connection?.error || 'Tentando reconectar automaticamente. Confira o endereço e as credenciais na central.'; }
  });
}
function bindVideo(el) {
  const id = el.dataset.id, slot = Number(el.dataset.slot), img = el.querySelector('img'), placeholder = el.querySelector('.video-placeholder');
  let reportedAt=0,reportedStatus='';
  const player=new window.PiKVMVideo({element:el,base:mediaBase,id,owner:windowId,slot,mode:dev(id).transport||'auto',receiveAudio:false,onState:report=>{
    placeholder.classList.toggle('hidden',report.status==='playing');
    if(report.status!=='playing'){placeholder.querySelector('strong').textContent=report.status==='error'?'Reconectando vídeo':'Conectando ao vídeo';placeholder.querySelector('span').textContent=report.error||`Negociando ${report.transport==='webrtc'?'WebRTC/H.264':report.transport==='h264'?'H.264 direto':'MJPEG'}…`;}
    const label=el.closest('.tile').querySelector('.transport-label'),labelText=report.transport==='webrtc'?'WebRTC':report.transport==='h264'?'H.264':'MJPEG';if(label&&label.textContent!==labelText)label.textContent=labelText;
    if(performance.now()-reportedAt>900||report.status!==reportedStatus){reportedAt=performance.now();reportedStatus=report.status;window.room.mediaStatus({id,slot,...report});}
  }});players.set(slot,player);updateAudio();
  el.addEventListener('mouseenter',()=>{if(!hoverBlocked.has(el)&&!$('#dialog').open)activateControl(el,true);});
  el.addEventListener('click', () => { if (armed?.el !== el) activateControl(el); });
  el.closest('.tile').addEventListener('click',e=>{if(!e.target.closest('button,.video'))activateControl(el);});
  el.addEventListener('blur', release);
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('keydown', e => { if (armed?.el !== el) return; if (['F10','F11'].includes(e.code)) return; e.preventDefault(); e.stopPropagation(); if (!e.repeat) window.room.hid(id,'key',{key:e.code,state:true}); });
  el.addEventListener('keyup', e => { if (armed?.el !== el || ['F10','F11'].includes(e.code)) return; e.preventDefault(); window.room.hid(id,'key',{key:e.code,state:false}); });
  let moveAt = 0;
  el.addEventListener('mousemove', e => { if (armed?.el !== el || performance.now() - moveAt < 15) return; moveAt = performance.now();
    if (subsystem('hid', id).mouse?.absolute === false) { window.room.hid(id,'mouse_relative',{delta:{x:Math.max(-127,Math.min(127,e.movementX)),y:Math.max(-127,Math.min(127,e.movementY))}}); return; }
    const b = el.getBoundingClientRect();
    const source = subsystem('streamer',id).streamer?.source?.resolution;
    const size=player.size();const iw=size.width || source?.width || 1920, ih=size.height || source?.height || 1080;
    const to=window.kvmGeometry.pointer(e.clientX,e.clientY,b,{width:iw,height:ih},tFit());
    if(to)window.room.hid(id,'mouse_move',{to});
  });
  el.addEventListener('mousedown', e => { if (armed?.el !== el) return; e.preventDefault(); window.room.hid(id,'mouse_button',{button:['left','middle','right','up','down'][e.button] || 'left',state:true}); });
  el.addEventListener('mouseup', e => { if (armed?.el !== el) return; e.preventDefault(); window.room.hid(id,'mouse_button',{button:['left','middle','right','up','down'][e.button] || 'left',state:false}); });
  el.addEventListener('mouseleave', () => {hoverBlocked.delete(el);if(armed?.el===el)release();});
  el.addEventListener('wheel', e => { if (armed?.el !== el) return; e.preventDefault(); window.room.hid(id,'mouse_wheel',{delta:{x:-Math.sign(e.deltaX)*5,y:-Math.sign(e.deltaY)*5}}); }, {passive:false});
}
function activateControl(el,quiet=false){
  if(armed?.el===el)return;
  if(quiet&&(!document.hasFocus()||$('#dialog').open))return;
  if(!el)return toast('Selecione uma área com vídeo.',true);
  const id=el.dataset.id;if(status(id)!=='online')return quiet?undefined:toast('Aguarde a conexão com o PiKVM.',true);
  const hid=subsystem('hid',id);if(hid.enabled===false||hid.online===false)return quiet?undefined:toast('O HID do PiKVM está desconectado. Confira a conexão USB com o computador remoto.',true);
  hoverBlocked.delete(el);selectDevice(id,Number(el.dataset.slot));armed={id,el};el.classList.add('armed');el.focus({preventScroll:true});renderFooter();
}
function updateAudio(){for(const player of players.values())player.playback(false,0);}
function updateAudioIndicators(changedId){
  document.querySelectorAll('.tile[data-id],.device[data-id]').forEach(el=>{
    const id=el.dataset.id;if(changedId&&id!==changedId)return;const level=audioLevels.get(id),report=audioReports.get(id);el.classList.toggle('audio-active',!!level?.active);
    const badge=el.querySelector('.audio-badge');if(badge){badge.textContent=level?.active?'♫ SOM':'♫';badge.title=level?.active?`Áudio vindo de ${dev(id)?.name||'PiKVM'}`:'Sem atividade sonora';}
    const mic=el.querySelector('.mic-badge');if(mic){mic.classList.toggle('live',!!report?.micActive);mic.textContent=report?.micConnected&&report?.micMuted?'MIC MUDO':'MIC';mic.title=report?.micActive?'Microfone transmitindo para este PiKVM':report?.micError||(report?.micConnected?'Microfone mutado, conexão mantida':'Microfone indisponível');}
  });
  const w=currentWindow();if(w)document.querySelectorAll('.tab[data-id]').forEach(el=>{const t=w.tabs.find(t=>t.id===el.dataset.id);el.classList.toggle('audio-active',!!t?.slots.some(id=>audioLevels.get(id)?.active));});
}
function selectedMedia(){return mediaReports.get(`${audioFocus?.owner}:${audioFocus?.slot}`)?.id===selectedId?mediaReports.get(`${audioFocus?.owner}:${audioFocus?.slot}`):[...mediaReports.values()].find(r=>r.id===selectedId);}
function mediaSummary(){const r=selectedMedia();if(!r)return 'Aguardando transmissão…';const mode=r.transport==='webrtc'?'WebRTC / H.264':r.transport==='h264'?'H.264 direto':'MJPEG';return `${mode} · ${r.status==='playing'?'reproduzindo':r.status==='error'?'reconectando':'conectando'}${r.codec?` · ${r.codec}`:''}${r.bufferMs!=null?` · buffer ${r.bufferMs} ms`:''}${r.error?` · ${r.error}`:''}`;}
function audioSummary(){const r=audioReports.get(selectedId);if(!r)return 'Conectando áudio em segundo plano…';if(r.status==='disabled')return 'Equipamento sem sessão de áudio.';return `${r.audio?'Áudio disponível':'Áudio indisponível'}${r.audioCodec?` · ${r.audioCodec}`:''}. ${r.micActive?'Microfone transmitindo.':r.micError||(r.micConnected&&r.micMuted?'Microfone mutado; conexão mantida.':!r.micSupported?'Este PiKVM não anunciou suporte ao microfone.':'Conectando microfone…')} ${r.error||''}`;}
function renderControls() {
  const d = dev(selectedId);
  $('#controls').innerHTML = `<div class="control-top"><div class="row"><h2>Central de controle</h2>${central ? '' : btn('central','','detach','ghost icon-btn','title="Abrir central em outra janela"')}</div><span class="small muted">Os comandos atuam no equipamento selecionado</span><div class="target">${badge(status(selectedId))}<strong style="flex:1;font-size:12px">${esc(d?.name || 'Selecione um PiKVM')}</strong>${d ? btn('edit-device','','edit','ghost icon-btn','title="Editar conexão"') : ''}</div></div><nav class="control-tabs">${[['video','Vídeo'],['captions','Legendas'],['input','Teclado'],['power','Energia'],['media','Mídia'],['gpio','GPIO'],['system','Sistema']].map(([id,label]) => btn(`section-${id}`,label,'',section === id ? 'active' : '')).join('')}</nav><div class="control-body">${d ? controlBody() : `<p>Selecione um equipamento na lista ou em uma das áreas de vídeo.</p>${btn('add-device','Cadastrar PiKVM','plus','primary')}`}</div>`;
}
function controlBody() {
  if(section==='captions')return CaptionUI.body();
  const stream = subsystem('streamer'), params = stream.params || {}, hid = subsystem('hid'), atx = subsystem('atx'), msd = subsystem('msd'), source = stream.streamer?.source;
  if (section === 'video') {const d=dev(selectedId);return `<h3>Vídeo e áudio</h3>${field('Transporte',`<select id="transport">${[['auto','Automático: WebRTC → H.264 → MJPEG'],['webrtc','WebRTC / H.264 + áudio'],['h264','H.264 direto (sem áudio)'],['mjpeg','MJPEG (compatibilidade)']].map(([id,label])=>`<option value="${id}" ${(d.transport||'auto')===id?'selected':''}>${label}</option>`).join('')}</select>`)}<div class="hint" data-live="transport">${esc(mediaSummary())}</div><label class="check"><input type="checkbox" id="audio-enabled" ${d.audioEnabled!==false?'checked':''}>Ouvir este PiKVM em segundo plano</label><label class="check"><input type="checkbox" id="mic-enabled" ${d.micEnabled!==false?'checked':''}>Microfone aberto (desmarque para mutar)</label><div class="hint">Áudio e microfone continuam ativos ao trocar de quadrante, aba ou monitor. Uma sessão por equipamento evita áudio duplicado. A borda pulsa quando chega som. Mutar o microfone envia silêncio imediatamente, sem reiniciar a conexão.</div>${field('Volume',`<input id="audio-volume" type="range" min="0" max="100" value="${d.volume??70}">`)}<p data-live="audio">${esc(audioSummary())}</p>${btn('apply-media','Salvar vídeo, áudio e microfone','settings','primary fill')}<div class="divider"></div><div class="two"><div class="metric"><span>RESOLUÇÃO</span><strong data-live="resolution">${source?.resolution ? `${source.resolution.width}×${source.resolution.height}` : '—'}</strong></div><div class="metric"><span>CAPTURA</span><strong data-live="fps">${source?.captured_fps ?? '—'} fps</strong></div></div>${!central ? field('Enquadramento da imagem', `<select id="fit"><option value="contain" ${tFit() === 'contain' ? 'selected' : ''}>Preservar proporção</option><option value="fill" ${tFit() === 'fill' ? 'selected' : ''}>Preencher toda a área (esticar)</option></select>`) : ''}${field('Limite de FPS', `<input id="fps" type="number" min="0" max="${stream.limits?.desired_fps?.max || 120}" value="${params.desired_fps ?? 30}">`)}<div class="two">${field('H.264 kbps',`<input id="bitrate" type="number" min="${stream.limits?.h264_bitrate?.min||25}" max="${stream.limits?.h264_bitrate?.max||20000}" value="${params.h264_bitrate??5000}">`)}${field('H.264 GOP',`<input id="gop" type="number" min="0" max="${stream.limits?.h264_gop?.max||60}" value="${params.h264_gop??0}">`)}</div>${field('Qualidade MJPEG (1–100)', `<input id="quality" type="number" min="1" max="100" value="${params.quality ?? 80}" ${stream.features?.quality === false ? 'disabled' : ''}>`)}${btn('apply-video','Aplicar ao PiKVM','settings','fill')}<p>GOP 0 favorece baixa latência em rede estável. Estes ajustes do codificador afetam os outros clientes do equipamento.</p>${btn('snapshot','Salvar captura de tela','camera','fill')}${btn('reconnect','Reconectar vídeo','refresh','ghost fill')}`;}
  if (section === 'input') return `<h3>Teclado e mouse</h3>${btn('control-selected','Controlar área selecionada','mouse','primary fill')}<div class="hint">Entre com o mouse no vídeo para assumir teclado e mouse automaticamente. Sair da área libera o controle. Pressione <kbd>F10</kbd> para liberar. A borda e a mensagem “CONTROLE ATIVO” confirmam a captura.</div><div class="status-line" data-live="hid">${badge(hid.online ? 'online' : '')}HID ${hid.online ? 'conectado' : 'indisponível'}</div><div class="stack">${[['ControlLeft,AltLeft,Delete','Ctrl + Alt + Del'],['MetaLeft,KeyR','Win + R'],['AltLeft,Tab','Alt + Tab'],['PrintScreen','Print Screen']].map(([keys,label]) => btn('shortcut',label,'keyboard','fill',`data-keys="${keys}"`)).join('')}</div>${field('Enviar texto ao computador remoto', '<textarea id="remote-text" placeholder="Digite ou cole o texto aqui…" maxlength="20000"></textarea>')}${field('Layout para digitação', '<select id="keymap"><option value="">Padrão do PiKVM</option></select>')}${btn('send-text','Digitar no computador remoto','arrow','fill')}${hid.mouse?.outputs?.available?.length ? field('Modo do mouse', `<select id="mouse-mode">${hid.mouse.outputs.available.map(s => `<option value="${esc(s)}" ${s === hid.mouse.outputs.active ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>`) + btn('apply-mouse','Aplicar modo do mouse','mouse','fill') : ''}${btn('reset-hid','Liberar teclas / reiniciar HID','refresh','ghost fill')}`;
  if (section === 'power') return `<h3>Energia do computador remoto</h3><div class="metric"><span>ESTADO ATX</span><strong data-live="atx">${atx.enabled ? atx.leds?.power ? 'Ligado' : 'Desligado' : 'Indisponível'}</strong></div><p>Os comandos abaixo controlam o computador conectado ao PiKVM.</p>${btn('power-on','Ligar computador','power','primary fill',atx.enabled ? '' : 'disabled')}${btn('power-off','Desligar via botão ATX','power','fill',atx.enabled ? '' : 'disabled')}${btn('power-hard','Forçar desligamento','power','danger fill',atx.enabled ? '' : 'disabled')}${btn('power-reset','Reset de hardware','refresh','danger fill',atx.enabled ? '' : 'disabled')}<div class="hint">Forçar desligamento e reset podem interromper o trabalho no computador remoto. A confirmação identifica o equipamento antes de enviar o comando.</div>`;
  if (section === 'media') { const images = msd.storage?.images || {};
    return `<h3>Mídia virtual</h3><div class="status-line" data-live="msd">${badge(msd.drive?.connected ? 'online' : '')}${msd.enabled ? msd.drive?.connected ? 'Mídia conectada' : 'Mídia desconectada' : 'Mídia virtual indisponível'}</div>${msd.enabled ? `${field('Imagem no PiKVM',`<select id="media-image"><option value="">Sem imagem</option>${Object.keys(images).map(n => `<option value="${esc(n)}" ${msd.drive?.image?.name === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`)}${field('Emular como', `<select id="media-mode"><option value="1" ${msd.drive?.cdrom ? 'selected' : ''}>CD / DVD</option><option value="0" ${!msd.drive?.cdrom ? 'selected' : ''}>Pendrive USB</option></select>`)}${btn('mount-media','Selecionar e conectar imagem','media','primary fill')}${btn('unmount-media','Desconectar mídia','media','fill')}${btn('upload-media','Enviar arquivo ISO / IMG','plus','fill')}${btn('delete-media','Excluir imagem selecionada','','danger fill')}<p>Desconecte a mídia antes de trocar a imagem ou o modo. Arquivos enviados ficam armazenados no PiKVM.</p>${btn('refresh-controls','Atualizar imagens','refresh','ghost fill')}` : '<p>O equipamento ainda não informou suporte a mídia virtual.</p>'}`;
  }
  if (section === 'gpio') { const gpio = subsystem('gpio'), scheme = subsystem('gpio_model').scheme || {}, outputs = scheme.outputs || {}, inputs = gpio.inputs || {};
    return `<h3>GPIO e comutação</h3>${Object.keys(inputs).map(n => `<div class="metric"><span>${esc(n)}</span><strong>${inputs[n].state ? 'Ativo' : 'Inativo'}</strong></div>`).join('')}${Object.entries(outputs).map(([name, conf]) => `<div class="stack"><span class="small muted">${esc(name)}</span>${conf.switch ? btn('gpio-switch',gpio.outputs?.[name]?.state ? 'Desativar' : 'Ativar','power','fill',`data-channel="${esc(name)}" data-value="${!gpio.outputs?.[name]?.state}"`) : ''}${conf.pulse ? btn('gpio-pulse','Enviar pulso','arrow','fill',`data-channel="${esc(name)}"`) : ''}</div>`).join('')}${!Object.keys(outputs).length && !Object.keys(inputs).length ? '<p>Nenhum canal GPIO configurado neste equipamento.</p>' : ''}<div class="divider"></div><h3>PiKVM Switch</h3><div class="two">${btn('switch-prev','Porta anterior','','',subsystem('switch').model ? '' : 'disabled')}${btn('switch-next','Próxima porta','','',subsystem('switch').model ? '' : 'disabled')}</div><p>A comutação depende de um PiKVM Switch conectado.</p>${btn('refresh-controls','Atualizar GPIO','refresh','ghost fill')}`;
  }
  const sys = events[selectedId]?.info_system_state, hw = events[selectedId]?.info_hw_state;
  return `<h3>Conexão</h3><p>${esc(dev(selectedId).url)}<br>Usuário: ${esc(dev(selectedId).username)}<br>Certificado local: ${dev(selectedId).insecure ? 'permitido para este PiKVM' : 'validação obrigatória'}</p>${btn('test-device','Testar conexão','link','primary fill')}${btn('edit-device','Editar equipamento','edit','fill')}<div class="two"><div class="metric"><span>KVMD</span><strong>${esc(sys?.kvmd?.version || '—')}</strong></div><div class="metric"><span>CPU DO PIKVM</span><strong>${hw?.health?.temp?.cpu?.toFixed(1) || '—'} °C</strong></div></div><div class="divider"></div><h3>Estado recebido</h3><pre class="debug">${esc(JSON.stringify({ connection:events[selectedId]?.connection, platform:hw?.platform, hid:subsystem('hid'), atx:subsystem('atx') }, null, 2))}</pre>${btn('delete-device','Remover equipamento','','danger fill')}`;
}
function updateLive() {
  updateTileStatus(); renderFooter();
  document.querySelectorAll('#sidebar .device').forEach(el => { const dot = el.querySelector('.dot'); if (dot) dot.className = `dot ${status(el.dataset.id)}`; });
  const targetDot = $('#controls .target .dot'); if (targetDot) targetDot.className = `dot ${status(selectedId)}`;
  const source = subsystem('streamer').streamer?.source;
  const set = (key, value) => { const el = $(`[data-live="${key}"]`); if (el) el.textContent = value; };
  set('resolution', source?.resolution ? `${source.resolution.width}×${source.resolution.height}` : '—'); set('fps', `${source?.captured_fps ?? '—'} fps`);
  set('source', source ? source.online ? '● Sinal HDMI presente' : '○ Sem sinal HDMI' : 'Aguardando estado do vídeo');
  const atx = subsystem('atx'); set('atx', atx.enabled ? atx.leds?.power ? 'Ligado' : 'Desligado' : 'Indisponível');
  set('hid', `HID ${subsystem('hid').online ? 'conectado' : 'indisponível'}`);
  set('transport',mediaSummary());set('audio',audioSummary());
  const msd = subsystem('msd'); set('msd', msd.enabled ? msd.drive?.connected ? 'Mídia conectada' : 'Mídia desconectada' : 'Mídia virtual indisponível');
}
function renderFooter() { const online = state.devices.filter(d => status(d.id) === 'online').length; $('#footer').innerHTML = `<div class="footer-left"><span>${badge(online ? 'online' : '')} ${online} conectado(s)</span><span>${state.devices.length} equipamento(s)</span><span>${esc(dev(selectedId)?.name || 'Nenhum selecionado')}</span><span class="mic-footer">MIC transmitindo: ${[...audioReports.values()].filter(r=>r.micActive).length}</span></div><span>${armed ? 'Controle remoto ativo' : 'Entre no quadrante para controlar'} &nbsp; <kbd>F10</kbd> liberar &nbsp; <kbd>F11</kbd> tela cheia</span>`; }
function modal(html) { release(); $('#dialog').innerHTML = html; if (!$('#dialog').open) $('#dialog').showModal(); }
function closeModal() { $('#dialog').close(); }
function deviceDialog(id) {
  const d = dev(id); editDeviceId = d?.id || null;
  modal(`<h2>${d ? 'Editar equipamento' : 'Adicionar PiKVM'}</h2><p>Cadastre a conexão. A senha é protegida pelo Windows e não aparece no arquivo de configuração em texto aberto.</p><form id="device-form">${field('Nome', `<input name="name" value="${esc(d?.name || '')}" placeholder="Ex.: Servidor de produção" required maxlength="80">`)}${field('Endereço', `<input name="url" value="${esc(d?.url || '')}" placeholder="https://pikvm.exemplo.local/kvm/" required>`)}<div class="two">${field('Usuário', `<input name="username" value="${esc(d?.username || 'admin')}" required autocomplete="off">`)}${field('Senha', `<input name="password" type="password" placeholder="${d ? 'Manter senha atual' : 'Senha do PiKVM'}" ${d ? '' : 'required'} autocomplete="new-password">`)}</div><label class="check"><input type="checkbox" name="insecure" ${d?.insecure || !d ? 'checked' : ''}>Permitir certificado autoassinado neste PiKVM</label><div class="dialog-actions">${btn('cancel','Cancelar')}<button class="primary" type="submit">Salvar equipamento</button></div></form>`);
}
async function persistWorkspace() { release(); const w = currentWindow(); await call('save-window', {tabs:w.tabs,activeTab:w.activeTab}); renderWorkspace(); renderSidebar(); }
async function api(route, params = {}, method = 'POST', body, id = selectedId) { if (!id) throw new Error('Selecione um PiKVM.'); const qs = new URLSearchParams(params).toString(); return call('api', id, method, route + (qs ? `?${qs}` : ''), body); }
async function refresh(id = selectedId) {
  if (!id) return;
  const results = await Promise.allSettled(['streamer','hid','atx','msd','gpio','switch'].map(name => api(`/api/${name}`,{},'GET',undefined,id).then(result => { (events[id] ||= {})[`${name}_state`] = result; })));
  if (results.every(r => r.status === 'rejected')) throw results[0].reason;
  renderControls(); if (section === 'input') loadKeymaps();
}
async function loadKeymaps() { try { const id = selectedId, data = await api('/api/hid/keymaps',{},'GET'); if (id !== selectedId || !$('#keymap')) return; const keys = data.keymaps?.available || []; $('#keymap').innerHTML = `<option value="">Padrão do PiKVM</option>${keys.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('')}`; } catch {} }
function confirmAction(title, description, perform) {
  modal(`<h2>${esc(title)}</h2><p>${esc(description)}</p><div class="hint">Equipamento: <strong>${esc(dev(selectedId)?.name || '')}</strong><br>${esc(dev(selectedId)?.url || '')}</div><div class="dialog-actions">${btn('cancel','Cancelar')}${btn('confirm','Confirmar','','danger')}</div>`);
  $('#dialog [data-action="confirm"]').onclick = async e => { e.stopPropagation(); closeModal(); try { await perform(); toast('Comando enviado.'); } catch (error) { toast(error.message,true); } };
}
async function act(action, el) {
  if (action.startsWith('section-')) { release(); section=action.slice(8); renderControls(); if(section === 'input') loadKeymaps(); return; }
  if (action.startsWith('layout-')) { focusedSlot=null; activeTab().layout=Number(action.slice(7)); if(selectedSlot >= activeTab().layout) selectedSlot=0; await persistWorkspace(); return; }
  switch(action) {
    case 'cancel': closeModal(); break;
    case 'add-device': deviceDialog(); break;
    case 'edit-device': deviceDialog(selectedId); break;
    case 'select-device': selectDevice(el.dataset.id); break;
    case 'asr-install':case 'meeting-start':case 'meeting-stop':case 'meeting-library':await CaptionUI.action(action);break;
    case 'meeting-folder':await call('meeting-folder',el.dataset.id);break;
    case 'meeting-review':closeModal();toast('Revisando o áudio salvo com o pacote atual…');await call('meeting-review',el.dataset.id);toast('Revisão salva como reviewed.txt e reviewed.srt.');break;
    case 'toggle-microphones': await call('toggle-microphones');break;
    case 'arm-video': activateControl($(`.video[data-slot="${Number(el.dataset.slot)}"]`));break;
    case 'control-selected': if(central)await call('control-selected');else activateControl($(`.video[data-slot="${selectedSlot}"]`));break;
    case 'apply-media': await call('media-settings',selectedId,{transport:$('#transport').value,audioEnabled:$('#audio-enabled').checked,micEnabled:$('#mic-enabled').checked,volume:Number($('#audio-volume').value)});toast('Transporte, áudio e microfone salvos.');break;
    case 'fullscreen': await call('fullscreen'); break;
    case 'central': release(); await call('central'); break;
    case 'toggle-controls': release(); document.body.classList.toggle('controls-hidden'); break;
    case 'immersive': if(!fullscreen)await call('fullscreen');else setFullscreen(true);break;
    case 'fullscreen-controls':release();document.body.classList.toggle('fullscreen-controls');break;
    case 'exit-immersive':if(fullscreen)await call('fullscreen');else setFullscreen(false);break;
    case 'focus': release(); selectedSlot=Number(el.dataset.slot); focusedSlot=focusedSlot == null ? selectedSlot : null; renderWorkspace();selectDevice(activeTab().slots[selectedSlot],selectedSlot); break;
    case 'assign': {
      selectedSlot=Number(el.dataset.slot); modal(`<h2>Equipamento da área ${selectedSlot+1}</h2><p>Escolha o PiKVM que será exibido nesta área.</p><div class="stack">${state.devices.map(d => btn('assign-device',esc(d.name),'screen','screen-option',`data-id="${esc(d.id)}"`)).join('')}${btn('assign-device','Deixar área vazia','','screen-option','data-id=""')}<div class="divider"></div>${btn('add-device','Cadastrar novo equipamento','plus','fill')}${btn('cancel','Cancelar')}</div>`); break;
    }
    case 'assign-device': activeTab().slots[selectedSlot]=el.dataset.id || null; closeModal(); await persistWorkspace(); if(el.dataset.id) selectDevice(el.dataset.id,selectedSlot); break;
    case 'tab': release(); focusedSlot=null; currentWindow().activeTab=el.dataset.id; selectedSlot=0; selectedId=activeTab().slots[0]; await persistWorkspace(); selectDevice(selectedId,0); break;
    case 'add-tab': { const w=currentWindow(), t={id:crypto.randomUUID(),name:`Workspace ${String(w.tabs.length+1).padStart(2,'0')}`,layout:1,slots:[null,null,null,null],fit:'contain'}; w.tabs.push(t); w.activeTab=t.id; focusedSlot=null; await persistWorkspace(); break; }
    case 'close-tab': { const w=currentWindow(); if(w.tabs.length===1) return; w.tabs=w.tabs.filter(t=>t.id!==el.dataset.id); if(w.activeTab===el.dataset.id) w.activeTab=w.tabs[0].id; focusedSlot=null; await persistWorkspace(); break; }
    case 'rename-tab': modal(`<h2>Renomear aba</h2><form id="rename-form">${field('Nome',`<input name="name" required maxlength="80" value="${esc(activeTab().name)}">`)}<div class="dialog-actions">${btn('cancel','Cancelar')}<button type="submit" class="primary">Salvar</button></div></form>`); break;
    case 'monitors': modal(`<h2>Monitores e janelas</h2><p>Abra uma janela em cada monitor. Cada janela mantém suas próprias abas e divisões.</p><div class="stack">${monitors.map(m => `<div class="monitor-card"><div class="row">${icon('screen')}<strong>${esc(m.name)}</strong><span class="muted small">${m.bounds.width} × ${m.bounds.height}</span></div><div class="two" style="margin-top:12px">${btn('move-monitor','Mover esta janela','','',`data-display="${m.id}"`)}${btn('new-monitor','Nova janela','plus','',`data-display="${m.id}"`)}</div></div>`).join('')}<div class="hint">Com um monitor, use várias abas ou abra outra janela. F11 alterna a transmissão em tela cheia. Aproxime o mouse do topo para mostrar a barra de ações.</div>${state.windows.length>1 ? btn('remove-window','Remover esta janela do workspace','','danger') : ''}${btn('cancel','Fechar')}</div>`); break;
    case 'new-monitor': closeModal(); await call('new-window',Number(el.dataset.display)); break;
    case 'move-monitor': closeModal(); await call('move-window',Number(el.dataset.display)); break;
    case 'remove-window': closeModal(); await call('remove-window'); break;
    case 'apply-video': { const fps=Number($('#fps').value), quality=Number($('#quality').value),bitrate=Number($('#bitrate').value),gop=Number($('#gop').value); if(!Number.isInteger(fps)||fps<0||fps>Number($('#fps').max)||!Number.isInteger(quality)||quality<1||quality>100||!Number.isInteger(bitrate)||bitrate<Number($('#bitrate').min)||bitrate>Number($('#bitrate').max)||!Number.isInteger(gop)||gop<0||gop>Number($('#gop').max)) throw new Error('Confira os limites de FPS, qualidade, bitrate e GOP.'); const h264=subsystem('streamer').features?.h264;await api('/api/streamer/set_params',{desired_fps:fps,...(!$('#quality').disabled ? {quality} : {}),...(h264?{h264_bitrate:bitrate,h264_gop:gop}:{})}); toast('Ajustes de vídeo aplicados.'); break; }
    case 'snapshot': if(await call('snapshot',selectedId)) toast('Captura salva.'); break;
    case 'reconnect': renderWorkspace(true); break;
    case 'shortcut': await api('/api/hid/events/send_shortcut',{keys:el.dataset.keys}); toast('Atalho enviado.'); break;
    case 'send-text': { const text=$('#remote-text').value, keymap=$('#keymap').value; if(!text) return; await api('/api/hid/print',keymap ? {keymap} : {},'POST',text); toast('Texto enviado para digitação.'); break; }
    case 'apply-mouse': await api('/api/hid/set_params',{mouse_output:$('#mouse-mode').value}); toast('Modo do mouse aplicado.'); break;
    case 'reset-hid': release(); await api('/api/hid/reset'); toast('HID reiniciado.'); break;
    case 'power-on': await api('/api/atx/power',{action:'on'}); toast('Comando de ligar enviado.'); break;
    case 'power-off': case 'power-hard': case 'power-reset': { const id=selectedId, types={'power-off':['Desligar computador?','Será enviado um toque no botão ATX para solicitar o desligamento.','off'],'power-hard':['Forçar desligamento?','A energia será interrompida pelo botão ATX pressionado. Há risco de perda de trabalho não salvo.','off_hard'],'power-reset':['Reiniciar por hardware?','O computador será reiniciado imediatamente pelo botão Reset.','reset_hard']}, [title,desc,type]=types[action]; confirmAction(title,desc,()=>api('/api/atx/power',{action:type},'POST',undefined,id)); break; }
    case 'mount-media': { const image=$('#media-image').value; if(!image) throw new Error('Selecione uma imagem.'); await api('/api/msd/set_params',{image,cdrom:$('#media-mode').value}); await api('/api/msd/set_connected',{connected:1}); await refresh(); toast('Mídia conectada.'); break; }
    case 'unmount-media': await api('/api/msd/set_connected',{connected:0}); await refresh(); toast('Mídia desconectada.'); break;
    case 'upload-media': { const id=selectedId; toast('Escolha o arquivo. O envio pode levar alguns minutos.'); el.disabled=true; el.textContent='Enviando…'; try { if(await call('upload',id)) { await refresh(id); toast('Imagem enviada ao PiKVM.'); } } finally { if(el.isConnected) { el.disabled=false; el.textContent='Enviar arquivo ISO / IMG'; } } break; }
    case 'delete-media': { const image=$('#media-image').value,id=selectedId; if(!image) throw new Error('Selecione uma imagem.'); confirmAction('Excluir imagem?',`O arquivo ${image} será removido do PiKVM.`,async()=>{await api('/api/msd/remove',{image},'POST',undefined,id);await refresh(id);}); break; }
    case 'gpio-switch': { const id=selectedId; confirmAction('Acionar saída GPIO?',`O canal ${el.dataset.channel} será ${el.dataset.value==='true'?'ativado':'desativado'}.`,()=>api('/api/gpio/switch',{channel:el.dataset.channel,state:el.dataset.value},'POST',undefined,id)); break; }
    case 'gpio-pulse': { const id=selectedId; confirmAction('Enviar pulso GPIO?',`Será enviado um pulso no canal ${el.dataset.channel}.`,()=>api('/api/gpio/pulse',{channel:el.dataset.channel},'POST',undefined,id)); break; }
    case 'switch-prev': await api('/api/switch/set_active_prev'); break;
    case 'switch-next': await api('/api/switch/set_active_next'); break;
    case 'refresh-controls': await refresh(); break;
    case 'test-device': { const id=selectedId,info=await call('test-device',id); const store=events[id] ||= {}; store.info_system_state=info.system;store.info_hw_state=info.hw; await refresh(id); toast(`Conexão OK · KVMD ${info.system?.kvmd?.version || ''}`); break; }
    case 'delete-device': { const id=selectedId; confirmAction('Remover equipamento?','A conexão salva e as atribuições deste equipamento serão removidas.',async()=>call('delete-device',id)); break; }
  }
}
document.addEventListener('click', async e => { const el=e.target.closest('[data-action]'); if(!el || el.disabled) return; if(el.tagName === 'BUTTON') e.preventDefault(); try { await act(el.dataset.action,el); } catch(error) { toast(error.message,true); } });
document.addEventListener('submit', async e => { e.preventDefault(); try { const data=new FormData(e.target); if(e.target.id==='device-form') { const id=await call('save-device',{id:editDeviceId,name:data.get('name'),url:data.get('url'),username:data.get('username'),password:data.get('password'),insecure:data.get('insecure')==='on'}); closeModal(); selectDevice(id); toast('Equipamento salvo. Escolha uma área para exibir seu vídeo.'); } else if(e.target.id==='rename-form') { activeTab().name=data.get('name'); closeModal(); await persistWorkspace(); } } catch(error) { toast(error.message,true); } });
document.addEventListener('change', async e => {try{if(e.target.id==='fit'){activeTab().fit=e.target.value;await persistWorkspace();}if(e.target.id==='mic-enabled'){await call('microphone-muted',selectedId,!e.target.checked);}}catch(error){toast(error.message,true);} });
let microphoneShortcutHeld=false;
window.addEventListener('blur',()=>{microphoneShortcutHeld=false;release();});
document.addEventListener('keydown',e=>{
  if((e.code==='KeyM'||e.key?.toLowerCase()==='m')&&(microphoneShortcutHeld||(e.ctrlKey&&e.shiftKey&&!e.altKey&&!e.metaKey))){e.preventDefault();e.stopImmediatePropagation();if(!microphoneShortcutHeld&&!e.repeat){microphoneShortcutHeld=true;call('toggle-microphones').catch(error=>toast(error.message,true));}return;}
  if(e.code==='F10'){e.preventDefault();escapeControl();}
  if(e.code==='F11'){e.preventDefault();call('fullscreen').catch(error=>toast(error.message,true));}
},true);
document.addEventListener('keyup',e=>{if((e.code==='KeyM'||e.key?.toLowerCase()==='m')&&microphoneShortcutHeld){microphoneShortcutHeld=false;e.preventDefault();e.stopImmediatePropagation();}},true);
window.room.on('state',value=>{state=value;CaptionUI.update(value.transcription);audioFocus=value.audioFocus;if(!dev(selectedId)) selectedId=value.selected || activeTab()?.slots[0] || null; renderMicrophoneMaster();renderSidebar();renderWorkspace();renderControls();renderFooter();updateAudio();});
window.room.on('selection',id=>{if(central){selectedId=id;release();renderControls();subscribe();}});
window.room.on('fullscreen',setFullscreen);
window.room.on('escape-controls',escapeControl);
window.room.on('displays',value=>{monitors=value;renderSidebar();});
window.room.on('audio-focus',value=>{audioFocus=value;});
window.room.on('audio-state',report=>{audioReports.set(report.id,report);const el=$('[data-live="audio"]');if(el&&report.id===selectedId)el.textContent=audioSummary();updateAudioIndicators(report.id);renderFooter();});
window.room.on('audio-level',report=>{audioLevels.set(report.id,report);updateAudioIndicators(report.id);});
window.room.on('activate-control',value=>{if(value.owner===windowId)activateControl($(`.video[data-slot="${Number(value.slot)}"][data-id="${CSS.escape(value.id)}"]`));});
window.room.on('hid-error',message=>{release();toast(message,true);});
window.room.on('media-status',report=>{mediaReports.set(`${report.owner}:${report.slot}`,report);const el=$('[data-live="transport"]');if(el)el.textContent=mediaSummary();const audio=$('[data-live="audio"]');if(audio)audio.textContent=audioSummary();});
window.room.on('device-event',data=>{
  const store=events[data.id] ||= {}, existed=store[data.event_type]; store[data.event_type]=data.event;
  if(data.event_type==='connection' && data.event.status!=='online' && armed?.id===data.id) release();
  if(!existed && data.id===selectedId && ['streamer_state','hid_state','atx_state','msd_state','gpio_model_state','switch_state'].includes(data.event_type)) { clearTimeout(eventTimer);eventTimer=setTimeout(()=>{if(!$('#controls').contains(document.activeElement))renderControls();},200); }
  updateLive();
});

function revealToolbar(){clearTimeout(toolbarTimer);$('#rdp-toolbar').classList.add('revealed');}
function escapeControl(){if(armed)hoverBlocked.add(armed.el);release();if(immersive){revealToolbar();$('#rdp-toolbar button')?.focus({preventScroll:true});}}
function setFullscreen(value){fullscreen=value;if(!central){immersive=value;document.body.classList.toggle('immersive',value);if(!value)document.body.classList.remove('fullscreen-controls','controls-hidden');}renderHeader();renderFullscreenToolbar();}
function renderFullscreenToolbar(){
  const bar=$('#rdp-toolbar');if(!immersive||central){bar.replaceChildren();return;}
  const w=currentWindow(),t=activeTab();
  bar.innerHTML='<span class="rdp-name">PiKVM · F10 liberar</span><select id="fullscreen-tab" aria-label="Aba">'+w.tabs.map(tab=>'<option value="'+esc(tab.id)+'" '+(tab.id===t.id?'selected':'')+'>'+esc(tab.name)+'</option>').join('')+'</select>'+[1,2,4].map(n=>btn('layout-'+n,String(n)+' área(s)',null,t.layout===n&&focusedSlot==null?'active':'')).join('')+btn('focus',focusedSlot==null?'Ampliar área':'Voltar à divisão','expand','', 'data-slot="'+selectedSlot+'"')+btn('fullscreen-controls','Central / ações','settings')+btn('central','Destacar central','detach')+btn('monitors','Monitores','screen')+btn('exit-immersive','Sair · F11','close');
}
$('#rdp-edge').addEventListener('mouseenter',()=>{release();revealToolbar();});
$('#rdp-edge').addEventListener('mouseleave',()=>{toolbarTimer=setTimeout(()=>$('#rdp-toolbar').classList.remove('revealed'),650);});
$('#rdp-toolbar').addEventListener('mouseenter',()=>{release();revealToolbar();});
$('#rdp-toolbar').addEventListener('mouseleave',()=>{if(document.activeElement?.matches('#rdp-toolbar button'))document.activeElement.blur();toolbarTimer=setTimeout(()=>$('#rdp-toolbar').classList.remove('revealed'),650);});
$('#rdp-toolbar').addEventListener('focusout',()=>{if(!$('#rdp-toolbar').contains(document.activeElement))toolbarTimer=setTimeout(()=>$('#rdp-toolbar').classList.remove('revealed'),650);});
document.addEventListener('change',e=>{if(e.target.id==='fullscreen-tab')act('tab',{dataset:{id:e.target.value}}).catch(error=>toast(error.message,true));});

(async()=>{try{const boot=await call('boot');state=boot;CaptionUI.update(boot.transcription);audioFocus=boot.audioFocus;for(const r of boot.mediaReports||[])mediaReports.set(`${r.owner}:${r.slot}`,r);for(const r of boot.audioReports||[])audioReports.set(r.id,r);for(const r of boot.audioLevels||[])audioLevels.set(r.id,r);monitors=boot.displays;mediaBase=boot.mediaBase;fullscreen=boot.fullscreen;selectedId=central ? boot.selected : activeTab()?.slots[0] || state.devices[0]?.id;document.body.classList.toggle('central-only',central);renderHeader();renderMicrophoneMaster();renderSidebar();renderWorkspace();renderControls();renderFooter();setFullscreen(fullscreen);subscribe();if(!central && selectedId)call('select',selectedId,selectedSlot); }catch(error){toast(error.message,true);}})();
