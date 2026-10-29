const http = require('node:http');
const https = require('node:https');
const WebSocket = require('ws');
const { merge, normalize } = require('./events.cjs');
const { encodeHid } = require('./hid.cjs');
function request(device, route, { method = 'GET', body, timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, device.url);
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method, rejectUnauthorized: !device.insecure,
      headers: { 'X-KVMD-User': device.username, 'X-KVMD-Passwd': device.password, ...(body != null ? { 'Content-Type': 'text/plain; charset=utf-8' } : {}) }
    }, res => {
      const chunks = []; let size = 0;
      res.on('data', b => { size += b.length; if (size > 8 * 1024 * 1024) { req.destroy(new Error('Resposta excede o limite.')); return; } chunks.push(b); });
      res.on('error', reject);
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`PiKVM HTTP ${res.statusCode}${[401,403].includes(res.statusCode) ? ': verifique usuário e senha' : ''}`));
        if (res.headers['content-type']?.includes('image/')) return resolve(raw);
        try { const data = JSON.parse(raw); if (data.ok === false) throw new Error(data.result?.error || 'Comando recusado.'); resolve(data.result); } catch (error) { reject(error); }
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error('Tempo de conexão esgotado.')));
    req.on('error', reject); req.end(body);
  });
}
class Connection {
  constructor(device, update) { this.device = device; this.update = update; this.states = {}; this.stopped = false; this.attempt = 0; this.connect(); }
  connect() {
    if (this.stopped) return;
    this.update({ event_type: 'connection', event: { status: 'connecting' } });
    const url = new URL('/api/ws', this.device.url); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = this.ws = new WebSocket(url, { rejectUnauthorized: !this.device.insecure, headers: { 'X-KVMD-User': this.device.username, 'X-KVMD-Passwd': this.device.password }, handshakeTimeout: 10000 });
    ws.on('open', () => { this.attempt = 0; this.update({ event_type: 'connection', event: { status: 'online' } }); this.ping = setInterval(() => { if(ws.readyState === WebSocket.OPEN)ws.send(Buffer.from([0])); }, 1000); });
    ws.on('message', raw => { try { for (const msg of normalize(JSON.parse(raw.toString()))) if (!['pong','loop'].includes(msg.event_type)) { this.states[msg.event_type] = merge(this.states[msg.event_type], msg.event); this.update({ ...msg, event: this.states[msg.event_type] }); } } catch {} });
    ws.on('error', error => this.update({ event_type: 'connection', event: { status: 'offline', error: error.message } }));
    ws.on('close', () => { clearInterval(this.ping); this.update({ event_type: 'connection', event: { status: 'offline' } }); if (!this.stopped) this.retry = setTimeout(() => this.connect(), Math.min(15000, 1000 * 2 ** this.attempt++)); });
  }
  send(event_type, event) {
    if (this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(['key','mouse_button','mouse_move','mouse_relative','mouse_wheel'].includes(event_type) ? encodeHid(event_type,event) : JSON.stringify({event_type,event})); return true;
  }
  stop() { this.stopped = true; clearTimeout(this.retry); clearInterval(this.ping); this.ws.terminate(); }
}
const reads = new Set(['/api/info', '/api/hid', '/api/hid/keymaps', '/api/atx', '/api/msd', '/api/gpio', '/api/streamer', '/api/switch']);
const writes = new Set(['/api/hid/set_params', '/api/hid/set_connected', '/api/hid/reset', '/api/hid/print', '/api/hid/events/send_shortcut', '/api/atx/power', '/api/atx/click', '/api/msd/set_params', '/api/msd/set_connected', '/api/msd/remove', '/api/msd/reset', '/api/gpio/switch', '/api/gpio/pulse', '/api/streamer/set_params', '/api/streamer/reset', '/api/switch/set_active', '/api/switch/set_active_prev', '/api/switch/set_active_next', '/api/wol/wakeup']);
function allowed(method, route) { return typeof route === 'string' && route.startsWith('/api/') && !route.includes('\\') && (method === 'GET' ? reads : method === 'POST' ? writes : new Set()).has(new URL(route, 'http://local').pathname); }
module.exports = { request, Connection, allowed };
