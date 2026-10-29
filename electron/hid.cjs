// Protocolo binário HID usado pela interface oficial do KVMD.
function encodeHid(type, event) {
  if (type === 'key' || type === 'mouse_button') {
    const value = type === 'key' ? event.key : event.button;
    if (typeof value !== 'string' || !/^[A-Za-z0-9_]{1,32}$/.test(value)) throw new Error('Código HID inválido.');
    if (typeof event.state !== 'boolean') throw new Error('Estado HID inválido.');
    return Buffer.concat([Buffer.from([type === 'key' ? 1 : 2, event.state ? 1 : 0]), Buffer.from(value, 'ascii')]);
  }
  const vector = type === 'mouse_move' ? event.to : event.delta;
  const limit = type === 'mouse_move' ? [-32768,32767] : [-127,127];
  if (!vector || !['x','y'].every(k => Number.isInteger(vector[k]) && vector[k] >= limit[0] && vector[k] <= limit[1])) throw new Error('Coordenada HID inválida.');
  if (type === 'mouse_move') { const b = Buffer.alloc(5); b[0] = 3; b.writeInt16BE(vector.x,1); b.writeInt16BE(vector.y,3); return b; }
  if (!['mouse_relative','mouse_wheel'].includes(type)) throw new Error('Evento HID inválido.');
  return Buffer.from([type === 'mouse_relative' ? 4 : 5, 0, vector.x & 255, vector.y & 255]);
}
module.exports = { encodeHid };
