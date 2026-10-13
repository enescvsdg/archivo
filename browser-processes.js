// Archivo'nun kendi Chrome sureclerini bulur ve kapatir.
// Yalnizca komut satirinda tam olarak Archivo'nun oturum klasoru (--user-data-dir) gecen surecler secilir;
// kullanicinin kendi Chrome'una ya da baska bir Archivo surumunun klasorune dokunulmaz.
const { execFile } = require('child_process');

function surecListesiniCoz(metin, platform = process.platform) {
  const surecler = [];
  for (const satir of String(metin || '').split(/\r?\n/)) {
    const m = platform === 'win32' ? satir.match(/^\s*(\d+)\t(.*)$/) : satir.match(/^\s*(\d+)\s+(.*)$/);
    if (m && m[2].trim()) surecler.push({ pid: Number(m[1]), komut: m[2] });
  }
  return surecler;
}

function klasorEslesiyor(komut, klasor, platform) {
  const winMi = platform === 'win32';
  const duzelt = (s) => {
    let d = String(s).replace(/"/g, '');
    if (winMi) d = d.replace(/\//g, '\\').toLowerCase();
    return d;
  };
  const metin = duzelt(komut), aranan = '--user-data-dir=' + duzelt(klasor).replace(/[\\/]+$/, '');
  for (let i = metin.indexOf(aranan); i !== -1; i = metin.indexOf(aranan, i + 1)) {
    const sonraki = metin[i + aranan.length];
    // Tam klasor: ".../session" eslesir, ".../session-2" ya da ".../session/alt" eslesmez.
    if (sonraki === undefined || /\s/.test(sonraki)) return true;
  }
  return false;
}

function yetimPidleri(surecler, klasor, platform = process.platform, haric = []) {
  const disla = new Set([process.pid, process.ppid, ...haric].filter(Boolean));
  return surecler.filter((s) => !disla.has(s.pid) && klasorEslesiyor(s.komut, klasor, platform)).map((s) => s.pid);
}

function surecleriListele(platform = process.platform) {
  return new Promise((resolve, reject) => {
    const [komut, argumanlar] = platform === 'win32'
      ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }']]
      : ['ps', ['-axww', '-o', 'pid=,command=']];
    execFile(komut, argumanlar, { maxBuffer: 32 * 1024 * 1024, windowsHide: true, timeout: 15000 }, (hata, cikti) => {
      if (hata) reject(hata); else resolve(surecListesiniCoz(cikti, platform));
    });
  });
}

const yasiyor = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

// Once nazikce (SIGTERM) kapatir; bekleme sonunda hala yasayanlari zorla (SIGKILL) sonlandirir.
async function pidleriKapat(pidler, { bekleme = 3000 } = {}) {
  const hedef = [...new Set(pidler)].filter(yasiyor);
  for (const pid of hedef) { try { process.kill(pid, 'SIGTERM'); } catch (e) {} }
  for (let gecen = 0; gecen < bekleme && hedef.some(yasiyor); gecen += 100) await bekle(100);
  for (const pid of hedef.filter(yasiyor)) { try { process.kill(pid, 'SIGKILL'); } catch (e) {} }
  return hedef;
}

async function yetimleriKapat(klasor, { platform = process.platform, haric = [], bekleme = 3000, listele = surecleriListele } = {}) {
  const pidler = yetimPidleri(await listele(platform), klasor, platform, haric);
  return pidler.length ? pidleriKapat(pidler, { bekleme }) : [];
}

module.exports = { surecListesiniCoz, klasorEslesiyor, yetimPidleri, surecleriListele, pidleriKapat, yetimleriKapat };
