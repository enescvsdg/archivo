// Yetim Chrome temizligi: yalnizca Archivo'nun kendi oturum klasoruyle acilmis surecler secilir ve kapatilir.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { surecListesiniCoz, klasorEslesiyor, yetimPidleri, yetimleriKapat, surecleriListele } = require('../browser-processes');

const MAC_KLASOR = '/Users/ali/Library/Application Support/wa-foto-arsivi/profiller/2.0.2/oturum/session';
const WIN_KLASOR = 'C:\\Users\\Ali\\AppData\\Roaming\\wa-foto-arsivi\\profiller\\2.0.2\\oturum\\session';

test('process lists from ps (Mac/Linux) and PowerShell (Windows) are parsed into pid and command', () => {
  const mac = surecListesiniCoz('  101 /Applications/Chrome --user-data-dir=/a b/c --type=renderer\n202 /usr/bin/zsh\n\n  bozuk satir\n', 'darwin');
  assert.deepEqual(mac.map((s) => s.pid), [101, 202]);
  assert.match(mac[0].komut, /--user-data-dir=\/a b\/c/);
  const win = surecListesiniCoz('4\t\r\n812\t"C:\\chrome.exe" "--user-data-dir=C:\\x y\\session" --no-sandbox\r\n900\t\r\n', 'win32');
  assert.deepEqual(win.map((s) => s.pid), [812], 'komut satırı boş olan sistem süreçleri atlanır');
});

test('only the exact Archivo session folder matches; other profiles, versions and the user Chrome do not', () => {
  const kendi = '/Applications/Chrome for Testing --user-data-dir=' + MAC_KLASOR + ' --remote-debugging-port=0';
  assert.equal(klasorEslesiyor(kendi, MAC_KLASOR, 'darwin'), true);
  assert.equal(klasorEslesiyor('chrome --type=gpu-process --user-data-dir=' + MAC_KLASOR, MAC_KLASOR, 'darwin'), true, 'yardımcı süreç de bu Chrome’a ait');
  assert.equal(klasorEslesiyor('chrome --user-data-dir=' + MAC_KLASOR, MAC_KLASOR + '/', 'darwin'), true, 'sondaki eğik çizgi fark etmez');
  assert.equal(klasorEslesiyor('chrome --user-data-dir=' + MAC_KLASOR + '-2', MAC_KLASOR, 'darwin'), false, 'session-2 başka klasör');
  assert.equal(klasorEslesiyor('chrome --user-data-dir=' + MAC_KLASOR + '/alt', MAC_KLASOR, 'darwin'), false, 'alt klasör başka');
  assert.equal(klasorEslesiyor('chrome --user-data-dir=' + MAC_KLASOR.replace('2.0.2', '2.0.1'), MAC_KLASOR, 'darwin'), false, 'eski sürümün klasörü');
  assert.equal(klasorEslesiyor('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', MAC_KLASOR, 'darwin'), false, 'kullanıcının kendi Chrome’u');
  assert.equal(klasorEslesiyor('chrome --user-data-dir=' + MAC_KLASOR.toUpperCase(), MAC_KLASOR, 'darwin'), false, 'Mac’te büyük-küçük harf farkı ayrı klasördür');
  // Windows: tirnak, buyuk-kucuk harf ve egik cizgi farki ayni klasoru gosterir.
  assert.equal(klasorEslesiyor('"C:\\chrome.exe" "--user-data-dir=' + WIN_KLASOR.toLowerCase() + '" --no-sandbox', WIN_KLASOR, 'win32'), true);
  assert.equal(klasorEslesiyor('chrome.exe --user-data-dir=' + WIN_KLASOR.replace(/\\/g, '/'), WIN_KLASOR, 'win32'), true);
  assert.equal(klasorEslesiyor('chrome.exe "--user-data-dir=' + WIN_KLASOR + '-2"', WIN_KLASOR, 'win32'), false);
});

test('the app itself and explicitly excluded processes are never selected', () => {
  const surecler = [
    { pid: process.pid, komut: 'node --user-data-dir=' + MAC_KLASOR },
    { pid: 31, komut: 'chrome --user-data-dir=' + MAC_KLASOR },
    { pid: 32, komut: 'chrome --user-data-dir=' + MAC_KLASOR },
    { pid: 33, komut: 'chrome --user-data-dir=/baska' },
  ];
  assert.deepEqual(yetimPidleri(surecler, MAC_KLASOR, 'darwin', [32]), [31]);
});

test('with no matching process nothing is closed and listing errors are reported to the caller', async () => {
  assert.deepEqual(await yetimleriKapat(MAC_KLASOR, { platform: 'darwin', listele: async () => [{ pid: 9, komut: 'chrome --user-data-dir=/baska' }] }), []);
  await assert.rejects(yetimleriKapat(MAC_KLASOR, { listele: async () => { throw new Error('ps yok'); } }), /ps yok/);
});

// Gercek surecler: biri Archivo klasoruyle, biri benzer ama farkli klasorle acilir. Yalniz ilki kapatilir.
test('real processes: the leftover process with our session folder is closed, the look-alike stays running', async (t) => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'archivo yetim '));
  const betik = path.join(kok, 'bekle.js');
  fs.writeFileSync(betik, 'setInterval(() => {}, 1000);');
  const klasor = path.join(kok, 'oturum', 'session');
  const yetim = spawn(process.execPath, [betik, '--user-data-dir=' + klasor], { stdio: 'ignore' });
  const benzer = spawn(process.execPath, [betik, '--user-data-dir=' + klasor + '-2'], { stdio: 'ignore' });
  const kapanis = (c) => new Promise((r) => { if (c.exitCode !== null || c.signalCode) r(); else c.once('exit', r); });
  t.after(async () => { for (const c of [yetim, benzer]) try { c.kill('SIGKILL'); } catch (e) {} fs.rmSync(kok, { recursive: true, force: true }); });
  // Surec listede gorunene kadar bekle (Windows'ta komut satiri biraz gec gelebilir).
  for (let n = 0; n < 50; n++) {
    const l = await surecleriListele();
    if (l.some((s) => s.pid === yetim.pid) && l.some((s) => s.pid === benzer.pid)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const kapatilan = await yetimleriKapat(klasor, { bekleme: 2000 });
  assert.deepEqual(kapatilan, [yetim.pid]);
  await kapanis(yetim);
  assert.ok(yetim.exitCode !== null || yetim.signalCode, 'yetim süreç kapandı');
  assert.equal(benzer.exitCode, null, 'benzer klasörlü süreç çalışmaya devam ediyor');
  assert.equal(benzer.signalCode, null);
});

// Canli testteki hatanin aynisi: ayni oturum klasorunu tutan yetim Chrome varken yeni tarayici "already running" ile acilamaz;
// temizlikten sonra acilir. Chrome for Testing yoksa (CI indirme atladiysa) test atlanir.
const { CHROME, puppeteer, ATLA } = require('./ui-yardimci');
test('real Chrome: a leftover browser holding the session folder blocks a new launch; after cleanup the launch works', { skip: ATLA }, async (t) => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'archivo-chrome-'));
  const klasor = path.join(kok, 'oturum', 'session');
  fs.mkdirSync(klasor, { recursive: true });
  const yetim = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-sandbox', '--user-data-dir=' + klasor, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  t.after(async () => { try { yetim.kill('SIGKILL'); } catch (e) {} await new Promise((r) => setTimeout(r, 300)); fs.rmSync(kok, { recursive: true, force: true }); });
  for (let n = 0; n < 60; n++) {
    if ((await surecleriListele()).filter((s) => klasorEslesiyor(s.komut, klasor)).length) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 800)); // profil kilidi olussun
  await assert.rejects(puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: klasor, args: ['--no-sandbox'] }), /already running|Failed to launch|exited/i, 'yetim Chrome varken yeni tarayıcı açılamamalı');
  const kapatilan = await yetimleriKapat(klasor);
  assert.ok(kapatilan.includes(yetim.pid), 'ana Chrome süreci kapatıldı');
  assert.deepEqual((await surecleriListele()).filter((s) => klasorEslesiyor(s.komut, klasor)).map((s) => s.pid), [], 'bu klasörü tutan süreç kalmadı');
  const tarayici = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: klasor, args: ['--no-sandbox'] });
  assert.ok(tarayici.connected ?? tarayici.isConnected());
  await tarayici.close();
});
