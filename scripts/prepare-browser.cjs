const path = require('node:path');
const fs = require('node:fs');
const entry = require.resolve('puppeteer', { paths: [path.dirname(require.resolve('whatsapp-web.js'))] });
const puppeteer = require(entry);
const browsers = require(require.resolve('@puppeteer/browsers', { paths: [path.dirname(entry)] }));
async function prepare(platform = browsers.detectBrowserPlatform(), offline = false) {
  const cached = (await browsers.getInstalledBrowsers({ cacheDir: path.join(__dirname, '../chromium') })).find(b => b.browser === browsers.Browser.CHROME && b.buildId === puppeteer.PUPPETEER_REVISIONS.chrome && b.platform === platform && fs.existsSync(b.executablePath));
  if (cached) { console.log(`Yerel tarayıcı kullanılıyor: ${platform} / ${cached.buildId}`); return cached; }
  if (offline) throw new Error('Tarayıcı önbellekte yok; çevrimdışı derleme indirme yapmadan durduruldu.');
  const browser = await browsers.install({
    browser: browsers.Browser.CHROME,
    buildId: puppeteer.PUPPETEER_REVISIONS.chrome,
    platform,
    cacheDir: path.join(__dirname, '../chromium'),
  });
  console.log(`Tarayıcı hazır: ${platform} / ${browser.buildId}`);
  return browser;
}
module.exports = { prepare };
if (require.main === module) prepare().catch(error => { console.error(error); process.exitCode = 1; });
