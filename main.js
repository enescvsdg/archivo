const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, Tray, Menu, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { readJson, writeJson, scanMessages, scanPaced } = require('./archive-state');
const { observeConnection, errorText } = require('./connection-diagnostics');
const { connectionConfig } = require('./connection-config');
const { dayStart, eligibleMedia, belgeResmi, missingDays, belgeTuru, mesajBelgesi, belgeEtiketi } = require('./collection-plan');
const { LIMITS, PACE, hizProfili, days, withTimeout, budget } = require('./operation-policy');
const tarayicilar = require('./browser-processes');
let canliDurum = null;
let baglantiDurumu = 'Bağlantı kapalı';
let islem = null;
let kapaniyor = false;
let yerelSilme = false;
// Cikis icin acilan gecici istemci; Durdur ve uygulama kapanisinda temizlenir.
let cikisClient = null, cikisReddet = null, cikisIptal = false, cikisCalisiyor = false;
// Grup yenilemeden Topla'ya aynı hazır tarayıcı ile geçilir.
let hazirClient = null;
function hazirIstemiAl() {
  const client = hazirClient;
  hazirClient = null;
  if (client) client.removeAllListeners();
  return client;
}
// Kopmus cerceve ("detached Frame") veya kapanmis sayfa yeniden kullanilirsa her islem ayni hatayla biter.
async function istemciSaglikli(client) {
  const page = client?.pupPage;
  if (!page) return true;
  let timer;
  try {
    if (page.isClosed?.() || page.mainFrame?.().detached) return false;
    await Promise.race([page.evaluate(() => true), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Sayfa yanıt vermiyor')), 5000); })]);
    return true;
  } catch (_) { return false; } finally { clearTimeout(timer); }
}
async function bozukHazirIstemciyiAt() {
  const client = hazirClient;
  if (!client || await istemciSaglikli(client) || hazirClient !== client) return;
  hazirClient = null;
  client.removeAllListeners();
  baglantiDurumu = 'Bağlantı kapalı';
  await istemciyiKapat(client);
}


function kontrol(i) {
  if (i.iptal) throw new Error('İşlem iptal edildi');
  if (i.butce) i.butce.check();
}

async function islemiDurdur() {
  // Cikis calisiyorsa: iptal isaretle, bekleyen cikisi reddet, gecici istemciyi kapat.
  if (cikisCalisiyor) {
    cikisIptal = true;
    cikisReddet?.(new Error('İşlem iptal edildi'));
    if (cikisClient) { try { await cikisClient.destroy(); } catch (e) {} }
  }
  const i = islem;
  if (!i) {
    const client = hazirIstemiAl();
    if (client) await istemciyiKapat(client);
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
// Gec ulasan mesajlar icin taramaya son toplama kaydindan 2 saat once baslanir.
const ORTUSME_SANIYE = 2 * 3600;
// Ayni fotograf bu kadar ayri Topla'da alinamazsa vazgecilir; kuyrugu tikamaz, raporda gorunur.
const ALINAMAYAN_DENEME = 3;

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
  pdfleriDaIndir: false,
  grubaGoreAltKlasor: false,
  ilkCalismaGunSayisi: 3,
  taramaTavani: LIMITS.messages,
  saydamlik: 13,
  yinelenenleriAtla: true,
  yakinMesajlariAl: true,
  notPenceresiSaniye: 150,
  otomatikCalistir: false,
  indirmeHizi: 'yavas',
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
  'application/pdf': '.pdf',
};

const GORSEL = /\.(jpe?g|png|webp|gif|heic)$/i;
// Arsivdeki tum dosya turleri (fotograf, video, PDF). Toplama "zaten indirildi" kontrolunu bunlarla yapar.
const ARSIV_DOSYASI = /\.(jpe?g|png|webp|gif|heic|mp4|mov|3gp|pdf)$/i;
// Belgenin kendi adi dosya adinin sonuna eklenir (ornegin ..._Grup_rapor.pdf); yasak karakterler temizlenir.
function belgeAdiParcasi(ad) {
  // Klasor ayiricilari dahil yasak karakterler temizle() ile '-' olur; ad hicbir zaman klasor disina yol gostermez.
  const kok = String(ad || '').replace(/\.[^.\\/]*$/, '');
  return kok ? temizle(kok).slice(0, 50) : '';
}
const ikiHane = (n) => String(n).padStart(2, '0');
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
// Insan hizi: rastgele bekleme. Durdur ve sure siniri her saniyede kontrol edilir (uzun molada bile hemen durur).
// bildir(kalanMs) verilirse her 15 saniyede bir cagrilir (arayuz uzun molada donmus gorunmesin).
async function insanBekle(aralik, i, bildir) {
  let kalan = aralik[0] + Math.random() * (aralik[1] - aralik[0]);
  for (let dilimNo = 0; kalan > 0; dilimNo++) {
    if (i) kontrol(i);
    if (bildir && dilimNo % 15 === 0) bildir(kalan);
    const dilim = Math.min(kalan, 1000);
    await bekle(dilim);
    kalan -= dilim;
  }
  if (i) kontrol(i);
}
// Sayfada sohbetin yuklu mesaj bilgisini verir; islem 'yukle' ise bir sayfa daha eski mesaj ister.
// Kutuphanenin fetchMessages'inin kullandigi ayni cagrilardir, ama sayfalar arasinda bekleme yapilir.
async function sohbetSayfasi(sayfa, chat, islem) {
  const sohbet = typeof chat.id === 'string' ? chat.id : chat.id?._serialized;
  return sayfa.evaluate(async ({ sohbet, islem }) => {
    const c = await window.WWebJS.getChat(sohbet, { getAsModel: false });
    let yeni = 0;
    if (islem === 'yukle') {
      const yuklenen = await window.require('WAWebChatLoadMessages').loadEarlierMsgs({ chat: c });
      yeni = yuklenen ? yuklenen.length : 0;
    }
    const liste = c.msgs.getModelsArray().filter(m => !m.isNotification);
    let enEski = null;
    for (const m of liste) if (typeof m.t === 'number' && (enEski === null || m.t < enEski)) enEski = m.t;
    return { toplam: liste.length, enEski, yeni };
  }, { sohbet, islem });
}
// WhatsApp Web sayfayi kendiliginden yenileyebilir; yenilenince window.WWebJS ve sayfaya taktigimiz yamalar silinir.
// Donus: false = sayfa su an yenileniyor (sorgu hata verdi), null = durum okunamadi, nesne = sayfa durumu.
async function sayfaDurumu(sayfa) {
  try {
    const d = await sayfa.evaluate(() => ({ wwebjs: !!window.WWebJS, req: typeof window.require === 'function', medya: typeof window.WWebJS?.resolveMediaBlob === 'function' }), { islem: 'hazirlik' });
    return d && typeof d === 'object' ? d : null;
  } catch (e) { return false; }
}
// Sayfa hazir olana kadar bekler ve silinen indirme yamasini yeniden uygular. Hazir olmazsa acik bir hatayla durur.
async function sayfaHazirla(sayfa, i) {
  for (let n = 0; n < 45; n++) {
    kontrol(i);
    const d = await sayfaDurumu(sayfa);
    if (d === null) return;
    if (d && d.wwebjs && d.req) { if (!d.medya) await medyayiSadelestir(sayfa); return; }
    await insanBekle([1000, 2000], i);
  }
  const hata = new Error('WhatsApp sayfası yenilendi ve hazır olmadı; işlem durduruldu');
  hata.sayfaYenilendi = true;
  throw hata;
}
// Islemi calistirir; sayfa yenilendiyse (hata sonrasi sayfa hazir degil ya da yama silinmis) bekleyip en fazla 2 kez yeniden dener.
// Sayfa saglamsa hata aynen yukari verilir.
async function sayfadaDene(sayfa, i, islem) {
  for (let deneme = 0; ; deneme++) {
    await sayfaHazirla(sayfa, i);
    try { return await islem(); }
    catch (e) {
      kontrol(i);
      const d = await sayfaDurumu(sayfa);
      const yenilendi = d === false || (d && (!d.wwebjs || !d.req || !d.medya));
      if (!yenilendi || deneme >= 2) throw e;
      await insanBekle([2000, 5000], i);
    }
  }
}
// Kutuphane 'ready'yi yalnizca WhatsApp Web'in change:hasSynced OLAYINDAN yayinlar. Sayfa yenilenip bu islem yarida kesilirse
// (ya da olay kacirilirse) WhatsApp "bagli ve senkron" dese bile hazir hic gelmez. Nobetci bunu yakalar ve kutuphanenin kendi
// hazir islemini (window.onAppStateHasSyncedEvent) yeniden tetikler. Donus: nobeti birakan fonksiyon.
function hazirBekcisi(client, kayit = () => {}) {
  let hazir = false, durdu = false, ardisik = 0, tetik = 0, zaman;
  const durdur = () => { durdu = true; clearTimeout(zaman); };
  client.once('ready', () => { hazir = true; durdur(); });
  const planla = () => { if (durdu || hazir) return; zaman = setTimeout(dongu, LIMITS.hazirBekciAraligi); zaman.unref?.(); };
  const dongu = async () => {
    if (durdu || hazir) return;
    try {
      const sayfa = client.pupPage;
      if (sayfa && !sayfa.isClosed?.()) {
        const d = await sayfa.evaluate(() => ({ durum: window.AuthStore?.AppState?.state, senkron: window.AuthStore?.AppState?.hasSynced, fn: typeof window.onAppStateHasSyncedEvent }), { islem: 'hazirlik-bekcisi' });
        if (!durdu && !hazir) {
          ardisik = d && d.durum === 'CONNECTED' && d.senkron === true && d.fn === 'function' ? ardisik + 1 : 0;
          if (ardisik >= 3) {
            ardisik = 0; tetik++;
            kayit('hazir-tetiklendi');
            await sayfa.evaluate(() => window.onAppStateHasSyncedEvent(), { islem: 'hazir-tetikle' });
            if (tetik >= 5 && !hazir) { kayit('hazir-tetiklenemedi'); durdur(); }
          }
        }
      }
    } catch (e) { ardisik = 0; }
    finally { planla(); }
  };
  planla();
  return durdur;
}

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

// WhatsApp'in kapaliyken gelen mesaj sayaci takilabiliyor: yonetici "COMPLETE" dese bile 11/12 = %92'de kalip hic %100 olmuyor
// (canli testte 6 dk boyunca %92'de kaldi). Bu yuzden sayac 45 sn kipirdamazsa ya da toplam bekleme 5 dk'yi asarsa devam edilir;
// neden tani kaydina yazilir. Sonraki Topla son toplamadan 2 saat geri taradigi icin gec gelen mesaj yine yakalanir.
async function sohbetHazirliginiBekle(client, i, secili = [], kayit = () => {}) {
  if (!client.pupPage) return;
  const adim = 2000;
  const durguTur = Math.ceil(LIMITS.hazirlikDurguSaniye * 1000 / adim);
  const kisaDurguTur = Math.ceil(LIMITS.hazirlikKisaDurguSaniye * 1000 / adim);
  const ustTur = Math.ceil(LIMITS.hazirlikUstSaniye * 1000 / adim);
  let tur = 0, durgun = 0, son = null, beklendi = false, sonuc = 'hazir';
  while (true) {
    kontrol(i);
    const d = await client.pupPage.evaluate(secim => {
      const chats = window.require('WAWebCollections').Chat.getModelsArray();
      const socket = window.AuthStore?.AppState;
      const progress = window.AuthStore?.OfflineMessageHandler?.getOfflineDeliveryProgress?.();
      if (socket?.hasSynced === false) return { bekle: true, neden: 'senkron' };
      if (Number.isFinite(progress) && progress > 0 && progress < 100) return { bekle: true, neden: 'cevrimdisi', ilerleme: progress, senkronTamam: socket?.hasSynced === true };
      const hazir = !!chats.length && secim.every(ad => chats.some(chat => (chat.formattedTitle || chat.name || '') === ad));
      return hazir ? { bekle: false } : { bekle: true, neden: 'sohbet' };
    }, secili);
    kontrol(i);
    if (!d?.bekle) break;
    tur++;
    const cevrimdisi = d.neden === 'cevrimdisi';
    durgun = cevrimdisi && d.ilerleme === son ? durgun + 1 : 0;
    son = cevrimdisi ? d.ilerleme : null;
    if (!beklendi) { beklendi = true; kayit('hazirlik-bekleniyor', { kod: d.neden, ...(cevrimdisi ? { ilerleme: d.ilerleme } : {}) }); }
    // Sayac %99 ve uzerinde takili kalip WhatsApp "senkron tamam" demisse sayac bitmistir (WhatsApp'in bilinen davranisi): kisa bekleme yeter.
    const kisa = cevrimdisi && d.senkronTamam === true && d.ilerleme >= LIMITS.hazirlikKisaEsik;
    if (durgun >= (kisa ? kisaDurguTur : durguTur)) { sonuc = 'durgun'; break; }
    if (tur >= ustTur) { sonuc = 'zaman-asimi'; break; }
    const ayrinti = cevrimdisi ? 'Kapalıyken gelen mesajlar alınıyor: %' + d.ilerleme
      : d.neden === 'senkron' ? 'WhatsApp senkronizasyonu bekleniyor'
        : 'Seçili sohbetlerin yerel listede hazır olması bekleniyor';
    yolla('durum', { metin: 'Senkronize ediliyor', ayrinti, ...(cevrimdisi ? { yuklemeYuzdesi: d.ilerleme } : {}) });
    await bekle(adim);
  }
  if (beklendi) kayit('hazirlik-bitti', { kod: sonuc, ...(son != null ? { ilerleme: son } : {}) });
}

// DENEME: telefondan gelen mesajlarin yerel depodaki SAYISINI (yalniz sayi, icerik degil) beklerken izler. Sayi artiyorsa
// telefon hala mesaj gonderiyordur; uzun sure degismiyorsa buyuk olasilikla bitmistir. Karar yine kullanicidadir.
function mesajSayaciIzle(i, kayit = () => {}) {
  let durdu = false, zaman, son = null, degisim = Date.now(), sonYazi = 0;
  const durdur = () => { durdu = true; clearTimeout(zaman); };
  const dongu = async () => {
    if (durdu) return;
    try {
      const sayfa = i.client?.pupPage;
      if (sayfa && !i.iptal) {
        const n = await Promise.race([
          sayfa.evaluate(() => window.require('WAWebCollections').Msg.length, { islem: 'mesaj-sayaci' }),
          new Promise((cozum) => { const z = setTimeout(() => cozum(null), 4000); z.unref?.(); }),
        ]);
        if (!durdu && Number.isFinite(n)) {
          const simdi = Date.now();
          if (n !== son) { son = n; degisim = simdi; }
          yolla('senkron', { mesajSayisi: n, durduSn: Math.floor((simdi - degisim) / 1000) });
          if (simdi - sonYazi >= 30000) { sonYazi = simdi; kayit('mesaj-sayaci', { ilerleme: n }); }
        }
      }
    } catch (e) { /* sayfa yenilenirken okunamayabilir; sonraki turda yeniden denenir */ }
    if (!durdu) { zaman = setTimeout(dongu, LIMITS.mesajSayaciAraligi); zaman.unref?.(); }
  };
  dongu();
  return durdur;
}

async function telefonOnayiniBekle(i, kayit = () => {}) {
  if (jsonOku(path.join(veriKok(), 'senkronizasyon-onayi.json'), {}).tamam) return;
  kontrol(i);
  baglantiDurumu = 'Senkronize ediliyor';
  yolla('senkron', { baglandi: true, grupSayisi: gruplariOku().length || null, onayBekliyor: true });
  yolla('durum', { metin: 'Senkronize ediliyor', telefonOnayi: true,
    ayrinti: 'WhatsApp Web hazır. Telefonda senkronizasyon sürüyorsa bekleyin. Telefonda tamamlandığında aşağıdan onaylayın.' });
  const sayacDurdur = mesajSayaciIzle(i, kayit);
  try {
    await new Promise((resolve, reject) => { i.telefonOnay = resolve; i.telefonIptal = reject; });
  } finally { sayacDurdur(); i.telefonOnay = null; i.telefonIptal = null; }
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
      islemBilgisi.butce.request();
      await insanBekle(PACE.arama, islemBilgisi);
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
  islemBilgisi.butce.request();
  await insanBekle(PACE.arama, islemBilgisi);
  try {
    const kisi = await withTimeout(msg.getContact(), LIMITS.timeout, 'Gönderen bilgisi');
    ad = kisi.pushname || kisi.name || kisi.number || null;
  } catch (e) { if (e.message.includes('yanıt süresi aşıldı')) throw e; }
  kisiOnbellek.set(kimlik, ad);
  return ad;
}

async function toplamayiBaslat(zorla, gecmis = false, sadeceTara = false, taslak = {}) {
  if (calisiyor || yerelSilme) return { hata: 'Toplama zaten sürüyor' };
  if (hazirClient) {
    await bozukHazirIstemciyiAt();
    if (calisiyor || yerelSilme) return { hata: 'Toplama zaten sürüyor' };
  }

  const ayar = { ...ayarOku(), ...taslak };
  const gunSayisi = days(ayar.ilkCalismaGunSayisi);
  const hiz = hizProfili(ayar.indirmeHizi, PACE);
  const simdi = Math.floor(Date.now() / 1000);
  const sonZaman = sonZamanOku();

  const baglanmaYolu = path.join(veriKok(), 'son-baglanti.json');
  if (!zorla && !hazirClient && Date.now() - (jsonOku(baglanmaYolu, {}).zaman || 0) < 60000) return { hata: 'Yeni bağlantı için en az 1 dakika bekleyin.' };
  if (!hazirClient) jsonYaz(baglanmaYolu, { zaman: Date.now() });
  const eskiDurum = jsonOku(durumYolu(), {});
  const ilerleme = { ...(eskiDurum.sohbetler || {}) };
  const ilkBaslangic = simdi - gunSayisi * 86400;
  const bugunBaslangic = dayStart(simdi);
  // Eski bicimde yalniz genel sonZaman vardir; yeni bicimde her grubun kendi kaydi.
  const eskiBicim = eskiDurum.sohbetler === undefined && sonZaman != null;
  const hamBaslangic = chat => ilerleme[chat.id._serialized] ?? (eskiBicim ? sonZaman : null);
  // Normal Topla her grubu kendi kaydindan baslatir (kaydi olmayan grup: ilk calisma gun sayisi).
  // Gecmis modlari secilen gun araligini tarar. Tekrar eden mesajlari mesaj kimligi eler.
  const sohbetBaslangici = chat => {
    if (gecmis) return ilkBaslangic;
    const kayit = hamBaslangic(chat);
    return kayit == null ? ilkBaslangic : Math.max(kayit - ORTUSME_SANIYE, simdi - LIMITS.days * 86400);
  };
  const rapor = { baslangic: simdi, gun: gunSayisi, gecmis, sadeceTara, gruplar: [], alinamayanMedya: [], bekleyenGrupSayisi: 0, sonuc: 'devam' };
  const sayac = { indirilen: 0, yinelenen: 0, atlanan: 0, hata: 0 };
  const dizin = dizinOku();
  const mevcutAdlar = new Set(arsivListele(Infinity, { tumTurler: true }).flatMap(g => g.dosyalar.map(d => d.ad)));
  // Alinmayan belgeler (ayari kapali PDF, Word, Excel, CAD...): yalniz sayilir, indirilmez. Ayni mesaj bir kez sayilir.
  const atlananBelgeYolu = path.join(veriKok(), 'atlanan-belgeler.json');
  const atlananBelgeler = jsonOku(atlananBelgeYolu, { turler: {}, kimlikler: [] });
  const sayilanBelgeler = new Set(atlananBelgeler.kimlikler || []);
  rapor.atlananBelgeler = {};
  const belgeyiSay = (msg, kimlik) => {
    const etiket = belgeEtiketi(msg);
    rapor.atlananBelgeler[etiket] = (rapor.atlananBelgeler[etiket] || 0) + 1;
    if (!kimlik || sayilanBelgeler.has(kimlik)) return;
    sayilanBelgeler.add(kimlik);
    atlananBelgeler.turler = { ...(atlananBelgeler.turler || {}), [etiket]: ((atlananBelgeler.turler || {})[etiket] || 0) + 1 };
    atlananBelgeler.kimlikler = [...sayilanBelgeler].slice(-5000);
    atlananBelgeler.guncelleme = Date.now();
    atlananBelgeDegisti = true;
  };
  let atlananBelgeDegisti = false;
  const mevcutKayitlar = Object.entries(dizin).filter(([ad]) => mevcutAdlar.has(ad));
  const hashHaritasi = new Map(mevcutKayitlar.map(([ad, k]) => [k.hash, ad]));
  const silinenYolu = path.join(veriKok(), 'silinen-mesajlar.json');
  const silinen = jsonOku(silinenYolu, {});
  const alinamayanYolu = path.join(veriKok(), 'alinamayan-medya.json');
  const alinamayanlar = jsonOku(alinamayanYolu, {});
  const islenenMesajlar = new Set(mevcutKayitlar.flatMap(([, k]) => [k.mesajKimligi, ...(k.mesajKimlikleri || [])]).filter(Boolean));
  let silinenSecimi;
  const kuyruk = [];

  canliDurum = null;
  baglantiDurumu = 'Bağlanıyor';
  yolla('durum', { metin: 'WhatsApp açılıyor' });

  const mevcutClient = hazirIstemiAl();
  const client = mevcutClient || new Client(istemciSecenekleri());
  const tani = observeConnection(client, path.join(veriKok(), 'baglanti-tanisi.json'), bilgi => yolla('durum', bilgi), !!mevcutClient);
  const bekci = mevcutClient ? null : hazirBekcisi(client, tani.record);
  const i = { client, iptal: false };
  islem = i;
  calisiyor = true;
  let tamamlandi = false;
  let sure;
  const bitir = async () => {
    if (tamamlandi) return;
    tamamlandi = true;
    bekci?.();
    clearTimeout(sure);
    await tani.finish(i.iptal ? 'iptal' : sayac.hata ? 'hata' : 'bitti', rapor.neden);
    rapor.baglantiAsamasi = tani.state.asama;
    if (i.basladi && !i.iptal && !kapaniyor && await istemciSaglikli(client)) {
      client.removeAllListeners(); hazirClient = client;
      client.once('disconnected', (neden) => hazirIstemciKoptu(client, neden));
    } else await istemciyiKapat(client);
    if (islem === i) { islem = null; calisiyor = false; }
    baglantiDurumu = hazirClient ? 'Bağlı' : 'Bağlantı kapalı';
    rapor.sonuc = i.iptal ? 'iptal' : (sayac.hata || sayac.atlanan) ? 'eksik' : 'bitti';
    // Vazgecilen fotograflar her raporda gorunur; hicbiri sessizce eksik kalmaz.
    for (const [kimlik, k] of Object.entries(alinamayanlar)) {
      if (!k.vazgecildi || (k.zaman ?? simdi) < simdi - LIMITS.days * 86400 || rapor.alinamayanMedya.some(m => m.mesajKimligi === kimlik)) continue;
      rapor.alinamayanMedya.push({ grup: k.grup, tur: k.tur, iletildi: !!k.iletildi, zaman: k.zaman, mesajKimligi: kimlik, neden: k.neden + ' · ' + ALINAMAYAN_DENEME + ' denemeden sonra vazgeçildi' });
    }
    try { jsonYaz(raporYolu(), rapor); } catch (e) { hataYaz('rapor', e); }
    if (atlananBelgeDegisti) { try { jsonYaz(atlananBelgeYolu, atlananBelgeler); } catch (e) { hataYaz('atlanan-belgeler', e); } }
    yolla('bitti', { ...sayac, rapor });
    bildirimGonder(bitisBildirimMetni(sayac, rapor, i.iptal));
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
    // Kayitli eslesme varken QR istenmesi: WhatsApp bu cihaz kaydini artik kabul etmiyor (telefondan cikilmis).
    if (eslesmeVar()) baglantiKoptu('QR');
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
  client.on('disconnected', (neden) => {
    const cikis = baglantiKoptu(neden);
    if (cikis && i.basladi) yolla('hata', CIKIS_MESAJI);
    i.iptal = true; i.reject(new Error(cikis ? CIKIS_MESAJI : 'Bağlantı kesildi'));
  });

  client.once('ready', async () => {
    if (tamamlandi || i.iptal) return;
    i.basladi = true;
    baglantiDurumu = 'Bağlı';
    clearTimeout(sure);
    yolla('qr', null);
    yolla('senkron', { baglandi: true, grupSayisi: gruplariOku().length || null });
    yolla('durum', { metin: 'Senkronize ediliyor', ayrinti: 'Seçili grup hazırlanıyor' });

    // Yarida kesilirse hangi gruplarin sirada kaldigini raporlamak icin.
    const sira = { hedefler: [], baslayan: 0, biten: 0 };
    try {
      await sohbetHazirliginiBekle(client, i, ayar.sadeceSuGruplar, tani.record);
      await telefonOnayiniBekle(i, tani.record);
      i.butce = budget();
      yolla('durum', { metin: 'Grup listesi alınıyor' });
      // WhatsApp Web'in ic yapisi kutuphaneden yeni oldugu icin getChatModel
      // bazi sohbetlerde cokuyor ve tek bir hata tum listeyi dusuruyor.
      // Yamayi bastan uygula: sorunlu sohbet sade modelle gecsin.
      if (client.pupPage) {
        await sayfaHazirla(client.pupPage, i);
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
      // Kaydi en eski (veya hic olmayan) grup once: butce dolsa bile hicbir grup ac kalmaz.
      if (!gecmis) hedefler.sort((a, b) => (hamBaslangic(a) ?? 0) - (hamBaslangic(b) ?? 0));
      sira.hedefler = hedefler;

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
      let indirmeSayaci = 0;

      for (const chat of hedefler) {
        kontrol(i);
        const baslangic = sohbetBaslangici(chat);
        let sohbetHatasi = false;
        islenen++; sira.baslayan = islenen;
        yolla('durum', { metin: 'Gruplar taranıyor', ayrinti: chat.name, grup: islenen, toplamGrup: hedefler.length });

        let paket = { tum: [], medyalar: [] };
        try {
          const tavan = Math.min(LIMITS.messages, Math.max(25, Number(ayar.taramaTavani) || LIMITS.messages));
          const taramaDurumu = bilgi => {
            yolla('durum', { metin: 'Gruplar taranıyor', ayrinti: chat.name, grup: islenen, toplamGrup: hedefler.length, ...bilgi });
          };
          const mesajlariGetir = options => withTimeout(chat.fetchMessages(options), LIMITS.timeout, 'Mesaj taraması');
          // Insan hizi: gecmis sayfa sayfa yuklenir, her sayfadan once beklenir, istenen tarihe ulasinca durulur.
          paket = client.pupPage
            ? await scanPaced({ bak: () => sayfadaDene(client.pupPage, i, () => sohbetSayfasi(client.pupPage, chat, 'bak')), yukle: () => sayfadaDene(client.pupPage, i, () => sohbetSayfasi(client.pupPage, chat, 'yukle')), fetchMessages: options => sayfadaDene(client.pupPage, i, () => mesajlariGetir(options)) },
              baslangic, simdi, tavan, () => insanBekle(PACE.sayfa, i), () => kontrol(i), taramaDurumu)
            : await scanMessages({ fetchMessages: async options => { kontrol(i); i.butce.request(); await insanBekle(PACE.sayfa, i); return mesajlariGetir(options); } },
              baslangic, simdi, tavan, bekle, () => kontrol(i), taramaDurumu);
          rapor.gruplar.push({ ad: chat.name, ...paket.erisim });
          if (!paket.tamam) {
            sohbetHatasi = true;
            sayac.hata++;
            yolla('hata', chat.name + ': Kontrollü tarama sınırına ulaşıldı. Erişim raporunu kontrol edin.');
          }
        } catch (e) {
          kontrol(i);
          if (!sadeceTara && !gecmis) { ilerleme[chat.id._serialized] = hamBaslangic(chat) ?? ilkBaslangic; sonZamanYaz(sonZaman ?? ilkBaslangic, ilerleme); }
          rapor.gruplar.push({ ad: chat.name, durum: 'hata', istenen: baslangic, enEski: null, neden: e.message });
          throw e; // Aynı hata üzerinde yeni WhatsApp istekleri başlatma.
        }

        console.log('  ' + chat.name + ': ' + paket.tum.length + ' mesaj yuklendi, ' +
          paket.medyalar.length + ' yeni medya');

        kuyruk.push({ chat, paket, islenen });

        // Grup grup calisma: bu grubun fotograflari hemen indirilir ve kaydi ilerletilir.
        // Butce dolsa bile biten gruplar kaybolmaz.
        kontrol(i);
        let notHaritasi = null;

        for (const msg of paket.medyalar) {
          kontrol(i);
          const kimlik = mesajKimligi(msg);
          // Even with content deduplication disabled, a retry must not save the same message twice.
          if (kimlik && islenenMesajlar.has(kimlik)) continue;
          if (!eligibleMedia(msg, ayar.videolariDaIndir, ayar)) {
            if (msg.hasMedia && msg.type === 'document' && !belgeResmi(msg)) belgeyiSay(msg, kimlik);
            continue;
          }
          // Vazgecilen fotograf istek harcamaz ve art arda hata sayacini tetiklemez; rapora bitirde eklenir.
          if (kimlik && alinamayanlar[kimlik]?.vazgecildi) continue;
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
          if (!notHaritasi) notHaritasi = ayar.yakinMesajlariAl ? await notlariEslestir(paket.medyalar, paket.tum, ayar.notPenceresiSaniye, i) : new Map();
          i.butce.media();
          // Insan hizi: secili hiza gore her hiz.molaHer indirmede uzun mola, her indirmeden once rastgele bekleme.
          if (indirmeSayaci > 0 && indirmeSayaci % hiz.molaHer === 0) {
            await insanBekle(hiz.mola, i, kalan => yolla('durum', { metin: 'Dinleniyor', ayrinti: 'Hesabı yormamak için mola veriliyor · yaklaşık ' + Math.max(1, Math.ceil(kalan / 60000)) + ' dk kaldı', grup: islenen, toplamGrup: hedefler.length, indirilen: sayac.indirilen }));
          }
          indirmeSayaci++;
          await insanBekle(hiz.indirme, i);
          yolla('durum', { metin: 'Fotoğraflar indiriliyor', ayrinti: chat.name, grup: islenen, toplamGrup: hedefler.length, indirilen: sayac.indirilen, medya: paket.medyalar.length });
          let media = null;
          let indirmeHatasi = null;

          if (kimlik && client.pupPage) {
            try {
              media = await withTimeout(sayfadaDene(client.pupPage, i, () => medyaIndir(client.pupPage, kimlik)), LIMITS.timeout, 'Medya indirme');
            } catch (e) { indirmeHatasi = e; }
          }

          else {
            try {
              media = await withTimeout(msg.downloadMedia(), LIMITS.timeout, 'Medya indirme');
              indirmeHatasi = null;
            } catch (e) { indirmeHatasi = indirmeHatasi || e; }
          }

          kontrol(i);
          // Sayfa yenilenip toparlanamadiysa bu fotografin suclu olmadigi bilinir: deneme sayilmaz, islem acik hatayla durur.
          if (indirmeHatasi?.sayfaYenilendi) throw indirmeHatasi;
          const eksigiKaydet = neden => rapor.alinamayanMedya.push({
            grup: chat.name, tur: msg.type || 'bilinmiyor', iletildi: !!msg.isForwarded, zaman: msg.timestamp || null,
            mesajKimligi: kimlik || null, neden,
          });
          if (indirmeHatasi?.message?.includes('yanıt süresi aşıldı')) {
            eksigiKaydet(indirmeHatasi.message);
            throw indirmeHatasi;
          }
          // Ayni fotograf birkac Topla'da alinamazsa vazgecilir (kuyrugu tikamasin); rapora yazilir.
          const denemeyiKaydet = neden => {
            if (!kimlik) return false;
            const deneme = (alinamayanlar[kimlik]?.deneme || 0) + 1;
            alinamayanlar[kimlik] = { deneme, grup: chat.name, tur: msg.type || 'bilinmiyor', iletildi: !!msg.isForwarded, zaman: msg.timestamp || null, neden, vazgecildi: deneme >= ALINAMAYAN_DENEME };
            jsonYaz(alinamayanYolu, alinamayanlar);
            return alinamayanlar[kimlik].vazgecildi;
          };
          if (!media && indirmeHatasi) {
            const neden = indirmeHatasi.message || String(indirmeHatasi);
            const vazgecildi = denemeyiKaydet(neden);
            eksigiKaydet(vazgecildi ? neden + ' · ' + ALINAMAYAN_DENEME + ' denemeden sonra vazgeçildi' : neden);
            i.butce.failed();
            const e = indirmeHatasi;
            if (!vazgecildi) sohbetHatasi = true;
            sayac.hata++;
            console.log('    ! indirilemedi: ' + ((e && e.message) || e));

            continue;
          }
          if (!media || !media.mimetype) {
            const neden = !media ? 'İndirme boş sonuç döndürdü. Dosyanın neden erişilemediği doğrulanamadı.' : 'İndirme sonucunda dosya türü bulunamadı.';
            const vazgecildi = denemeyiKaydet(neden);
            eksigiKaydet(vazgecildi ? neden + ' · ' + ALINAMAYAN_DENEME + ' denemeden sonra vazgeçildi' : neden);
            i.butce.failed();
            if (!vazgecildi) sohbetHatasi = true;
            sayac.atlanan++;
            console.log('    - bos dondu (sunucuda suresi dolmus olabilir)');
            continue;
          }

          i.butce.succeeded();
          if (kimlik && alinamayanlar[kimlik]) { delete alinamayanlar[kimlik]; jsonYaz(alinamayanYolu, alinamayanlar); }
          // Belge olarak gelen fotograf bazen "octet-stream" turunde gelir; dosya adindan resim sayilir.
          const resimMi = media.mimetype.startsWith('image/') || belgeResmi(msg);
          const videoMu = media.mimetype.startsWith('video/');
          const belge = resimMi || videoMu ? null : (belgeTuru(media) || mesajBelgesi(msg));
          if (!resimMi && !(videoMu && ayar.videolariDaIndir) && !(belge && ayar[belge.ayar] === true)) {
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

          const uzanti = (belge && belge.uzanti) || UZANTILAR[media.mimetype] || path.extname(media.filename || msg._data?.filename || '') || '.bin';
          const belgeAdi = belge ? belgeAdiParcasi(media.filename || msg._data?.filename) : '';
          const tamYol = cakismayanYol(hedefKlasor, `${klasor}_${saat}_${grupAdi}` + (belgeAdi ? '_' + belgeAdi : ''), uzanti);
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
        }
        kontrol(i);
        if (!sadeceTara && !gecmis && !sohbetHatasi) ilerleme[chat.id._serialized] = simdi - 1;
        // Checkpoint each successful conversation. Failed conversations retain their old boundary.
        else if (!sadeceTara && !gecmis && !(chat.id._serialized in ilerleme)) ilerleme[chat.id._serialized] = hamBaslangic(chat) ?? ilkBaslangic;
        if (!sadeceTara && !gecmis) sonZamanYaz(sonZaman ?? ilkBaslangic, ilerleme);
        sira.biten++;
      }

      kontrol(i);
      // Indirmeden sonra hala eksik kalan gunler (alinamayan, atlanan, erisilemeyen).
      rapor.eksikGunler = missingDays(kuyruk.flatMap(({ paket }) => paket.medyalar), islenenMesajlar, silinen, bugunBaslangic, ayar.videolariDaIndir, ayar);
      if (!sadeceTara && !gecmis) sonZamanYaz(simdi - 1, ilerleme);
      console.log('\n=== BITTI ===');
      console.log('  indirilen: ' + sayac.indirilen + ', yinelenen: ' + sayac.yinelenen +
        ', atlanan: ' + sayac.atlanan + ', hata: ' + sayac.hata);
      console.log('=== BITTI SONU ===\n');

    } catch (err) {
      sayac.hata++;
      const mesaj = hataYaz('toplama', err);
      rapor.neden = mesaj;
      const bekleyen = sira.hedefler.slice(sira.biten);
      rapor.bekleyenGrupSayisi = bekleyen.length;
      // Hic baslanmayan gruplar raporda gorunur; baslayip yarim kalanin kaydi zaten vardir.
      for (const c of sira.hedefler.slice(sira.baslayan)) rapor.gruplar.push({ ad: c.name, durum: 'Sırada', istenen: sohbetBaslangici(c), enEski: null, neden: 'Bu çalışmada sırası gelmedi; sonraki Topla’da taranacak.' });
      yolla('hata', 'Toplama tamamlanamadı: ' + mesaj + '. ' + (bekleyen.length ? bekleyen.length + ' grup sırada; Topla’ya yeniden basarak devam edebilirsiniz.' : 'Tamamlanmayan gruplar yeniden taranacak.'));

    } finally {
      await bitir();
    }
  });

  if (mevcutClient) {
    client.emit('ready');
  } else {
    await yetimTarayicilariKapat();
    // Temizlik sirasinda Durdur'a basildiysa tarayici hic acilmaz.
    if (tamamlandi) return { tamam: true };
    try { client.initialize().catch(baslatmaHatasi); } catch (err) { await baslatmaHatasi(err); }
  }

  return { tamam: true };
}

// ---------------- IPC ----------------

const SIMGE_B64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAFtklEQVR4nM2Xb3CURx3HP7v73CXk7loSc3fJmdJKR0hCuGACb1AnMVrHzggJR5OOxU5BbH0RMkz/WNoZyyVtZ9qRoiMpLTIWnIFICAoSprTQqpPO2BdgdITrpTaighJ7ubSZkqSQu2ef9cUd0dqQSzrF+nv57J/v59n97Xf3Bx8lolE5q2/XIURzc48CWNr07Deq1+w8Xt2086XqNc+uA8i2iesmXlcXtQCq13S2L16734RWHTChVT8zi9d2mfCazicAsn1mDTHbjqKuLqr6+jrsmsiO6KhT3H6r+6/2xgW/FQLDngufN4OphVaRfOeJ/sNtW+vqolZfX4cGTK6JZ7NvU+LLIzuiI9rfvqxgwN67bL/6+5Uidf5ysXrhc12q1vOGndTFj9VGOh/v6+uw6+qis9qOXB0+ID6s/e01ngH7+fBB9Wh8tTiWqALg9mCcbZVHzKazLfr0eJXlV8lZr8RMANOK7wp3q4fjTeKVZDmBvDEAhid9NBS/xfYlh03rHCGuBZBb3D1G2igALKFJpj4axHQ5MCdxANso/O4xfj2yiAffiIidS3vUCm/MTmp/zpz47w8zir+aLMefN0baUR8aaACX1CQnvXypeJBnlhyeVU6IXOLPh7vVI/Em8epIOYXWOGnzYfEPQAjNqO2hvniQZypzQ4jZiL88nBGf5zJTAwzgZP9DisxEBtAOpLRg1PbylcBbOSEEZCz00KEWXZM951eXfUu8SZxMluPPG2frFy6ysuw9UlqAyYh68zIE45MCx4CloKjA4cS5+bS/FprxdNDcozjUogXRqKSjw6lu/FH7JeGPLisYsJ8L96gt8Ubxq5HFeMQE5QGHo/cMYxyJY0BZYBzBa+cyifjFWzXSckiMSo7F3axffpk7uwPE/imZMB7qP5XJibazzbp/YonlM8knzxzd/BjRqBQA4cadd6asG7vL1AV7z7J9auubXxcnkhUE88e4dEURLoOD9yq0BqVg9H3Dxp/avHvFBcD8/DT77rUYfk/w0C8Ee+82tHVrTv0N5udrEpM+vuz/E09V9JqNf1inz+vPWK706DdjvZu6ssdQf+tSynI2LnidnqFacSxRRTDvErajwBiQLpSvBOErwR0I8YPf5FPgKaCvo4S+jhK83gK+fzKfiqoQL343QKC0lDQuBAbbKIJ5Y7yUqKTrHyvEt29+nbGUdKR0NgBY10jo/zgkDkgXwhdCagPzFGcvJmlb/WlcwSAAG76aT2fvRUx+iJSjcbskQr0LTJLrusm2qj03uG35woWVtIT6zapgjMTkDVhSZ1fAQvhC4C2FwpuoqQiw+0SCy8LPZeFn94kENRUBROFN4C1F+EpBusAYLJnZgtuDcdaVnTY/Ob8Sn9uRjiP3ZgCiUXnmaOvBPPudjnOpW6zNsTv0U5W95jb/myQnfVjCBuXCeIJIbwlaFvHAhnqENY/6+45Tf99xhDWPBzbUo2URyhfEKQiCdOES9pRFb6s8Yu6PRfRgaqGVZ488Gevd1DX1irr6yqmJ7IguaDxgmu7amn776UXO+vVbTGHDbhNp22emi/74kOmPD03bdsfm/aaw4cfm7nseNW8/vchZu+576QWN3aY20vl4RjSjOaMR7QofVA/HG8XJ4cXsenAFy5fejGMyZiSEwFPgBmDi/RTGGAwgheT3sfN8Z/spGooH2V51xLSeaZ7ZiHJBPBRbLV4c+iwLC1PY2UvIYDBZKxRSILL/YgnNX0bdfK30HD8M/9K0/rFZn57IbcU5IR4ZaBIvJxbhd4+TNnLKeq9OkrkHHJIpL7cF/8y2ysM5xacDmAGiW20ZaBKvDGesOe1IRHa0MSJzE6a8NBRn/L/1TEtO8WsBzAjxcT9I/m+fZDNC/K8epdeEqPXE7R1VP1cHhmqFMYK7yn5n7o9F9KnxKsuvRuZUG3zihclc4rqUZnOG+CSL03/Hx1ie/wvonyEcW5E4fAAAAABJRU5ErkJggg==';

ipcMain.handle('durum-al', () => ({ ayar: ayarOku(), sonZaman: sonZamanOku(), calisiyor, canliDurum, baglantiDurumu, bagli: !!hazirClient, eslesmeKayitli: eslesmeVar(), rapor: jsonOku(raporYolu(), null) }));
ipcMain.handle('gruplar-al', () => gruplariOku());
// Hic grup secili degilse tum gruplar taranir. Bu, kullanici acikca onaylamadan baslamaz (Vazgec varsayilan).
async function tumGruplarOnayi(secili) {
  if (Array.isArray(secili) && secili.length) return true;
  const sayi = gruplariOku().length;
  const { response } = await dialog.showMessageBox(pencere, { type: 'warning', buttons: ['Vazgeç', 'Hepsini tara'], defaultId: 0, cancelId: 0,
    message: 'Hiç grup seçmedin. ' + (sayi ? 'Tüm gruplar (' + sayi + ') taransın mı?' : 'Tüm gruplar taransın mı?'),
    detail: 'Grup seçmek için: Ayarlar › Hangi Gruplar. Tüm grupları taramak uzun sürer ve WhatsApp hesabını daha çok yorar.' });
  return response === 1;
}
const GRUP_SECILMEDI = { iptal: true, mesaj: 'Başlamadı: hiç grup seçilmedi' };
// Grup seciliyse ya da calisan bir islem varsa soru sorulmadan baslatilir (toplamayiBaslat "suruyor" cevabini kendisi verir).
function onayliBaslat(secili, ...arguman) {
  if (calisiyor || yerelSilme || (Array.isArray(secili) && secili.length)) return toplamayiBaslat(...arguman);
  return tumGruplarOnayi(secili).then((onay) => (onay ? toplamayiBaslat(...arguman) : GRUP_SECILMEDI));
}
ipcMain.handle('gecmis-kontrol', (_e, taslak) => onayliBaslat(taslak.sadeceSuGruplar, false, true, true, { ilkCalismaGunSayisi: days(taslak.ilkCalismaGunSayisi), sadeceSuGruplar: taslak.sadeceSuGruplar }));
ipcMain.handle('gecmis-indir', (_e, taslak) => onayliBaslat(taslak.sadeceSuGruplar, false, true, false, { ilkCalismaGunSayisi: days(taslak.ilkCalismaGunSayisi), sadeceSuGruplar: taslak.sadeceSuGruplar }));
ipcMain.handle('topla', (_e, zorla, gecmis) => onayliBaslat(ayarOku().sadeceSuGruplar, !!zorla, !!gecmis));

ipcMain.handle('durdur', async () => {
  await islemiDurdur();
  return true;
});

ipcMain.handle('degisiklik-sor', async () => (await dialog.showMessageBox(pencere, { type: 'question', message: 'Değişiklikler kaydedilsin mi?', buttons: ['Evet', 'Hayır'], defaultId: 0, cancelId: 1 })).response === 0);
// Hizli indirme secilirken bir kez sorulur; varsayilan dugme Vazgec'tir.
ipcMain.handle('hiz-onayi', async () => (await dialog.showMessageBox(pencere, { type: 'warning', buttons: ['Vazgeç', 'Hızlı yap'], defaultId: 0, cancelId: 0,
  message: 'Hızlı indirme, hesabın WhatsApp tarafından kısıtlanma riskini artırabilir. Yine de Hızlı açılsın mı?',
  detail: 'Yalnızca eski fotoğrafları bir kerelik toplarken kullanmanızı öneririz. Kısıtlanmayacağınızın garantisi verilemez.' })).response === 1);
ipcMain.handle('ayar-kaydet', (_e, yeni) => {
  const b = { ...ayarOku(), ...yeni };
  b.ilkCalismaGunSayisi = days(b.ilkCalismaGunSayisi);
  b.indirmeHizi = ['yavas', 'orta', 'hizli'].includes(b.indirmeHizi) ? b.indirmeHizi : 'yavas';
  ayarYaz(b);
  if (typeof yeni.otomatikCalistir === 'boolean') {
    app.setLoginItemSettings({
      openAtLogin: yeni.otomatikCalistir,
      ...(process.platform === 'darwin' ? {} : { args: [] }),
    });
  }
  return b;
});

function arsivListele(gunSayisi = 60, { tumTurler = false } = {}) {
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

      if (!(tumTurler ? ARSIV_DOSYASI : GORSEL).test(g.name)) continue;

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
// Bir tarihin fotograflari silinir. `grup` verilirse yalnizca o grubun o gunku fotograflari (grup gorunumu),
// verilmezse o tarihteki TUM gruplarin fotograflari (Tumu gorunumu) silinir ve onay penceresi bunu buyuk harfle belirtir.
async function gunDosyalari(gun, grup) {
  const hepsi = arsivListele(Infinity).find(x => x.gun === gun)?.dosyalar || [];
  return grup ? hepsi.filter(d => d.grup === grup) : hepsi;
}
ipcMain.handle('gun-sil', async (_e, gun, grup = null) => {
  if (calisiyor || yerelSilme) throw new Error('Önce çalışan işlemi durdurun');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gun)) throw new Error('Geçersiz tarih');
  if (grup !== null && (typeof grup !== 'string' || !grup.trim())) throw new Error('Geçersiz grup');
  const onceki = await gunDosyalari(gun, grup);
  if (!onceki.length) return { silindi: false, adet: 0 };
  const gunTR = gun.split('-').reverse().join('.');
  const soru = grup
    ? { buttons: ['Hayır', 'Evet'], message: gunTR + ' tarihli “' + grup + '” fotoğrafları silinsin mi?',
      detail: onceki.length + ' fotoğraf yerel Çöp Kutusu’na taşınacak; yalnızca bu grubun fotoğrafları silinir, diğer gruplara dokunulmaz. WhatsApp değişmeyecek.' }
    : { buttons: ['Vazgeç', 'Tüm fotoğrafları sil'], message: 'DİKKAT: ' + gunTR + ' TARİHİNDEKİ TÜM GRUPLARIN FOTOĞRAFLARI SİLİNECEK',
      detail: new Set(onceki.map(d => d.grup)).size + ' gruptan toplam ' + onceki.length + ' fotoğraf yerel Çöp Kutusu’na taşınacak; önizleme ve arşiv kayıtları kaldırılacak. WhatsApp değişmeyecek.\n\nYalnızca bir grubun fotoğraflarını silmek istiyorsanız Vazgeç’e basın, önce o grubu seçin.' };
  const { response } = await dialog.showMessageBox(pencere, { type: 'warning', buttons: soru.buttons, defaultId: 0, cancelId: 0, message: soru.message, detail: soru.detail });
  if (response !== 1) return { silindi: false };
  const dosyalar = await gunDosyalari(gun, grup);
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

// whatsapp-web.js kopma nedeni 'LOGOUT' (telefondan cikis) ya da WhatsApp durum adidir; bu uc neden cihaz kaydinin kalktigini gosterir.
// 'QR': kayitli eslesme varken WhatsApp yeniden QR istedi (oturum sunucuda kapanmis).
const CIKIS_NEDENLERI = new Set(['LOGOUT', 'UNPAIRED', 'UNPAIRED_IDLE', 'QR']);
const CIKIS_MESAJI = 'WhatsApp bağlantısı telefondan kaldırılmış. QR kod ile yeniden bağlanın.';
// Kopma nedenini kaydeder. Cihaz kaydi kalktiysa yerel eslesme de "yok" sayilir (standart baslangic: QR kod goster);
// uyku ya da ag kopmasinda eslesme korunur. Her durumda pencereye haber verilir (rozet beklemeden guncellenir).
function baglantiKoptu(neden) {
  const metin = String(neden ?? 'bilinmiyor');
  const cikis = CIKIS_NEDENLERI.has(metin);
  try { jsonYaz(path.join(veriKok(), 'son-kopma.json'), { zaman: Date.now(), neden: metin, eslesmeSilindi: cikis }); } catch (e) { hataYaz('son-kopma', e); }
  if (cikis) yerelEslesmeyiTemizle();
  yolla('eslesme', { cikis, neden: metin });
  return cikis;
}
// Grup yenileme/Topla sonrasi acik tutulan tarayici koptu.
function hazirIstemciKoptu(client, neden) {
  if (hazirClient !== client) return;
  hazirClient = null;
  baglantiDurumu = 'Bağlantı kapalı';
  void istemciyiKapat(client);
  baglantiKoptu(neden);
}

const oturumKlasoru = () => path.join(veriKok(), 'oturum', 'session');
// Uyku ya da ag kopmasindan kalan kendi Chrome'umuzu kapatir ("browser is already running" hatasini onler).
// Yalnizca bu surumun oturum klasoruyle acilmis surecler kapatilir.
async function yetimTarayicilariKapat() {
  try {
    const kapatilan = await tarayicilar.yetimleriKapat(oturumKlasoru());
    if (kapatilan.length) {
      console.log('Yetim tarayıcı kapatıldı:', kapatilan.join(', '));
      jsonYaz(path.join(veriKok(), 'tarayici-temizligi.json'), { zaman: Date.now(), pidler: kapatilan });
    }
    return kapatilan;
  } catch (e) { hataYaz('yetim-tarayici', e); return []; }
}
// Istemciyi kapatir. Baglanti kopuksa destroy takilabilir; baska islem yoksa ardindan kalan kendi Chrome'umuz da temizlenir.
async function istemciyiKapat(client) {
  let kapanis = null;
  try { kapanis = client.destroy(); } catch (e) {}
  try { if (kapanis) await withTimeout(Promise.resolve(kapanis), 10000, 'Tarayıcı kapatma'); } catch (e) {}
  if (!islem && !cikisClient && !hazirClient && !calisiyor) await yetimTarayicilariKapat();
}

// Kullanıcının çıkış isteği: kayıtlı oturumu bir kez aç, QR ile yeniden giriş yapma.
async function cikisIstemcisi() {
  await yetimTarayicilariKapat();
  if (cikisIptal) throw new Error('İşlem iptal edildi');
  const client = new Client(istemciSecenekleri());
  cikisClient = client;
  const bekci = hazirBekcisi(client);
  let zamanlayici;
  try {
    await new Promise((resolve, reject) => {
      const hata = (mesaj, isaret) => { const e = new Error(mesaj); if (isaret) e[isaret] = true; reject(e); };
      cikisReddet = reject;
      client.once('ready', resolve);
      // QR istenmesi, WhatsApp'in bu oturumu artik kabul etmedigi (zaten cikilmis) anlamina gelir.
      client.once('qr', () => hata('Kayıtlı oturum kullanılamıyor; WhatsApp bu oturumu zaten kapatmış', 'oturumGecersiz'));
      client.once('auth_failure', () => hata('Kayıtlı eşleşme doğrulanamadı'));
      client.once('disconnected', () => hata('Bağlantı kesildi'));
      zamanlayici = setTimeout(() => hata('WhatsApp ' + LIMITS.cikisZamanAsimi / 1000 + ' saniyede yanıt vermedi', 'zamanAsimi'), LIMITS.cikisZamanAsimi);
      client.initialize().catch(reject);
    });
    return client;
  } catch (e) { await istemciyiKapat(client); throw e; }
  finally { bekci(); clearTimeout(zamanlayici); cikisReddet = null; }
}

// Yerel eslesmeyi temizler: sunucuda oturum kapali oldugu bilindiginde ya da kullanici onayladiginda.
function yerelEslesmeyiTemizle() {
  eslesmeYaz(false);
  const acik = hazirIstemiAl();
  if (acik) void istemciyiKapat(acik);
  baglantiDurumu = 'Çıkış yapıldı';
  jsonYaz(path.join(veriKok(), 'senkronizasyon-onayi.json'), { tamam: false });
  gruplariYaz([]);
}

async function whatsappCikis() {
  if (calisiyor || yerelSilme) return { hata: 'Önce çalışan işlemi durdurun' };
  if (!hazirClient && !eslesmeVar()) return { hata: 'Gerçek çıkış için kayıtlı bir eşleşme gerekiyor. Yerel eşleşme silinmedi.' };
  const { response } = await dialog.showMessageBox(pencere, { type: 'question', buttons: ['Hayır', 'Evet'], defaultId: 0, cancelId: 0,
    message: 'WhatsApp’tan çıkış yapılsın mı?', detail: 'Bu uygulamanın WhatsApp oturumu kapatılacak. Fotoğraf arşivi korunacak.' });
  if (response !== 1) return { cikildi: false };
  if (calisiyor || yerelSilme) return { hata: 'Bağlantı durumu değişti; çıkış yapılmadı' };
  let client = hazirClient, sonuc;
  calisiyor = true; cikisCalisiyor = true; cikisIptal = false;
  // Cikis gecici bir tarayici acabildigi icin 1-2 dakika surebilir; Ayarlar'da hemen "Çıkış yapılıyor" gorunsun.
  yolla('eslesme', { cikisSuruyor: true });
  try {
    try {
      if (!client) client = await cikisIstemcisi();
      await client.logout();
      yerelEslesmeyiTemizle();
      sonuc = { cikildi: true };
    } catch (e) {
      if (client && client !== hazirClient) await istemciyiKapat(client);
      if (cikisIptal) sonuc = { cikildi: false };
      else if (e.oturumGecersiz) {
        // WhatsApp QR istedi: oturum sunucuda zaten kapali. Yerel kaydi temizlemek guvenlidir.
        yerelEslesmeyiTemizle();
        sonuc = { cikildi: true, zatenCikilmis: true, mesaj: 'WhatsApp bu oturumu zaten kapatmış (telefondan çıkış yapılmış). Yerel eşleşme temizlendi; QR ile yeniden bağlanabilirsiniz.' };
      } else {
        const mesaj = 'WhatsApp çıkışı doğrulanamadı: ' + errorText(e) + '.';
        // Dogrulanamayan cikista, kullanici onayiyla yalnizca yerel eslesme temizlenebilir.
        const { response: temizle } = await dialog.showMessageBox(pencere, { type: 'warning', buttons: ['Hayır', 'Evet, yerel eşleşmeyi temizle'], defaultId: 0, cancelId: 0,
          message: mesaj, detail: 'İsterseniz yalnızca bu bilgisayardaki eşleşme kaydı temizlenir. WhatsApp’taki cihaz kaydı telefonun Bağlı Cihazlar ekranından silinmelidir. Fotoğraf arşivi korunur.' });
        if (temizle === 1) { yerelEslesmeyiTemizle(); sonuc = { cikildi: true, yerelTemizlendi: true, mesaj: 'Yerel eşleşme temizlendi. WhatsApp’taki cihaz kaydını telefondan silin; QR ile yeniden bağlanabilirsiniz.' }; }
        else sonuc = { hata: mesaj + ' Yerel oturum silinmedi.' };
      }
    }
  } finally { cikisClient = null; cikisReddet = null; cikisCalisiyor = false; calisiyor = false; }
  // Pencere (yeniden acilmis olsa bile) bitisi ogrensin; bayat "Islem suruyor" paneli kalmasin.
  yolla('bitti', { mesaj: sonuc.hata || sonuc.mesaj || (sonuc.cikildi ? 'WhatsApp’tan çıkış yapıldı' : 'Çıkış iptal edildi') });
  return sonuc;
}
ipcMain.handle('whatsapp-cikis', whatsappCikis);
ipcMain.handle('oturum-sifirla', whatsappCikis);

async function baglanVeListele(sadeceBaglan = false) {
  if (calisiyor || yerelSilme) return { hata: 'Toplama sürüyor' };
  if (hazirClient) {
    await bozukHazirIstemciyiAt();
    if (calisiyor || yerelSilme) return { hata: 'Toplama sürüyor' };
  }
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
  const bekci = mevcutClient ? null : hazirBekcisi(gecici, tani.record);
  let baglantiHatasi;
  const i = { client: gecici, iptal: false };
  islem = i;
  calisiyor = true;
  let sure;
  try {
    const liste = await new Promise((cozum, hata) => {
      i.reject = hata;

      gecici.on('auth_failure', m => hata(new Error('Eşleşme başarısız: ' + m)));
      gecici.on('disconnected', (neden) => { const cikis = baglantiKoptu(neden); i.iptal = true; hata(new Error(cikis ? CIKIS_MESAJI : 'Bağlantı kesildi')); });
      gecici.on('loading_screen', percent => yolla('durum', { metin: 'Senkronize ediliyor', yuklemeYuzdesi: Number(percent) }));
      gecici.on('qr', async (qr) => {
        if (eslesmeVar()) baglantiKoptu('QR');
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
        yolla('senkron', { baglandi: true });
        try {
          yolla('durum', { metin: sadeceBaglan ? 'Senkronize ediliyor' : 'Grup adları alınıyor', ayrinti: 'Grup listesi hazırlanıyor' });
          eslesmeYaz(true);
          if (gecici.pupPage) await withTimeout(modeliSadelestir(gecici.pupPage), LIMITS.timeout, 'Sohbet hazırlığı');
          const s = await withTimeout(gecici.getChats(), LIMITS.timeout, 'Grup listesi');
          const gruplar = s.filter(c => c.isGroup).map(c => ({ ad: c.name, son: c.timestamp || 0 })).sort((a,b) => b.son-a.son);
          gruplariYaz(gruplar);
          yolla('gruplar', gruplar);
          yolla('senkron', { baglandi: true, grupSayisi: gruplar.length });
          if (sadeceBaglan) {
            yolla('durum', { metin: 'Senkronize ediliyor', ayrinti: gruplar.length + ' grup listeye eklendi; senkronizasyon bekleniyor.' });
            await sohbetHazirliginiBekle(gecici, i, [], tani.record);
            await telefonOnayiniBekle(i, tani.record);
          }
          yolla('durum', { metin: gruplar.length + ' adet grup bulundu' });
          cozum(gruplar);
        } catch (e) { hata(e); }
      });
      if (mevcutClient) gecici.emit('ready');
      // Yeni tarayici acmadan once kalan kendi Chrome'umuz kapatilir; bu sirada Durdur'a basildiysa tarayici acilmaz.
      else yetimTarayicilariKapat().then(() => { if (i.iptal) throw new Error('İşlem iptal edildi'); return gecici.initialize(); }).catch(hata);
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
    bekci?.();
    clearTimeout(sure);
    await tani.finish(i.iptal ? 'iptal' : listeAlindi ? 'bitti' : 'hata', baglantiHatasi);
    if ((listeAlindi || tani.state.sayfa?.kutuphaneHazir) && !i.iptal && !kapaniyor && await istemciSaglikli(gecici)) {
      gecici.removeAllListeners();
      hazirClient = gecici;
      gecici.once('disconnected', (neden) => hazirIstemciKoptu(gecici, neden));
    } else {
      baglantiDurumu = 'Bağlantı kapalı';
      await istemciyiKapat(gecici);
    }
    if (islem === i) { islem = null; calisiyor = false; }
    canliDurum = null;
  }
}
ipcMain.handle('gruplari-getir', () => baglanVeListele(false));
ipcMain.handle('baglan', () => baglanVeListele(true));

// ---------------- pencere / tepsi ----------------

// Pencere onde degilken (kapali, arka planda ya da kucultulmus) sonucu Mac/Windows bildirim merkezine de yazar;
// tiklaninca pencere acilir. Pencere onundeyse bitis zaten ekranda gorundugu icin bildirim gonderilmez.
function bildirimGonder(govde) {
  try {
    if (!Notification || !Notification.isSupported?.()) return;
    if (pencere && !pencere.isDestroyed() && pencere.isVisible() && pencere.isFocused()) return;
    const n = new Notification({ title: 'Archivo', body: govde });
    n.on('click', () => pencereAc());
    n.show();
  } catch (e) { /* bildirim izni yoksa sessizce atlanir */ }
}
function bitisBildirimMetni(sayac, rapor, iptal) {
  const eksik = !!(sayac.hata || sayac.atlanan);
  if (iptal) return 'İşlem durduruldu';
  if (sayac.indirilen) return sayac.indirilen + ' fotoğraf indirildi' + (eksik ? ' (bazıları alınamadı)' : '');
  if (eksik) return 'İşlem tamamlanamadı; ayrıntı için Archivo’yu açın';
  return rapor.sadeceTara ? 'Geçmiş taraması tamamlandı' : 'Yeni fotoğraf yok';
}

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
  // Onceki calismadan (cokme, uyku) kalan kendi Chrome'umuz varsa kapatilir.
  if (app.hasSingleInstanceLock?.() !== false) void yetimTarayicilariKapat();

  if (!SESSIZ) pencereAc(); // Açılışta otomatik indirme başlatılmaz.

});

app.on('window-all-closed', () => {
  // tepsi acikken calismaya devam eder
});

app.on('activate', () => pencereAc());

app.on('before-quit', e => {
  if (!kapaniyor && (islem || hazirClient || cikisCalisiyor)) {
    e.preventDefault();
    kapaniyor = true;
    islemiDurdur().finally(() => app.quit());
  }
});

app.on('second-instance', () => pencereAc());
if (!app.requestSingleInstanceLock()) app.quit();
