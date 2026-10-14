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
const RESIM_UZANTISI = /\.(jpe?g|png|webp|gif|heic|heif)$/i;
// Belge olarak gonderilen fotograf: dosya turu resim, ya da dosya adi resim uzantili.
function belgeResmi(msg) {
  if (msg.type !== 'document') return false;
  const veri = msg._data || {};
  return String(veri.mimetype || '').startsWith('image/') || RESIM_UZANTISI.test(String(veri.filename || ''));
}
// Indirilebilen belge turleri. Yalniz ilgili ayar acikken alinir (ayar: ayarlar.json anahtari).
// Office, CAD gibi yeni bir tur eklemek icin bu tabloya satir eklenir; tabloda olmayan belgeler alinmaz.
const BELGE_TURLERI = Object.freeze([
  Object.freeze({ tur: 'pdf', ad: 'PDF', ayar: 'pdfleriDaIndir', uzanti: '.pdf', uzantilar: Object.freeze(['pdf']), mimetipler: Object.freeze(['application/pdf']) }),
]);
const uzantiAl = (ad) => { const m = String(ad || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/); return m ? m[1] : ''; };
// { mimetype, filename } bilgisinden belge turu (tablodaki satir) ya da null. Dosya turu "octet-stream" gelse de uzantidan taninir.
function belgeTuru(bilgi) {
  const mime = String(bilgi?.mimetype || '').toLowerCase().split(';')[0].trim();
  const uzanti = uzantiAl(bilgi?.filename);
  return BELGE_TURLERI.find((b) => b.mimetipler.includes(mime) || b.uzantilar.includes(uzanti)) || null;
}
const mesajBelgesi = (msg) => (msg.type === 'document' ? belgeTuru(msg._data || {}) : null);
// Alinmayan belge sayaci icin kisa ad: tablodaki ad, yoksa uzanti (XLSX, DWG...), yoksa dosya turu, yoksa "Diğer".
function belgeEtiketi(msg) {
  const veri = msg._data || {};
  const tur = belgeTuru(veri);
  if (tur) return tur.ad;
  const uzanti = uzantiAl(veri.filename);
  if (uzanti) return uzanti.toUpperCase();
  return String(veri.mimetype || '').split(';')[0].trim() || 'Diğer';
}
// belgeler: ayar nesnesi; ornegin { pdfleriDaIndir: true } ise PDF belgeleri de alinir.
function eligibleMedia(msg, videos = false, belgeler = {}) {
  if (!msg.hasMedia) return false;
  if (['image', 'sticker', ...(videos ? ['video'] : [])].includes(msg.type) || belgeResmi(msg)) return true;
  const belge = mesajBelgesi(msg);
  return !!(belge && belgeler && belgeler[belge.ayar] === true);
}
function missingDays(messages, stored, deleted, today, videos = false, belgeler = {}) {
  const counts = new Map(), seen = new Set();
  for (const msg of messages) {
    const id = msg.id?._serialized;
    if (!id || seen.has(id) || stored.has(id) || (deleted[id] && deleted[id].tekrarEkle !== true) || msg.timestamp >= today || !eligibleMedia(msg, videos, belgeler)) continue;
    seen.add(id);
    const key = dayKey(msg.timestamp);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([gun, adet]) => ({ gun, adet }));
}
module.exports = { dayStart, dayKey, eligibleMedia, belgeResmi, missingDays, BELGE_TURLERI, belgeTuru, mesajBelgesi, belgeEtiketi };
