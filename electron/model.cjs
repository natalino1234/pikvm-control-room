const { randomUUID } = require('node:crypto');
function origin(value) {
  const url = new URL(value.includes('://') ? value : `https://${value}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Informe um endereço HTTP ou HTTPS sem credenciais.');
  return url.origin;
}
function tab(deviceId = null, name = 'Workspace 01') {
  return { id: randomUUID(), name, layout: 1, slots: [deviceId, null, null, null], fit: 'contain' };
}
function initial() {
  return { devices: [], windows: [] };
}
function validateTab(t, devices) {
  if (![1, 2, 4].includes(t.layout)) throw new Error('Layout inválido.');
  const ids = new Set(devices.map(d => d.id));
  return { id: String(t.id), name: String(t.name).slice(0, 80) || 'Workspace', layout: t.layout, slots: Array.from({ length: 4 }, (_, i) => ids.has(t.slots?.[i]) ? t.slots[i] : null), fit: t.fit === 'fill' ? 'fill' : 'contain' };
}
const { pointer } = require('../ui/geometry.js');
module.exports = { origin, tab, initial, validateTab, pointer };
