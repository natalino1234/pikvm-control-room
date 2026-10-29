const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocketServer } = require('ws');
const live = process.argv.includes('--live');
const packaged = process.argv.includes('--packaged');
const liveHid = process.argv.includes('--live-hid');
const mic = process.argv.includes('--mic');
const transport = process.argv.find(a=>a.startsWith('--transport='))?.split('=')[1] || (live?'webrtc':'mjpeg');
const root = path.resolve(__dirname,'..');
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'pikvm-smoke-'));
  let mock, wss, app;
  const hidEvents=[];
  try {
    if(live&&!process.env.PIKVM_URL)throw Error('Defina PIKVM_URL para o teste com equipamento real.');
    let url=process.env.PIKVM_URL||'https://192.0.2.10';
    if(!live){
      mock=http.createServer((req,res)=>{
        if(req.url.startsWith('/streamer/stream')){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#182f48"/><text x="960" y="540" text-anchor="middle" fill="#8dc8b5" font-size="50">Servidor de teste · 1920 × 1080</text></svg>');return;}
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,result:{system:{kvmd:{version:'test'}}}}));
      });await new Promise(r=>mock.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${mock.address().port}`;
      wss=new WebSocketServer({server:mock});wss.on('connection',(ws,req)=>{if(req.url!=='/api/ws'){ws.close(1008,'Transporte indisponível no mock');return;}for(const [event_type,event] of Object.entries({streamer_state:{params:{desired_fps:30,quality:80},streamer:{source:{online:true,resolution:{width:1920,height:1080},captured_fps:30}}},hid_state:{online:true,mouse:{absolute:true}},atx_state:{enabled:true,leds:{power:true}},msd_state:{enabled:true,storage:{images:{'teste.iso':{}}},drive:{connected:false}}}))ws.send(JSON.stringify({event_type,event}));ws.on('message',(b,binary)=>{if(!binary)return;hidEvents.push({opcode:b[0],state:!!b[1],key:b.subarray(2).toString('ascii'),raw:[...b]});});});
    }
    const config={devices:[{id:'test-device',name:live?'PiKVM principal':'Servidor de teste',url,username:'admin',defaultPassword:true,insecure:true,transport,micEnabled:mic,audioEnabled:live}],windows:[{id:'test-window',fullscreen:false,tabs:[{id:'test-tab',name:'Workspace 01',layout:4,slots:['test-device',null,null,null],fit:'contain'}],activeTab:'test-tab'}]};
    fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(config));
    const mediaFlags=mic?['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']:[];
    app=await electron.launch({...(packaged ? {executablePath:path.join(root,'dist/win-unpacked/PiKVM Control Room.exe'),args:mediaFlags} : {args:[root,...mediaFlags]}),env:{...process.env,PIKVM_DATA_DIR:dir}});
    await app.firstWindow();let page;for(let i=0;i<60;i++){page=app.windows().find(p=>p.url().includes('/index.html')&&!p.url().includes('central=1'));if(page)break;await new Promise(r=>setTimeout(r,100));}assert.ok(page,'Janela principal não abriu');page.setDefaultTimeout(15000);page.on('pageerror',error=>console.error('Renderer:',error.message));await page.waitForSelector('.tile');
    await page.waitForSelector('.video[data-status="playing"]',{timeout:30000});
    await page.waitForFunction(()=>document.querySelector('.target .dot')?.classList.contains('online'));
    assert.equal(await page.locator('.tile').count(),4);
    const dimensions=await page.locator('.video').evaluate(el=>({transport:el.dataset.transport,width:el.querySelector('video').videoWidth||el.querySelector('img').naturalWidth||el.querySelector('canvas').width,height:el.querySelector('video').videoHeight||el.querySelector('img').naturalHeight||el.querySelector('canvas').height}));
    console.log('Video:',dimensions);
    if(live&&transport==='webrtc'){
      let reports=[];for(let i=0;i<60;i++){reports=await page.evaluate(async()=>(await window.room.call('boot')).mediaReports);if(reports.some(r=>r.status==='playing'&&r.codec==='video/H264'&&r.frames>0))break;await page.waitForTimeout(200);}console.log('WebRTC stats:',reports.map(({transport,codec,frames,audio,audioCodec,audioBytes,bufferMs})=>({transport,codec,frames,audio,audioCodec,audioBytes,bufferMs})));
      assert.ok(reports.some(r=>r.codec==='video/H264'&&r.frames>0),'WebRTC deve decodificar quadros H.264');
      await page.locator('#audio-enabled').check();await page.locator('#audio-volume').fill('1');await page.locator('[data-action="apply-media"]').click();
      const hub=app.windows().find(p=>p.url().includes('/audio.html'));assert.ok(hub);await hub.waitForFunction(()=>document.querySelector('video')?.muted===false);console.log('Áudio habilitado na sessão de fundo, independente da seleção.');
      let sound=[];for(let i=0;i<80;i++){sound=await page.evaluate(async()=>(await window.room.call('boot')).audioReports);if(sound.some(r=>r.audioBytes>0&&(!mic||r.micPackets>0)))break;await page.waitForTimeout(150);}
      console.log('Áudio em fundo:',sound.map(({id,status,audioBytes,audioCodec,micSupported,micActive,micPackets,micError,error})=>({id,status,audioBytes,audioCodec,micSupported,micActive,micPackets,micError,error})));
      assert.ok(sound.some(r=>r.audioBytes>0),'Sessão de fundo deve receber áudio');if(mic)assert.ok(sound.some(r=>r.micActive&&r.micPackets>0),'Microfone deve enviar RTP');
      if(mic){
        await hub.evaluate(()=>{const p=sessions.get('test-device').player;globalThis.muteRefs={player:p,pc:p.pc,ws:p.ws,track:p.micTrack,generation:p.generation};});
        await page.evaluate(()=>globalThis.videoBeforeMute=players.get(0).pc);
        for(let i=0;i<3;i++){
          await page.locator('#mic-enabled').uncheck();await hub.waitForFunction(()=>sessions.get('test-device').player.micTrack?.enabled===false);
          assert.equal(await hub.evaluate(()=>{const p=sessions.get('test-device').player;return p===muteRefs.player&&p.pc===muteRefs.pc&&p.ws===muteRefs.ws&&p.micTrack===muteRefs.track&&p.generation===muteRefs.generation&&p.micTrack.readyState==='live';}),true);
          await page.locator('#mic-enabled').check();await hub.waitForFunction(()=>sessions.get('test-device').player.micTrack?.enabled===true);
        }
        await page.locator('#mic-enabled').uncheck();await page.locator('#audio-enabled').uncheck();await page.locator('[data-action="apply-media"]').click();
        assert.equal(await hub.evaluate(()=>sessions.get('test-device').player.pc===muteRefs.pc),true);
        await page.locator('#audio-enabled').check();await page.locator('[data-action="apply-media"]').click();await page.locator('#mic-enabled').check();
        await hub.waitForFunction(()=>sessions.get('test-device').player.micTrack?.enabled===true);
        assert.equal(await page.evaluate(()=>players.get(0).pc===videoBeforeMute),true);
        console.log('Mute/unmute: mesma faixa, PeerConnection e WebSocket; vídeo sem reinício, inclusive com ambos mutados OK');
        for(let i=0;i<2;i++){
          await page.keyboard.press('Control+Shift+m');await page.waitForSelector('#global-mic-bar[data-muted="true"]');await hub.waitForFunction(()=>sessions.get('test-device').player.micTrack?.enabled===false);
          if(i===0){await page.getByText('MIC MUDO',{exact:true}).waitFor();fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/global-mute.png')});}
          assert.equal(await hub.evaluate(()=>{const p=sessions.get('test-device').player;return p.pc===muteRefs.pc&&p.ws===muteRefs.ws&&p.micTrack===muteRefs.track&&p.generation===muteRefs.generation;}),true);
          await page.keyboard.press('Control+Shift+m');await page.waitForSelector('#global-mic-bar[data-muted="false"]');await hub.waitForFunction(()=>sessions.get('test-device').player.micTrack?.enabled===true);
        }
        assert.equal(await page.evaluate(()=>players.get(0).pc===videoBeforeMute),true);console.log('Ctrl+Shift+M: mute geral sem recriar faixa, conexão ou stream OK');
      }
      // Sinal sintético somente para o analisador: não toca nos alto-falantes
      // e não é enviado ao host remoto.
      await hub.evaluate(()=>{const entry=sessions.get('test-device'),context=new AudioContext(),osc=context.createOscillator(),gain=context.createGain(),dest=context.createMediaStreamDestination();gain.gain.value=.15;osc.connect(gain);gain.connect(dest);osc.start();entry.player.meter(dest.stream.getAudioTracks()[0],entry.player.generation);globalThis.meterTest={context,osc};});
      await page.waitForSelector('.tile.audio-active');assert.equal(await page.locator('.tile.audio-active').count(),1);fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/audio-pulse.png')});console.log('Detecção sonora e borda pulsante OK');
    }
    if(!live){
      const hoverBox=await page.locator('.video').boundingBox();await page.mouse.move(0,100);await page.mouse.move(hoverBox.x+hoverBox.width/2,hoverBox.y+hoverBox.height/2);await page.waitForSelector('.armed');await page.mouse.move(hoverBox.x+hoverBox.width/2+20,hoverBox.y+hoverBox.height/2+10);await page.waitForTimeout(100);assert.ok(hidEvents.some(e=>e.opcode===3),'Mover após entrar deve enviar HID sem clique');await page.keyboard.press('F10');await page.mouse.move(hoverBox.x+hoverBox.width/2+30,hoverBox.y+hoverBox.height/2+10);assert.equal(await page.locator('.armed').count(),0,'F10 bloqueia recaptura até sair e entrar');await page.mouse.move(0,100);await page.mouse.move(hoverBox.x+hoverBox.width/2,hoverBox.y+hoverBox.height/2);await page.waitForSelector('.armed');await page.mouse.move(0,100);await page.waitForFunction(()=>!document.querySelector('.armed'));console.log('Hover assume controle, saída libera e F10 impede recaptura imediata OK');
      await page.locator('.video').click();await page.keyboard.press('a');await page.keyboard.press('F10');await page.waitForFunction(()=>!document.querySelector('.armed'));
      assert.ok(hidEvents.some(e=>e.opcode===1&&e.key==='KeyA'&&e.state===true));
      assert.ok(hidEvents.some(e=>e.opcode===1&&e.key==='KeyA'&&e.state===false));
      await page.locator('.video').click();
      const mutedBefore=await page.locator('#global-mic-bar').getAttribute('data-muted');
      await page.keyboard.down('Control');await page.keyboard.down('Shift');await page.keyboard.down('m');
      await page.waitForSelector(`#global-mic-bar[data-muted="${mutedBefore==='true'?'false':'true'}"]`);
      await page.keyboard.down('m');await page.waitForTimeout(150);assert.notEqual(await page.locator('#global-mic-bar').getAttribute('data-muted'),mutedBefore);
      await page.keyboard.up('m');await page.keyboard.up('Shift');await page.keyboard.up('Control');
      assert.ok(!hidEvents.some(e=>e.opcode===1&&e.key==='KeyM'),'Atalho local não deve enviar M ao computador remoto');await page.waitForSelector('.armed');await page.keyboard.press('F10');
      console.log('Atalho com controle remoto capturado; repetição da tecla não alterna duas vezes OK');
      const nativeBefore=String(await page.evaluate(async()=>(await window.room.call('boot')).microphones.muted));await page.waitForSelector(`#global-mic-bar[data-muted="${nativeBefore}"]`);
      const nativeKey=(type,repeat=false)=>app.evaluate(({BrowserWindow},{type,repeat})=>{const w=BrowserWindow.getAllWindows().find(w=>w.roomId==='test-window');w.webContents.sendInputEvent({type,keyCode:'M',modifiers:['control','shift',...(repeat?['isautorepeat']:[])]});},{type,repeat});
      await nativeKey('keyDown');await page.waitForSelector(`#global-mic-bar[data-muted="${nativeBefore==='true'?'false':'true'}"]`);
      await nativeKey('keyDown',true);await page.waitForTimeout(100);assert.notEqual(await page.locator('#global-mic-bar').getAttribute('data-muted'),nativeBefore);
      await nativeKey('keyUp');await nativeKey('keyDown');await nativeKey('keyUp');await page.waitForSelector(`#global-mic-bar[data-muted="${nativeBefore}"]`);console.log('Interceptação nativa do atalho e bloqueio de repetição OK');
      await page.locator('.video').click();await page.keyboard.down('Shift');await page.keyboard.press('F10');await page.keyboard.up('Shift');
      await new Promise(r=>setTimeout(r,300));assert.ok(hidEvents.some(e=>e.opcode===1&&e.key==='ShiftLeft'&&e.state===false));
      await page.locator('.video').click();const rect=await page.locator('.video').boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.wheel(0,80);await page.keyboard.press('F10');await page.waitForFunction(()=>!document.querySelector('.armed'));
      assert.ok(hidEvents.some(e=>e.opcode===3));assert.ok(hidEvents.some(e=>e.opcode===2&&e.key==='left'&&e.state));assert.ok(hidEvents.some(e=>e.opcode===2&&e.key==='left'&&!e.state));assert.ok(hidEvents.some(e=>e.opcode===5));console.log('Mouse: movimento, clique e rolagem binários OK');
    }
    if(live&&liveHid){
      const readCaps=()=>page.evaluate(async()=>!!(await window.room.call('api','test-device','GET','/api/hid')).keyboard.leds.caps);
      const original=await readCaps();let toggled=false;
      try{await page.locator('.video').click();await page.keyboard.press('CapsLock');await page.keyboard.press('F10');
        for(let i=0;i<20;i++){if((await readCaps())!==original){toggled=true;break;}await page.waitForTimeout(150);}
        assert.ok(toggled,'O host não confirmou a tecla CapsLock através do LED HID');
      }finally{if((await readCaps())!==original){await page.locator('.video').click();await page.keyboard.press('CapsLock');await page.keyboard.press('F10');for(let i=0;i<20;i++){if((await readCaps())===original)break;await page.waitForTimeout(150);}}}
      assert.equal(await readCaps(),original);console.log('HID REAL confirmado pelo LED CapsLock; estado original restaurado.');
    }
    await page.locator('[data-action="layout-2"]').click();assert.equal(await page.locator('.tile').count(),2);console.log('Layout 2 OK');
    await page.locator('[data-action="focus"]').first().click();assert.equal(await page.locator('.tile').count(),1);
    await page.locator('[data-action="focus"]').first().click();assert.equal(await page.locator('.tile').count(),2);
    await page.locator('[data-action="add-tab"]').first().click();await page.waitForSelector('.empty');console.log('Nova aba OK');
    if(live&&transport==='webrtc'){await page.waitForSelector('.tab.audio-active');const hub=app.windows().find(p=>p.url().includes('/audio.html'));assert.equal(await hub.locator('#sessions > div').count(),1);assert.equal(await hub.locator('video').evaluate(v=>v.muted),false);console.log('Áudio, microfone e indicação na aba continuam sem área selecionada OK');await hub.evaluate(()=>{meterTest.osc.stop();meterTest.context.close();});}
    assert.equal(await page.locator('.tab').count(),2);
    await page.locator('[data-action="tab"]').first().click();
    await page.locator('[data-action="section-power"]').click();await page.waitForSelector('[data-action="power-hard"]:not([disabled])');
    await page.locator('[data-action="power-hard"]').click();assert.ok(await page.locator('#dialog').isVisible());await page.locator('[data-action="cancel"]').click();
    await page.locator('[data-action="section-video"]').click();
    await page.locator('[data-action="monitors"]').click();assert.ok(await page.locator('.monitor-card').count()>0);await page.locator('#dialog [data-action="cancel"]').click();
    console.log('Layouts, abas e confirmação ATX OK');
    const centralOpened=app.waitForEvent('window',{timeout:15000});await page.locator('[data-action="central"]').first().click();const centralPage=await centralOpened;
    await centralPage.waitForSelector('.control-top');
    const initialMute=await page.locator('#global-mic-bar').getAttribute('data-muted');await centralPage.locator('[data-action="toggle-microphones"]').click();
    await page.waitForSelector(`#global-mic-bar[data-muted="${initialMute==='true'?'false':'true'}"]`);assert.equal(await page.locator('#global-mic-bar').getAttribute('data-muted'),await centralPage.locator('#global-mic-bar').getAttribute('data-muted'));
    await centralPage.locator('[data-action="toggle-microphones"]').click();await page.waitForSelector(`#global-mic-bar[data-muted="${initialMute}"]`);console.log('Indicador geral sincronizado entre janelas OK');
    if(!live){await centralPage.locator('[data-action="section-input"]').click();await centralPage.locator('[data-action="control-selected"]').click();await page.waitForSelector('.armed');await page.keyboard.press('F10');await page.waitForFunction(()=>!document.querySelector('.armed'));console.log('Controle ativado pela central separada OK');}
    await centralPage.close();await page.bringToFront();console.log('Central separada OK');
    await page.evaluate(()=>globalThis.fullscreenPlayer=players.get(0));
    await page.locator('[data-action="fullscreen"]').click();await page.waitForFunction(()=>document.body.classList.contains('immersive'));
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#global-mic-bar').isVisible(),true);
    assert.equal(await page.evaluate(()=>players.get(0)===fullscreenPlayer),true,'Fullscreen preserva stream');
    const screenBounds=await page.locator('.grid').evaluate(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,ww:innerWidth,wh:innerHeight}));assert.equal(screenBounds.x,0);assert.equal(screenBounds.y,0);assert.equal(screenBounds.width,screenBounds.ww);assert.equal(screenBounds.height,screenBounds.wh);
    await page.mouse.move(2,2);await page.waitForSelector('#rdp-toolbar.revealed');
    await page.locator('#rdp-toolbar [data-action="fullscreen-controls"]').click();assert.equal(await page.locator('#controls').isVisible(),true);
    await page.locator('#controls [data-action="section-input"]').click();assert.equal(await page.locator('#remote-text').isVisible(),true);
    await page.locator('#rdp-toolbar [data-action="fullscreen-controls"]').click();assert.equal(await page.locator('#controls').isVisible(),false);
    await page.mouse.move(2,Math.floor(screenBounds.wh/2));await page.waitForTimeout(850);assert.equal(await page.locator('#rdp-toolbar').evaluate(el=>el.getBoundingClientRect().bottom<=6),true,'Barra se recolhe');
    await page.keyboard.press('F10');await page.waitForSelector('#rdp-toolbar.revealed');assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('immersive')),true);
    fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/fullscreen.png')});
    await page.keyboard.press('F11');await page.waitForFunction(()=>!document.body.classList.contains('immersive'));assert.equal(await page.evaluate(()=>players.get(0)===fullscreenPlayer),true);console.log('Fullscreen ocupa tela, mantém streams, barra retrátil e central sobreposta OK');
    await page.locator('[data-action="layout-4"]').click();
    await page.waitForFunction(()=>document.querySelector('.target .dot')?.classList.contains('online'));
    await page.waitForSelector('.video[data-status="playing"]',{timeout:30000});
    if(live&&process.argv.includes('--grid')){
      await page.evaluate(async()=>{const boot=await window.room.call('boot'),w=boot.windows[0];w.tabs[0].layout=4;w.tabs[0].slots=Array(4).fill('test-device');await window.room.call('save-window',{tabs:w.tabs,activeTab:w.activeTab});});
      await page.waitForFunction(()=>document.querySelectorAll('.video[data-status="playing"]').length===4,{},{timeout:30000});
      assert.equal(await page.locator('.video video').evaluateAll(v=>v.filter(el=>!el.muted).length),0);const hub=app.windows().find(p=>p.url().includes('/audio.html'));assert.equal(await hub.locator('#sessions > div').count(),1);console.log('Quatro vídeos; sessão única de áudio persistente por equipamento OK');
    }
    await page.waitForTimeout(400);fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts',live?'live.png':'smoke.png')});
    if(!live){
      const opened=app.waitForEvent('window',{timeout:15000});
      await page.evaluate(()=>window.room.call('new-window',null));const second=await opened;second.setDefaultTimeout(15000);
      await second.waitForSelector('.grid');
      const ports=await Promise.all([page.evaluate(()=>new URL(document.querySelector('.video img').src).port),second.evaluate(async()=>new URL((await window.room.call('boot')).mediaBase).port)]);
      assert.notEqual(ports[0],ports[1]);
      await second.evaluate(()=>window.room.call('remove-window')).catch(error=>{if(!error.message.includes('closed'))throw error;});console.log('Múltiplas janelas com portas de vídeo independentes OK');
    }
    console.log(`Smoke ${live?'LIVE (somente leitura)':'mock'} OK. ${hidEvents.length} eventos no mock.`);
  } catch(error) { console.error('Falha durante smoke:',error); throw error; }
  finally { if(app) { const proc=app.process();let timer;try{await Promise.race([app.close(),new Promise(resolve=>timer=setTimeout(()=>{if(proc.exitCode==null)proc.kill();resolve();},7000))]);}finally{clearTimeout(timer);} } if(wss){for(const c of wss.clients)c.terminate();wss.close();}if(mock){mock.closeAllConnections();mock.close();} /* Diretório temporário mantido para diagnóstico. */ }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
