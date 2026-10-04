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
  await sayfa.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
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
  assert.deepEqual(k.map((x) => x.gun), beklenen.map((x) => x.gun));
  for (const x of k) assert.equal(x.adet, beklenen.find((b) => b.gun === x.gun).n + ' foto');
  assert.equal(k.filter((x) => x.acik).length, 1);
  const baska = await h.sayfa.$$eval('.kare', (l) => l.filter((e) => e._veri.grup !== '3.Bölge Şoför ve Operatör').length);
  assert.equal(baska, 0, 'başka grubun fotoğrafı görünmemeli');
  assert.equal((await h.sayfa.$$('.kare.solgun')).length, 0);
  await foto(h, '03-grup-gorunumu');
  await cipTikla(h.sayfa, 'Tümü');
  assert.equal((await kartlar(h.sayfa)).length, h.veri.length);
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

test('sayfalama: 250 fotografli gun 100luk sayfada 3 sayfa; ARCHIV + O, marka yazi tipi; Onceki/Sonraki; boyut degisince 5 sayfa', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await grupSec(h.sayfa, 'Acil Müdahale Ekibi');
  let k = await kartlar(h.sayfa);
  assert.equal(k.find((x) => x.gun === '2026-10-02').adet, '250 foto');
  await h.sayfa.evaluate(() => [...document.querySelectorAll('.bolum')].find((b) => b.dataset.gun === '2026-10-02').querySelector('.gun-ac').click());
  await bekle(150);
  const gun = '.bolum[data-gun="2026-10-02"]';
  assert.equal(await h.sayfa.$$eval(gun + ' .kare', (l) => l.length), 100);
  assert.equal(await h.sayfa.$$eval(gun + ' .sy', (l) => l.length), 3);
  assert.equal(await h.sayfa.$eval(gun + ' .sy[aria-current="page"] b', (e) => e.textContent), '1');
  assert.equal(await h.sayfa.$eval(gun + ' .marka-sayfa .kok', (e) => e.textContent), 'Archiv');
  assert.match(await h.sayfa.$eval(gun + ' .marka-sayfa', (e) => getComputedStyle(e).fontFamily), /Iceberg/);
  assert.equal(await h.sayfa.$eval(gun + ' .marka-sayfa', (e) => getComputedStyle(e).textTransform), 'uppercase');
  assert.equal(await h.sayfa.$(gun + ' [data-git="-1"]'), null, '1. sayfada Önceki olmamalı');
  assert.ok(await h.sayfa.$(gun + ' [data-git="1"]'));
  const ilkYol = await h.sayfa.$eval(gun + ' .kare', (e) => e._veri.yol);
  await h.sayfa.evaluate(() => document.querySelector('.bolum[data-gun="2026-10-02"] .sayfalama').scrollIntoView({ block: 'center' })); await bekle(120);
  await foto(h, '04-sayfalama-1');
  await tikla(h.sayfa, gun + ' [data-git="1"]');
  assert.equal(await h.sayfa.$eval(gun + ' .sy[aria-current="page"] b', (e) => e.textContent), '2');
  assert.notEqual(await h.sayfa.$eval(gun + ' .kare', (e) => e._veri.yol), ilkYol);
  assert.ok(await h.sayfa.$(gun + ' [data-git="-1"]'));
  await tikla(h.sayfa, gun + ' .sy[data-sayfa="3"]');
  assert.equal(await h.sayfa.$$eval(gun + ' .kare', (l) => l.length), 50, 'son sayfada 50 fotoğraf');
  assert.equal(await h.sayfa.$(gun + ' [data-git="1"]'), null, 'son sayfada Sonraki olmamalı');
  await h.sayfa.evaluate(() => document.querySelector('.bolum[data-gun="2026-10-02"] .sayfalama').scrollIntoView({ block: 'center' })); await bekle(120);
  await foto(h, '05-sayfalama-3');
  await tikla(h.sayfa, gun + ' [data-boy="50"]');
  assert.equal(await h.sayfa.$$eval(gun + ' .sy', (l) => l.length), 5);
  assert.equal(await h.sayfa.$eval(gun + ' .sy[aria-current="page"] b', (e) => e.textContent), '1');
  assert.equal(await h.sayfa.evaluate(() => localStorage.getItem('archivo.sayfaBoyu')), '50');
});

test('50den az fotografli gunde sayfalama gorunmez', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  assert.equal(await h.sayfa.$eval('.bolum .sayfalama', (e) => e.hidden), true);
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
  assert.equal((await kartlar(h.sayfa)).length, h.veri.length);
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
  assert.equal((await kartlar(h.sayfa)).length, h.veri.length);
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
  assert.equal((await kartlar(h.sayfa)).length, h.veri.length);
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

test('buyuk onizleme: gorunumdeki fotograflar arasinda gezer; kapatinca kart o fotografin sayfasina gecer', { skip: ATLA }, async (t) => {
  const h = await ac(t);
  await grupSec(h.sayfa, 'Acil Müdahale Ekibi');
  await h.sayfa.evaluate(() => [...document.querySelectorAll('.bolum')].find((b) => b.dataset.gun === '2026-10-02').querySelector('.gun-ac').click()); await bekle(150);
  const gun = '.bolum[data-gun="2026-10-02"]';
  await tikla(h.sayfa, gun + ' .sy[data-sayfa="2"]');
  const yol = await h.sayfa.$eval(gun + ' .kare', (e) => e._veri.yol);
  await tikla(h.sayfa, gun + ' .kare');
  assert.equal(await h.sayfa.$eval('#buyukKatman', (e) => e.hidden), false);
  assert.match(await h.sayfa.$eval('#buyukBilgi', (e) => e.textContent), /Acil Müdahale Ekibi/);
  assert.match(await h.sayfa.$eval('#buyukBilgi span', (e) => e.textContent), /2 Ekim 2026/);
  assert.equal((await h.sayfa.$eval('#buyukResim', (e) => e.src)).includes(encodeURIComponent(path.basename(yol))), true);
  await foto(h, '10-buyuk-onizleme');
  for (let n = 0; n < 120; n++) await h.sayfa.keyboard.press('ArrowRight');
  await bekle(100);
  await h.sayfa.keyboard.press('Escape'); await bekle(250);
  assert.equal(await h.sayfa.$eval('#buyukKatman', (e) => e.hidden), true);
  const sayfa = await h.sayfa.$eval(gun + ' .sy[aria-current="page"] b', (e) => e.textContent);
  assert.equal(sayfa, '3', '2. sayfanın ilk fotoğrafından (sıra 100) 120 ilerleyince sıra 220 = 3. sayfa');
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
  const metinDugmeleri = await h.sayfa.evaluate(() => [...document.querySelectorAll('button')].filter((b) => !b.classList.contains('dg') && !b.querySelector('svg') && !b.classList.contains('anahtar') && !b.classList.contains('cp') && !b.classList.contains('tk-gun') && !b.classList.contains('tk-ok') && !b.classList.contains('sy') && !b.classList.contains('snb') && !b.classList.contains('gun-ac') && !b.classList.contains('kare') && !b.classList.contains('gun-secenek') && !b.classList.contains('grupsatir') && !b.id.match(/^(topla|yol)$/)).map((b) => b.id || b.className));
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
  await grupSec(h.sayfa, 'Acil Müdahale Ekibi');
  await tikla(h.sayfa, '.bolum[data-gun="2026-10-02"] .gun-ac');
  const buyuk = await h.sayfa.$eval('.bolum[data-gun="2026-10-02"] .marka-sayfa .kok', (e) => { const r = document.createRange(); r.selectNodeContents(e); return e.innerText; });
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
