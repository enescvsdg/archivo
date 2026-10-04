const fs = require('node:fs');
const path = require('node:path');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    // A damaged archive must never silently become an empty archive.
    throw new Error(`Veri dosyası okunamadı: ${path.basename(file)}. Dosya korunuyor; yedeğinizi kontrol edin.`, { cause: error });
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(temp, file);
}

async function scanMessages(chat, since, until, ceiling, pause, check, progress = () => {}) {
  let limit = Math.min(25, ceiling);
  let messages = [];
  let complete = false;
  while (true) {
    check();
    messages = await chat.fetchMessages({ limit });
    check();
    messages.sort((a, b) => a.timestamp - b.timestamp);
    progress({ mesaj: messages.length, enEski: messages[0]?.timestamp ?? null });
    complete = messages.length < limit || messages.length === 0 || messages[0].timestamp <= since;
    if (complete || limit >= ceiling) break;
    limit = Math.min(limit * 2, ceiling);
    await pause(1500);
  }
  return scanResult(messages, since, until, complete);
}

// Tarama sonucunu kurar: pencere ici mesajlar, medyalar ve erisim durumu.
function scanResult(messages, since, until, complete) {
  const current = messages.filter(m => m.timestamp > since && m.timestamp <= until);
  const oldest = messages[0]?.timestamp ?? null;
  const status = oldest !== null && oldest <= since ? 'ulasildi'
    : complete ? 'erisim-belirsiz' : 'sinir';
  return { tum: messages, medyalar: current.filter(m => m.hasMedia), tamam: complete,
    erisim: { durum: status, istenen: since, enEski: oldest, mesaj: messages.length } };
}

// Insan hizi: gecmis mesajlar sayfa sayfa yuklenir, her yuklemeden once beklenir ve istenen tarihe
// ulasilinca durulur (fazla yuklenmez). chat: { bak(), yukle(), fetchMessages() }.
// bak() yuklu mesajlarin { toplam, enEski } bilgisini ag istegi olmadan verir; yukle() bir sayfa daha ister.
async function scanPaced(chat, since, until, ceiling, pause, check, progress = () => {}) {
  let durum = await chat.bak();
  let complete = false;
  while (true) {
    check();
    progress({ mesaj: durum.toplam, enEski: durum.enEski });
    if (durum.enEski !== null && durum.enEski <= since) { complete = true; break; }
    if (durum.toplam >= ceiling) break;
    await pause();
    check();
    durum = await chat.yukle();
    check();
    if (!durum.yeni) { complete = true; break; }
  }
  const messages = await chat.fetchMessages({ limit: durum.toplam });
  check();
  messages.sort((a, b) => a.timestamp - b.timestamp);
  return scanResult(messages, since, until, complete);
}

module.exports = { readJson, writeJson, scanMessages, scanPaced };
