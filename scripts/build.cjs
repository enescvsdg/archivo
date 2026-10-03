process.env.npm_config_user_agent ||= 'pnpm/11.19.0';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { build, Platform, Arch } = require('electron-builder');
const { prepare } = require('./prepare-browser.cjs');
async function main() {
  const target = process.argv[2];
  const archName = process.argv[3] || process.arch;
  if (!['arm64', 'x64'].includes(archName)) throw new Error('Desteklenen mimariler: arm64, x64');
  const windows = target === 'win' || target === 'nsis';
  if (!windows && target !== 'mac') throw new Error('Hedef: win, nsis veya mac');
  if (!windows && process.platform !== 'darwin') throw new Error('macOS paketi Mac üzerinde derlenmelidir');
  if (windows && archName !== 'x64') throw new Error('Windows taşınabilir sürümü x64 olarak hazırlanır');
  const offline = process.argv.includes('--offline');
  const browser = await prepare(windows ? 'win64' : archName === 'arm64' ? 'mac_arm' : 'mac', offline);
  // On Mac the executable sits inside Chrome.app/Contents/MacOS; use the installation root.
  const cacheRoot = path.join(__dirname, '../chromium/chrome', `${browser.platform}-${browser.buildId}`);
  const config = {
    extraResources: [{ from: cacheRoot, to: 'chromium', filter: ['**/*'] }],
    publish: null,
  };
  if (offline) {
    const version = require('../package.json').devDependencies.electron;
    const wanted = `electron-v${version}-${windows ? 'win32' : 'darwin'}-${archName}.zip`;
    const cache = path.join(os.homedir(), 'Library/Caches/electron');
    const zip = fs.existsSync(cache) ? fs.readdirSync(cache).map(dir => path.join(cache, dir, wanted)).find(file => fs.existsSync(file)) : null;
    if (!zip) throw new Error('Electron önbellekte yok; çevrimdışı derleme indirme yapmadan durduruldu.');
    config.electronDist = zip;
    process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  }
  // Cross-building an unsigned portable EXE avoids Wine and administrator-dependent installers.
  // Native Windows builds retain normal icon/version resource editing.
  if (windows && process.platform !== 'win32') config.win = { signAndEditExecutable: false };
  await build({
    projectDir: path.join(__dirname, '..'),
    targets: windows ? Platform.WINDOWS.createTarget(target === 'nsis' ? 'nsis' : 'portable', Arch.x64)
      : Platform.MAC.createTarget(['dmg', 'zip'], Arch[archName]),
    config,
  });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
