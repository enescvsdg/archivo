const path = require('node:path');
function browserIdentity(platform, chromeVersion) {
  const os = platform === 'win32' ? 'Windows NT 10.0; Win64; x64'
    : platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}
function connectionConfig(platform = process.platform) {
  const entry = require.resolve('puppeteer', { paths: [path.dirname(require.resolve('whatsapp-web.js'))] });
  const version = require(entry).PUPPETEER_REVISIONS.chrome;
  return { userAgent: browserIdentity(platform, version), webVersionCache: { type: 'none' } };
}
module.exports = { browserIdentity, connectionConfig };
