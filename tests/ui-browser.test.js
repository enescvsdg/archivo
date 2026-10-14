// Gercek Chrome for Testing ile index.html'i acar, sahte window.api ile galeriyi surer.
// Chrome ya da puppeteer yoksa (ornegin CI'da indirme atlandiysa) testler atlanir.
// Ekran goruntusu icin: UI_EKRAN_DIR=/yol node --test tests/ui-browser.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { CHROME, puppeteer, ATLA, png, veriKur, SAHTE_API, GRUPLAR, GRUP_BUYUK } = require('./ui-yardimci');

let tarayici = null;
const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'archivo-ui-'));
const EKRAN = process.env.UI_EKRAN_DIR || '';
if (EKRAN) fs.mkdirSync(EKRAN, { recursive: true });
test.after(async () => { if (tarayici) await tarayici.close(); fs.rmSync(gecici, { recursive: true, force: true }); });

async function ac(t, secenek = {}) {
  if (!tarayici) tarayici = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-prefers-reduced-motion'] });
  const sayfa = await tarayici.newPage();
  t.after(() => sayfa.close());
  const hatalar = [];
  sayfa.on('pageerror', (e) => hatalar.push('pageerror: ' + e.message));
  sayfa.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/favicon|Download the Font/i.test(m.text())) hatalar.push(m.type() + ': ' + m.text()); });
  await sayfa.setViewport({ width: secenek.genislik || 1180, height: secenek.yukseklik || 860 });
  const veri = secenek.veri || veriKur(gecici);
  await sayfa.evaluateOnNewDocument((depo) => { try { localStorage.clear(); for (const [k, v] of Object.entries(depo)) localStorage.setItem(k, v); } catch (e) {} }, secenek.depo || {});
  await sayfa.evaluateOnNewDocument(SAHTE_API(veri));
  await sayfa.goto('file://' + path.join(__dirname, '../index.html'));
  await sayfa.waitForSelector('#suzgec:not([hidden])', { timeout: 8000 }).catch(() => {});
  await sayfa.evaluate(() => document.getElementById('giris') && document.getElementById('giris').remove());
  await new Promise((r) => setTimeout(r, 250));
  return { sayfa, hatalar, veri };
}
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
async function foto(h, ad) { if (EKRAN) await h.sayfa.screenshot({ path: path.join(EKRAN, ad + '.png') }); }
const kartlar = (s) => s.$$eval('.bolum', (l) => l.map((b) => ({ gun: b.dataset.gun, acik: !b.classList.contains('kapali'), kare: b.querySelectorAll('.kare').length, adet: b.querySelector('.gun-adet').textContent })));
const cipler = (s) => s.$$eval('#sabitCipler .cp', (l) => l.map((c) => ({ ad: c.querySelector('.ad').textContent, aktif: c.getAttribute('aria-pressed') === 'true', grup: c.dataset.grup || null })));
async function cipTikla(s, metin) { await s.evaluate((m) => { [...document.querySelectorAll('#suzgec .cp')].find((c) => c.textContent.includes(m)).click(); }, metin); await bekle(120); }
async function tikla(s, sel) { await s.evaluate((x) => document.querySelector(x).click(), sel); await bekle(130); }
// Grubu, kartta gorunuyorsa duğmesinden, degilse Gruplar listesinden secer (orijinal WhatsApp adiyla).
async function grupSec(s, ad) {
  const kartta = await s.evaluate((a) => { const c = [...document.querySelectorAll('#sabitCipler .cp[data-grup]')].find((x) => x.dataset.grup === a); if (c) { c.click(); return true; } return false; }, ad);
  if (!kartta) {
    await s.evaluate(() => document.getElementById('gruplarDugme').click()); await bekle(120);
    await s.evaluate((a) => [...document.querySelectorAll('#grupListeAcilir .ln')].find((x) => x.dataset.grup === a).click(), ad);
  }
  await bekle(150);
}
async function cagrilar(s) { return s.evaluate(() => window.__cagrilar); }

test('sayfa hatasiz acilir; CSP, sahte API ve tum dugmeler yuklenir', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  assert.deepEqual(h.hatalar, []);
  assert.equal(await h.sayfa.$eval('#suzgec', (e) => e.hidden), false);
  const ad = await h.sayfa.$eval('.marka-ad', (e) => getComputedStyle(e).fontFamily);
  assert.match(ad, /Iceberg/);
  await foto(h, '01-tumu');
});

test('Tumu gorunumu: sayac, standart grup adlari, yalniz en yeni gun acik ve kapali gunlerin fotograflari cizilmez', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  const toplam = h.veri.reduce((n, g) => n + g.dosyalar.length, 0);
  const c = await cipler(h.sayfa);
  assert.equal(c[0].ad, 'Tümü'); assert.equal(c[0].aktif, true);
  assert.equal(await h.sayfa.$eval('#sabitCipler .cp .sayi', (e) => e.textContent), '· ' + toplam);
  const adlar = c.filter((x) => x.grup).map((x) => x.ad);
  const hepsi = [...adlar, ...await h.sayfa.evaluate(() => { document.getElementById('gruplarDugme').click(); return [...document.querySelectorAll('#grupListeAcilir .ln .ad')].map((e) => e.textContent); })];
  for (const beklenen of ['3.Bölge At Kaç', '3.Bölge Şoför ve Operatör', 'YBO-İETT Koordinasyon Grubu', '3.Bölge Çözüm Merkezi', 'Başkanlık Merkez Başşoförlük', 'Kezban Hanımın Gülleri', '19 Mayıs Mahallesi Muhtarlık Hizmetleri'])
    assert.ok(hepsi.includes(beklenen), beklenen + ' bulunamadı: ' + hepsi.join(' | '));
  assert.ok(!hepsi.some((a) => a !== a.trim() || / {2}/.test(a)));
  const k = await kartlar(h.sayfa);
  assert.equal(k.filter((x) => x.acik).length, 1, 'yalnız bir gün açık');
  assert.equal(k[0].acik, true); assert.equal(k[0].gun, '2026-10-03');
  assert.ok(k[0].kare > 0 && k[0].kare <= 100);
  for (const x of k.slice(1)) assert.equal(x.kare, 0, x.gun + ' kapalıyken fotoğraf çizilmemeli');
  await h.sayfa.keyboard.press('Escape');
  await foto(h, '02-gruplar-listesi-kapali');
});

test('Gruplar dugmesi: kartta en cok 6 grup, sigmayanlar listeye duser; az grupta dugme cikmaz; kart tasmaz', { skip: ATLA }, async (t) => {
  const olc = async (h) => ({ n: (await cipler(h.sayfa)).filter((x) => x.grup).length, dugme: !!(await h.sayfa.$('#gruplarDugme')), tasma: await h.sayfa.$eval('#sabitCipler', (e) => e.scrollWidth > e.clientWidth + 1), liste: await h.sayfa.evaluate(() => { document.getElementById('gruplarDugme') && document.getElementById('gruplarDugme').click(); const n = document.querySelectorAll('#grupListeAcilir .ln').length; document.getElementById('grupPopover').hidden = true; return n; }) });
  const genis = await olc(await ac(t, { genislik: 1900 }));
  const orta = await olc(await ac(t, { genislik: 1180 }));
  const dar = await olc(await ac(t, { genislik: 760 }));
  for (const o of [genis, orta, dar]) { assert.ok(o.n >= 1 && o.n <= 6); assert.equal(o.tasma, false, 'grup düğmeleri kartın dışına taşmamalı'); assert.equal(o.dugme, true); assert.equal(o.n + o.liste, 9, 'kart + liste toplamı grup sayısı olmalı'); }
  assert.ok(genis.n >= orta.n && orta.n >= dar.n && genis.n > dar.n, 'pencere daraldıkça kartta daha az grup düğmesi: ' + [genis.n, orta.n, dar.n]);
  const az = await ac(t, { veri: veriKur(gecici, { cokGrup: false }), genislik: 1180 });
  assert.equal(await az.sayfa.$('#gruplarDugme'), null);
  assert.equal((await cipler(az.sayfa)).filter((x) => x.grup).length, 3);
});

test('grup secince yalniz o grubun fotograflari kalir; gun sayilari filtrelidir; Tumu hepsini geri getirir', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await grupSec(h.sayfa, '3.Bölge Şoför ve Operatör');
  const beklenen = h.veri.map((g) => ({ gun: g.gun, n: g.dosyalar.filter((d) => d.grup === '3.Bölge Şoför ve Operatör').length })).filter((g) => g.n > 0);
  const k = await kartlar(h.sayfa);
  assert.ok(beklenen.length > 7, 'bu grup 7 günden fazlada fotoğraf içermeli (sayfalama denenir)');
  assert.deepEqual(k.map((x) => x.gun), beklenen.slice(0, 7).map((x) => x.gun), 'ilk sayfada en yeni 7 gün');
  for (const x of k) assert.equal(x.adet, beklenen.find((b) => b.gun === x.gun).n + ' foto');
  assert.equal(k.filter((x) => x.acik).length, 1);
  const baska = await h.sayfa.$$eval('.kare', (l) => l.filter((e) => e._veri.grup !== '3.Bölge Şoför ve Operatör').length);
  assert.equal(baska, 0, 'başka grubun fotoğrafı görünmemeli');
  assert.equal((await h.sayfa.$$('.kare.solgun')).length, 0);
  await foto(h, '03-grup-gorunumu');
  await cipTikla(h.sayfa, 'Tümü');
  assert.equal((await kartlar(h.sayfa)).length, 7);
});

test('gun karti tiklaninca kapanir ve acilir; kapaninca fotograflar bosaltilir, acinca yeniden cizilir', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  const ilk = '.bolum:nth-of-type(1) .gun-ac';
  const sec = (n) => `#sayfa .bolum:nth-of-type(${n})`;
  await h.sayfa.evaluate(() => document.querySelector('.bolum .gun-ac').click());
  await bekle(600);
  let k = await kartlar(h.sayfa);
  assert.equal(k[0].acik, false); assert.equal(k[0].kare, 0, 'kapanınca fotoğraflar boşaltılmalı');
  await h.sayfa.evaluate(() => document.querySelectorAll('.bolum .gun-ac')[1].click());
  await bekle(120);
  k = await kartlar(h.sayfa);
  assert.equal(k[1].acik, true); assert.ok(k[1].kare > 0);
  assert.equal(await h.sayfa.$eval('.bolum:nth-of-type(2) .gun-ac', (e) => e.getAttribute('aria-expanded')), 'true');
});

test('genel sayfalama: bir sayfada 7 gun; ARCHIV + O sayfanin en altinda; Sonraki/Onceki; 7-15-30 secimi hatirlanir', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  const gunler = h.veri.map((g) => g.gun);
  assert.equal(gunler.length, 14);
  assert.deepEqual((await kartlar(h.sayfa)).map((x) => x.gun), gunler.slice(0, 7));
  assert.equal(await h.sayfa.$eval('#sayfalama', (e) => e.hidden), false);
  assert.equal(await h.sayfa.$$eval('#sayfalama .sy', (l) => l.length), 2);
  assert.equal(await h.sayfa.$eval('#sayfalama .sy[aria-current="page"] b', (e) => e.textContent), '1');
  assert.equal(await h.sayfa.$eval('#sayfalama .marka-sayfa .kok', (e) => e.textContent), 'Archiv');
  assert.match(await h.sayfa.$eval('#sayfalama .marka-sayfa', (e) => getComputedStyle(e).fontFamily), /Iceberg/);
  assert.equal(await h.sayfa.$eval('#sayfalama .marka-sayfa', (e) => getComputedStyle(e).textTransform), 'uppercase');
  assert.deepEqual(await h.sayfa.$$eval('#sayfalama [data-boy]', (l) => l.map((e) => e.dataset.boy + ':' + e.getAttribute('aria-pressed'))), ['7:true', '15:false', '30:false']);
  assert.equal(await h.sayfa.$('#sayfalama [data-git="-1"]'), null, '1. sayfada Önceki olmamalı');
  assert.ok(await h.sayfa.$('#sayfalama [data-git="1"]'));
  assert.equal(await h.sayfa.$('.bolum .sayfalama'), null, 'gün kartı içinde sayfalama kalmamalı');
  // pager, son kartin altinda (sayfanin sonunda) ve ekran iceriginin icinde
  const yer = await h.sayfa.evaluate(() => { const son = [...document.querySelectorAll('.bolum')].pop().getBoundingClientRect(); const p = document.getElementById('sayfalama').getBoundingClientRect(); return { pAlt: p.top - son.bottom }; });
  assert.ok(yer.pAlt >= 0, 'sayfalama son kartın altında olmalı');
  await h.sayfa.evaluate(() => document.getElementById('sayfalama').scrollIntoView({ block: 'center' })); await bekle(120);
  await foto(h, '04-sayfalama-1');
  await tikla(h.sayfa, '#sayfalama [data-git="1"]');
  assert.deepEqual((await kartlar(h.sayfa)).map((x) => x.gun), gunler.slice(7), '2. sayfada kalan günler');
  assert.equal((await kartlar(h.sayfa)).filter((x) => x.acik).length, 1, 'her sayfada yalnız en yeni gün açık');
  assert.equal(await h.sayfa.$eval('#sayfa', (e) => e.scrollTop), 0, 'sayfa değişince liste başa döner');
  assert.equal(await h.sayfa.$eval('#sayfalama .sy[aria-current="page"] b', (e) => e.textContent), '2');
  assert.equal(await h.sayfa.$('#sayfalama [data-git="1"]'), null, 'son sayfada Sonraki olmamalı');
  assert.ok(await h.sayfa.$('#sayfalama [data-git="-1"]'));
  await foto(h, '05-sayfalama-2');
  await tikla(h.sayfa, '#sayfalama .sy[data-sayfa="1"]');
  assert.deepEqual((await kartlar(h.sayfa)).map((x) => x.gun), gunler.slice(0, 7));
  // 15: iki sayfa tek sayfaya sigar; secim her zaman gorunur kalir
  await tikla(h.sayfa, '#sayfalama [data-boy="15"]');
  assert.equal((await kartlar(h.sayfa)).length, 14);
  assert.equal(await h.sayfa.$eval('#sayfalama', (e) => e.hidden), false, 'gün sayısı 7den fazlaysa seçim görünür kalmalı');
  assert.equal(await h.sayfa.$$eval('#sayfalama .sy', (l) => l.length), 0, 'tek sayfada numara yok');
  assert.equal(await h.sayfa.evaluate(() => localStorage.getItem('archivo.gunBoyu')), '15');
  await tikla(h.sayfa, '#sayfalama [data-boy="7"]');
  assert.equal((await kartlar(h.sayfa)).length, 7);
  assert.equal(await h.sayfa.$$eval('#sayfalama .sy', (l) => l.length), 2);
});

test('genel sayfalama: secilen gun boyu yeniden acilista hatirlanir; gecersiz kayit 7ye doner', { skip: ATLA }, async (t) => {
  const on = await ac(t, { depo: { 'archivo.gunBoyu': '15' } });
  assert.equal((await kartlar(on.sayfa)).length, 14);
  assert.equal(await on.sayfa.$eval('#sayfalama [data-boy="15"]', (e) => e.getAttribute('aria-pressed')), 'true');
  const otuz = await ac(t, { depo: { 'archivo.gunBoyu': '30' } });
  assert.equal((await kartlar(otuz.sayfa)).length, 14);
  const bozuk = await ac(t, { depo: { 'archivo.gunBoyu': '99' } });
  assert.equal((await kartlar(bozuk.sayfa)).length, 7);
  assert.equal(await bozuk.sayfa.$eval('#sayfalama [data-boy="7"]', (e) => e.getAttribute('aria-pressed')), 'true');
});

test('genel sayfalama: 7 gun ve altinda gorunmez, 8 gunde gorunur; kisa sayfada pencerenin dibine yaslanir; gun karti tum fotograflarini tek seferde gosterir', { skip: ATLA }, async (t) => {
  const veri = veriKur(gecici);
  const yedi = await ac(t, { veri: veri.slice(0, 7) });
  assert.equal(await yedi.sayfa.$eval('#sayfalama', (e) => e.hidden), true);
  assert.equal((await kartlar(yedi.sayfa)).length, 7);
  const sekiz = await ac(t, { veri: veri.slice(0, 8), yukseklik: 1300 });
  assert.equal(await sekiz.sayfa.$eval('#sayfalama', (e) => e.hidden), false);
  await tikla(sekiz.sayfa, '#sayfalama [data-git="1"]');
  assert.equal((await kartlar(sekiz.sayfa)).length, 1);
  const alt = await sekiz.sayfa.evaluate(() => { const s = document.getElementById('sayfa'); const p = document.getElementById('sayfalama').getBoundingClientRect(); const r = s.getBoundingClientRect(); return { bosluk: r.bottom - p.bottom, kart: document.querySelector('.bolum').getBoundingClientRect().bottom < p.top }; });
  assert.ok(Math.abs(alt.bosluk - 156) <= 4, 'kısa sayfada sayfalama pencerenin dibine yaslanmalı (alt bar payı ~156px): ' + alt.bosluk);
  assert.equal(alt.kart, true);
  await foto(sekiz, '04b-sayfalama-kisa');
  // 250 fotografli gun: kart icinde sayfalama yok, hepsi tek seferde
  const h = await ac(t);
  await grupSec(h.sayfa, 'Acil Müdahale Ekibi');
  await h.sayfa.evaluate(() => [...document.querySelectorAll('.bolum')].find((b) => b.dataset.gun === '2026-10-02').querySelector('.gun-ac').click());
  await bekle(200);
  assert.equal(await h.sayfa.$$eval('.bolum[data-gun="2026-10-02"] .kare', (l) => l.length), 250);
});

test('takvim: fotografli gunler isaretli, iki tikla aralik secilir, tek gun, kisayollar ve temizleme', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await cipTikla(h.sayfa, 'Tarih');
  assert.equal(await h.sayfa.$eval('#takvimPopover', (e) => e.hidden), false);
  assert.match(await h.sayfa.$eval('#takvimPopover .tk-bas b', (e) => e.textContent), /Ekim 2026/);
  const varGunler = await h.sayfa.$$eval('#takvimPopover .tk-gun.var:not(.disari)', (l) => l.map((e) => e.dataset.gun));
  assert.ok(varGunler.includes('2026-10-03') && varGunler.includes('2026-10-02'));
  assert.equal(await h.sayfa.$eval('#takvimPopover .tk-gun[data-gun="2026-10-03"]', (e) => e.classList.contains('bugun')), true);
  await foto(h, '06-takvim');
  await tikla(h.sayfa, '#takvimPopover .tk-gun[data-gun="2026-10-01"]');
  assert.deepEqual((await kartlar(h.sayfa)).map((x) => x.gun), ['2026-10-01']);
  assert.equal(await h.sayfa.$eval('#takvimPopover', (e) => e.hidden), false, 'ikinci tık beklenirken açık kalmalı');
  await tikla(h.sayfa, '#takvimPopover .tk-gun[data-gun="2026-10-03"]');
  assert.deepEqual((await kartlar(h.sayfa)).map((x) => x.gun), ['2026-10-03', '2026-10-02', '2026-10-01']);
  assert.equal(await h.sayfa.$eval('#takvimPopover', (e) => e.hidden), true);
  assert.equal(await h.sayfa.$eval('#tarihSatiri .cp.temizle .ad', (e) => e.textContent), '01.10.2026 – 03.10.2026');
  await foto(h, '07-aralik');
  await tikla(h.sayfa, '#tarihSatiri .cp.temizle');
  assert.equal((await kartlar(h.sayfa)).length, 7);
  await cipTikla(h.sayfa, 'Son 7 gün');
  assert.deepEqual((await kartlar(h.sayfa)).map((x) => x.gun), ['2026-10-03', '2026-10-02', '2026-10-01', '2026-09-30', '2026-09-29', '2026-09-28', '2026-09-27'].filter((g) => h.veri.some((d) => d.gun === g)));
  await cipTikla(h.sayfa, 'Bugün');
  assert.deepEqual((await kartlar(h.sayfa)).map((x) => x.gun), ['2026-10-03']);
  await cipTikla(h.sayfa, 'Tarih'); await tikla(h.sayfa, '#takvimPopover .tk-gun[data-gun="2026-10-02"]'); await tikla(h.sayfa, '#takvimPopover .tk-gun[data-gun="2026-10-02"]');
  assert.deepEqual((await kartlar(h.sayfa)).map((x) => x.gun), ['2026-10-02']);
});

test('takvim, secili grubun fotografli gunlerini isaretler', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await grupSec(h.sayfa, 'Acil Müdahale Ekibi');
  await cipTikla(h.sayfa, 'Tarih');
  const gruptaVar = new Set(h.veri.filter((g) => g.dosyalar.some((d) => d.grup === 'Acil Müdahale Ekibi')).map((g) => g.gun));
  const isaretli = await h.sayfa.$$eval('#takvimPopover .tk-gun.var:not(.disari)', (l) => l.map((e) => e.dataset.gun));
  assert.deepEqual(new Set(isaretli), new Set([...gruptaVar].filter((g) => g >= '2026-10-01')));
  assert.ok(await h.sayfa.$$eval('#takvimPopover .tk-gun:not(.var):not(.disari)', (l) => l.length) > 0);
});

test('arama: eslesmeyen gizlenir, hic eslesme yoksa bos mesaji ve Filtreleri temizle gorunur', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await h.sayfa.type('#arama', 'kaldırım onarımı 5'); await bekle(450);
  const k = await kartlar(h.sayfa);
  assert.ok(k.length > 0 && k.length < h.veri.length);
  assert.equal(await h.sayfa.$$eval('.kare', (l) => l.filter((e) => !/kald[ıi]r[ıi]m onar[ıi]m[ıi] 5/i.test([e._veri.aciklama, e._veri.ad].join(' '))).length), 0);
  await h.sayfa.$eval('#arama', (e) => { e.value = ''; });
  await h.sayfa.type('#arama', 'zzzyokboyle'); await bekle(450);
  assert.equal((await kartlar(h.sayfa)).length, 0);
  assert.equal(await h.sayfa.$eval('#bosFiltre', (e) => e.hidden), false);
  await tikla(h.sayfa, '#filtreTemizle');
  assert.equal(await h.sayfa.$eval('#arama', (e) => e.value), '');
  assert.equal((await kartlar(h.sayfa)).length, 7);
});

test('silme: grup gorunumunde (gun, grup), Tumu gorunumunde (gun, null) gonderilir ve liste yenilenir', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await h.sayfa.evaluate(() => document.querySelector('.bolum .gun-sil').click()); await bekle(250);
  let c = (await cagrilar(h.sayfa)).filter((x) => x[0] === 'gunSil');
  assert.deepEqual(c[0].slice(1), ['2026-10-03', null]);
  await grupSec(h.sayfa, '3. Bölge at kaç ');
  assert.match(await h.sayfa.$eval('.bolum .gun-sil', (e) => e.title), /yalnızca 3\.Bölge At Kaç fotoğraflarını sil/);
  await h.sayfa.evaluate(() => document.querySelector('.bolum .gun-sil').click()); await bekle(250);
  c = (await cagrilar(h.sayfa)).filter((x) => x[0] === 'gunSil');
  assert.deepEqual(c[1].slice(1), ['2026-10-03', '3. Bölge at kaç ']);
  assert.equal((await cagrilar(h.sayfa)).filter((x) => x[0] === 'arsivAl').length >= 3, true, 'silmeden sonra liste yeniden alınmalı');
});

test('surukle-birak: grup duğmeleri yer degistirir, sira kaydedilir; duğmeden listeye ve listeden duğmeye tasinir', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  const sira = async () => (await cipler(h.sayfa)).filter((x) => x.grup).map((x) => x.grup);
  const once = await sira();
  const merkez = async (sel) => h.sayfa.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const ilk = await merkez('#sabitCipler .cp[data-grup]'); const ucuncu = (await h.sayfa.$$eval('#sabitCipler .cp[data-grup]', (l) => l.map((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })))[2];
  await h.sayfa.mouse.move(ilk.x, ilk.y); await h.sayfa.mouse.down();
  await h.sayfa.mouse.move(ilk.x + 20, ilk.y, { steps: 3 }); await h.sayfa.mouse.move(ucuncu.x + 40, ucuncu.y, { steps: 8 });
  assert.equal(await h.sayfa.$$eval('.hayalet', (l) => l.length), 1, 'sürüklerken hayalet görünmeli');
  await h.sayfa.mouse.up(); await bekle(400);
  assert.equal(await h.sayfa.$$eval('.hayalet', (l) => l.length), 0);
  const sonra = await sira();
  assert.notDeepEqual(sonra, once);
  assert.equal(sonra.length, once.length);
  assert.equal(sonra[2], once[0], 'ilk grup üçüncü sıraya taşınmalı');
  assert.deepEqual(JSON.parse(await h.sayfa.evaluate(() => localStorage.getItem('archivo.grupSirasi'))).slice(0, sonra.length), sonra);
  assert.equal(await h.sayfa.$$eval('#sabitCipler .cp.on, #sabitCipler .cp[aria-pressed="true"]', (l) => l.length), 1, 'sürükleme grup seçmemeli');
  assert.equal((await kartlar(h.sayfa)).length, 7);
  // karttan listeye: son gorunur grubu listeye birak
  const gorunurOnce = (await sira()).length;
  await cipTikla(h.sayfa, 'Gruplar'); await bekle(150);
  const sonGorunur = (await h.sayfa.$$eval('#sabitCipler .cp[data-grup]', (l) => l.map((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, g: e.dataset.grup }; }))).pop();
  const liste = await h.sayfa.$eval('#grupListeAcilir', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 80, y: r.top + 70 }; });
  const listeOnce = await h.sayfa.$$eval('#grupListeAcilir .ln', (l) => l.map((e) => e.dataset.grup));
  await h.sayfa.mouse.move(sonGorunur.x, sonGorunur.y); await h.sayfa.mouse.down();
  await h.sayfa.mouse.move(sonGorunur.x, sonGorunur.y + 15, { steps: 3 }); await h.sayfa.mouse.move(liste.x, liste.y, { steps: 10 });
  await foto(h, '08-surukleme');
  await h.sayfa.mouse.up(); await bekle(400);
  const listeSonra = await h.sayfa.$$eval('#grupListeAcilir .ln', (l) => l.map((e) => e.dataset.grup));
  assert.ok(listeSonra.includes(sonGorunur.g), 'bırakılan grup listeye girmeli');
  assert.ok(!(await sira()).includes(sonGorunur.g));
  assert.equal((await sira()).length, gorunurOnce, 'karttaki grup sayısı sabit kalmalı');
  assert.equal(listeSonra.length, listeOnce.length + 0, 'listede toplam sayı korunur (biri yükselir)');
});

test('Gruplar listesi: aranabilir, listeden grup secilir ve Gruplar dugmesi secili grubu gosterir', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await cipTikla(h.sayfa, 'Gruplar'); await bekle(150);
  assert.equal(await h.sayfa.$eval('#grupPopover', (e) => e.hidden), false);
  await foto(h, '09-gruplar-listesi');
  const tum = await h.sayfa.$$eval('#grupListeAcilir .ln', (l) => l.length);
  assert.ok(tum >= 1);
  await h.sayfa.type('#grupAra', 'zzzyok'); await bekle(100);
  assert.equal(await h.sayfa.$$eval('#grupListeAcilir .ln', (l) => l.length), 0);
  assert.equal(await h.sayfa.$eval('.bos-liste', (e) => e.textContent), 'Eşleşen grup yok');
  await h.sayfa.$eval('#grupAra', (e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
  await bekle(100);
  const secilen = await h.sayfa.$eval('#grupListeAcilir .ln', (e) => ({ g: e.dataset.grup, ad: e.querySelector('.ad').textContent }));
  await tikla(h.sayfa, '#grupListeAcilir .ln');
  assert.equal(await h.sayfa.$eval('#grupPopover', (e) => e.hidden), true);
  assert.equal(await h.sayfa.$eval('#gruplarDugme .ad', (e) => e.textContent), secilen.ad);
  assert.equal(await h.sayfa.$eval('#gruplarDugme', (e) => e.getAttribute('aria-pressed')), 'true');
  assert.equal(await h.sayfa.$$eval('.kare', (l, g) => l.filter((e) => e._veri.grup !== g).length, secilen.g), 0);
});

test('buyuk onizleme: gorunumdeki tum sayfalardaki fotograflar arasinda gezer; kapatinca liste o fotografin gunune (sayfasina) gecer', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  const ilkSayfaFoto = h.veri.slice(0, 7).reduce((n, g) => n + g.dosyalar.length, 0);
  const sekizinci = h.veri[7];
  await tikla(h.sayfa, '.bolum .kare');
  assert.equal(await h.sayfa.$eval('#buyukKatman', (e) => e.hidden), false);
  assert.match(await h.sayfa.$eval('#buyukBilgi span', (e) => e.textContent), /3 Ekim 2026/);
  assert.match(await h.sayfa.$eval('#buyukBilgi span', (e) => e.textContent), new RegExp('1/' + h.veri.reduce((n, g) => n + g.dosyalar.length, 0)), 'oklar yalnız sayfadakileri değil görünümdeki tüm fotoğrafları gezer');
  await foto(h, '10-buyuk-onizleme');
  await h.sayfa.evaluate((n) => { for (let i = 0; i < n; i++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); }, ilkSayfaFoto);
  await bekle(100);
  assert.match(await h.sayfa.$eval('#buyukBilgi span', (e) => e.textContent), new RegExp(sekizinci.gun.split('-').reverse()[0].replace(/^0/, '') + ' '), 'sıra 2. sayfanın ilk gününe geçmiş olmalı');
  await h.sayfa.keyboard.press('Escape'); await bekle(250);
  assert.equal(await h.sayfa.$eval('#buyukKatman', (e) => e.hidden), true);
  assert.equal(await h.sayfa.$eval('#sayfalama .sy[aria-current="page"] b', (e) => e.textContent), '2', 'kapatınca fotoğrafın günü hangi sayfadaysa o sayfa açılmalı');
  const k = await kartlar(h.sayfa);
  assert.equal(k[0].gun, sekizinci.gun);
  assert.equal(k.find((x) => x.gun === sekizinci.gun).acik, true, 'o günün kartı açık gelmeli');
  assert.ok(k.find((x) => x.gun === sekizinci.gun).kare > 0);
});

test('canli indirme: yeni fotograf dogru kartin basina eklenir, sayaclar ve takvim guncellenir', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  const onceki = (await kartlar(h.sayfa))[0];
  const yol = path.join(gecici, 'yeni.png'); fs.writeFileSync(yol, png(255, 200, 40));
  await h.sayfa.evaluate((yol) => window.__cb.onDosya({ gun: '2026-10-03', ad: '2026-10-03_23-59-59_yeni.png', yol, kucuk: yol, grup: '3. Bölge at kaç ', gonderen: 'Test', aciklama: 'yeni foto', notlar: [] }), yol);
  await bekle(150);
  const sonra = (await kartlar(h.sayfa))[0];
  assert.equal(sonra.adet, (Number(onceki.adet.split(' ')[0]) + 1) + ' foto');
  assert.equal(await h.sayfa.$eval('.bolum .kare', (e) => e._veri.ad), '2026-10-03_23-59-59_yeni.png');
  // yeni bir gunde yeni foto: yeni kart olusur
  await h.sayfa.evaluate((yol) => window.__cb.onDosya({ gun: '2026-10-04', ad: 'x.png', yol, kucuk: yol, grup: 'Yeni Grup', gonderen: null, aciklama: null, notlar: [] }), yol);
  await bekle(150);
  assert.equal((await kartlar(h.sayfa))[0].gun, '2026-10-04');
  assert.ok((await cipler(h.sayfa)).some((c) => c.ad.startsWith('Tümü')));
});

test('fotografsiz arsiv: suzgec gizli, bos ekran gorunur', { skip: ATLA }, async (t) => {
  const h = await ac(t, { veri: [] });
  assert.equal(await h.sayfa.$eval('#suzgec', (e) => e.hidden), true);
  assert.notEqual(await h.sayfa.$eval('#bos', (e) => getComputedStyle(e).display), 'none');
  assert.deepEqual(h.hatalar, []);
});

test('tum dugmeler ikon ustte ad altta: ikon karosu ve etiket var; ayarlar paneli acilir', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  const eksik = await h.sayfa.evaluate(() => [...document.querySelectorAll('button.dg')].filter((b) => !b.querySelector('.tl svg use') || !b.querySelector('span:last-child').textContent.trim()).map((b) => b.id || b.className));
  assert.deepEqual(eksik, []);
  assert.ok(await h.sayfa.evaluate(() => document.querySelectorAll('button.dg').length) >= 15);
  const metinDugmeleri = await h.sayfa.evaluate(() => [...document.querySelectorAll('button')].filter((b) => !b.classList.contains('dg') && !b.querySelector('svg') && !b.classList.contains('anahtar') && !b.classList.contains('cp') && !b.classList.contains('tk-gun') && !b.classList.contains('tk-ok') && !b.classList.contains('sy') && !b.classList.contains('snb') && !b.dataset.boy && !b.dataset.hiz && !b.classList.contains('gun-ac') && !b.classList.contains('kare') && !b.classList.contains('gun-secenek') && !b.classList.contains('grupsatir') && !b.id.match(/^(topla|yol)$/)).map((b) => b.id || b.className));
  assert.deepEqual(metinDugmeleri, [], 'yalnızca yazıdan oluşan düğme kalmamalı');
  await tikla(h.sayfa, '#ayarAc'); await bekle(300);
  assert.equal(await h.sayfa.$eval('#ayarKatman', (e) => e.hidden), false);
  await foto(h, '11-ayarlar');
  await h.sayfa.evaluate(() => { const k = document.querySelector('.ayar-icerik'); k.scrollTop = k.scrollHeight; }); await bekle(150);
  await foto(h, '11b-ayarlar-alt');
  await h.sayfa.evaluate(() => { document.querySelector('.ayar-icerik').scrollTop = 0; });
  assert.doesNotMatch(await h.sayfa.$eval('#ayarKatman', (e) => e.textContent), /500 mesaj|24 sohbet/);
  await tikla(h.sayfa, '#ayarX');
  assert.deepEqual(h.hatalar, []);
});

test('kehribar/turuncu vurgu kalmadi: arayuz rengi kurumsal mavi', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  const r = await h.sayfa.evaluate(() => ({ vurgu: getComputedStyle(document.documentElement).getPropertyValue('--vurgu-2').trim(), taban: getComputedStyle(document.documentElement).getPropertyValue('--taban').trim(), kehribar: getComputedStyle(document.documentElement).getPropertyValue('--kehribar').trim() }));
  assert.equal(r.vurgu, '#4C7BD0'); assert.equal(r.taban, '#0A1020'); assert.equal(r.kehribar, '');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/<svg class="amblem[\s\S]*?<\/svg>/g, '');
  assert.doesNotMatch(html, /233, ?166, ?60|#E9A63C|#F3B450|#2A1B05/i, 'amblem dışında kehribar kalmamalı');
});

test('hata yazilari: yeni calisma baslayinca silinir, Kapat ile elle kapatilir, metin zararsizdir', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  const say = () => h.sayfa.$$eval('#sayfa .uyari', (l) => l.length);
  await h.sayfa.evaluate(() => window.__cb.onHata('Birinci hata <img src=x onerror=alert(1)>'));
  await h.sayfa.evaluate(() => window.__cb.onHata('İkinci hata'));
  assert.equal(await say(), 2);
  assert.match(await h.sayfa.$eval('#sayfa .uyari .uyari-metin', (e) => e.textContent), /İkinci hata|Birinci hata/);
  assert.equal(await h.sayfa.$$eval('#sayfa .uyari img', (l) => l.length), 0, 'hata metni HTML olarak yorumlanmamalı');
  await foto(h, '12-hata-yazilari');
  await tikla(h.sayfa, '#sayfa .uyari [data-kapat]');
  assert.equal(await say(), 1, 'Kapat yalnızca o uyarıyı kaldırmalı');
  await h.sayfa.evaluate(() => window.__cb.onBitti({ indirilen: 0, hata: 2 }));
  await bekle(150);
  assert.ok(await say() >= 2, 'bitişte genel uyarı eklenir');
  await tikla(h.sayfa, '#topla');
  assert.equal(await say(), 0, 'yeni Topla eski hata yazılarını silmeli');
  assert.equal((await cagrilar(h.sayfa)).filter((x) => x[0] === 'topla').length, 1);
  // gecmis tara/indir da temizler
  await h.sayfa.evaluate(() => window.__cb.onBitti({ indirilen: 0 }));
  await h.sayfa.evaluate(() => window.__cb.onHata('Eski'));
  await tikla(h.sayfa, '#gecmisTara');
  assert.equal(await say(), 0);
});

test('hata yazilari yalniz Tumu gorunumunde gorunur, grup sayfalarinda gizlenir ve sure orada islemez', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  const gorunur = () => h.sayfa.$$eval('#sayfa .uyari', (l) => l.filter((e) => !e.hidden && e.offsetParent !== null).length);
  const var_ = () => h.sayfa.$$eval('#sayfa .uyari', (l) => l.length);
  await h.sayfa.evaluate(() => window.__cb.onHata('Grup sayfasında görünmemeli'));
  assert.equal(await gorunur(), 1, 'Tümü sayfasında görünür');
  await grupSec(h.sayfa, '3.Bölge Şoför ve Operatör');
  assert.equal(await var_(), 1, 'grup sayfasında silinmez, yalnız gizlenir');
  assert.equal(await gorunur(), 0, 'grup sayfasında görünmemeli');
  await h.sayfa.evaluate(() => window.__cb.onHata('Grupta gelen hata'));
  assert.equal(await gorunur(), 0, 'grup sayfasında yeni gelen de görünmemeli');
  await cipTikla(h.sayfa, 'Tümü');
  assert.equal(await gorunur(), 2, 'Tümü sayfasına dönünce ikisi de görünür');
  await foto(h, '12-hata-yazilari');
});

test('hata yazilari belirli sure sonra kendiliginden kaybolur; sure grup sayfasinda gezerken dolmaz', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  const say = () => h.sayfa.$$eval('#sayfa .uyari', (l) => l.length);
  assert.equal(await h.sayfa.evaluate(() => uyariSuresi), 10000, 'varsayılan süre 10 saniye');
  await h.sayfa.evaluate(() => { uyariSuresi = 700; });
  await h.sayfa.evaluate(() => window.__cb.onHata('Kısa ömürlü'));
  assert.equal(await say(), 1);
  await bekle(250);
  assert.equal(await say(), 1, 'süre dolmadan kaybolmamalı');
  await bekle(800);
  assert.equal(await say(), 0, 'süre dolunca kaybolmalı');
  // grupta gezerken sayac durur
  await h.sayfa.evaluate(() => window.__cb.onHata('Beklemede'));
  await bekle(250);
  await grupSec(h.sayfa, '3.Bölge Şoför ve Operatör');
  await bekle(1000);
  assert.equal(await say(), 1, 'grup sayfasındayken süre işlememeli');
  await cipTikla(h.sayfa, 'Tümü');
  assert.equal(await h.sayfa.$$eval('#sayfa .uyari', (l) => l.filter((e) => !e.hidden).length), 1);
  await bekle(200);
  assert.equal(await say(), 1, 'kalan süre (~450 ms) dolmadan kaybolmamalı');
  await bekle(600);
  assert.equal(await say(), 0, 'kalan süre dolunca kaybolmalı');
  assert.deepEqual(h.hatalar, []);
});

test('kapali acilir pencereler gercekten gorunmez (hidden niteligi CSS ile ezilmemeli)', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  const goruntu = await h.sayfa.evaluate(() => ['grupPopover', 'takvimPopover', 'bosFiltre', 'fotoMenu', 'buyukKatman', 'ayarKatman', 'qrKatman', 'syncKatman', 'islemPanel'].map((id) => [id, getComputedStyle(document.getElementById(id)).display]));
  for (const [id, display] of goruntu) assert.equal(display, 'none', id + ' hidden iken görünür durumda: ' + display);
  const kutu = await h.sayfa.$eval('#grupPopover', (e) => e.getBoundingClientRect().height);
  assert.equal(kutu, 0);
});

test('gun basligi yapiskan: kaydirinca filtre kartinin hemen altinda kalir, dogal konumunda ise fotograflarinin ustundedir', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  const olc = () => h.sayfa.evaluate(() => { const b = document.querySelector('.bolum'), g = b.querySelector('.gunbasi').getBoundingClientRect(), i = b.querySelector('.izgara').getBoundingClientRect(), s = document.getElementById('suzgec').getBoundingClientRect(); return { baslik: g.top, baslikAlt: g.bottom, izgaraUst: i.top, suzgecAlt: s.bottom }; });
  const bas = await olc();
  assert.ok(bas.baslikAlt <= bas.izgaraUst, 'başlık fotoğrafların üstünde olmalı: ' + JSON.stringify(bas));
  assert.ok(bas.baslik >= bas.suzgecAlt, 'başlık filtre kartının altında olmalı: ' + JSON.stringify(bas));
  await h.sayfa.evaluate(() => { document.getElementById('sayfa').scrollTop = 140; });
  await bekle(100);
  const kaydi = await olc();
  assert.ok(kaydi.baslik >= kaydi.suzgecAlt - 1 && kaydi.baslik <= kaydi.suzgecAlt + 24, 'kaydırınca başlık filtre kartının hemen altında yapışmalı: ' + JSON.stringify(kaydi));
  await foto(h, '13-yapiskan-baslik');
});

test('sayfalama yazisi markadaki gibi noktasiz I ile yazilir (Turkce buyuk harf kurali uygulanmaz)', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  const buyuk = await h.sayfa.$eval('#sayfalama .marka-sayfa .kok', (e) => e.innerText);
  assert.equal(buyuk, 'ARCHIV');
});

test('Windows yollari dogru file adresine cevrilir ve grup adi standardi ornekleri', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  const r = await h.sayfa.evaluate(() => ({
    win: dosyaUrl('C:\\Users\\Ayşe Kaya\\Pictures\\Archivo 2.0.0 Arsivi\\2026\\Ekim\\03.10.2026\\3. Bölge at kaç\\a b.jpg'),
    unix: dosyaUrl('/Users/a/Pictures/x y.jpg'),
    adlar: ['3. Bölge at kaç ', '3.BÖLGE ÇÖZÜM MERKEZİ', 'YBO-İETT KOORDİNASYON GRUBU', 'Şoför ve Operatör', 'KEZBAN HANIMIN GÜLLERİ', 'ahmet\'in grubu', '  çok   boşluk  ', 'VE bağlaç', 'ÖZEL İŞ', 'IŞIK ve ısı', ''].map(grupAdiGoster),
    sayfalar: [[1, 5], [1, 25], [6, 25], [8, 25], [25, 25], [3, 1], [1, 0]].map(([a, b]) => sayfaNumaralari(a, b)),
    kisayol: kisayolAraligi('son7', '2026-03-02'), ay: gunEkle('2026-03-01', -1), yil: gunEkle('2026-01-01', -1),
    tasi: sirayiTasi(['a', 'b', 'c', 'd'], 'a', 2), tasi2: sirayiTasi(['a', 'b', 'c', 'd'], 'd', 0), tasi3: sirayiTasi(['a', 'b'], 'x', 1),
    hucre: takvimHucreleri(2026, 9).slice(0, 7).map((x) => x.iso + (x.buAy ? '' : '*')),
  }));
  assert.equal(r.win, 'file:///C:/Users/Ay%C5%9Fe%20Kaya/Pictures/Archivo%202.0.0%20Arsivi/2026/Ekim/03.10.2026/3.%20B%C3%B6lge%20at%20ka%C3%A7/a%20b.jpg');
  assert.equal(r.unix, 'file:///Users/a/Pictures/x%20y.jpg');
  assert.deepEqual(r.adlar, ['3.Bölge At Kaç', '3.Bölge Çözüm Merkezi', 'YBO-İETT Koordinasyon Grubu', 'Şoför ve Operatör', 'Kezban Hanımın Gülleri', 'Ahmet\'in Grubu', 'Çok Boşluk', 'VE Bağlaç', 'ÖZEL İŞ', 'IŞIK ve Isı', '']);
  assert.deepEqual(r.sayfalar, [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [16, 17, 18, 19, 20, 21, 22, 23, 24, 25], [1], []]);
  assert.deepEqual(r.kisayol, ['2026-02-24', '2026-03-02']);
  assert.equal(r.ay, '2026-02-28'); assert.equal(r.yil, '2025-12-31');
  assert.deepEqual(r.tasi, ['b', 'c', 'a', 'd']); assert.deepEqual(r.tasi2, ['d', 'a', 'b', 'c']); assert.deepEqual(r.tasi3, ['a', 'b']);
  assert.deepEqual(r.hucre, ['2026-09-28*', '2026-09-29*', '2026-09-30*', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
});

test('senkron paneli: asamalar gorunur, ekrani kilitlemez, Devam et tiklanabilir ve sonradan gelen durumlar onu gizlemez', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await tikla(h.sayfa, '#topla');
  await h.sayfa.evaluate(() => {
    window.__cb.onSenkron({ baglandi: true }); window.__cb.onSenkron({ grupSayisi: 41 });
    window.__cb.onDurum({ metin: 'Senkronize ediliyor', telefonOnayi: true });
    window.__cb.onSenkron({ onayBekliyor: true, mesajSayisi: 12430, durduSn: 3 });
    window.__cb.onDurum({ metin: 'Senkronize ediliyor', yuklemeYuzdesi: 99 });
  });
  await bekle(350);
  const o = await h.sayfa.evaluate(() => {
    const R = (id) => document.getElementById(id).getBoundingClientRect();
    const tepe = (id) => { const r = R(id); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); };
    return {
      panel: getComputedStyle(document.getElementById('syncKatman')).display, islem: getComputedStyle(document.getElementById('islemPanel')).display,
      devamGorunur: getComputedStyle(document.getElementById('syncDevam')).display,
      devamTiklanir: document.getElementById('syncDevam').contains(tepe('syncDevam')), durdurTiklanir: document.getElementById('syncIptal').contains(tepe('syncIptal')),
      ayarTiklanir: document.getElementById('ayarAc').contains(tepe('ayarAc')), filtreTiklanir: !!tepe('sabitCipler') && !document.getElementById('syncKatman').contains(tepe('sabitCipler')),
      kapsul: R('syncKatman').toJSON(), alt: R('alt').toJSON(), pencere: [innerWidth, innerHeight],
      adimlar: [1, 2, 3].map((n) => [document.getElementById('syncAdim' + n).getAttribute('data-durum'), document.getElementById('syncAdim' + n + 'Yazi').textContent]),
    };
  });
  assert.equal(o.panel, 'grid'); assert.equal(o.islem, 'none', 'iki panel üst üste binmemeli');
  assert.equal(o.devamGorunur, 'flex', 'Devam et görünür'); assert.ok(o.devamTiklanir, 'Devam et tıklanabilir (üstünü başka öğe kapatmıyor)'); assert.ok(o.durdurTiklanir);
  assert.ok(o.ayarTiklanir, 'panel ekranı kilitlememeli: Ayarlar düğmesi tıklanabilir'); assert.ok(o.filtreTiklanir, 'filtre kartı panelin arkasında kalmamalı');
  assert.ok(o.kapsul.bottom <= o.alt.top, 'panel alt çubuğun üstünde durmalı'); assert.ok(o.kapsul.left >= 0 && o.kapsul.right <= o.pencere[0] && o.kapsul.top >= 0);
  assert.ok(o.kapsul.height < 260, 'panel küçük olmalı: ' + o.kapsul.height);
  assert.deepEqual(o.adimlar.map((a) => a[0]), ['tamam', 'tamam', 'surer']); assert.match(o.adimlar[1][1], /41 grup/); assert.match(o.adimlar[2][1], /12\.430 mesaj · artıyor/);
  await foto(h, '14-senkron-paneli');
  await tikla(h.sayfa, '#syncDevam');
  assert.equal(await h.sayfa.$eval('#syncDevam', (e) => getComputedStyle(e).display), 'none');
  assert.equal((await cagrilar(h.sayfa)).filter((x) => x[0] === 'senkronizasyonOnayla').length, 1);
});

test('Durdur ve is sonu: ana surec gec cevap verse bile uc gecici pencere de kapanir', { skip: ATLA }, async (t) => {
  const kapali = (s) => s.evaluate(() => ['syncKatman', 'islemPanel', 'qrKatman'].map((id) => getComputedStyle(document.getElementById(id)).display));
  const ac_ = async (h) => { await tikla(h.sayfa, '#topla'); await h.sayfa.evaluate(() => { window.__cb.onDurum({ metin: 'Senkronize ediliyor', telefonOnayi: true }); window.__cb.onQr('data:image/png;base64,AAAA'); window.__cb.onQr(null); }); await bekle(150); };
  // 1) is sonu (onBitti)
  const a = await ac_(await ac(t).then((h) => (t.h1 = h))); assert.notDeepEqual(await kapali(t.h1.sayfa), ['none', 'none', 'none']);
  await t.h1.sayfa.evaluate(() => window.__cb.onBitti({ indirilen: 0 })); await bekle(250);
  assert.deepEqual(await kapali(t.h1.sayfa), ['none', 'none', 'none'], 'onBitti sonrası paneller kapanmalı');
  // 2) hata ile biten islem (Topla hata dondurur)
  const h2 = await ac(t);
  await h2.sayfa.evaluate(() => { window.api.topla = () => Promise.resolve({ hata: 'Bağlantı kurulamadı' }); });
  await tikla(h2.sayfa, '#topla'); await bekle(250);
  assert.deepEqual(await kapali(h2.sayfa), ['none', 'none', 'none'], 'hata sonrası paneller kapanmalı');
  assert.match(await h2.sayfa.$eval('#ozet', (e) => e.textContent), /Bağlantı kurulamadı/);
  // 3) Durdur: ana surec ilk uc yoklamada hala "calisiyor" der, sonra biter
  const h3 = await ac(t); await ac_(h3);
  await h3.sayfa.evaluate(() => { let n = 0; const eski = window.api.durumAl; window.api.durumAl = () => eski().then((d) => ({ ...d, calisiyor: ++n <= 3 })); });
  const t0 = Date.now(); await tikla(h3.sayfa, '#syncIptal'); await bekle(1400);
  assert.deepEqual(await kapali(h3.sayfa), ['none', 'none', 'none'], 'Durdur sonrası paneller kapanmalı'); assert.ok((await cagrilar(h3.sayfa)).some((x) => x[0] === 'durdur'));
  assert.equal(await h3.sayfa.$eval('#topla', (e) => e.disabled), false, 'Topla yeniden etkin olmalı');
  // 4) islem panelindeki Durdur ayni sekilde
  const h4 = await ac(t); await tikla(h4.sayfa, '#topla'); await h4.sayfa.evaluate(() => window.__cb.onDurum({ metin: 'Fotoğraflar indiriliyor', ayrinti: 'g' }));
  await bekle(150); assert.equal(await h4.sayfa.$eval('#islemPanel', (e) => getComputedStyle(e).display) !== 'none', true);
  await tikla(h4.sayfa, '#islemDurdur'); await bekle(600);
  assert.deepEqual(await kapali(h4.sayfa), ['none', 'none', 'none']);
  // 5) ana surec 5 sn'den uzun "calisiyor" derse bile paneller kapanir (zorla)
  const h5 = await ac(t); await ac_(h5);
  await h5.sayfa.evaluate(() => { const eski = window.api.durumAl; window.api.durumAl = () => eski().then((d) => ({ ...d, calisiyor: true })); });
  await tikla(h5.sayfa, '#syncIptal'); await bekle(5800);
  assert.deepEqual(await kapali(h5.sayfa), ['none', 'none', 'none'], '5 sn sonra paneller zorla kapanmalı');
});

test('islem kapsulu: tek satir, kucuk, cam; Durdur sag koseda yazilarla ayni hizada; alt cubugun yerini alir ve icerigi kapatmaz', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await tikla(h.sayfa, '#topla');
  await h.sayfa.evaluate(() => window.__cb.onDurum({ metin: 'Fotoğraflar indiriliyor', ayrinti: '3. Bölge at kaç', toplamGrup: 1, grup: 1, indirilen: 65 }));
  await bekle(350);
  const o = await h.sayfa.evaluate(() => {
    const R = (e) => e.getBoundingClientRect(), p = document.getElementById('islemPanel'), pr = R(p), d = R(document.getElementById('islemDurdur')), m = R(document.querySelector('.islem-metin')), sp = R(document.querySelector('#islemPanel .donen'));
    const cs = getComputedStyle(p), son = [...document.querySelectorAll('.bolum')].pop(), sayfa = document.getElementById('sayfa');
    return {
      goster: cs.display, alt: getComputedStyle(document.getElementById('alt')).display, sync: getComputedStyle(document.getElementById('syncKatman')).display,
      yukseklik: pr.height, genislik: pr.width, sagBosluk: pr.right - d.right, durdurMerkez: (d.top + d.bottom) / 2, metinMerkez: (m.top + m.bottom) / 2, panelMerkez: (pr.top + pr.bottom) / 2,
      durdurMetnin_sagi: d.left >= m.right - 1, donenSol: sp.right <= m.left + 1,
      arkaPlan: cs.backgroundColor, bulaniklik: cs.backdropFilter || cs.webkitBackdropFilter, kenar: cs.borderTopColor, golge: cs.boxShadow.includes('inset'),
      altBosluk: parseFloat(getComputedStyle(sayfa).paddingBottom), pencere: innerHeight, alt_ust: pr.top,
      metin: document.getElementById('islemAsama').textContent + '|' + document.getElementById('islemAyrinti').textContent,
    };
  });
  assert.equal(o.goster, 'grid'); assert.equal(o.alt, 'none', 'çalışırken alt çubuk (Topla) gizlenir, panel onun yerini alır'); assert.equal(o.sync, 'none');
  assert.ok(o.yukseklik < 90, 'tek satırlık kapsül küçük olmalı: ' + o.yukseklik); assert.ok(o.genislik <= 580);
  assert.ok(Math.abs(o.durdurMerkez - o.metinMerkez) < 6, 'Durdur yazılarla aynı hizada: ' + o.durdurMerkez + ' / ' + o.metinMerkez); assert.ok(o.durdurMetnin_sagi, 'Durdur yazıların sağında'); assert.ok(o.sagBosluk >= 8 && o.sagBosluk < 30, 'Durdur sağ köşede: ' + o.sagBosluk); assert.ok(o.donenSol);
  const alfa = Number((o.arkaPlan.match(/rgba?\([^)]*?,\s*([\d.]+)\)$/) || [0, 1])[1]);
  assert.ok(alfa < 0.35, 'cam yüzey yarı saydam olmalı, opak değil: ' + o.arkaPlan); assert.match(o.bulaniklik, /blur/); assert.ok(o.golge, 'üstte parlak iç çizgi');
  assert.ok(o.altBosluk >= o.pencere - o.alt_ust, 'sayfanın alt boşluğu panelin kapladığı yükseklikten az olmamalı (son kart panelin altında kalmasın)');
  assert.equal(o.metin, 'Fotoğraflar indiriliyor|3. Bölge at kaç · Grup 1 / 1 · 65 fotoğraf kaydedildi');
  await foto(h, '15-islem-kapsulu');
  // durdurunca alt cubuk geri gelir
  await tikla(h.sayfa, '#islemDurdur'); await bekle(600);
  assert.notEqual(await h.sayfa.$eval('#alt', (e) => getComputedStyle(e).display), 'none', 'iş bitince Topla çubuğu geri gelir');
  assert.equal(await h.sayfa.$eval('#islemPanel', (e) => getComputedStyle(e).display), 'none');
});

test('bitis karti: Topla cubugunun yerini alir, baslik BUYUK HARF (Turkce I), cam, sag koseden duzgun; Tamam kapatinca Topla geri gelir', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await tikla(h.sayfa, '#topla');
  await h.sayfa.evaluate(() => window.__cb.onDurum({ metin: 'Fotoğraflar indiriliyor', baslangic: Date.now() - 860000 }));
  await h.sayfa.evaluate(() => window.__cb.onBitti({ indirilen: 98, yinelenen: 12, atlanan: 2, hata: 0, rapor: { sonuc: 'eksik' } }));
  await bekle(450);
  const o = await h.sayfa.evaluate(() => {
    const R = (e) => e.getBoundingClientRect(), k = document.getElementById('bitisKart'), kr = R(k), cs = getComputedStyle(k);
    const m = R(document.querySelector('.bitis-metin')), tamam = R(document.getElementById('bitisTamam')), klasor = R(document.getElementById('bitisKlasor'));
    return {
      goster: cs.display, alt: getComputedStyle(document.getElementById('alt')).display, islem: getComputedStyle(document.getElementById('islemPanel')).display,
      baslik: document.getElementById('bitisBaslik').textContent, ayrinti: document.getElementById('bitisAyrinti').textContent + '|' + document.getElementById('bitisEksik').textContent + '|' + document.getElementById('bitisSure').textContent,
      eksikRenk: getComputedStyle(document.getElementById('bitisEksik')).color, ayrintiRenk: getComputedStyle(document.getElementById('bitisAyrinti')).color,
      altBosluk: innerHeight - kr.bottom, genislik: kr.width, yukseklik: kr.height, solSag: [kr.left, innerWidth - kr.right],
      tamamMerkez: (tamam.top + tamam.bottom) / 2, metinMerkez: (m.top + m.bottom) / 2, sagBosluk: kr.right - tamam.right,
      klasorSol: klasor.right <= tamam.left, klasorGorunur: !document.getElementById('bitisKlasor').hidden,
      arkaPlan: cs.backgroundColor, bulaniklik: cs.backdropFilter || cs.webkitBackdropFilter, tasma: k.scrollWidth > k.clientWidth + 1,
    };
  });
  assert.equal(o.goster, 'grid'); assert.equal(o.alt, 'none', 'kart çıkınca Topla çubuğu kaybolur'); assert.equal(o.islem, 'none');
  assert.equal(o.baslik, 'İNDİRME TAMAMLANDI', 'başlık büyük harf ve noktalı İ ile');
  assert.equal(o.ayrinti, '98 fotoğraf indirildi · 12 yinelenen atlandı|' + ' · 2 alınamadı, sonraki Topla’da yeniden denenecek' + '| · 14 dk 20 sn');
  assert.notEqual(o.eksikRenk, o.ayrintiRenk, 'alınamayan kısım ayrı renkte');
  assert.ok(o.altBosluk >= 14 && o.altBosluk <= 28, 'kart Topla çubuğunun yerinde, alttan ~20px: ' + o.altBosluk);
  assert.ok(o.genislik <= 640 && o.yukseklik < 110, 'küçük kapsül: ' + o.genislik + 'x' + o.yukseklik);
  assert.ok(Math.abs(o.solSag[0] - o.solSag[1]) < 2, 'yatayda ortalı');
  assert.ok(Math.abs(o.tamamMerkez - o.metinMerkez) < 8, 'düğmeler yazılarla aynı hizada');
  assert.ok(o.sagBosluk >= 8 && o.sagBosluk < 32 && o.klasorSol && o.klasorGorunur, 'Klasörü aç solda, Tamam sağ köşede');
  const alfa = Number((o.arkaPlan.match(/rgba?\([^)]*?,\s*([\d.]+)\)$/) || [0, 1])[1]);
  assert.ok(alfa < 0.35, 'cam yüzey: ' + o.arkaPlan); assert.match(o.bulaniklik, /blur/); assert.equal(o.tasma, false);
  await foto(h, '16-bitis-karti');
  await tikla(h.sayfa, '#bitisKlasor');
  assert.equal((await cagrilar(h.sayfa)).filter((x) => x[0] === 'klasorAc').length, 1);
  await tikla(h.sayfa, '#bitisTamam'); await bekle(200);
  assert.equal(await h.sayfa.$eval('#bitisKart', (e) => getComputedStyle(e).display), 'none');
  assert.notEqual(await h.sayfa.$eval('#alt', (e) => getComputedStyle(e).display), 'none', 'Tamam’dan sonra Topla çubuğu geri gelir');
  assert.deepEqual(h.hatalar, []);
  // basarisiz sonuc: kirmizi karo, klasor dugmesi yok, ayri screenshot
  await tikla(h.sayfa, '#topla');
  await h.sayfa.evaluate(() => window.__cb.onBitti({ indirilen: 0, hata: 3, atlanan: 0, rapor: { sonuc: 'eksik' } }));
  await bekle(400);
  assert.equal(await h.sayfa.$eval('#bitisBaslik', (e) => e.textContent), 'İŞLEM TAMAMLANAMADI');
  assert.equal(await h.sayfa.$eval('#bitisKlasor', (e) => getComputedStyle(e).display), 'none');
  assert.equal(await h.sayfa.$eval('#bitisIkon', (e) => e.className), 'tl t-kirmizi');
  await foto(h, '16b-bitis-karti-hata');
});

async function ayarlariAc(h) {
  await tikla(h.sayfa, '#ayarAc'); await bekle(350);
  await h.sayfa.evaluate(() => { const k = document.querySelector('.ayar-icerik'); k.scrollTop = k.scrollHeight; }); await bekle(150);
}

test('ayarlar: tum basliklar her kelimenin bas harfi buyuk ve kalin; aciklama yazilari normal agirlikta', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await ayarlariAc(h);
  const r = await h.sayfa.evaluate(() => {
    const BAGLAC = new Set(['ve', 'ile', 'veya', 'de', 'da', 'ki', 'mi', 'mı', 'mu', 'mü']);
    const baslikEl = [...document.querySelectorAll('#ayarKatman .ayar-baslik h2, #ayarKatman .ayar-icerik .satir label')].filter((e) => !e.closest('#grupListe'));
    return baslikEl.map((e) => {
      const metin = (e.childNodes[0].textContent || '').trim();
      const kotu = metin.split(/\s+/).filter((w, i) => /^\p{L}/u.test(w) && !(i > 0 && BAGLAC.has(w)) && w[0] !== w[0].toLocaleUpperCase('tr'));
      const small = e.querySelector('small');
      return { metin, kotu, agirlik: Number(getComputedStyle(e).fontWeight), smallAgirlik: small ? Number(getComputedStyle(small).fontWeight) : null };
    });
  });
  assert.ok(r.length >= 14, 'Ayarlar başlıkları bulunamadı: ' + r.length);
  for (const b of r) {
    assert.deepEqual(b.kotu, [], '"' + b.metin + '" başlığında küçük harfle başlayan kelime var');
    assert.ok(b.agirlik >= 600, '"' + b.metin + '" kalın değil: ' + b.agirlik);
    if (b.smallAgirlik !== null) assert.ok(b.smallAgirlik <= 400, 'açıklama yazısı normal kalmalı: ' + b.metin);
  }
  const metinler = r.map((b) => b.metin);
  for (const beklenen of ['Ayarlar', 'Telefon Eşlemesi', 'Toplama Geçmişi', 'Uygulama Verileri', 'Videoları da İndir', 'WhatsApp Web Sürümünü Sabitle', 'Kaç Gün Geriye Taransın?', 'Cam Saydamlığı'])
    assert.ok(metinler.includes(beklenen), beklenen + ' bulunamadı: ' + metinler.join(' | '));
  await foto(h, '17-ayar-basliklari');
});

test('telefon eslemesi satiri: baslik solda, durum rozeti sagda, iki esit dugme; nokta renkleri Bagli yesil, Bagli degil gri, gecici durum mavi', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await ayarlariAc(h);
  const nokta = () => h.sayfa.evaluate(() => { const e = document.getElementById('baglantiEtiket'); return { metin: e.textContent, durum: e.dataset.durum, renk: getComputedStyle(e, '::before').backgroundColor, ayrinti: document.getElementById('baglantiAyrinti').textContent, kapsamTasma: e.scrollWidth > e.clientWidth + 1 }; });
  const yerlesim = () => h.sayfa.evaluate(() => {
    const R = (e) => e.getBoundingClientRect(), satir = document.getElementById('baglanDugme').closest('.satir'), sr = R(satir);
    const lab = R(satir.querySelector('label')), roz = R(document.getElementById('baglantiEtiket')), a = R(document.getElementById('baglanDugme')), b = R(document.getElementById('esleşmeSifirla'));
    const ic = document.querySelector('.ayar-icerik');
    return { sol: lab.left - sr.left, rozetSag: sr.right - roz.right, rozetMerkez: (roz.top + roz.bottom) / 2, labelMerkez: (lab.top + lab.bottom) / 2,
      genislikFark: Math.abs(a.width - b.width), yukseklikFark: Math.abs(a.height - b.height), ustFark: Math.abs(a.top - b.top), altta: a.top > roz.bottom && b.top > roz.bottom,
      aralik: b.left - a.right, ikiKutu: [a.width, b.width], satirGenislik: sr.width, tasma: ic.scrollWidth > ic.clientWidth + 1, kutuIcinde: a.left >= sr.left - 1 && b.right <= sr.right + 1,
      cinsiyet: getComputedStyle(document.getElementById('baglanDugme')).backgroundColor };
  });
  // 1) eslesmis + bagli (sahte API varsayilani)
  let n = await nokta();
  assert.deepEqual([n.metin, n.durum, n.renk, n.ayrinti], ['Bağlı', 'bagli', 'rgb(95, 214, 138)', 'Telefondaki WhatsApp ile bağlantı']);
  const y = await yerlesim();
  assert.ok(y.sol >= 0 && y.sol < 6, 'başlık solda: ' + y.sol); assert.ok(y.rozetSag >= 0 && y.rozetSag < 6, 'rozet sağ köşede: ' + y.rozetSag);
  assert.ok(Math.abs(y.rozetMerkez - y.labelMerkez) < 14, 'rozet başlıkla aynı hizada');
  assert.ok(y.genislikFark <= 1 && y.yukseklikFark <= 1 && y.ustFark <= 1, 'iki düğme aynı boyutta ve hizada: ' + JSON.stringify(y));
  assert.ok(y.altta && y.kutuIcinde && !y.tasma && y.aralik > 6 && y.aralik < 24);
  assert.equal(await h.sayfa.$eval('#baglanDugme', (e) => e.disabled), true); assert.equal(await h.sayfa.$eval('#esleşmeSifirla', (e) => e.disabled), false);
  assert.equal(await h.sayfa.$eval('#baglanYazi', (e) => e.textContent), 'Bağlandı');
  await foto(h, '17b-eslesme-bagli');
  // 2) eslesmemis: gri nokta, QR aktif, cikis pasif
  await h.sayfa.evaluate(async () => { const d = await window.api.durumAl(); window.api.durumAl = async () => ({ ...d, eslesmeKayitli: false, bagli: false, baglantiDurumu: 'Bağlantı kapalı', calisiyor: false }); window.__cb.onBitti({ indirilen: 0, rapor: { sonuc: 'bitti' } }); });
  await bekle(250);
  n = await nokta();
  assert.deepEqual([n.metin, n.durum, n.renk], ['Bağlı değil', 'degil', 'rgb(139, 147, 163)']);
  assert.equal(await h.sayfa.$eval('#baglanDugme', (e) => e.disabled), false); assert.equal(await h.sayfa.$eval('#esleşmeSifirla', (e) => e.disabled), true);
  assert.equal(await h.sayfa.$eval('#baglanYazi', (e) => e.textContent), 'QR kod göster');
  await h.sayfa.evaluate(() => { const k = document.querySelector('.ayar-icerik'); k.scrollTop = k.scrollHeight; });
  await foto(h, '17c-eslesme-degil');
  // 3) QR kod gosterilirken / senkronizasyonda gecici durum: mavi nokta, rozet tasmaz
  for (const metin of ['WhatsApp açılıyor', 'QR bekleniyor', 'Senkronize ediliyor']) {
    await h.sayfa.evaluate((m) => window.__cb.onDurum({ metin: m }), metin); await bekle(100);
    n = await nokta();
    assert.deepEqual([n.metin, n.durum, n.renk], [metin, 'surer', 'rgb(143, 181, 242)']);
    assert.equal(n.kapsamTasma, false, 'rozet taşmamalı: ' + metin);
    assert.equal((await yerlesim()).tasma, false);
  }
  await h.sayfa.evaluate(() => window.__cb.onBitti({ indirilen: 0, rapor: { sonuc: 'bitti' } })); await bekle(250);
  n = await nokta(); assert.equal(n.durum, 'degil', 'iş bitince gerçek duruma döner');
  // 4) QR ile baglanti hatasi: hata aciklamada, rozet gri; ozet satiri bayat cikis yazisinda kalir (baglanti kurulmadi)
  await h.sayfa.evaluate(() => { document.getElementById('ozet').textContent = 'WhatsApp’tan çıkış yapıldı'; });
  await h.sayfa.evaluate(() => { window.api.baglan = async () => ({ hata: 'Bağlantı kurulamadı: deneme hatası' }); });
  await h.sayfa.evaluate(() => document.getElementById('baglanDugme').click()); await bekle(400);
  n = await nokta();
  assert.deepEqual([n.metin, n.durum, n.ayrinti], ['Bağlı değil', 'degil', 'Bağlantı kurulamadı: deneme hatası']);
  assert.equal(await h.sayfa.$eval('#ozet', (e) => e.textContent), 'WhatsApp’tan çıkış yapıldı', 'bağlantı kurulamadıysa özet değişmez');
  // 5) QR ile basarili baglanti: yesil
  await h.sayfa.evaluate(() => { window.api.baglan = async () => ({ bagli: true, liste: [] }); const d0 = window.api.durumAl; window.api.durumAl = async () => ({ ...(await d0()), eslesmeKayitli: true, bagli: true, baglantiDurumu: 'Bağlı' }); });
  await h.sayfa.evaluate(() => document.getElementById('baglanDugme').click()); await bekle(400);
  n = await nokta(); assert.deepEqual([n.metin, n.durum, n.renk], ['Bağlı', 'bagli', 'rgb(95, 214, 138)']);
  assert.equal(await h.sayfa.$eval('#ozet', (e) => e.textContent), 'Bağlandı · Topla’ya hazır', 'bağlanınca özet satırı yenilenir');
  assert.deepEqual(h.hatalar, []);
});

test('indirme hizi satiri: Yavas varsayilan; Orta ve Hizli uyari gosterir; Hizli onay ister; secim kaydedilir; satir tasmaz', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await tikla(h.sayfa, '#ayarAc'); await bekle(350);
  await h.sayfa.evaluate(() => document.getElementById('hizEtiket').closest('.satir').scrollIntoView({ block: 'center' })); await bekle(150);
  const durum = () => h.sayfa.evaluate(() => {
    const R = (e) => e.getBoundingClientRect(), satir = document.getElementById('hizEtiket').closest('.satir'), sr = R(satir), seg = R(document.querySelector('#hizEtiket ~ .seg')), lab = R(document.getElementById('hizEtiket')), ic = document.querySelector('.ayar-icerik');
    return { basili: ['hizYavas', 'hizOrta', 'hizHizli'].map((id) => document.getElementById(id).getAttribute('aria-pressed')), aciklama: document.getElementById('hizAciklama').textContent,
      uyari: document.getElementById('hizUyari').textContent, uyariGorunur: getComputedStyle(document.getElementById('hizUyari')).display !== 'none', uyariRenk: getComputedStyle(document.getElementById('hizUyari')).color,
      aciklamaRenk: getComputedStyle(document.getElementById('hizAciklama')).color, baslikAgirlik: Number(getComputedStyle(document.getElementById('hizEtiket')).fontWeight),
      segSag: sr.right - seg.right, hizalama: Math.abs((seg.top + seg.bottom) / 2 - (lab.top + lab.bottom) / 2), tasma: ic.scrollWidth > ic.clientWidth + 1, icinde: seg.left >= sr.left && seg.right <= sr.right };
  });
  let d = await durum();
  assert.deepEqual(d.basili, ['true', 'false', 'false']); assert.match(d.aciklama, /önerilen hız.*2–5 sn.*100 indirmede.*400 fotoğraf/); assert.equal(d.uyariGorunur, false);
  assert.ok(d.baslikAgirlik >= 600); assert.ok(d.segSag >= 0 && d.segSag < 8, 'seçim sağ köşede: ' + d.segSag); assert.ok(d.hizalama < 6 && d.icinde && !d.tasma);
  await foto(h, '18-hiz-yavas');
  await tikla(h.sayfa, '#hizOrta');
  d = await durum();
  assert.deepEqual(d.basili, ['false', 'true', 'false']); assert.match(d.aciklama, /1–3 sn.*150 indirmede.*600 fotoğraf/); assert.equal(d.uyariGorunur, true); assert.match(d.uyari, /biraz artırabilir/);
  assert.notEqual(d.uyariRenk, d.aciklamaRenk, 'uyarı ayrı renkte');
  assert.equal((await cagrilar(h.sayfa)).filter((x) => x[0] === 'hizOnayi').length, 0, 'Orta için onay sorulmaz');
  await foto(h, '18b-hiz-orta');
  // Hizli: onay reddedilirse degismez
  await h.sayfa.evaluate(() => { window.api.hizOnayi = async () => { window.__cagrilar.push(['hizOnayi']); return false; }; });
  await tikla(h.sayfa, '#hizHizli');
  assert.deepEqual((await durum()).basili, ['false', 'true', 'false'], 'onay verilmezse Orta kalır');
  assert.equal((await cagrilar(h.sayfa)).filter((x) => x[0] === 'hizOnayi').length, 1);
  // onay verilirse Hizli
  await h.sayfa.evaluate(() => { window.api.hizOnayi = async () => { window.__cagrilar.push(['hizOnayi']); return true; }; });
  await tikla(h.sayfa, '#hizHizli');
  d = await durum();
  assert.deepEqual(d.basili, ['false', 'false', 'true']); assert.match(d.aciklama, /0,5–1,5 sn.*200 indirmede.*800 fotoğraf/); assert.match(d.uyari, /belirgin şekilde artırabilir/);
  await h.sayfa.evaluate(() => document.getElementById('hizEtiket').closest('.satir').scrollIntoView({ block: 'center' })); await bekle(120);
  await foto(h, '18c-hiz-hizli');
  // Bitti: secim kaydedilir
  await tikla(h.sayfa, '#ayarKapat'); await bekle(200);
  const kayit = (await cagrilar(h.sayfa)).filter((x) => x[0] === 'ayarKaydet').pop();
  assert.equal(kayit[1].indirmeHizi, 'hizli');
  assert.deepEqual(h.hatalar, []);
});

test('ayarlar: bosluksuz cok uzun klasor yolu satira sarilir, yatay kaydirma cubugu cikmaz', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await h.sayfa.evaluate(async () => {
    const d = await window.api.durumAl();
    window.api.durumAl = async () => ({ ...d, ayar: { ...d.ayar, hedefKlasor: '/var/folders/4r/glmqdk8x2hsbphr3l8vbvh2r0000gn/T/' + 'Cok-Uzun-Klasor-Adi-'.repeat(6) } });
  });
  await tikla(h.sayfa, '#ayarAc'); await bekle(400);
  const o = await h.sayfa.evaluate(() => { const ic = document.querySelector('.ayar-icerik'), e = document.getElementById('klasorEtiket'); return { tasma: ic.scrollWidth > ic.clientWidth + 1, satir: Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight || 14)), metin: e.textContent.length }; });
  assert.ok(o.metin > 100);
  assert.equal(o.tasma, false, 'uzun yol yüzünden yatay kaydırma çıkmamalı');
  assert.ok(o.satir >= 2, 'uzun yol birden çok satıra sarılmalı');
});

// 2.0.2: elle cikista Ayarlar acikken "Çıkış yapılıyor" gorunur ve is bitince Bitti'ye basmadan rozet/QR dugmesi guncellenir;
// telefondan cikis haberi gelince Ayarlar acik olsa bile standart baslangica doner.
test('telefon eslemesi: elle cikis surerken ilerleme gorunur, bitince Bitti beklenmeden QR kod goster acilir; telefondan cikis haberi rozeti hemen gunceller', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  const oku = () => h.sayfa.evaluate(() => ({ rozet: document.getElementById('baglantiEtiket').textContent, durum: document.getElementById('baglantiEtiket').dataset.durum, ayrinti: document.getElementById('baglantiAyrinti').textContent, qrYazi: document.getElementById('baglanYazi').textContent, qrPasif: document.getElementById('baglanDugme').disabled, cikisPasif: document.getElementById('esleşmeSifirla').disabled, ayarAcik: !document.getElementById('ayarKatman').hidden, grupSayisi: document.querySelectorAll('#grupListe .grupsatir').length, ozet: document.getElementById('ozet').textContent }));
  // Ana surecin sirasi: onaydan sonra "suruyor" haberi -> (gecici tarayici, uzun surer) -> durum dosyalari -> 'bitti' -> cevap
  await h.sayfa.evaluate(() => {
    const d0 = window.api.durumAl; window.__cikildi = false;
    window.api.durumAl = async () => { const d = await d0(); return window.__cikildi ? { ...d, eslesmeKayitli: false, bagli: false, baglantiDurumu: 'Çıkış yapıldı' } : d; };
    window.api.whatsappCikis = async () => {
      window.__cb.onEslesme({ cikisSuruyor: true });
      await new Promise((r) => setTimeout(r, 700));
      window.__cikildi = true;
      window.__cb.onBitti({ mesaj: 'WhatsApp’tan çıkış yapıldı' });
      return { cikildi: true };
    };
  });
  await tikla(h.sayfa, '#ayarAc'); await bekle(300);
  let o = await oku();
  assert.deepEqual([o.rozet, o.qrPasif, o.cikisPasif], ['Bağlı', true, false]);
  await h.sayfa.evaluate(() => document.getElementById('esleşmeSifirla').click()); await bekle(200);
  o = await oku();
  assert.deepEqual([o.rozet, o.durum, o.qrPasif, o.cikisPasif], ['Çıkış yapılıyor', 'surer', true, true], 'çıkış sürerken ilerleme görünür, iki düğme kapalı');
  assert.match(o.ayrinti, /kapatılıyor/);
  await foto(h, '24a-cikis-suruyor');
  await bekle(900);
  o = await oku();
  assert.deepEqual([o.rozet, o.durum, o.qrYazi, o.qrPasif, o.cikisPasif, o.ayarAcik], ['Bağlı değil', 'degil', 'QR kod göster', false, true, true], 'Bitti’ye basmadan güncellenir');
  await foto(h, '24b-cikis-bitti');
  // Telefondan cikis: yeniden bagli gorunen durumdan baslar, grup listesi dolu
  await h.sayfa.evaluate(() => { window.__cikildi = false; window.__cb.onGruplar([{ ad: 'Grup A', son: 2 }, { ad: 'Grup B', son: 1 }]); });
  await h.sayfa.evaluate(() => window.__cb.onEslesme({ cikis: false, neden: 'CONFLICT' })); await bekle(200);
  o = await oku();
  assert.deepEqual([o.rozet, o.grupSayisi], ['Bağlı', 2], 'çıkış olmayan kopma eşleşmeyi ve listeyi silmez');
  await h.sayfa.evaluate(() => { window.__cikildi = true; window.__cb.onEslesme({ cikis: true, neden: 'LOGOUT' }); }); await bekle(250);
  o = await oku();
  assert.deepEqual([o.rozet, o.durum, o.qrYazi, o.qrPasif, o.cikisPasif, o.ayarAcik, o.grupSayisi], ['Bağlı değil', 'degil', 'QR kod göster', false, true, true, 0], 'telefondan çıkış: standart başlangıç');
  assert.match(o.ozet, /Telefon bağlantısı kaldırılmış/);
  await foto(h, '24c-telefondan-cikis');
  assert.deepEqual(h.hatalar, []);
});

// 2.0.2: grup secimi cikista korunur; yeni listede olmayan gruplar secimden duser; 0 grupta Vazgec'ten sonra ekran eski haline doner.
test('grup secimi: cikista korunur, yeni listede olmayan grup duser, Bitti ile kaydedilir; 0 grup sorusunda Vazgec ekrani geri birakir', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await h.sayfa.evaluate(() => {
    const d0 = window.api.durumAl;
    window.api.durumAl = async () => { const d = await d0(); return { ...d, ayar: { ...d.ayar, sadeceSuGruplar: ['Grup A', 'Grup B'] } }; };
    window.api.gruplarAl = async () => [{ ad: 'Grup A', son: 2 }, { ad: 'Grup B', son: 1 }];
  });
  await tikla(h.sayfa, '#ayarAc'); await bekle(300);
  const isaretli = () => h.sayfa.$$eval('#grupListe .grupsatir[aria-checked="true"] .ad', (l) => l.map((e) => e.textContent));
  assert.deepEqual(await isaretli(), ['Grup A', 'Grup B']);
  assert.equal(await h.sayfa.$eval('#grupOzet', (e) => e.textContent), '2 grup seçili');
  await h.sayfa.evaluate(() => document.getElementById('esleşmeSifirla').click()); await bekle(300);
  assert.equal(await h.sayfa.$$eval('#grupListe .grupsatir', (l) => l.length), 0, 'çıkışta liste boşalır');
  assert.equal(await h.sayfa.$eval('#grupOzet', (e) => e.textContent), '2 grup seçili', 'seçim korunur');
  await h.sayfa.evaluate(() => window.__cb.onGruplar([{ ad: 'Grup A', son: 3 }, { ad: 'Grup C', son: 1 }])); await bekle(150);
  assert.deepEqual(await isaretli(), ['Grup A'], 'yeni listede olmayan Grup B düşer');
  await tikla(h.sayfa, '#ayarKapat'); await bekle(200);
  const kayit = (await cagrilar(h.sayfa)).filter((c) => c[0] === 'ayarKaydet').pop();
  assert.deepEqual(kayit[1].sadeceSuGruplar, ['Grup A']);
  // 0 grup: ana surec soruyu sorar; Vazgec'te Topla geri gelir, ozet nedeni yazar
  await h.sayfa.evaluate(() => { window.api.topla = async () => ({ iptal: true, mesaj: 'Başlamadı: hiç grup seçilmedi' }); });
  await tikla(h.sayfa, '#topla'); await bekle(250);
  assert.equal(await h.sayfa.$eval('#topla', (e) => e.disabled), false);
  assert.equal(await h.sayfa.$eval('#toplaYazi', (e) => e.textContent), 'Topla');
  assert.equal(await h.sayfa.$eval('#ozet', (e) => e.textContent), 'Başlamadı: hiç grup seçilmedi');
  assert.deepEqual(h.hatalar, []);
});

test('ayarlar: PDF’leri de Indir satiri Videolari da Indir’in hemen altinda; acilip kapanir ve Bitti ile kaydedilir', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await tikla(h.sayfa, '#ayarAc'); await bekle(300);
  const sira = await h.sayfa.evaluate(() => { const v = document.getElementById('videoAnahtar').closest('.satir'); return { sonraki: v.nextElementSibling?.querySelector('button')?.id, etiket: v.nextElementSibling?.querySelector('label')?.textContent }; });
  assert.deepEqual(sira, { sonraki: 'pdfAnahtar', etiket: 'PDF’leri de İndirKapalıyken PDF alınmaz' });
  assert.equal(await h.sayfa.$eval('#pdfAnahtar', (e) => e.getAttribute('aria-checked')), 'false', 'varsayılan kapalı');
  await tikla(h.sayfa, '#pdfAnahtar');
  assert.equal(await h.sayfa.$eval('#pdfAnahtar', (e) => e.getAttribute('aria-checked')), 'true');
  await tikla(h.sayfa, '#ayarKapat'); await bekle(200);
  const kayit = (await cagrilar(h.sayfa)).filter((c) => c[0] === 'ayarKaydet').pop();
  assert.equal(kayit[1].pdfleriDaIndir, true);
  assert.equal(kayit[1].videolariDaIndir, false, 'video ayarı etkilenmez');
  assert.deepEqual(h.hatalar, []);
});

// 2.0.2: galeride video ve PDF: karo (tur etiketi, oynat isareti, kucuk resim yoksa ikon + PDF adi), gun basliginda "dosya",
// buyuk gorunumde video oynatici ve PDF karti (PDF'i Ac), aramada PDF adi bulunur.
function karisikVeri() {
  const k = path.join(gecici, 'karisik', '2026-10-03', 'g');
  fs.mkdirSync(k, { recursive: true });
  const yaz = (ad, icerik) => { const y = path.join(k, ad); fs.writeFileSync(y, icerik); return y; };
  const foto = yaz('2026-10-03_10-00-00_Saha_0.png', png(76, 123, 208));
  const kucukVideo = yaz('kucuk-video.png', png(40, 50, 90));
  const video = yaz('2026-10-03_11-00-00_Saha.mp4', Buffer.alloc(64));
  const pdf = yaz('2026-10-03_12-00-00_Saha_Keşif raporu.pdf', '%PDF-1.4\n');
  const k2 = path.join(gecici, 'karisik', '2026-10-02', 'g'); fs.mkdirSync(k2, { recursive: true });
  const foto2 = path.join(k2, '2026-10-02_09-00-00_Saha_0.png'); fs.writeFileSync(foto2, png(47, 174, 98));
  return [
    { gun: '2026-10-03', dosyalar: [
      { ad: path.basename(pdf), yol: pdf, kucuk: null, tur: 'pdf', boyut: 1468006, grup: 'Saha', gonderen: 'Ayşe K.', aciklama: null, notlar: [], gruplar: [] },
      { ad: path.basename(video), yol: video, kucuk: kucukVideo, tur: 'video', boyut: 64, grup: 'Saha', gonderen: null, aciklama: 'Kaldırım onarımı videosu', notlar: [], gruplar: [] },
      { ad: path.basename(foto), yol: foto, kucuk: foto, tur: 'resim', boyut: null, grup: 'Saha', gonderen: null, aciklama: null, notlar: [], gruplar: [] },
    ] },
    { gun: '2026-10-02', dosyalar: [{ ad: path.basename(foto2), yol: foto2, kucuk: foto2, tur: 'resim', boyut: null, grup: 'Saha', gonderen: null, aciklama: null, notlar: [], gruplar: [] }] },
  ];
}
test('galeri: video ve PDF karolari, gun basliginda dosya sayisi, buyuk gorunumde video oynatici ve PDF karti; aramada PDF adi bulunur', { skip: ATLA }, async (t) => {
  const h = await ac(t, { veri: karisikVeri() });
  const karolar = () => h.sayfa.$$eval('.bolum:not(.kapali) .kare', (l) => l.map((k) => ({ tur: k.querySelector('.tur')?.textContent || null, oynat: !!k.querySelector('.oynat'), ikonlu: k.classList.contains('ikonlu'), ad: k.querySelector('.yedek-ikon small')?.textContent || null })));
  await bekle(400);
  const k = await karolar();
  assert.deepEqual(k, [
    { tur: 'PDF', oynat: false, ikonlu: true, ad: 'Keşif raporu.pdf' },
    { tur: 'VİDEO', oynat: true, ikonlu: false, ad: null },
    { tur: null, oynat: false, ikonlu: false, ad: null },
  ]);
  assert.equal(await h.sayfa.$eval('.bolum:not(.kapali) .kare.k-pdf img', (e) => e.getAttribute('src')), null, 'küçük resmi olmayan PDF resim olarak yüklenmeye çalışılmaz');
  const adetler = await h.sayfa.$$eval('.gun-adet', (l) => l.map((e) => e.textContent));
  assert.deepEqual(adetler, ['3 dosya', '1 foto']);
  await foto(h, '25a-galeri-video-pdf');
  // Buyuk gorunum: PDF karti
  await h.sayfa.evaluate(() => document.querySelectorAll('.bolum:not(.kapali) .kare')[0].click()); await bekle(250);
  const gorunen = () => h.sayfa.evaluate(() => ({ resim: !document.getElementById('buyukResim').hidden && getComputedStyle(document.getElementById('buyukResim')).display !== 'none', video: !document.getElementById('buyukVideo').hidden && getComputedStyle(document.getElementById('buyukVideo')).display !== 'none', belge: !document.getElementById('buyukBelge').hidden && getComputedStyle(document.getElementById('buyukBelge')).display !== 'none', videoSrc: document.getElementById('buyukVideo').getAttribute('src') || '' }));
  let g = await gorunen();
  assert.deepEqual([g.resim, g.video, g.belge], [false, false, true]);
  assert.equal(await h.sayfa.$eval('#belgeAd', (e) => e.textContent), 'Keşif raporu.pdf');
  assert.match(await h.sayfa.$eval('#belgeBilgi', (e) => e.textContent), /^Saha · .+ · 1,4 MB$/);
  await foto(h, '25b-buyuk-pdf');
  await tikla(h.sayfa, '#belgeAc');
  const acmalar = (await cagrilar(h.sayfa)).filter((c) => c[0] === 'dosyaAc');
  assert.equal(acmalar.length, 1); assert.match(acmalar[0][1], /Keşif raporu\.pdf$/);
  // Video
  await h.sayfa.keyboard.press('ArrowRight'); await bekle(250);
  g = await gorunen();
  assert.deepEqual([g.resim, g.video, g.belge], [false, true, false]);
  assert.match(g.videoSrc, /^file:.*\.mp4$/);
  await foto(h, '25c-buyuk-video');
  // Fotograf: video birakilir
  await h.sayfa.keyboard.press('ArrowRight'); await bekle(250);
  g = await gorunen();
  assert.deepEqual([g.resim, g.video, g.belge, g.videoSrc], [true, false, false, ''], 'videodan çıkınca oynatıcı boşaltılır');
  await h.sayfa.keyboard.press('ArrowLeft'); await bekle(200);
  assert.equal((await gorunen()).video, true);
  await h.sayfa.keyboard.press('Escape'); await bekle(200);
  assert.equal(await h.sayfa.$eval('#buyukVideo', (e) => e.getAttribute('src')), null, 'kapatınca video durur ve boşaltılır');
  // Arama: PDF adiyla bulunur
  await h.sayfa.type('#arama', 'keşif'); await bekle(450);
  assert.deepEqual((await karolar()).map((x) => x.tur), ['PDF']);
  const csp = h.hatalar.filter((m) => /Content Security Policy|Refused to load/i.test(m));
  assert.deepEqual(csp, [], 'güvenlik ayarı video ve küçük resimleri engellemez');
});

test('ayarlar: Acilista Otomatik Topla satiri eski Acilista Uygulamayi Ac yerine gelir, varsayilan kapali, Bitti ile kaydedilir', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await tikla(h.sayfa, '#ayarAc'); await bekle(300);
  assert.equal(await h.sayfa.evaluate(() => document.getElementById('otomatikAnahtar').closest('.satir').querySelector('label').textContent), 'Açılışta Otomatik ToplaBilgisayar açılınca ya da uykudan uyanınca arka planda toplar');
  assert.equal(await h.sayfa.evaluate(() => document.body.textContent.includes('Açılışta Uygulamayı Aç')), false);
  assert.equal(await h.sayfa.$eval('#otomatikAnahtar', (e) => e.getAttribute('aria-checked')), 'false');
  await tikla(h.sayfa, '#otomatikAnahtar');
  await tikla(h.sayfa, '#ayarKapat'); await bekle(200);
  const kayit = (await cagrilar(h.sayfa)).filter((c) => c[0] === 'ayarKaydet').pop();
  assert.equal(kayit[1].acilistaOtomatikTopla, true);
  assert.equal('otomatikCalistir' in kayit[1], false, 'eski anahtar gönderilmez');
  assert.deepEqual(h.hatalar, []);
});

// 2.0.2: Ayarlar karti %30 buyuk; yazi, dugme, ikon, anahtar ayni oranda; sira ve yerler degismez; en kucuk pencerede de tasmaz.
test('ayarlar karti %30 buyuk: oranlar korunur, satir sirasi ayni, 620x520 pencerede tasmaz ve en alta inilir; diger kartlar etkilenmez', { skip: ATLA }, async (t) => {
  for (const [w, y] of [[620, 520], [1180, 860]]) {
    const h = await ac(t, { genislik: w, yukseklik: y });
    await tikla(h.sayfa, '#ayarAc'); await bekle(350);
    const o = await h.sayfa.evaluate(() => {
      const k = document.querySelector('.ayar-karti'), r = k.getBoundingClientRect(), ic = document.querySelector('.ayar-icerik');
      const satirlar = [...ic.querySelectorAll(':scope > .satir')];
      const ustler = satirlar.map((x) => x.getBoundingClientRect().top);
      const anahtar = document.getElementById('videoAnahtar').getBoundingClientRect();
      const karo = document.querySelector('#ayarX .tl').getBoundingClientRect();
      const tekerlek = document.getElementById('gunTekerlek').getBoundingClientRect();
      const secili = document.querySelector('#gunSecenekleri [aria-selected="true"]');
      secili.scrollIntoView({ block: 'nearest' });
      const s = secili.getBoundingClientRect(), t2 = document.getElementById('gunTekerlek').getBoundingClientRect();
      ic.scrollTop = ic.scrollHeight;
      const son = satirlar[satirlar.length - 1].getBoundingClientRect(), icR = ic.getBoundingClientRect();
      return {
        zoom: getComputedStyle(k).zoom, genislik: r.width, icerde: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        yanTasma: ic.scrollWidth > ic.clientWidth || document.documentElement.scrollWidth > innerWidth,
        satirSayisi: satirlar.length, sirali: ustler.every((u, i) => i === 0 || u > ustler[i - 1]),
        anahtar: [anahtar.width, anahtar.height], karo: [karo.width, karo.height], tekerlekYuksek: tekerlek.height,
        seciliTekerlekte: s.top >= t2.top - 1 && s.bottom <= t2.bottom + 1, sonGorunur: son.bottom <= icR.bottom + 1,
        digerKart: getComputedStyle(document.querySelector('#qrKatman .kart')).zoom,
      };
    });
    assert.equal(o.zoom, '1.3', w + ': ölçek');
    assert.ok(Math.abs(o.genislik - 380 * 1.3) < 1, w + ': genişlik 494: ' + o.genislik);
    assert.ok(o.icerde, w + ': kart pencerenin içinde'); assert.equal(o.yanTasma, false, w + ': yan kaydırma yok');
    assert.equal(o.satirSayisi, 16); assert.equal(o.sirali, true, 'satır sırası değişmez');
    assert.ok(Math.abs(o.anahtar[0] - 46 * 1.3) < 0.6 && Math.abs(o.anahtar[1] - 27 * 1.3) < 0.6, 'anahtar aynı oranda: ' + o.anahtar);
    assert.ok(Math.abs(o.karo[0] - 34 * 1.3) < 0.6, 'ikon karosu aynı oranda: ' + o.karo);
    assert.equal(o.seciliTekerlekte, true, 'gün tekerleğinde seçili gün görünür');
    assert.equal(o.sonGorunur, true, 'en alttaki satıra inilir');
    assert.equal(o.digerKart, '1', 'diğer kartlar büyümez');
    await foto(h, '26-ayarlar-' + w + 'x' + y);
    assert.deepEqual(h.hatalar, []);
  }
});
