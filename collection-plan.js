// Pure planning functions: no network, filesystem or WhatsApp calls.
function dayStart(seconds) {
  const date = new Date(seconds * 1000);
  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}
function dayKey(seconds) {
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function eligibleMedia(msg, videos = false) {
  return !!msg.hasMedia && ['image', 'sticker', ...(videos ? ['video'] : [])].includes(msg.type);
}
function missingDays(messages, stored, deleted, today, videos = false) {
  const counts = new Map(), seen = new Set();
  for (const msg of messages) {
    const id = msg.id?._serialized;
    if (!id || seen.has(id) || stored.has(id) || (deleted[id] && deleted[id].tekrarEkle !== true) || msg.timestamp >= today || !eligibleMedia(msg, videos)) continue;
    seen.add(id);
    const key = dayKey(msg.timestamp);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([gun, adet]) => ({ gun, adet }));
}
module.exports = { dayStart, dayKey, eligibleMedia, missingDays };
