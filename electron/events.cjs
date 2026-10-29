function merge(previous, update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return update;
  const next = { ...(previous && typeof previous === 'object' ? previous : {}) };
  for (const [key, value] of Object.entries(update)) next[key] = key === 'images' ? value : merge(next[key], value);
  return next;
}
// KVMD recente usa eventos agrupados; versões anteriores usam *_state.
function normalize(message) {
  const { event_type: type, event } = message;
  if (type === 'info') return Object.entries(event).map(([name, value]) => name === 'health' ? { event_type: 'info_hw_state', event: { health: value } } : { event_type: `info_${name}_state`, event: value });
  if (type === 'gpio') return Object.entries(event).map(([name, value]) => ({ event_type: name === 'model' ? 'gpio_model_state' : 'gpio_state', event: value }));
  return [{ event_type: ['streamer','hid','atx','msd','switch','wol','ocr','hid_keymaps'].includes(type) ? `${type}_state` : type, event }];
}
module.exports = { merge, normalize };
