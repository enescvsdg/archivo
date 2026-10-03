const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, Tray, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { readJson, writeJson, scanMessages } = require('./archive-state');
const { observeConnection, errorText } = require('./connection-diagnostics');
const { connectionConfig } = require('./connection-config');
const { dayStart, eligibleMedia, missingDays } = require('./collection-plan');
const { LIMITS, days, withTimeout, budget } = require('./operation-policy');
let canliDurum = null;
let baglantiDurumu = 'Bağlantı kapalı';
let islem = null;
let kapaniyor = false;
let yerelSilme = false;
// Grup yenilemeden Topla'ya aynı hazır tarayıcı ile geçilir.
let hazirClient = null;
function hazirIstemiAl() {
  const client = hazirClient;
  hazirClient = null;
  if (client) client.removeAllListeners();
  return client;
}


function kontrol(i) {
  if (i.iptal) throw new Error('İşlem iptal edildi');
  if (i.butce) i.butce.check();
}

async function islemiDurdur() {
  const i = islem;
  if (!i) {
    const client = hazirIstemiAl();
    if (client) { try { await client.destroy(); } catch (e) {} }
    baglantiDurumu = 'Bağlantı kapalı';
    return;
  }
  i.iptal = true;
  if (i.telefonIptal) i.telefonIptal(new Error('İşlem iptal edildi'));
  if (i.reject) i.reject(new Error('İşlem iptal edildi'));
  try { await i.client.destroy(); } catch (e) {}
}


const SMOKE = process.argv.find(a => a.startsWith('--smoke-test='));
if (SMOKE) app.setPath('userData', SMOKE.split('=').slice(1).join('='));
else {
  const profil = path.join(app.getPath('userData'), 'profiller', require('./package.json').version);
  fs.mkdirSync(profil, { recursive: true });
  app.setPath('userData', profil);
}
const SESSIZ = process.argv.includes('--sessiz');
const BEKLEME_DAKIKA = 30;

let pencere = null;
let tepsi = null;
let calisiyor = false;

// ---------------- yollar ----------------

const veriKok = () => app.getPath('userData');
const ayarYolu = () => path.join(veriKok(), 'ayarlar.json');
const durumYolu = () => path.join(veriKok(), 'son-calisma.json');
const raporYolu = () => path.join(veriKok(), 'tarama-raporu.json');
const gruplarYolu = () => path.join(veriKok(), 'gruplar.json');
const dizinYolu = () => path.join(veriKok(), 'dizin.json');
const kucukKok = () => path.join(veriKok(), 'kucuk');

const VARSAYILAN_AYAR = {
  hedefKlasor: path.join(app.getPath('pictures') || app.getPath('home'), 'Archivo ' + require('./package.json').version + ' Arsivi'),
  sadeceSuGruplar: [],
  bireyselSohbetlerDeIndir: false,
  videolariDaIndir: false,
  grubaGoreAltKlasor: false,
  ilkCalismaGunSayisi: 3,
  taramaTavani: 5000,
  saydamlik: 13,
  yinelenenleriAtla: true,
  yakinMesajlariAl: true,
  notPenceresiSaniye: 150,
  otomatikCalistir: false,
  waSurum: '',
};

const jsonOku = readJson;
const jsonYaz = writeJson;

const ayarOku = () => ({ ...VARSAYILAN_AYAR, ...jsonOku(ayarYolu(), {}) });
const ayarYaz = (a) => jsonYaz(ayarYolu(), a);
const sonZamanOku = () => jsonOku(durumYolu(), {}).sonZaman ?? null;
const sonZamanYaz = (z, sohbetler) => jsonYaz(durumYolu(), { sonZaman: z, sohbetler });
const gruplariOku = () => jsonOku(gruplarYolu(), []);
const gruplariYaz = (l) => jsonYaz(gruplarYolu(), l);

// dizin: dosyaAdi -> { hash, grup, gonderen, zaman, gruplar: [] }
const dizinOku = () => jsonOku(dizinYolu(), {});
const dizinYaz = (d) => jsonYaz(dizinYolu(), d);

// ---------------- yardimcilar ----------------

const UZANTILAR = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
  'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/3gpp': '.3gp',
};

const GORSEL = /\.(jpe?g|png|webp|gif|heic)$/i;
const ikiHane = (n) => String(n).padStart(2, '0');
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

function temizle(metin) {
  return String(metin || 'bilinmeyen')
    .replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60);
}

const AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

// Disk yapisi:  2026 / Eylül / 20.09.2026 / Grup Adi / dosya
// Uygulama ici gruplama ise ISO tarihle yapilir (siralama kolay olsun diye).
function tarihParcala(sn) {
  const d = new Date(sn * 1000);
  const yil = d.getFullYear();
  const ayNo = ikiHane(d.getMonth() + 1);
  const gunNo = ikiHane(d.getDate());
  return {
    yil: String(yil),
    ay: AY_ADLARI[d.getMonth()],
    gunTR: `${gunNo}.${ayNo}.${yil}`,
    klasor: `${yil}-${ayNo}-${gunNo}`,
    saat: `${ikiHane(d.getHours())}-${ikiHane(d.getMinutes())}-${ikiHane(d.getSeconds())}`,
  };
}

// dd.mm.yyyy -> yyyy-mm-dd
function gunIso(gunTR) {
  const p = gunTR.split('.');
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : null;
}

function cakismayanYol(klasor, ad, uzanti) {
  let yol = path.join(klasor, ad + uzanti);
  let i = 1;
  while (fs.existsSync(yol)) { yol = path.join(klasor, `${ad}_${i}${uzanti}`); i++; }
  return yol;
}

function hataYaz(nerede, e) {
  const ayrinti = (e && (e.stack || e.message)) || String(e);
  console.error('\n=== HATA: ' + nerede + ' ===');
  console.error(ayrinti);
  console.error('=== HATA SONU ===\n');
  return (e && e.message) || String(e);
}

function yolla(kanal, veri) {
  if (kanal === 'durum') {
    const now = Date.now();
    canliDurum = { ...veri, baslangic: canliDurum?.baslangic || now, sonIlerleme: now };
    veri = canliDurum;
  }
  if (kanal === 'bitti') canliDurum = null;
  if (pencere && !pencere.isDestroyed()) pencere.webContents.send(kanal, veri);
}

// ---------------- gomulu tarayici ----------------

// Paketlenmis exe icinde Chromium resources/chromium altinda durur.
// Gelistirme sirasinda proje icindeki chromium klasorunde.
let tarayiciOnbellek;

function tarayiciYolu() {
  if (tarayiciOnbellek !== undefined) return tarayiciOnbellek;

  let kok = app.isPackaged
    ? path.join(process.resourcesPath, 'chromium')
    : path.join(__dirname, 'chromium');
  if (!app.isPackaged) {
    const platform = process.platform === 'win32' ? 'win64' : process.platform === 'darwin' ? (process.arch === 'arm64' ? 'mac_arm' : 'mac') : 'linux';
    const cache = path.join(kok, 'chrome');
    const installs = fs.existsSync(cache) ? fs.readdirSync(cache).filter(n => n.startsWith(platform + '-')).sort() : [];
    if (installs.length) kok = path.join(cache, installs[installs.length - 1]);
  }

  const adaylar = process.platform === 'win32'
    ? ['chrome.exe']
    : process.platform === 'darwin'
      ? ['Chromium', 'Google Chrome for Testing']
      : ['chrome'];

  const ara = (dizin, derinlik) => {
    if (derinlik > 6) return null;
    let girdiler = [];
    try { girdiler = fs.readdirSync(dizin, { withFileTypes: true }); } catch (e) { return null; }
    for (const g of girdiler) {
      const tam = path.join(dizin, g.name);
      if (g.isDirectory()) {
        const bulunan = ara(tam, derinlik + 1);
        if (bulunan) return bulunan;
      } else if (adaylar.includes(g.name)) {
        return tam;
      }
    }
    return null;
  };

  tarayiciOnbellek = fs.existsSync(kok) ? ara(kok, 0) : null;
  return tarayiciOnbellek;
}

function tarayiciAyari() {
  const secenekler = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
  const yol = tarayiciYolu();
  if (yol) secenekler.executablePath = yol;
  else if (app.isPackaged) throw new Error('Paket içindeki tarayıcı bulunamadı. Uygulamayı yeniden indirin.');
  return secenekler;
}

function istemciSecenekleri() {
  const ayar = ayarOku();
  const secenekler = {
    ...connectionConfig(),
    authStrategy: new LocalAuth({ dataPath: path.join(veriKok(), 'oturum') }),
    puppeteer: tarayiciAyari(),
  };

  // WhatsApp arayuzunu degistirdiginde kutuphane yetisemez ve "r" gibi
  // anlamsiz hatalar verir. Calisan bir surumu sabitlemek bunu asar.
  if (ayar.waSurum) {
    secenekler.webVersionCache = {
      type: 'remote',
      remotePath:
        'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/' +
        ayar.waSurum + '.html',
    };
    console.log('WhatsApp Web sürümü sabitlendi:', ayar.waSurum);
  }

  return secenekler;
}

// ---------------- kucuk resim ----------------

function kucukYolu(gun, ad) {
  return path.join(kucukKok(), gun, ad.replace(/\.[^.]+$/, '') + '.jpg');
}

function kucukUret(kaynakYol, gun, ad) {
  const hedef = kucukYolu(gun, ad);
  if (fs.existsSync(hedef)) return hedef;
  try {
    const resim = nativeImage.createFromPath(kaynakYol);
    if (resim.isEmpty()) return null;
    const kucuk = resim.resize({ width: 320, quality: 'good' });
    fs.mkdirSync(path.dirname(hedef), { recursive: true });
    fs.writeFileSync(hedef, kucuk.toJPEG(74));
    return hedef;
  } catch (e) {
    return null;
  }
}

function kucukUretTampon(tampon, gun, ad) {
  try {
    const resim = nativeImage.createFromBuffer(tampon);
    if (resim.isEmpty()) return null;
    const hedef = kucukYolu(gun, ad);
    fs.mkdirSync(path.dirname(hedef), { recursive: true });
    fs.writeFileSync(hedef, resim.resize({ width: 320, quality: 'good' }).toJPEG(74));
    return hedef;
  } catch (e) {
    return null;
  }
}

function csvAlan(d) {
  const m = String(d == null ? '' : d).replace(/"/g, '""');
  return '"' + m + '"';
}

// Her gun klasorune, uygulama disindan da okunabilen bir aciklama dosyasi yazar.
function aciklamaKaydet(klasorYolu, satir) {
  const dosya = path.join(klasorYolu, '_aciklamalar.csv');
  try {
    if (!fs.existsSync(dosya)) {
      fs.writeFileSync(dosya, '\ufeffDosya;Gonderen;Grup;Saat;Aciklama;YakinMesajlar\n', 'utf8');
    }
    fs.appendFileSync(dosya, satir.map(csvAlan).join(';') + '\n', 'utf8');
  } catch (e) {}
}

// WhatsApp Web'in ic modulleri degistiginde kutuphanenin getChatModel
// fonksiyonu cokuyor. Nesi bozuk oldugunu olcer ve terminale yazar.
async function teshis(sayfa) {
  try {
    const rapor = await sayfa.evaluate(() => {
      const sonuc = {};
      const dene = (ad, fn) => {
        try { sonuc[ad] = fn(); } catch (e) { sonuc[ad] = 'HATA: ' + (e && e.message || e); }
      };

      dene('window.require', () => typeof window.require);
      dene('WWebJS', () => typeof window.WWebJS);
      dene('WAWebCollections', () => typeof window.require('WAWebCollections'));
      dene('Chat koleksiyonu', () => window.require('WAWebCollections').Chat.getModelsArray().length);
      dene('WAWebWidFactory', () => typeof window.require('WAWebWidFactory').createWid);
      dene('WAWebLidMigrationUtils', () => typeof window.require('WAWebLidMigrationUtils').toPn);
      dene('GroupMetadata', () => {
        const k = window.require('WAWebCollections');
        return typeof (k.GroupMetadata || k.WAWebGroupMetadataCollection);
      });

      dene('sade model (ilk sohbet)', () => {
        const c = window.require('WAWebCollections').Chat.getModelsArray()[0];
        const m = c.serialize();
        return m && m.id ? 'calisiyor' : 'bos dondu';
      });

      return sonuc;
    });

    console.log('\n=== TESHIS ===');
    for (const [ad, deger] of Object.entries(rapor)) console.log('  ' + ad + ': ' + deger);
    console.log('=== TESHIS SONU ===\n');
    return rapor;
  } catch (e) {
    hataYaz('teshis', e);
    return null;
  }
}

// getChatModel'i, kirilgan kisimlari atlayan sade bir surumle degistirir.
// Bize sadece ad, kimlik, grup mu ve son mesaj zamani lazim.
async function modeliSadelestir(sayfa, secili = [], bireysel = false) {
  await sayfa.evaluate((secim, ozel) => {
    if (!window.WWebJS) throw new Error('WhatsApp yardımcı kodu henüz hazır değil');
    // Read cached fields only: no GroupMetadata.update and no original serializer.
    window.WWebJS.getChatModel = async chat => {
      if (!chat) return null;
      const id = typeof chat.id === 'string' ? chat.id : chat.id?._serialized || chat.id?.toString();
      if (!id || id === '[object Object]') throw new Error('Sohbet kimliği okunamadı');
      return { id: { _serialized: id }, formattedTitle: chat.formattedTitle || chat.name || '',
        isGroup: id.endsWith('@g.us'), isMuted: !!chat.mute?.expiration,
        isReadOnly: !!chat.groupMetadata?.announce, t: chat.t || chat.timestamp || 0,
        unreadCount: chat.unreadCount || 0, archive: !!chat.archive, pin: chat.pin || 0, lastMessage: null };
    };
    window.WWebJS.getChats = async () => {
      const chats = window.require('WAWebCollections').Chat.getModelsArray();
      const filtered = chats.filter(chat => {
        const id = typeof chat.id === 'string' ? chat.id : chat.id?._serialized || chat.id?.toString();
        const group = id?.endsWith('@g.us');
        return group ? !secim.length || secim.includes(chat.formattedTitle || chat.name || '') : ozel;
      });
      return Promise.all(filtered.map(chat => window.WWebJS.getChatModel(chat)));
    };
  }, secili, bireysel);
}

async function sohbetHazirliginiBekle(client, i, secili = []) {
  if (!client.pupPage) return;
  while (true) {
    kontrol(i);
    const hazir = await client.pupPage.evaluate(secim => {
      const chats = window.require('WAWebCollections').Chat.getModelsArray();
      const socket = window.AuthStore?.AppState;
      const progress = window.AuthStore?.OfflineMessageHandler?.getOfflineDeliveryProgress?.();
      if (socket?.hasSynced === false || (Number.isFinite(progress) && progress > 0 && progress < 100)) return false;
      return !!chats.length && secim.every(ad => chats.some(chat => (chat.formattedTitle || chat.name || '') === ad));
    }, secili);
    kontrol(i);
    if (hazir !== false) break;
    yolla('durum', { metin: 'Senkronize ediliyor', ayrinti: 'Seçili sohbetlerin yerel listede hazır olması bekleniyor' });
    await bekle(2000);
  }
}

async function telefonOnayiniBekle(i) {
  if (jsonOku(path.join(veriKok(), 'senkronizasyon-onayi.json'), {}).tamam) return;
  kontrol(i);
  baglantiDurumu = 'Senkronize ediliyor';
  yolla('durum', { metin: 'Senkronize ediliyor', telefonOnayi: true,
    ayrinti: 'WhatsApp Web hazır. Telefonda senkronizasyon sürüyorsa bekleyin. Telefonda tamamlandığında aşağıdan onaylayın.' });
  await new Promise((resolve, reject) => { i.telefonOnay = resolve; i.telefonIptal = reject; });
  i.telefonOnay = null; i.telefonIptal = null;
  kontrol(i); jsonYaz(path.join(veriKok(), 'senkronizasyon-onayi.json'), { tamam: true });
  baglantiDurumu = 'Bağlı';
}

ipcMain.handle('senkronizasyon-onayla', () => {
  if (!islem?.telefonOnay) return false;
  islem.telefonOnay(); return true;
});

// WhatsApp Web kodunu kuculturken alan adlarini degistirebiliyor:
// id._serialized yerine id.$1 gibi. Kimligi neresinde olursa olsun bulur.
function mesajKimligi(msg) {
  const id = msg && msg.id;
  if (!id) return null;
  if (typeof id === 'string') return id;
  if (id._serialized) return id._serialized;

  // Serilestirilmis kimlik "false_<sohbet>@g.us_<kod>_<kisi>@lid" bicimindedir:
  // hem @ hem _ iceren tek alan odur.
  for (const anahtar of Object.keys(id)) {
    const deger = id[anahtar];
    if (typeof deger === 'string' && deger.includes('@') && deger.includes('_')) {
      return deger;
    }
  }

  // Son care: parcalardan kur
  if (id.remote && id.id) {
    const parcalar = [String(!!id.fromMe), String(id.remote), String(id.id)];
    const k = id.participant;
    const kisi = k && (k._serialized || (typeof k === 'string' ? k : null));
    if (kisi) parcalar.push(kisi);
    return parcalar.join('_');
  }

  return null;
}

// Kutuphanenin downloadMedia'si bozuk kimlik gonderdigi icin indirmeyi
// dogru kimlikle kendimiz yapariz.
async function medyaIndir(sayfa, kimlik) {
  return await sayfa.evaluate(async (id) => {
    const cozulen = await window.WWebJS.resolveMediaBlob(id);
    if (!cozulen) return null;

    const tampon = await cozulen.blob.arrayBuffer();
    const base64 = typeof window.WWebJS.arrayBufferToBase64Async === 'function'
      ? await window.WWebJS.arrayBufferToBase64Async(tampon)
      : window.WWebJS.arrayBufferToBase64(tampon);

    return {
      data: base64,
      mimetype: cozulen.mimetype,
      filename: cozulen.filename,
      filesize: cozulen.filesize,
    };
  }, kimlik);
}

// resolveMediaBlob'u, her adimi ayri ayri deneyip birini tutturmaya calisan
// hosgorulu bir surumle degistirir.
async function medyayiSadelestir(sayfa) {
  await sayfa.evaluate(() => {
    if (!window.WWebJS) return;

    window.WWebJS.resolveMediaBlob = async (msgId) => {
      const { Msg } = window.require('WAWebCollections');
      let msg = null;
      try {
        msg = Msg.get(msgId) || (await Msg.getMessagesById([msgId]))?.messages?.[0];
      } catch (e) {}
      if (!msg) return null;

      try {
        await msg.downloadMedia({
          downloadEvenIfExpensive: true, rmrReason: 1, isUserInitiated: true,
        });
      } catch (e) { /* indirme zaten yapilmis olabilir */ }

      let blob = null;

      try {
        const cache = window.require('WAWebMediaInMemoryBlobCache').InMemoryMediaBlobCache;
        blob = cache.get(msg.mediaObject && msg.mediaObject.filehash) || null;
      } catch (e) {}

      if (!blob) {
        try {
          const mb = msg.mediaObject && msg.mediaObject.mediaBlob;
          if (mb && typeof mb.forceToBlob === 'function') blob = mb.forceToBlob();
          else if (mb instanceof Blob) blob = mb;
        } catch (e) {}
      }

      if (!blob) {
        try {
          const mb = msg.mediaData && msg.mediaData.mediaBlob;
          if (mb && typeof mb.forceToBlob === 'function') blob = mb.forceToBlob();
          else if (mb instanceof Blob) blob = mb;
        } catch (e) {}
      }

      if (!blob) return null;

      return {
        blob,
        mimetype: msg.mimetype,
        filename: msg.filename,
        filesize: msg.size,
      };
    };
  });
  console.log('resolveMediaBlob hoşgörülü sürümle değiştirildi.');
}

// ---------------- toplama ----------------

// Fotografin altina yazilmamis ama ona ait olan mesajlari bulur.
// Iki bag kullanilir: ayni kisiden yakin zamanli duz mesaj, ve fotografi alintilayan cevap.
async function notlariEslestir(medyalar, tumMesajlar, pencere, islemBilgisi) {
  const harita = new Map();
  const kimlik = (m) => mesajKimligi(m);
  const kisi = (m) => m.author || m.from;

  for (const m of medyalar) harita.set(kimlik(m), []);

  const metinler = tumMesajlar.filter((m) => !m.hasMedia && (m.body || '').trim());

  for (const t of metinler) {
    const metin = t.body.trim();
    if (metin.length > 600) continue;

    // 1) alintili cevap: kesin bag
    if (t.hasQuotedMsg) {
      kontrol(islemBilgisi); islemBilgisi.butce.request();
      await bekle(LIMITS.pause); kontrol(islemBilgisi);
      try {
        const alinti = await withTimeout(t.getQuotedMessage(), LIMITS.timeout, 'Alıntı bilgisi');
        const hedef = kimlik(alinti);
        if (hedef && harita.has(hedef)) {
          harita.get(hedef).push({ metin, kaynak: 'alinti', kim: kisi(t) });
          continue;
        }
      } catch (e) { if (e.message.includes('yanıt süresi aşıldı')) throw e; }
    }

    // 2) ayni kisiden, zaman penceresi icindeki en yakin fotograf
    let enYakin = null;
    let enKucukFark = Infinity;
    for (const m of medyalar) {
      if (kisi(m) !== kisi(t)) continue;
      const fark = Math.abs(t.timestamp - m.timestamp);
      if (fark <= pencere && fark < enKucukFark) { enKucukFark = fark; enYakin = m; }
    }
    if (enYakin) harita.get(kimlik(enYakin)).push({ metin, kaynak: 'yakin', kim: kisi(t) });
  }

  return harita;
}

const kisiOnbellek = new Map();

async function gonderenAdi(msg, islemBilgisi) {
  const kimlik = msg.author || msg.from;
  if (!kimlik) return null;
  if (kisiOnbellek.has(kimlik)) return kisiOnbellek.get(kimlik);
  let ad = null;
  if (typeof msg.getContact !== 'function') return null;
  kontrol(islemBilgisi); islemBilgisi.butce.request();
  await bekle(LIMITS.pause); kontrol(islemBilgisi);
  try {
    const kisi = await withTimeout(msg.getContact(), LIMITS.timeout, 'Gönderen bilgisi');
    ad = kisi.pushname || kisi.name || kisi.number || null;
  } catch (e) { if (e.message.includes('yanıt süresi aşıldı')) throw e; }
  kisiOnbellek.set(kimlik, ad);
  return ad;
}

async function toplamayiBaslat(zorla, gecmis = false, sadeceTara = false, taslak = {}) {
  if (calisiyor || yerelSilme) return { hata: 'Toplama zaten sürüyor' };

  const ayar = { ...ayarOku(), ...taslak };
  const gunSayisi = days(ayar.ilkCalismaGunSayisi);
  const simdi = Math.floor(Date.now() / 1000);
  const sonZaman = sonZamanOku();
  const sonIslem = Math.max(sonZaman || 0, jsonOku(path.join(veriKok(), 'son-istek.json'), {}).zaman || 0, jsonOku(path.join(veriKok(), 'son-gecmis-tarama.json'), {}).zaman || 0);

  if (!sadeceTara && !zorla && sonIslem && simdi - sonIslem < BEKLEME_DAKIKA * 60) {
    const kalan = Math.ceil((BEKLEME_DAKIKA * 60 - (simdi - sonIslem)) / 60);
    return { hata: `Son işlemden sonra bekleme sürüyor. ${kalan} dakika sonra tekrar dene.` };
  }

  const baglanmaYolu = path.join(veriKok(), 'son-baglanti.json');
  if (!zorla && !hazirClient && Date.now() - (jsonOku(baglanmaYolu, {}).zaman || 0) < 60000) return { hata: 'Yeni bağlantı için en az 1 dakika bekleyin.' };
  if (!hazirClient) jsonYaz(baglanmaYolu, { zaman: Date.now() });
  if (!sadeceTara) jsonYaz(path.join(veriKok(), 'son-istek.json'), { zaman: simdi });
  const eskiDurum = jsonOku(durumYolu(), {});
  const ilerleme = { ...(eskiDurum.sohbetler || {}) };
  const ilkBaslangic = simdi - gunSayisi * 86400;
  const bugunBaslangic = dayStart(simdi);
  const sohbetBaslangici = () => Math.min(ilkBaslangic, bugunBaslangic - 1);
  const rapor = { baslangic: simdi, gun: gunSayisi, gecmis, sadeceTara, gruplar: [], alinamayanMedya: [], sonuc: 'devam' };
  const sayac = { indirilen: 0, yinelenen: 0, atlanan: 0, hata: 0 };
  const dizin = dizinOku();
  const mevcutAdlar = new Set(arsivListele(Infinity).flatMap(g => g.dosyalar.map(d => d.ad)));
  const mevcutKayitlar = Object.entries(dizin).filter(([ad]) => mevcutAdlar.has(ad));
  const hashHaritasi = new Map(mevcutKayitlar.map(([ad, k]) => [k.hash, ad]));
  const silinenYolu = path.join(veriKok(), 'silinen-mesajlar.json');
  const silinen = jsonOku(silinenYolu, {});
  const islenenMesajlar = new Set(mevcutKayitlar.flatMap(([, k]) => [k.mesajKimligi, ...(k.mesajKimlikleri || [])]).filter(Boolean));
  let silinenSecimi;
  const kuyruk = [];

  canliDurum = null;
  baglantiDurumu = 'Bağlanıyor';
  yolla('durum', { metin: 'WhatsApp açılıyor' });

  const mevcutClient = hazirIstemiAl();
  const client = mevcutClient || new Client(istemciSecenekleri());
  const tani = observeConnection(client, path.join(veriKok(), 'baglanti-tanisi.json'), bilgi => yolla('durum', bilgi), !!mevcutClient);
  const i = { client, iptal: false };
  islem = i;
  calisiyor = true;
  let tamamlandi = false;
  let sure;
  const bitir = async () => {
    if (tamamlandi) return;
    tamamlandi = true;
    clearTimeout(sure);
    await tani.finish(i.iptal ? 'iptal' : sayac.hata ? 'hata' : 'bitti', rapor.neden);
    rapor.baglantiAsamasi = tani.state.asama;
    if (i.basladi && !i.iptal && !kapaniyor) {
      client.removeAllListeners(); hazirClient = client;
      client.once('disconnected', () => { if (hazirClient === client) { hazirClient = null; baglantiDurumu = 'Bağlantı kapalı'; void client.destroy().catch(() => {}); } });
    } else { try { await client.destroy(); } catch (e) {} }
    if (islem === i) { islem = null; calisiyor = false; }
    baglantiDurumu = hazirClient ? 'Bağlı' : 'Bağlantı kapalı';
    rapor.sonuc = i.iptal ? 'iptal' : (sayac.hata || sayac.atlanan) ? 'eksik' : 'bitti';
    try { jsonYaz(raporYolu(), rapor); } catch (e) { hataYaz('rapor', e); }
    yolla('bitti', { ...sayac, rapor });
    if (SESSIZ && !pencere) app.quit();
  };
  const baslatmaHatasi = async (err) => {
    if (tamamlandi) return;
    sayac.hata++;
    rapor.neden = errorText(err);
    yolla('hata', 'Bağlantı kurulamadı: ' + hataYaz('initialize', err));
    await bitir();
  };
  i.reject = (err) => { if (!i.basladi) void baslatmaHatasi(err); };


  client.on('qr', async (qr) => {
    jsonYaz(path.join(veriKok(), 'senkronizasyon-onayi.json'), { tamam: false });
    baglantiDurumu = 'QR bekleniyor';
    yolla('durum', { metin: 'QR bekleniyor' });
    if (SESSIZ && !pencere) pencereAc();
    try { yolla('qr', await QRCode.toDataURL(qr, { margin: 1, width: 320 })); } catch (e) {}
  });

  client.on('authenticated', () => { eslesmeYaz(true); baglantiDurumu = 'Senkronize ediliyor'; yolla('qr', null); yolla('durum', { metin: 'Senkronize ediliyor' }); });
  client.on('loading_screen', (percent) => { yolla('durum', { metin: 'Senkronize ediliyor', ayrinti: 'WhatsApp yükleme bildirimi: ' + percent, yuklemeYuzdesi: Number(percent) }); });

  client.on('ready', async () => {
    try {
      const surum = await client.getWWebVersion();
      console.log('WhatsApp Web sürümü:', surum);
      console.log('whatsapp-web.js sürümü:', require('whatsapp-web.js/package.json').version);
    } catch (e) {}
  });
  client.on('auth_failure', (m) => void baslatmaHatasi(new Error('Eşleşme başarısız: ' + m)));
  client.on('disconnected', () => { i.iptal = true; i.reject(new Error('Bağlantı kesildi')); });

  client.once('ready', async () => {
    if (tamamlandi || i.iptal) return;
    i.basladi = true;
    baglantiDurumu = 'Bağlı';
    clearTimeout(sure);
    yolla('qr', null);
    yolla('durum', { metin: 'Senkronize ediliyor', ayrinti: 'Seçili grup hazırlanıyor' });

    try {
      await sohbetHazirliginiBekle(client, i, ayar.sadeceSuGruplar);
      await telefonOnayiniBekle(i);
      i.butce = budget();
      yolla('durum', { metin: 'Grup listesi alınıyor' });
      // WhatsApp Web'in ic yapisi kutuphaneden yeni oldugu icin getChatModel
      // bazi sohbetlerde cokuyor ve tek bir hata tum listeyi dusuruyor.
      // Yamayi bastan uygula: sorunlu sohbet sade modelle gecsin.
      if (client.pupPage) {
        await withTimeout(modeliSadelestir(client.pupPage, ayar.sadeceSuGruplar, ayar.bireyselSohbetlerDeIndir), LIMITS.timeout, 'Sohbet hazırlığı');
        await withTimeout(medyayiSadelestir(client.pupPage), LIMITS.timeout, 'Medya hazırlığı');
      }

      // Hatalı liste isteği otomatik tekrarlanmaz.
      kontrol(i);
      const sohbetler = await withTimeout(client.getChats(), LIMITS.timeout, 'Grup listesi');
      kontrol(i);

      if (!ayar.sadeceSuGruplar.length) gruplariYaz(
        sohbetler.filter((c) => c.isGroup)
          .map((c) => ({ ad: c.name, son: c.timestamp || 0 }))
          .sort((a, b) => b.son - a.son)
      );

      const gruplarToplam = sohbetler.filter((c) => c.isGroup).length;
      console.log('\n=== TARAMA ===');
      console.log('  toplam sohbet: ' + sohbetler.length + ' (grup: ' + gruplarToplam + ')');
      console.log('  baslangic zamani: ' + new Date((sonZaman ?? ilkBaslangic) * 1000).toLocaleString('tr-TR'));
      console.log('  secili grup suzgeci: ' +
        (ayar.sadeceSuGruplar.length ? ayar.sadeceSuGruplar.join(', ') : '(yok, hepsi)'));

      const elenen = { grupDegil: 0, suzgec: 0, eski: 0 };

      const hedefler = sohbetler.filter((c) => {
        if (!c.isGroup && !ayar.bireyselSohbetlerDeIndir) { elenen.grupDegil++; return false; }
        if (c.isGroup && ayar.sadeceSuGruplar.length > 0 &&
            !ayar.sadeceSuGruplar.includes(c.name)) { elenen.suzgec++; return false; }
        if (c.timestamp && c.timestamp < sohbetBaslangici(c)) { elenen.eski++; return false; }
        return true;
      });

      console.log('  elenen -> grup degil: ' + elenen.grupDegil +
        ', suzgec: ' + elenen.suzgec + ', baslangictan eski: ' + elenen.eski);
      rapor.toplamGrup = hedefler.length;
      if (!hedefler.length) rapor.neden = 'Seçili aralıkta taranacak sohbet bulunamadı; geçmiş erişimi doğrulanmadı.';
      console.log('  taranacak sohbet: ' + hedefler.length);
      if (hedefler.length) {
        console.log('  ilk 5: ' + hedefler.slice(0, 5).map((c) => c.name).join(' | '));
      }
      console.log('=== TARAMA SONU ===\n');

      let islenen = 0;

      for (const chat of hedefler) {
        kontrol(i);
        const baslangic = sohbetBaslangici(chat);
        let sohbetHatasi = false;
        islenen++;
        yolla('durum', { metin: 'Gruplar taranıyor', ayrinti: chat.name, grup: islenen, toplamGrup: hedefler.length });

        let paket = { tum: [], medyalar: [] };
        try {
          paket = await scanMessages({ fetchMessages: async options => {
            kontrol(i); i.butce.request();
            await bekle(LIMITS.pause); kontrol(i);
            return withTimeout(chat.fetchMessages(options), LIMITS.timeout, 'Mesaj taraması');
          } }, baslangic, simdi, Math.min(LIMITS.messages, Math.max(25, Number(ayar.taramaTavani) || 5000)), bekle, () => kontrol(i), bilgi => {
            yolla('durum', { metin: 'Gruplar taranıyor', ayrinti: chat.name, grup: islenen, toplamGrup: hedefler.length, ...bilgi });
          });
          rapor.gruplar.push({ ad: chat.name, ...paket.erisim });
          if (!paket.tamam) {
            sohbetHatasi = true;
            sayac.hata++;
            yolla('hata', chat.name + ': Kontrollü tarama sınırına ulaşıldı. Erişim raporunu kontrol edin.');
          }
        } catch (e) {
          kontrol(i);
          if (!sadeceTara && !gecmis) { ilerleme[chat.id._serialized] = ilerleme[chat.id._serialized] ?? sonZaman ?? baslangic; sonZamanYaz(sonZaman ?? ilkBaslangic, ilerleme); }
          rapor.gruplar.push({ ad: chat.name, durum: 'hata', istenen: baslangic, enEski: null, neden: e.message });
          throw e; // Aynı hata üzerinde yeni WhatsApp istekleri başlatma.
        }

        console.log('  ' + chat.name + ': ' + paket.tum.length + ' mesaj yuklendi, ' +
          paket.medyalar.length + ' yeni medya');

        kuyruk.push({ chat, paket, islenen });
      }

      kontrol(i);
      const eksikler = missingDays(kuyruk.flatMap(({ paket }) => paket.medyalar), islenenMesajlar, silinen, bugunBaslangic, ayar.videolariDaIndir);
      rapor.eksikGunler = eksikler;
      let gecmisOnay = gecmis;
      if (!gecmis && !sadeceTara && eksikler.length) {
        yolla('durum', { metin: 'Onay bekleniyor', ayrinti: 'Geçmişteki eksik görseller' });
        const { response } = await dialog.showMessageBox(pencere, { type: 'question', buttons: ['Hayır', 'Evet'], defaultId: 0, cancelId: 0,
          message: 'Geçmişteki eksik görseller de indirilsin mi?',
          detail: eksikler.map(x => `${x.gun}: ${x.adet} görsel indirilmemiş`).join('\n') + '\nBu sayılar yalnızca erişilebilen mesajları kapsar. Silinen görseller ayrıca sorulacak.' });
        kontrol(i); gecmisOnay = response === 1;
      }
      for (const item of kuyruk) {
        const { chat, paket, islenen } = item;
        const baslangic = sohbetBaslangici(chat);
        let sohbetHatasi = !paket.tamam;
        let notHaritasi = null;

        for (const msg of paket.medyalar) {
          kontrol(i);
          const kimlik = mesajKimligi(msg);
          // Even with content deduplication disabled, a retry must not save the same message twice.
          if (kimlik && islenenMesajlar.has(kimlik)) continue;
          if (!eligibleMedia(msg, ayar.videolariDaIndir)) continue;
          const onceSilindi = kimlik && silinen[kimlik];
          if (onceSilindi) {
            let cevap = silinenSecimi;
            if (cevap === undefined && onceSilindi.tekrarEkle !== true) {
              yolla('durum', { metin: 'Onay bekleniyor', ayrinti: 'Daha önce silinen görsel' });
              const soru = await dialog.showMessageBox(pencere, { type: 'question', buttons: ['Hayır', 'Evet'], defaultId: 0, cancelId: 0,
                message: 'Bu görseli daha önce silmiştiniz. Tekrar eklensin mi?',
                detail: new Date(msg.timestamp * 1000).toLocaleString('tr-TR') + '\n' + (onceSilindi.ad || 'Görsel') + '\nTarama sırasında verilen izin indirmeyi başlatmaz.',
                checkboxLabel: 'Seçimi bu işlemdeki tüm silinmiş görsellere uygula', checkboxChecked: false });
              kontrol(i); cevap = soru.response === 1;
              if (soru.checkboxChecked) silinenSecimi = cevap;
            }
            if (cevap === undefined) cevap = true;
            silinen[kimlik] = { ...onceSilindi, tekrarEkle: cevap };
            jsonYaz(silinenYolu, silinen);
            if (!cevap) continue;
          }
          if (sadeceTara) continue;
          if (!gecmis && msg.timestamp < bugunBaslangic && !gecmisOnay && !onceSilindi) continue;
          if (!notHaritasi) notHaritasi = ayar.yakinMesajlariAl ? await notlariEslestir(paket.medyalar, paket.tum, ayar.notPenceresiSaniye, i) : new Map();
          i.butce.media();
          await bekle(LIMITS.pause); kontrol(i);
          yolla('durum', { metin: 'Fotoğraflar indiriliyor', ayrinti: chat.name, grup: islenen, toplamGrup: hedefler.length, indirilen: sayac.indirilen, medya: paket.medyalar.length });
          let media = null;
          let indirmeHatasi = null;

          if (kimlik && client.pupPage) {
            try {
              media = await withTimeout(medyaIndir(client.pupPage, kimlik), LIMITS.timeout, 'Medya indirme');
            } catch (e) { indirmeHatasi = e; }
          }

          else {
            try {
              media = await withTimeout(msg.downloadMedia(), LIMITS.timeout, 'Medya indirme');
              indirmeHatasi = null;
            } catch (e) { indirmeHatasi = indirmeHatasi || e; }
          }

          kontrol(i);
          const eksigiKaydet = neden => rapor.alinamayanMedya.push({
            grup: chat.name, tur: msg.type || 'bilinmiyor', zaman: msg.timestamp || null,
            mesajKimligi: kimlik || null, neden,
          });
          if (indirmeHatasi?.message?.includes('yanıt süresi aşıldı')) {
            eksigiKaydet(indirmeHatasi.message);
            throw indirmeHatasi;
          }
          if (!media && indirmeHatasi) {
            eksigiKaydet(indirmeHatasi.message || String(indirmeHatasi));
            i.butce.failed();
            const e = indirmeHatasi;
            sohbetHatasi = true;
            sayac.hata++;
            console.log('    ! indirilemedi: ' + ((e && e.message) || e));

            continue;
          }
          if (!media || !media.mimetype) {
            eksigiKaydet(!media ? 'İndirme boş sonuç döndürdü. Dosyanın neden erişilemediği doğrulanamadı.' : 'İndirme sonucunda dosya türü bulunamadı.');
            i.butce.failed();
            sohbetHatasi = true;
            sayac.atlanan++;
            console.log('    - bos dondu (sunucuda suresi dolmus olabilir)');
            continue;
          }

          i.butce.succeeded();
          const resimMi = media.mimetype.startsWith('image/');
          const videoMu = media.mimetype.startsWith('video/');
          if (!resimMi && !(videoMu && ayar.videolariDaIndir)) {
            console.log('    . atlandi (tur: ' + media.mimetype + ')');
            continue;
          }

          kontrol(i);
          const tampon = Buffer.from(media.data, 'base64');
          i.butce.bytes(tampon.length);
          const hash = crypto.createHash('sha1').update(tampon).digest('hex');

          if (!onceSilindi && ayar.yinelenenleriAtla && hashHaritasi.has(hash)) {
            const varolan = hashHaritasi.get(hash);
            const kayit = dizin[varolan];
            if (kayit && !kayit.gruplar.includes(chat.name)) {
              kayit.gruplar.push(chat.name);
              dizinYaz(dizin);
              yolla('yinelenen', { ad: varolan, grup: chat.name });
            }
            if (kayit && kimlik) { kayit.mesajKimlikleri = [...new Set([...(kayit.mesajKimlikleri || []), kimlik])]; islenenMesajlar.add(kimlik); dizinYaz(dizin); }
            sayac.yinelenen++;
            console.log('    = yinelenen, atlandi');
            await bekle(120);
            continue;
          }

          const { yil, ay, gunTR, klasor, saat } = tarihParcala(msg.timestamp);
          const grupAdi = temizle(chat.name);

          const gunKlasoru = path.join(ayar.hedefKlasor, yil, ay, gunTR);
          const hedefKlasor = path.join(gunKlasoru, grupAdi);
          fs.mkdirSync(hedefKlasor, { recursive: true });

          const uzanti = UZANTILAR[media.mimetype] || path.extname(media.filename || '') || '.bin';
          const tamYol = cakismayanYol(hedefKlasor, `${klasor}_${saat}_${grupAdi}`, uzanti);
          fs.writeFileSync(tamYol, tampon);

          const ad = path.basename(tamYol);
          const gonderen = await gonderenAdi(msg, i);
          const kucuk = resimMi ? kucukUretTampon(tampon, klasor, ad) : null;
          const aciklama = (msg.body || '').trim();
          const notlar = (notHaritasi.get(kimlik || '') || [])
            .map((n) => n.metin);

          if (aciklama || notlar.length) {
            aciklamaKaydet(gunKlasoru, [
              ad, gonderen || '', chat.name, saat.replace(/-/g, ':'),
              aciklama, notlar.join(' | '),
            ]);
          }

          dizin[ad] = {
            hash, mesajKimligi: kimlik, grup: chat.name, gonderen, aciklama, notlar,
            zaman: msg.timestamp, gruplar: [chat.name],
          };
          hashHaritasi.set(hash, ad);
          if (kimlik) islenenMesajlar.add(kimlik);
          dizinYaz(dizin);
          if (kimlik && silinen[kimlik]) { delete silinen[kimlik]; jsonYaz(silinenYolu, silinen); }

          sayac.indirilen++;
          console.log('    + ' + ad);
          yolla('dosya', { gun: klasor, ad, yol: tamYol, kucuk, grup: chat.name, gonderen, aciklama, notlar });
          await bekle(LIMITS.pause);
        }
        kontrol(i);
        if (!sadeceTara && !gecmis && !sohbetHatasi) ilerleme[chat.id._serialized] = simdi - 1;
        // Checkpoint each successful conversation. Failed conversations retain their old boundary.
        else if (!sadeceTara && !gecmis && !(chat.id._serialized in ilerleme)) ilerleme[chat.id._serialized] = sonZaman ?? baslangic;
        if (!sadeceTara && !gecmis) sonZamanYaz(sonZaman ?? ilkBaslangic, ilerleme);
      }

      kontrol(i);
      if (!sadeceTara && !gecmis) sonZamanYaz(simdi - 1, ilerleme);
      else if (!sadeceTara) jsonYaz(path.join(veriKok(), 'son-gecmis-tarama.json'), { zaman: simdi });
      console.log('\n=== BITTI ===');
      console.log('  indirilen: ' + sayac.indirilen + ', yinelenen: ' + sayac.yinelenen +
        ', atlanan: ' + sayac.atlanan + ', hata: ' + sayac.hata);
      console.log('=== BITTI SONU ===\n');

    } catch (err) {
      sayac.hata++;
      const mesaj = hataYaz('toplama', err);
      rapor.neden = mesaj;
      yolla('hata', 'Toplama tamamlanamadı: ' + mesaj + '. Tamamlanmayan gruplar yeniden taranacak.');

    } finally {
      await bitir();
    }
  });

  if (mevcutClient) {
    client.emit('ready');
  } else {
    try { client.initialize().catch(baslatmaHatasi); } catch (err) { await baslatmaHatasi(err); }
  }

  return { tamam: true };
}

// ---------------- IPC ----------------

const SIMGE_B64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAFtklEQVR4nM2Xb3CURx3HP7v73CXk7loSc3fJmdJKR0hCuGACb1AnMVrHzggJR5OOxU5BbH0RMkz/WNoZyyVtZ9qRoiMpLTIWnIFICAoSprTQqpPO2BdgdITrpTaighJ7ubSZkqSQu2ef9cUd0dqQSzrF+nv57J/v59n97Xf3Bx8lolE5q2/XIURzc48CWNr07Deq1+w8Xt2086XqNc+uA8i2iesmXlcXtQCq13S2L16734RWHTChVT8zi9d2mfCazicAsn1mDTHbjqKuLqr6+jrsmsiO6KhT3H6r+6/2xgW/FQLDngufN4OphVaRfOeJ/sNtW+vqolZfX4cGTK6JZ7NvU+LLIzuiI9rfvqxgwN67bL/6+5Uidf5ysXrhc12q1vOGndTFj9VGOh/v6+uw6+qis9qOXB0+ID6s/e01ngH7+fBB9Wh8tTiWqALg9mCcbZVHzKazLfr0eJXlV8lZr8RMANOK7wp3q4fjTeKVZDmBvDEAhid9NBS/xfYlh03rHCGuBZBb3D1G2igALKFJpj4axHQ5MCdxANso/O4xfj2yiAffiIidS3vUCm/MTmp/zpz47w8zir+aLMefN0baUR8aaACX1CQnvXypeJBnlhyeVU6IXOLPh7vVI/Em8epIOYXWOGnzYfEPQAjNqO2hvniQZypzQ4jZiL88nBGf5zJTAwzgZP9DisxEBtAOpLRg1PbylcBbOSEEZCz00KEWXZM951eXfUu8SZxMluPPG2frFy6ysuw9UlqAyYh68zIE45MCx4CloKjA4cS5+bS/FprxdNDcozjUogXRqKSjw6lu/FH7JeGPLisYsJ8L96gt8Ubxq5HFeMQE5QGHo/cMYxyJY0BZYBzBa+cyifjFWzXSckiMSo7F3axffpk7uwPE/imZMB7qP5XJibazzbp/YonlM8knzxzd/BjRqBQA4cadd6asG7vL1AV7z7J9auubXxcnkhUE88e4dEURLoOD9yq0BqVg9H3Dxp/avHvFBcD8/DT77rUYfk/w0C8Ee+82tHVrTv0N5udrEpM+vuz/E09V9JqNf1inz+vPWK706DdjvZu6ssdQf+tSynI2LnidnqFacSxRRTDvErajwBiQLpSvBOErwR0I8YPf5FPgKaCvo4S+jhK83gK+fzKfiqoQL343QKC0lDQuBAbbKIJ5Y7yUqKTrHyvEt29+nbGUdKR0NgBY10jo/zgkDkgXwhdCagPzFGcvJmlb/WlcwSAAG76aT2fvRUx+iJSjcbskQr0LTJLrusm2qj03uG35woWVtIT6zapgjMTkDVhSZ1fAQvhC4C2FwpuoqQiw+0SCy8LPZeFn94kENRUBROFN4C1F+EpBusAYLJnZgtuDcdaVnTY/Ob8Sn9uRjiP3ZgCiUXnmaOvBPPudjnOpW6zNsTv0U5W95jb/myQnfVjCBuXCeIJIbwlaFvHAhnqENY/6+45Tf99xhDWPBzbUo2URyhfEKQiCdOES9pRFb6s8Yu6PRfRgaqGVZ488Gevd1DX1irr6yqmJ7IguaDxgmu7amn776UXO+vVbTGHDbhNp22emi/74kOmPD03bdsfm/aaw4cfm7nseNW8/vchZu+576QWN3aY20vl4RjSjOaMR7QofVA/HG8XJ4cXsenAFy5fejGMyZiSEwFPgBmDi/RTGGAwgheT3sfN8Z/spGooH2V51xLSeaZ7ZiHJBPBRbLV4c+iwLC1PY2UvIYDBZKxRSILL/YgnNX0bdfK30HD8M/9K0/rFZn57IbcU5IR4ZaBIvJxbhd4+TNnLKeq9OkrkHHJIpL7cF/8y2ysM5xacDmAGiW20ZaBKvDGesOe1IRHa0MSJzE6a8NBRn/L/1TEtO8WsBzAjxcT9I/m+fZDNC/K8epdeEqPXE7R1VP1cHhmqFMYK7yn5n7o9F9KnxKsuvRuZUG3zihclc4rqUZnOG+CSL03/Hx1ie/wvonyEcW5E4fAAAAABJRU5ErkJggg==';

ipcMain.handle('durum-al', () => ({ ayar: ayarOku(), sonZaman: sonZamanOku(), calisiyor, canliDurum, baglantiDurumu, bagli: !!hazirClient, eslesmeKayitli: eslesmeVar(), rapor: jsonOku(raporYolu(), null) }));
ipcMain.handle('gruplar-al', () => gruplariOku());
ipcMain.handle('gecmis-kontrol', (_e, taslak) => toplamayiBaslat(false, true, true, { ilkCalismaGunSayisi: days(taslak.ilkCalismaGunSayisi), sadeceSuGruplar: taslak.sadeceSuGruplar }));
ipcMain.handle('gecmis-indir', (_e, taslak) => toplamayiBaslat(false, true, false, { ilkCalismaGunSayisi: days(taslak.ilkCalismaGunSayisi), sadeceSuGruplar: taslak.sadeceSuGruplar }));
ipcMain.handle('topla', (_e, zorla, gecmis) => toplamayiBaslat(!!zorla, !!gecmis));

ipcMain.handle('durdur', async () => {
  await islemiDurdur();
  return true;
});

ipcMain.handle('degisiklik-sor', async () => (await dialog.showMessageBox(pencere, { type: 'question', message: 'Değişiklikler kaydedilsin mi?', buttons: ['Evet', 'Hayır'], defaultId: 0, cancelId: 1 })).response === 0);
ipcMain.handle('ayar-kaydet', (_e, yeni) => {
  const b = { ...ayarOku(), ...yeni };
  b.ilkCalismaGunSayisi = days(b.ilkCalismaGunSayisi);
  ayarYaz(b);
  if (typeof yeni.otomatikCalistir === 'boolean') {
    app.setLoginItemSettings({
      openAtLogin: yeni.otomatikCalistir,
      ...(process.platform === 'darwin' ? {} : { args: [] }),
    });
  }
  return b;
});

function arsivListele(gunSayisi = 60) {
  const ayar = ayarOku();
  const kok = ayar.hedefKlasor;
  if (!fs.existsSync(kok)) return [];

  const dizin = dizinOku();
  const gunKalibi = /^\d{2}\.\d{2}\.\d{4}$/;
  const gunler = new Map(); // iso -> dosya listesi

  // 2026 / Eylül / 20.09.2026 / Grup / dosya  yapisini gezer.
  // Eski duz yapiyi (2026-09-20/...) da tanir.
  const gez = (dizinYol, gunIsoDegeri, grupAdi, derinlik) => {
    if (derinlik > 6) return;
    let girdiler = [];
    try { girdiler = fs.readdirSync(dizinYol, { withFileTypes: true }); } catch (e) { return; }

    for (const g of girdiler) {
      const tam = path.join(dizinYol, g.name);

      if (g.isDirectory()) {
        if (gunKalibi.test(g.name)) gez(tam, gunIso(g.name), null, derinlik + 1);
        else if (/^\d{4}-\d{2}-\d{2}$/.test(g.name)) gez(tam, g.name, null, derinlik + 1);
        else gez(tam, gunIsoDegeri, gunIsoDegeri ? g.name : null, derinlik + 1);
        continue;
      }

      if (!GORSEL.test(g.name)) continue;

      // gun bilinmiyorsa dosya adinin basindaki tarihten cikar
      let iso = gunIsoDegeri;
      if (!iso) {
        const e = g.name.match(/^(\d{4}-\d{2}-\d{2})_/);
        if (e) iso = e[1];
      }
      if (!iso) continue;

      const ust = dizin[g.name] || {};
      const kYol = kucukYolu(iso, g.name);

      if (!gunler.has(iso)) gunler.set(iso, []);
      gunler.get(iso).push({
        ad: g.name,
        yol: tam,
        kucuk: fs.existsSync(kYol) ? kYol : null,
        grup: ust.grup || grupAdi || null,
        gonderen: ust.gonderen || null,
        aciklama: ust.aciklama || null,
        notlar: ust.notlar || [],
        gruplar: ust.gruplar || [],
      });
    }
  };

  gez(kok, null, null, 0);

  return [...gunler.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, gunSayisi)
    .map(([gun, dosyalar]) => ({
      gun,
      dosyalar: dosyalar.sort((a, b) => b.ad.localeCompare(a.ad)),
    }));
}
ipcMain.handle('arsiv-al', (_e, gunSayisi) => arsivListele(gunSayisi));

ipcMain.handle('kucuk-uret', (_e, { yol, gun, ad }) => kucukUret(yol, gun, ad));

ipcMain.handle('klasor-sec', async () => {
  const s = await dialog.showOpenDialog(pencere, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Fotoğrafların kaydedileceği klasör',
  });
  if (s.canceled || !s.filePaths[0]) return null;
  const ayar = ayarOku();
  return s.filePaths[0]; // Seçim taslaktır; kullanıcı kaydederse uygulanır.
});

ipcMain.handle('klasor-ac', () => {
  const ayar = ayarOku();
  fs.mkdirSync(ayar.hedefKlasor, { recursive: true });
  shell.openPath(ayar.hedefKlasor);
});

ipcMain.handle('dosya-goster', (_e, yol) => shell.showItemInFolder(yol));

async function yerelFotografSil(yol, onayli = false, kilitli = false) {
  if (calisiyor || (yerelSilme && !kilitli)) throw new Error('Önce çalışan işlemi durdurun');
  const kok = fs.realpathSync(ayarOku().hedefKlasor);
  if (fs.lstatSync(yol).isSymbolicLink()) throw new Error('Sembolik bağlantı silinemez');
  const tam = fs.realpathSync(yol);
  const rel = path.relative(kok, tam);
  if (!rel || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel) || !GORSEL.test(tam) || !fs.statSync(tam).isFile()) throw new Error('Yalnızca arşiv klasöründeki fotoğraflar silinebilir');
  const { response } = onayli ? { response: 1 } : await dialog.showMessageBox(pencere, { type: 'warning', buttons: ['Vazgeç', 'Sil'], defaultId: 0, cancelId: 0,
    message: 'Bu fotoğraf silinsin mi?', detail: path.basename(tam) + '\nYerel arşivden kaldırılıp Çöp Kutusu’na taşınacak. WhatsApp ve telefon değişmeyecek.' });
  if (response !== 1) return { silindi: false };
  if (calisiyor || (yerelSilme && !kilitli)) throw new Error('Önce çalışan işlemi durdurun');
  // Revalidate after confirmation to prevent a replaced path escaping the archive.
  if (fs.realpathSync(yol) !== tam) throw new Error('Dosya yolu değişti; silme iptal edildi');
  const dizin = dizinOku(), ad = path.basename(tam), kayit = dizin[ad];
  const eskiDizin = { ...dizin };
  const silinenYolu = path.join(veriKok(), 'silinen-mesajlar.json');
  const silinen = jsonOku(silinenYolu, {}), eskiSilinen = { ...silinen };
  for (const kimlik of [kayit?.mesajKimligi, ...(kayit?.mesajKimlikleri || [])].filter(Boolean)) silinen[kimlik] = { zaman: kayit.zaman, ad, tekrarEkle: false };
  delete dizin[ad];
  yerelSilme = true;
  try {
  try {
    dizinYaz(dizin); jsonYaz(silinenYolu, silinen);
    await shell.trashItem(tam);
  } catch (e) { dizinYaz(eskiDizin); jsonYaz(silinenYolu, eskiSilinen); throw e; }
  if (fs.existsSync(kucukKok())) {
    for (const gun of fs.readdirSync(kucukKok())) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(gun)) continue;
      const cache = kucukYolu(gun, ad);
      if (fs.existsSync(cache)) {
        const cacheRel = path.relative(fs.realpathSync(kucukKok()), fs.realpathSync(cache));
        if (!cacheRel.startsWith('..' + path.sep) && !path.isAbsolute(cacheRel) && cacheRel !== '..') fs.rmSync(cache, { force: true });
      }
    }
  }
  return { silindi: true };
  } finally { if (!kilitli) yerelSilme = false; }
}

ipcMain.handle('fotograf-sil', (_e, yol) => yerelFotografSil(yol));
ipcMain.handle('gun-sil', async (_e, gun) => {
  if (calisiyor || yerelSilme) throw new Error('Önce çalışan işlemi durdurun');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gun)) throw new Error('Geçersiz tarih');
  const { response } = await dialog.showMessageBox(pencere, { type: 'warning', buttons: ['Hayır', 'Evet'], defaultId: 0, cancelId: 0,
    message: 'Bu tarihe ait tüm indirilen görseller silinsin mi?', detail: gun + '\nYerel dosyalar Çöp Kutusu’na taşınacak; önizleme ve arşiv kayıtları kaldırılacak. WhatsApp değişmeyecek.' });
  if (response !== 1) return { silindi: false };
  const dosyalar = arsivListele(Infinity).find(x => x.gun === gun)?.dosyalar || [];
  if (calisiyor || yerelSilme) throw new Error('Önce çalışan işlemi durdurun');
  let adet = 0; yerelSilme = true;
  try {
    for (const dosya of dosyalar) { await yerelFotografSil(dosya.yol, true, true); adet++; }
    return { silindi: true, adet };
  } catch (e) { throw new Error(`${adet} görsel silindi; kalan dosyalar korunuyor. ${e.message}`); }
  finally { yerelSilme = false; }
});

ipcMain.handle('gecmisi-sifirla', () => {
  if (calisiyor || yerelSilme) throw new Error('Önce çalışan işlemi durdurun');
  fs.rmSync(durumYolu(), { force: true });
  return true;
});

ipcMain.handle('veri-klasoru-ac', () => shell.openPath(veriKok()));

function eslesmeVar() { return !!jsonOku(path.join(veriKok(), 'eslesme-durumu.json'), {}).giris; }
function eslesmeYaz(giris) { jsonYaz(path.join(veriKok(), 'eslesme-durumu.json'), { giris }); }

// Kullanıcının çıkış isteği: kayıtlı oturumu bir kez aç, QR ile yeniden giriş yapma.
async function cikisIstemcisi() {
  const client = new Client(istemciSecenekleri());
  try {
    await new Promise((resolve, reject) => {
      client.once('ready', resolve);
      client.once('qr', () => reject(new Error('Kayıtlı oturum kullanılamıyor; telefondaki Bağlı Cihazlar’dan çıkış yapın')));
      client.once('auth_failure', () => reject(new Error('Kayıtlı eşleşme doğrulanamadı')));
      client.once('disconnected', () => reject(new Error('Bağlantı kesildi')));
      client.initialize().catch(reject);
    });
    return client;
  } catch (e) { try { await client.destroy(); } catch (_) {} throw e; }
}

async function whatsappCikis() {
  if (calisiyor || yerelSilme) return { hata: 'Önce çalışan işlemi durdurun' };
  if (!hazirClient && !eslesmeVar()) return { hata: 'Gerçek çıkış için kayıtlı bir eşleşme gerekiyor. Yerel eşleşme silinmedi.' };
  const { response } = await dialog.showMessageBox(pencere, { type: 'question', buttons: ['Hayır', 'Evet'], defaultId: 0, cancelId: 0,
    message: 'WhatsApp’tan çıkış yapılsın mı?', detail: 'Bu uygulamanın WhatsApp oturumu kapatılacak. Fotoğraf arşivi korunacak.' });
  if (response !== 1) return { cikildi: false };
  if (calisiyor || yerelSilme) return { hata: 'Bağlantı durumu değişti; çıkış yapılmadı' };
  let client = hazirClient;
  calisiyor = true;
  try {
    if (!client) client = await cikisIstemcisi();
    await client.logout();
    eslesmeYaz(false);
    hazirClient = null; baglantiDurumu = 'Çıkış yapıldı';
    jsonYaz(path.join(veriKok(), 'senkronizasyon-onayi.json'), { tamam: false });
    gruplariYaz([]);
    return { cikildi: true };
  } catch (e) { if (client && client !== hazirClient) { try { await client.destroy(); } catch (_) {} } return { hata: 'WhatsApp çıkışı doğrulanamadı: ' + errorText(e) + '. Yerel oturum zorla silinmedi.' }; }
  finally { calisiyor = false; }
}
ipcMain.handle('whatsapp-cikis', whatsappCikis);
ipcMain.handle('oturum-sifirla', whatsappCikis);

async function baglanVeListele(sadeceBaglan = false) {
  if (calisiyor || yerelSilme) return { hata: 'Toplama sürüyor' };
  const baglanmaYolu = path.join(veriKok(), 'son-baglanti.json');
  const onceki = jsonOku(baglanmaYolu, {}).zaman || 0;
  if (!hazirClient && Date.now() - onceki < 60000) return { hata: 'Yeni bağlantı için en az 1 dakika bekleyin; otomatik tekrar yapılmadı.' };
  if (!hazirClient) jsonYaz(baglanmaYolu, { zaman: Date.now() });
  const mevcutClient = hazirIstemiAl();
  const gecici = mevcutClient || new Client(istemciSecenekleri());
  let listeAlindi = false;
  canliDurum = null;
  baglantiDurumu = 'Bağlanıyor';
  yolla('durum', { metin: 'WhatsApp açılıyor' });
  const tani = observeConnection(gecici, path.join(veriKok(), 'baglanti-tanisi.json'), bilgi => yolla('durum', bilgi), !!mevcutClient);
  let baglantiHatasi;
  const i = { client: gecici, iptal: false };
  islem = i;
  calisiyor = true;
  let sure;
  try {
    const liste = await new Promise((cozum, hata) => {
      i.reject = hata;

      gecici.on('auth_failure', m => hata(new Error('Eşleşme başarısız: ' + m)));
      gecici.on('disconnected', () => { i.iptal = true; hata(new Error('Bağlantı kesildi')); });
      gecici.on('loading_screen', percent => yolla('durum', { metin: 'Senkronize ediliyor', yuklemeYuzdesi: Number(percent) }));
      gecici.on('qr', async (qr) => {
        jsonYaz(path.join(veriKok(), 'senkronizasyon-onayi.json'), { tamam: false });
    baglantiDurumu = 'QR bekleniyor';
        yolla('durum', { metin: 'QR bekleniyor' });
        try { yolla('qr', await QRCode.toDataURL(qr, { margin: 1, width: 320 })); } catch (e) {}
      });
      gecici.on('authenticated', () => {
        eslesmeYaz(true);
        yolla('qr', null);
        baglantiDurumu = 'Senkronize ediliyor';
        yolla('durum', { metin: 'Senkronize ediliyor' });
      });

      gecici.once('ready', async () => {
        baglantiDurumu = 'Bağlı';
        yolla('qr', null);
        try {
          yolla('durum', { metin: sadeceBaglan ? 'Senkronize ediliyor' : 'Grup adları alınıyor', ayrinti: 'Grup listesi hazırlanıyor' });
          eslesmeYaz(true);
          if (gecici.pupPage) await withTimeout(modeliSadelestir(gecici.pupPage), LIMITS.timeout, 'Sohbet hazırlığı');
          const s = await withTimeout(gecici.getChats(), LIMITS.timeout, 'Grup listesi');
          const gruplar = s.filter(c => c.isGroup).map(c => ({ ad: c.name, son: c.timestamp || 0 })).sort((a,b) => b.son-a.son);
          gruplariYaz(gruplar);
          yolla('gruplar', gruplar);
          if (sadeceBaglan) {
            yolla('durum', { metin: 'Senkronize ediliyor', ayrinti: gruplar.length + ' grup listeye eklendi; senkronizasyon bekleniyor.' });
            await sohbetHazirliginiBekle(gecici, i, []);
            await telefonOnayiniBekle(i);
          }
          yolla('durum', { metin: gruplar.length + ' adet grup bulundu' });
          cozum(gruplar);
        } catch (e) { hata(e); }
      });
      if (mevcutClient) gecici.emit('ready');
      else gecici.initialize().catch(hata);
    });
    kontrol(i);
    if (!sadeceBaglan) gruplariYaz(liste);
    listeAlindi = true;
    return { liste, bagli: true };
  } catch (e) {
    yolla('qr', null);
    baglantiHatasi = e;
    return { hata: hataYaz('gruplari-getir', e) };
  } finally {
    yolla('qr', null);
    clearTimeout(sure);
    await tani.finish(i.iptal ? 'iptal' : listeAlindi ? 'bitti' : 'hata', baglantiHatasi);
    if ((listeAlindi || tani.state.sayfa?.kutuphaneHazir) && !i.iptal && !kapaniyor) {
      gecici.removeAllListeners();
      hazirClient = gecici;
      gecici.once('disconnected', () => {
        if (hazirClient === gecici) {
          hazirClient = null;
          baglantiDurumu = 'Bağlantı kapalı';
          void gecici.destroy().catch(() => {});
        }
      });
    } else {
      baglantiDurumu = 'Bağlantı kapalı';
      try { await gecici.destroy(); } catch (e) {}
    }
    if (islem === i) { islem = null; calisiyor = false; }
    canliDurum = null;
  }
}
ipcMain.handle('gruplari-getir', () => baglanVeListele(false));
ipcMain.handle('baglan', () => baglanVeListele(true));

// ---------------- pencere / tepsi ----------------

function pencereAc() {
  if (pencere && !pencere.isDestroyed()) { pencere.show(); return; }
  pencere = new BrowserWindow({
    width: 860, height: 700, minWidth: 620, minHeight: 520,
    backgroundColor: '#0C0E11', title: 'Archivo', autoHideMenuBar: true,
    icon: path.join(__dirname, process.platform === 'win32' ? 'simge.ico' : 'simge-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  pencere.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  pencere.webContents.on('will-navigate', e => e.preventDefault());
  pencere.loadFile(path.join(__dirname, 'index.html'));
  pencere.webContents.on('did-finish-load', () => {
    if (calisiyor) yolla('durum', { metin: 'İşlem sürüyor' });
  });
  pencere.on('closed', () => { pencere = null; });
}

function tepsiKur() {
  if (tepsi) return;
  // Tepsi simgesi gomulu PNG'den gelir: .ico okuma davranisi isletim
  // sistemine gore degisiyor, PNG her yerde ayni sekilde calisiyor.
  let simge = nativeImage.createFromBuffer(Buffer.from(SIMGE_B64, 'base64'));
  if (process.platform === 'darwin') simge = simge.resize({ width: 18, height: 18 });
  tepsi = new Tray(simge);
  tepsi.setToolTip('WhatsApp Foto Arşivi');
  tepsi.setContextMenu(Menu.buildFromTemplate([
    { label: 'Arşivi aç', click: () => pencereAc() },
    { type: 'separator' },
    { label: 'Çık', click: () => app.quit() },
  ]));
  tepsi.on('click', () => pencereAc());
}

app.whenReady().then(async () => {
  if (SMOKE) {
    try {
      pencereAc();
      await new Promise((resolve, reject) => {
        pencere.webContents.once('did-finish-load', resolve);
        pencere.webContents.once('did-fail-load', (_e, code, message) => reject(new Error(message)));
      });
      await bekle(2000);
      const dom = await pencere.webContents.executeJavaScript(`({ title: document.title, api: typeof window.api?.durumAl, buttons: document.querySelectorAll('button').length, text: document.getElementById('ozet').textContent, controls: ['gecmisGun','gecmisTara','baglanDugme','islemPanel','islemDurdur','erisimRaporu'].every(id => !!document.getElementById(id)) })`);
      const browser = tarayiciYolu();
      if (!browser) throw new Error('Gömülü tarayıcı bulunamadı');
      fs.mkdirSync(veriKok(), { recursive: true });
      fs.writeFileSync(path.join(veriKok(), 'smoke.png'), (await pencere.webContents.capturePage()).toPNG());
      jsonYaz(path.join(veriKok(), 'smoke.json'), { ...dom, browser, platform: process.platform, arch: process.arch });
      app.quit();
    } catch (err) { console.error(err); app.exit(1); }
    return;
  }
  tepsiKur();

  if (!SESSIZ) pencereAc(); // Açılışta otomatik indirme başlatılmaz.

});

app.on('window-all-closed', () => {
  // tepsi acikken calismaya devam eder
});

app.on('activate', () => pencereAc());

app.on('before-quit', e => {
  if (!kapaniyor && (islem || hazirClient)) {
    e.preventDefault();
    kapaniyor = true;
    islemiDurdur().finally(() => app.quit());
  }
});

app.on('second-instance', () => pencereAc());
if (!app.requestSingleInstanceLock()) app.quit();
