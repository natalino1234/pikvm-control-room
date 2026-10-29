const { contextBridge, ipcRenderer } = require('electron');
const calls = ['boot','save-device','delete-device','save-window','select','subscribe','api','test-device','release','fullscreen','new-window','move-window','central','remove-window','snapshot','upload','media-settings','control-selected','microphone-muted','toggle-microphones','transcription-settings','transcription-install','captions-enabled','meeting-start','meeting-stop','meeting-list','meeting-folder','meeting-review'];
contextBridge.exposeInMainWorld('room', {
  call: async (name, ...args) => { if (!calls.includes(name)) throw new Error('Operação inválida.'); const result = await ipcRenderer.invoke(name, ...args); if (!result.ok) throw new Error(result.error); return result.data; },
  hid: (id, type, event) => ipcRenderer.send('hid', id, type, event),
  stopStreams: () => ipcRenderer.send('clear-streams'),
  mediaStatus: report => ipcRenderer.send('media-status',report),
  audioFlushed: result=>ipcRenderer.send('audio-flushed',result),
  audioPcm: chunk=>ipcRenderer.send('audio-pcm',chunk),
  audioStatus: report=>ipcRenderer.send('audio-status',report),
  audioLevel: report=>ipcRenderer.send('audio-level',report),
  on: (name, fn) => { if (!['state','device-event','selection','fullscreen','escape-controls','displays','audio-focus','activate-control','hid-error','media-status','audio-state','audio-level','caption','voice-level','transcription-state','flush-audio'].includes(name)) return; ipcRenderer.on(name, (_e, value) => fn(value)); }
});
