// Gercek tarayici testleri icin ortak yardimcilar: Chrome yolu, puppeteer, sahte PNG ve sahte window.api.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function chromeYolu() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const kok = path.join(__dirname, '../chromium/chrome');
  if (!fs.existsSync(kok)) return null;
  for (const d of fs.readdirSync(kok)) {
    const adaylar = [
      path.join(kok, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
      path.join(kok, d, 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
      path.join(kok, d, 'chrome-win64/chrome.exe'),
      path.join(kok, d, 'chrome-linux64/chrome'),
    ];
    const uygun = adaylar.find((a) => fs.existsSync(a) && ((process.platform === 'darwin' && a.includes('chrome-mac-' + (process.arch === 'arm64' ? 'arm64' : 'x64'))) || (process.platform === 'win32' && a.endsWith('.exe')) || (process.platform === 'linux' && a.includes('linux'))));
    if (uygun) return uygun;
  }
  return null;
}
function puppeteerYukle() {
  try { return require(require.resolve('puppeteer-core', { paths: [require.resolve('whatsapp-web.js')] })); } catch (e) {}
  try { return require('puppeteer-core'); } catch (e) { return null; }
}
const CHROME = chromeYolu();
const puppeteer = puppeteerYukle();
const ATLA = !CHROME || !puppeteer ? 'Chrome for Testing ya da puppeteer bulunamadı' : false;

// --- kucuk PNG uretici (60x60 gradyan) ---
const crcTablo = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTablo[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function parca(tip, veri) { const l = Buffer.alloc(4); l.writeUInt32BE(veri.length); const t = Buffer.concat([Buffer.from(tip), veri]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(t)); return Buffer.concat([l, t, c]); }
function png(r, g, b) {
  const N = 60, ham = Buffer.alloc(N * (1 + N * 3));
  for (let y = 0; y < N; y++) { ham[y * (1 + N * 3)] = 0; for (let x = 0; x < N; x++) { const o = y * (1 + N * 3) + 1 + x * 3, k = 0.55 + 0.45 * (y / N); ham[o] = r * k; ham[o + 1] = g * k; ham[o + 2] = b * k; } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(N, 0); ih.writeUInt32BE(N, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), parca('IHDR', ih), parca('IDAT', zlib.deflateSync(ham)), parca('IEND', Buffer.alloc(0))]);
}

const GRUPLAR = ['3. Bölge at kaç ', '3.Bölge Şoför ve Operatör', '3.Bölge Binek Araçların Giriş-Çıkış km', '19 Mayıs Mahallesi Muhtarlık Hizmetleri', 'YBO-İETT KOORDİNASYON GRUBU', 'Acil Müdahale Ekibi', '3.BÖLGE ÇÖZÜM MERKEZİ', 'BAŞKANLIK MERKEZ BAŞŞOFÖRLÜK', 'Kezban hanımın gülleri'];
const GRUP_BUYUK = 'Acil Müdahale Ekibi';
function veriKur(klasor, { cokGrup = true } = {}) {
  const renkler = [[76, 123, 208], [47, 174, 98], [233, 120, 90], [150, 110, 200], [60, 170, 170], [200, 160, 60], [110, 130, 160], [180, 90, 130], [90, 150, 90]];
  const gruplar = cokGrup ? GRUPLAR : GRUPLAR.slice(0, 3);
  const gunler = [];
  for (let i = 0; i < 14; i++) {
    const t = new Date(2026, 9, 3 - i), gun = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    const dosyalar = [];
    gruplar.forEach((g, gi) => {
      let adet = (i * 7 + gi * 3) % 6;
      if (i === 0 && gi === 0) adet = 4;
      if (g === GRUP_BUYUK && i === 1) adet = 250;
      if (i % 3 === 2 && gi % 2 === 1) adet = 0;
      for (let n = 0; n < adet; n++) {
        const ad = gun + '_' + String(23 - Math.floor(n / 60)).padStart(2, '0') + '-' + String(59 - (n % 60)).padStart(2, '0') + '-00_g' + gi + '_' + n + '.png';
        const yol = path.join(klasor, gun, 'g' + gi, ad);
        fs.mkdirSync(path.dirname(yol), { recursive: true });
        if (!fs.existsSync(yol)) fs.writeFileSync(yol, png(...renkler[gi % renkler.length]));
        dosyalar.push({ ad, yol, kucuk: yol, grup: g, gonderen: n % 4 === 0 ? 'Ayşe K.' : null, aciklama: n % 5 === 0 ? 'Kaldırım onarımı ' + n : null, notlar: [], gruplar: [] });
      }
    });
    dosyalar.sort((a, b) => b.ad.localeCompare(a.ad));
    if (dosyalar.length) gunler.push({ gun, dosyalar });
  }
  return gunler;
}

// Sayfa acilmadan once window.api'yi kuran betik (preload yerine).
const SAHTE_API = (veri) => `
  (() => {
    window.__cagrilar = []; window.__cb = {};
    const kaydet = (ad, sonuc) => (...a) => { window.__cagrilar.push([ad, ...a]); return Promise.resolve(typeof sonuc === 'function' ? sonuc(...a) : sonuc); };
    const durum = { ayar: { hedefKlasor: '/tmp/arsiv', ilkCalismaGunSayisi: 3, sadeceSuGruplar: [], saydamlik: 13, notPenceresiSaniye: 150 }, calisiyor: false, baglantiDurumu: 'Bağlı', eslesmeKayitli: true, bagli: true, rapor: null };
    window.api = {
      durumAl: kaydet('durumAl', durum), arsivAl: kaydet('arsivAl', ${JSON.stringify(veri)}), kucukUret: kaydet('kucukUret', null),
      gruplarAl: kaydet('gruplarAl', []), klasorAc: kaydet('klasorAc'), gunSil: kaydet('gunSil', { silindi: true }), fotografSil: kaydet('fotografSil', { silindi: true }),
      dosyaGoster: kaydet('dosyaGoster'), ayarKaydet: kaydet('ayarKaydet', (a) => ({ ...durum.ayar, ...a })), degisiklikSor: kaydet('degisiklikSor', true),
      topla: kaydet('topla', {}), durdur: kaydet('durdur', true), baglan: kaydet('baglan', { liste: [] }), gruplariGetir: kaydet('gruplariGetir', { liste: [] }),
      gecmisKontrol: kaydet('gecmisKontrol', {}), gecmisIndir: kaydet('gecmisIndir', {}), gecmisiSifirla: kaydet('gecmisiSifirla', true), klasorSec: kaydet('klasorSec', null),
      veriKlasoruAc: kaydet('veriKlasoruAc'), whatsappCikis: kaydet('whatsappCikis', { cikildi: true }), senkronizasyonOnayla: kaydet('senkronizasyonOnayla', true), hizOnayi: kaydet('hizOnayi', true),
    };
    for (const ad of ['onGruplar', 'onQr', 'onDurum', 'onDosya', 'onYinelenen', 'onBitti', 'onHata', 'onSenkron']) window.api[ad] = (fn) => { window.__cb[ad] = fn; };
    const SABIT = new Date('2026-10-03T12:00:00').getTime(); const GD = Date;
    class SahteTarih extends GD { constructor(...a) { if (a.length === 0) super(SABIT); else super(...a); } static now() { return SABIT; } }
    window.Date = SahteTarih;
  })();`;

module.exports = { CHROME, puppeteer, ATLA, png, veriKur, SAHTE_API, GRUPLAR, GRUP_BUYUK };
