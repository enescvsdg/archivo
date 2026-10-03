const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { readJson, writeJson, scanMessages } = require('../archive-state');

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivo-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('JSON writes preserve the previous version; corrupt JSON never silently resets', t => {
  const file = path.join(temp(t), 'state.json');
  writeJson(file, { n: 1 }); writeJson(file, { n: 2 });
  assert.deepEqual(readJson(file, {}), { n: 2 });
  assert.deepEqual(readJson(file + '.bak', {}), { n: 1 });
  fs.writeFileSync(file, '{broken');
  assert.throws(() => readJson(file, {}), /Veri dosyası okunamadı/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});
test('scan excludes messages arriving after scan start and sorts timestamps', async () => {
  const messages = [{ timestamp: 120, hasMedia: true }, { timestamp: 101, hasMedia: true }, { timestamp: 90 }];
  const result = await scanMessages({ fetchMessages: async () => messages }, 100, 110, 100, async () => {}, () => {});
  assert.equal(result.tamam, true);
  assert.deepEqual(result.medyalar.map(m => m.timestamp), [101]);
});
test('scan marks a truncated conversation incomplete', async () => {
  const messages = Array.from({ length: 300 }, (_, n) => ({ timestamp: 100 + n, hasMedia: true }));
  const limits = [];
  const result = await scanMessages({ fetchMessages: async ({ limit }) => { limits.push(limit); return messages.slice(-limit); } }, 1, 999, 300, async () => {}, () => {});
  assert.equal(result.tamam, false);
  assert.deepEqual(limits, [25, 50, 100, 200, 300]);
});
test('scan cancellation stops immediately after a pending fetch returns', async () => {
  let cancelled = false;
  await assert.rejects(scanMessages({ fetchMessages: async () => { cancelled = true; return []; } }, 1, 2, 25, async () => {}, () => { if (cancelled) throw new Error('cancelled'); }), /cancelled/);
});

function harness(t, chats, failure = false, options = {}) {
  const dir = temp(t), handlers = new Map(), clients = [];
  writeJson(path.join(dir,'senkronizasyon-onayi.json'),{tamam:true});
  class FakeClient extends EventEmitter {
    constructor() { super(); clients.push(this); }
    async initialize() { if (failure) throw new Error('offline'); }
    async destroy() { this.destroyed = true; }
    async getChats() { return chats; }
    async logout() { if (options.logoutFailure) throw new Error('logout offline');this.loggedOut=true; }
    async getWWebVersion() { return 'test'; }
  }
  const app = { isPackaged: false, getPath: () => dir, setPath: () => {}, whenReady: () => new Promise(() => {}), on: () => {}, setLoginItemSettings: () => {}, requestSingleInstanceLock: () => true, quit: () => {} };
  const electron = { app, dialog: { showMessageBox: async (_window, config) => { if (options.dialog) return options.dialog(config); return { response: options.confirm ?? 0 }; } }, shell: { trashItem: options.trash || (async file => fs.unlinkSync(file)) }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) } };
  const context = {
    require: name => name === 'electron' ? electron : name === 'qrcode' ? { toDataURL: async () => 'qr' }
      : name === 'whatsapp-web.js' ? { Client: FakeClient, LocalAuth: class {} }
      : name === 'whatsapp-web.js/package.json' ? { version: 'test' }
      : name === './package.json' ? require('../package.json') : name === './connection-diagnostics' ? require('../connection-diagnostics') : name === './collection-plan' ? require('../collection-plan') : name === './archive-state' ? require('../archive-state') : name === './connection-config' ? require('../connection-config') : name === './operation-policy' ? require('../operation-policy') : require(name),
    __dirname: path.join(__dirname, '..'), process: { argv: [], platform: 'darwin', pid: process.pid },
    Buffer, console: { log() {}, error() {} }, setTimeout: (fn, ms) => setTimeout(fn, ms <= 1500 ? 1 : ms), clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), context);
  const invoke = (name, ...args) => handlers.get(name)(null, ...args);
  const settle = async () => { for (let n = 0; n < 50 && invoke('durum-al').calisiyor; n++) await new Promise(r => setTimeout(r, 10)); assert.equal(invoke('durum-al').calisiyor, false); };
  return { dir, clients, invoke, settle };
}
const group = (id, fetchMessages) => ({ id: { _serialized: id }, name: id, isGroup: true, timestamp: 0, fetchMessages });
test('failed media keeps its group checkpoint while successful group advances', async t => {
  const now = Math.floor(Date.now() / 1000);
  const failed = { timestamp: now - 60, hasMedia: true, type: 'image', id: { _serialized: 'failed' }, downloadMedia: async () => { throw new Error('download'); } };
  const h = harness(t, [group('bad', async () => [failed]), group('good', async () => [])]);
  writeJson(path.join(h.dir, 'son-calisma.json'), { sonZaman: now - 3600 });
  await h.invoke('topla', true); h.clients[0].emit('ready'); await h.settle();
  const state = readJson(path.join(h.dir, 'son-calisma.json'), {});
  assert.equal(state.sohbetler.bad, now - 3600);
  assert.ok(state.sohbetler.good >= now - 1);
  assert.ok(state.sonZaman <= Math.floor(Date.now() / 1000));
});
test('unreadable group is retried instead of inheriting the global checkpoint', async t => {
  const now = Math.floor(Date.now() / 1000);
  const h = harness(t, [group('bad', async () => { throw new Error('read'); }), group('good', async () => [])]);
  writeJson(path.join(h.dir, 'son-calisma.json'), { sonZaman: now - 3600 });
  await h.invoke('topla', true); h.clients[0].emit('ready'); await h.settle();
  assert.equal(readJson(path.join(h.dir, 'son-calisma.json'), {}).sohbetler.bad, now - 3600);
});
test('group QR cancellation destroys the active group-list client and unlocks', async t => {
  const h = harness(t, []);
  const result = h.invoke('gruplari-getir');
  await h.invoke('durdur');
  assert.match((await result).hata, /iptal/);
  assert.equal(h.clients[0].destroyed, true);
  await h.settle();
});
test('initialization failure releases the client and does not advance progress', async t => {
  const h = harness(t, [], true);
  await h.invoke('topla', true); await h.settle();
  assert.equal(h.clients[0].destroyed, true);
  assert.equal(fs.existsSync(path.join(h.dir, 'son-calisma.json')), false);
});
test('retry does not duplicate saved messages when content deduplication is disabled', async t => {
  const now = Math.floor(Date.now() / 1000);
  let unavailable = true;
  const media = { mimetype: 'image/jpeg', data: Buffer.from('image-test').toString('base64') };
  const messages = [
    { timestamp: now - 60, hasMedia: true, type: 'image', id: { _serialized: 'saved-message' }, downloadMedia: async () => media },
    { timestamp: now - 59, hasMedia: true, type: 'image', id: { _serialized: 'retry-message' }, downloadMedia: async () => unavailable ? null : media },
  ];
  const h = harness(t, [group('group', async () => messages)]);
  writeJson(path.join(h.dir, 'ayarlar.json'), { yinelenenleriAtla: false });
  writeJson(path.join(h.dir, 'son-calisma.json'), { sonZaman: now - 3600 });
  await h.invoke('topla', true); h.clients[0].emit('ready'); await h.settle();
  assert.equal(Object.keys(readJson(path.join(h.dir, 'dizin.json'), {})).length, 1);
  unavailable = false;
  await h.invoke('topla', true); await h.settle();
  const index = readJson(path.join(h.dir, 'dizin.json'), {});
  assert.equal(Object.keys(index).length, 2);
  assert.deepEqual(Object.values(index).map(k => k.mesajKimligi).sort(), ['retry-message', 'saved-message']);
});
test('group-list retrieval applies chat compatibility before getChats', async t => {
  const h = harness(t, []); let patched = false;
  const result = h.invoke('gruplari-getir');
  h.clients[0].pupPage = { evaluate: async () => { patched = true; } };
  h.clients[0].getChats = async () => { assert.equal(patched, true); return []; };
  h.clients[0].emit('ready');
  assert.equal((await result).liste.length, 0);
  await h.settle();
});
test('browser identity follows the bundled browser version and platform', () => {
  const { browserIdentity, connectionConfig } = require('../connection-config');
  assert.match(browserIdentity('win32', '146.0.7680.31'), /Windows NT 10\.0.*Chrome\/146\.0\.7680\.31/);
  assert.match(browserIdentity('darwin', '146.0.7680.31'), /Macintosh.*Chrome\/146\.0\.7680\.31/);
  assert.equal(connectionConfig().webVersionCache.type, 'none');
  assert.doesNotMatch(connectionConfig().userAgent, /Chrome\/101\./);
});

test('Topla reuses the ready group connection without another initialization', async t => {
  const h = harness(t, []);
  const result = h.invoke('gruplari-getir');
  let starts = 1;
  h.clients[0].initialize = async () => { starts++; };
  h.clients[0].emit('ready');
  assert.equal((await result).liste.length, 0);
  assert.notEqual(h.clients[0].destroyed, true);
  await h.invoke('topla', true);
  await h.settle();
  assert.equal(h.clients.length, 1);
  assert.equal(starts, 1);
  assert.notEqual(h.clients[0].destroyed, true);
  await h.invoke('durdur');
  assert.equal(h.clients[0].destroyed, true);
});
test('refreshing groups reuses the ready connection and stopping closes it', async t => {
  const h = harness(t, []);
  const first = h.invoke('gruplari-getir');
  h.clients[0].emit('ready');
  await first;
  await h.invoke('gruplari-getir');
  assert.equal(h.clients.length, 1);
  await h.invoke('durdur');
  assert.equal(h.clients[0].destroyed, true);
});
test('a disconnected idle client is discarded before the next operation', async t => {
  const h = harness(t, []);
  const result = h.invoke('gruplari-getir');
  h.clients[0].emit('ready');
  await result;
  h.clients[0].emit('disconnected');
  assert.equal(h.clients[0].destroyed, true);
  await h.invoke('topla', true);
  assert.equal(h.clients.length, 2);
  await h.invoke('durdur');
  await h.settle();
});

test('access report distinguishes reaching the requested date from exhausted Web history', async () => {
  const reached = await scanMessages({fetchMessages: async () => [{timestamp:90},{timestamp:110}]},100,120,25,async()=>{},()=>{});
  assert.equal(reached.erisim.durum,'ulasildi');
  const exhausted = await scanMessages({fetchMessages: async () => [{timestamp:110}]},100,120,25,async()=>{},()=>{});
  assert.equal(exhausted.erisim.durum,'erisim-belirsiz');
  assert.equal(exhausted.erisim.enEski,110);
  const empty = await scanMessages({fetchMessages: async () => []},100,120,25,async()=>{},()=>{});
  assert.equal(empty.erisim.enEski,null);
  assert.equal(empty.erisim.durum,'erisim-belirsiz');
});
test('history scan ignores a newer checkpoint but does not erase or advance it', async t => {
  const now=Math.floor(Date.now()/1000);
  let limit;
  const message={timestamp:now-5*86400,hasMedia:true,type:'image',id:{_serialized:'old'},downloadMedia:async()=>({mimetype:'image/jpeg',data:Buffer.from('old').toString('base64')})};
  const h=harness(t,[group('old-group',async options=>{limit=options.limit;return [message];})]);
  writeJson(path.join(h.dir,'ayarlar.json'),{ilkCalismaGunSayisi:7});
  const prior={sonZaman:now-10,sohbetler:{'old-group':now-10}};
  writeJson(path.join(h.dir,'son-calisma.json'),prior);
  await h.invoke('topla',true,true);h.clients[0].emit('ready');await h.settle();
  assert.ok(limit);
  assert.deepEqual(readJson(path.join(h.dir,'son-calisma.json'),{}),prior);
  assert.equal(Object.keys(readJson(path.join(h.dir,'dizin.json'),{})).length,1);
  const report=readJson(path.join(h.dir,'tarama-raporu.json'),{});
  assert.equal(report.gun,7);
  assert.equal(report.gruplar[0].erisim,undefined);
  assert.equal(report.gruplar[0].durum,'erisim-belirsiz');
});
test('pairing automatically lists groups without downloading media', async t => {
  const h=harness(t,[]);
  const result=h.invoke('baglan');
  h.clients[0].getChats=async()=>[group('one',async()=>{throw new Error('Must not read messages');})];
  h.clients[0].emit('loading_screen',42);
  assert.equal(h.invoke('durum-al').canliDurum.metin,'Senkronize ediliyor');
  h.clients[0].emit('ready');
  const connected=await result; assert.equal(connected.bagli,true);assert.equal(connected.liste.length,1);
  assert.equal(h.invoke('durum-al').baglantiDurumu,'Bağlı');
  assert.equal(fs.existsSync(path.join(h.dir,'dizin.json')),false);
  await h.invoke('durdur');
});
test('invalid days are rejected and failed collection has a cooldown', async t => {
  const h=harness(t,[],true);
  assert.throws(()=>h.invoke('ayar-kaydet',{ilkCalismaGunSayisi:0}),/1–90/);
  assert.throws(()=>h.invoke('ayar-kaydet',{ilkCalismaGunSayisi:91}),/1–90/);
  await h.invoke('topla',false);await h.settle();
  assert.match((await h.invoke('topla',false)).hata,/dakika/);
  assert.equal(h.clients.length,1);
});
test('three consecutive media failures stop further downloads', async t => {
  const now=Math.floor(Date.now()/1000);let attempts=0;
  const messages=Array.from({length:5},(_,n)=>({timestamp:now-60+n,hasMedia:true,type:'image',id:{_serialized:'fail'+n},downloadMedia:async()=>{attempts++;throw new Error('unavailable');}}));
  const h=harness(t,[group('bad',async()=>messages)]);
  await h.invoke('topla',true);h.clients[0].emit('ready');await h.settle();
  assert.equal(attempts,3);
  assert.notEqual(h.clients[0].destroyed,true);
 await h.invoke('durdur');
 assert.equal(h.clients[0].destroyed,true);
  assert.match(readJson(path.join(h.dir,'tarama-raporu.json'),{}).neden,/3 medya/);
});
test('budget caps requests, media, bytes, duration and clears timeout timers',async()=>{
  const {budget,LIMITS,withTimeout}=require('../operation-policy');
  const b=budget();for(let n=0;n<LIMITS.requests;n++)b.request();assert.throws(()=>b.request(),/24/);
  const m=budget();for(let n=0;n<LIMITS.media;n++)m.media();assert.throws(()=>m.media(),/100/);
  assert.throws(()=>budget().bytes(LIMITS.bytes+1),/100 MB/);
  let now=0;const clock=budget(()=>now);now=LIMITS.duration;assert.throws(()=>clock.check(),/15 dakika/);
  assert.equal(await withTimeout(Promise.resolve(3),10,'test'),3);
  await assert.rejects(withTimeout(new Promise(()=>{}),5,'test'),/yanıt süresi/);
});
test('renderer script remains valid and matches its CSP hash',()=>{
  const crypto=require('node:crypto');
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(script);
  const hash=crypto.createHash('sha256').update(script).digest('base64');
  assert.ok(html.includes("script-src 'sha256-"+hash+"'"));
});
test('compatibility setup failure stops before chat or media requests',async t=>{
 const h=harness(t,[]);let requests=0;
 await h.invoke('topla',true);
 h.clients[0].pupPage={evaluate:async()=>{throw new Error('setup failed');}};
 h.clients[0].getChats=async()=>{requests++;return [];};
 h.clients[0].emit('ready');await h.settle();
 assert.equal(requests,0);
 assert.notEqual(h.clients[0].destroyed,true);
 await h.invoke('durdur');
 assert.equal(h.clients[0].destroyed,true);
});
test('unavailable media records type, date and cause without message contents',async t=>{
 const now=Math.floor(Date.now()/1000);
 const h=harness(t,[group('group',async()=>[{timestamp:now-50,type:'image',hasMedia:true,body:'private caption',id:{_serialized:'unavailable'},downloadMedia:async()=>null}])]);
 await h.invoke('topla',true);h.clients[0].emit('ready');await h.settle();
 const report=readJson(path.join(h.dir,'tarama-raporu.json'),{});
 assert.equal(report.sonuc,'eksik');
 assert.equal(report.alinamayanMedya.length,1);
 assert.equal(report.alinamayanMedya[0].tur,'image');
 assert.equal(report.alinamayanMedya[0].zaman,now-50);
 assert.match(report.alinamayanMedya[0].neden,/boş sonuç/);
 assert.equal(JSON.stringify(report).includes('private caption'),false);
});
test('location messages do not count as failed media',async t=>{
 const h=harness(t,[group('group',async()=>[{timestamp:Math.floor(Date.now()/1000)-50,type:'location',hasMedia:true,downloadMedia:async()=>{throw new Error('location must not be downloaded');}}])]);
 await h.invoke('topla',true);h.clients[0].emit('ready');await h.settle();
 assert.equal(readJson(path.join(h.dir,'tarama-raporu.json'),{}).alinamayanMedya.length,0);
});
test('history access check never downloads media or advances collection checkpoints',async t=>{
 const now=Math.floor(Date.now()/1000);let downloaded=0;
 const h=harness(t,[group('group',async()=>[{timestamp:now-86400,type:'image',hasMedia:true,type:'image',id:{_serialized:'photo'},downloadMedia:async()=>{downloaded++;return null;}}])]);
 const prior={sonZaman:now-10,sohbetler:{group:now-10}};writeJson(path.join(h.dir,'son-calisma.json'),prior);
 const start=h.invoke('gecmis-kontrol',{ilkCalismaGunSayisi:7,sadeceSuGruplar:[]});await start;
 h.clients[0].emit('ready');await h.settle();
 assert.equal(downloaded,0);
 assert.equal(fs.existsSync(path.join(h.dir,'dizin.json')),false);
 assert.deepEqual(readJson(path.join(h.dir,'son-calisma.json'),{}),prior);
 assert.equal(readJson(path.join(h.dir,'tarama-raporu.json'),{}).sadeceTara,true);
 assert.notEqual(h.clients[0].destroyed,true);
 await h.invoke('durdur');
});
test('local deletion requires confirmation and removes file/index/cache but no WhatsApp calls',async t=>{
 const h=harness(t,[],false,{confirm:1});const now=Math.floor(Date.now()/1000);
 const file=path.join(h.dir,'photo.jpg');fs.writeFileSync(file,'photo');
 writeJson(path.join(h.dir,'ayarlar.json'),{hedefKlasor:h.dir});
 writeJson(path.join(h.dir,'dizin.json'),{'photo.jpg':{mesajKimligi:'deleted-id',zaman:now}});
 const date=new Date(now*1000);const day=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
 const cache=path.join(h.dir,'kucuk',day,'photo.jpg');fs.mkdirSync(path.dirname(cache),{recursive:true});fs.writeFileSync(cache,'thumb');
 assert.equal((await h.invoke('fotograf-sil',file)).silindi,true);
 assert.equal(fs.existsSync(file),false);assert.equal(fs.existsSync(cache),false);
 assert.equal(Object.keys(readJson(path.join(h.dir,'dizin.json'),{})).length,0);
 assert.ok(readJson(path.join(h.dir,'silinen-mesajlar.json'),{})['deleted-id']);
 assert.equal(h.clients.length,0);
});
test('cancelled deletion preserves file; outside paths are rejected; failed trash restores records',async t=>{
 const h=harness(t,[]);const file=path.join(h.dir,'photo.jpg');fs.writeFileSync(file,'photo');
 writeJson(path.join(h.dir,'ayarlar.json'),{hedefKlasor:h.dir});
 assert.equal((await h.invoke('fotograf-sil',file)).silindi,false);assert.ok(fs.existsSync(file));
 const outside=path.join(temp(t),'outside.jpg');fs.writeFileSync(outside,'outside');
 await assert.rejects(h.invoke('fotograf-sil',outside),/arşiv klasör/);
 const failing=harness(t,[],false,{confirm:1,trash:async()=>{throw new Error('trash unavailable');}});
 const f=path.join(failing.dir,'photo.jpg');fs.writeFileSync(f,'photo');writeJson(path.join(failing.dir,'ayarlar.json'),{hedefKlasor:failing.dir});
 const index={'photo.jpg':{mesajKimligi:'keep'}};writeJson(path.join(failing.dir,'dizin.json'),index);
 await assert.rejects(failing.invoke('fotograf-sil',f),/trash unavailable/);
 assert.deepEqual(readJson(path.join(failing.dir,'dizin.json'),{}),index);assert.ok(fs.existsSync(f));
});
test('locally deleted message IDs are not downloaded again by Topla',async t=>{
 let requests=0;const now=Math.floor(Date.now()/1000);
 const h=harness(t,[group('group',async()=>[{timestamp:now-30,type:'image',hasMedia:true,type:'image',id:{_serialized:'deleted'},downloadMedia:async()=>{requests++;return null;}}])]);
 writeJson(path.join(h.dir,'silinen-mesajlar.json'),{deleted:{zaman:now-30}});
 await h.invoke('topla',true,true);h.clients[0].emit('ready');await h.settle();assert.equal(requests,0);
});

test('Topla scans once, includes local midnight, excludes future and asks before past downloads', async t => {
 const {dayStart}=require('../collection-plan');const now=Math.floor(Date.now()/1000), start=dayStart(now);
 for(const approve of [false,true]) {
  let fetches=0;const downloaded=[],questions=[];
  const messages=[['old',start-60],['midnight',start],['today',now-1],['future',now+60]].map(([id,timestamp])=>({timestamp,type:'image',hasMedia:true,id:{_serialized:id},downloadMedia:async()=>{downloaded.push(id);return null;}}));
  const h=harness(t,[group('g',async()=>{fetches++;return messages;})],false,{dialog:async q=>{questions.push(q);return {response:approve?1:0};}});
  await h.invoke('topla',true,false);h.clients[0].emit('ready');await h.settle();
  assert.equal(fetches,1);assert.equal(questions.length,1);assert.match(questions[0].detail,/1 görsel/);
  assert.deepEqual(downloaded,approve?['old','midnight','today']:['midnight','today']);
 }
});
test('history download uses its draft range and scan is download-free even when restoration is approved',async t=>{
 const now=Math.floor(Date.now()/1000);let downloads=0;
 const messages=[{timestamp:now-86400,type:'image',hasMedia:true,id:{_serialized:'restore'},downloadMedia:async()=>{downloads++;return null;}}];
 const h=harness(t,[group('g',async()=>messages)],false,{confirm:1});
 writeJson(path.join(h.dir,'silinen-mesajlar.json'),{restore:{zaman:now-86400}});
 await h.invoke('gecmis-kontrol',{ilkCalismaGunSayisi:8,sadeceSuGruplar:[]});h.clients[0].emit('ready');await h.settle();
 assert.equal(downloads,0);assert.equal(readJson(path.join(h.dir,'silinen-mesajlar.json'),{}).restore.tekrarEkle,true);
 await h.invoke('gecmis-indir',{ilkCalismaGunSayisi:8,sadeceSuGruplar:[]});await h.settle();
 assert.equal(downloads,1);assert.equal(readJson(path.join(h.dir,'tarama-raporu.json'),{}).gun,8);
});
test('restoration apply-all Yes or No affects every deleted image with one dialog',async t=>{
 const now=Math.floor(Date.now()/1000);
 for(const yes of [false,true]) {
  let questions=0,downloads=0;
  const messages=['a','b'].map(id=>({timestamp:now-30,type:'image',hasMedia:true,id:{_serialized:id},downloadMedia:async()=>{downloads++;return null;}}));
  const h=harness(t,[group('g',async()=>messages)],false,{dialog:async q=>{questions++;assert.ok(q.checkboxLabel);return {response:yes?1:0,checkboxChecked:true};}});
  writeJson(path.join(h.dir,'silinen-mesajlar.json'),{a:{},b:{}});
  await h.invoke('topla',true);h.clients[0].emit('ready');await h.settle();
  assert.equal(questions,1);assert.equal(downloads,yes?2:0);
  const deleted=readJson(path.join(h.dir,'silinen-mesajlar.json'),{});assert.equal(deleted.a.tekrarEkle,yes);assert.equal(deleted.b.tekrarEkle,yes);
 }
});
test('day deletion confirms once, only deletes that day and preserves cancelled files',async t=>{
 for(const yes of [false,true]) {
  let questions=0;
  const h=harness(t,[],false,{dialog:async q=>{questions++;assert.deepEqual(Array.from(q.buttons),['Hayır','Evet']);return {response:yes?1:0};}});
  writeJson(path.join(h.dir,'ayarlar.json'),{hedefKlasor:path.join(h.dir,'archive')});
  const entries={};
  for(const [day,name] of [['2026-10-02','one.jpg'],['2026-10-02','two.jpg'],['2026-10-01','other.jpg']]) {
   const folder=path.join(h.dir,'archive',day);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,name),'image');entries[name]={mesajKimligi:name,zaman:1};
   const cache=path.join(h.dir,'kucuk',day,name);fs.mkdirSync(path.dirname(cache),{recursive:true});fs.writeFileSync(cache,'thumb');
  }
  writeJson(path.join(h.dir,'dizin.json'),entries);
  const result=await h.invoke('gun-sil','2026-10-02');assert.equal(result.silindi,yes);assert.equal(questions,1);
  assert.equal(fs.existsSync(path.join(h.dir,'archive','2026-10-02','one.jpg')),!yes);
  assert.equal(fs.existsSync(path.join(h.dir,'kucuk','2026-10-02','one.jpg')),!yes);
  assert.equal(fs.existsSync(path.join(h.dir,'archive','2026-10-01','other.jpg')),true);
  assert.equal(Object.keys(readJson(path.join(h.dir,'dizin.json'),{})).length,yes?1:3);assert.equal(h.clients.length,0);
 }
});
test('successful restoration clears tombstone and remains deduplicated on retry',async t=>{
 const now=Math.floor(Date.now()/1000);let downloads=0;
 const msg={timestamp:now-30,type:'image',hasMedia:true,id:{_serialized:'restored'},downloadMedia:async()=>{downloads++;return {mimetype:'image/jpeg',data:Buffer.from('restored').toString('base64')};}};
 const h=harness(t,[group('g',async()=>[msg])],false,{confirm:1});
 writeJson(path.join(h.dir,'silinen-mesajlar.json'),{restored:{}});
 await h.invoke('topla',true);h.clients[0].emit('ready');await h.settle();
 assert.equal(readJson(path.join(h.dir,'silinen-mesajlar.json'),{}).restored,undefined);
 await h.invoke('topla',true);await h.settle();assert.equal(downloads,1);
});

test('missing local files are offered as gaps rather than skipped by an old index entry',async t=>{
 const now=Math.floor(Date.now()/1000);let downloads=0,questions=0;
 const h=harness(t,[group('g',async()=>[{timestamp:now-86400,type:'image',hasMedia:true,id:{_serialized:'gone'},downloadMedia:async()=>{downloads++;return null;}}])],false,{dialog:async()=>{questions++;return {response:1};}});
 writeJson(path.join(h.dir,'dizin.json'),{'gone.jpg':{mesajKimligi:'gone',hash:'old'}});
 await h.invoke('topla',true);h.clients[0].emit('ready');await h.settle();assert.equal(questions,1);assert.equal(downloads,1);
});
test('day trash failure preserves remaining files and their index entries',async t=>{
 let trashes=0;const h=harness(t,[],false,{confirm:1,trash:async file=>{if(++trashes===2)throw new Error('disk error');fs.unlinkSync(file);}});
 const root=path.join(h.dir,'archive'),folder=path.join(root,'2026-10-02');fs.mkdirSync(folder,{recursive:true});
 writeJson(path.join(h.dir,'ayarlar.json'),{hedefKlasor:root});
 const entries={};for(const name of ['a.jpg','b.jpg']){fs.writeFileSync(path.join(folder,name),'photo');entries[name]={mesajKimligi:name};}
 writeJson(path.join(h.dir,'dizin.json'),entries);
 await assert.rejects(h.invoke('gun-sil','2026-10-02'),/1 görsel silindi/);
 assert.equal(fs.readdirSync(folder).length,1);assert.equal(Object.keys(readJson(path.join(h.dir,'dizin.json'),{})).length,1);
});

test('chat serializer reads only cache, avoids pending original serializer and filters before model conversion',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
 const fn=source.slice(source.indexOf('async function modeliSadelestir('),source.indexOf('async function sohbetHazirliginiBekle('));
 let originalCalls=0,metadataRequests=0;
 const chats=[{id:{_serialized:'one@g.us'},formattedTitle:'selected',groupMetadata:{announce:false}},
 {id:{_serialized:'two@g.us'},formattedTitle:'other',groupMetadata:{}},{id:{_serialized:'person@c.us'},formattedTitle:'person'}];
 const window={WWebJS:{getChatModel:()=>{originalCalls++;return new Promise(()=>{});}},require:name=>({Chat:{getModelsArray:()=>chats},GroupMetadata:{update:()=>metadataRequests++}})};
 const ctx={window};vm.createContext(ctx);vm.runInContext(fn,ctx);
 await ctx.modeliSadelestir({evaluate:async(code,...args)=>{const local={window,args};vm.createContext(local);return vm.runInContext('('+code.toString()+')(...args)',local);}},['selected'],false);
 const result=await window.WWebJS.getChats();assert.equal(result.length,1);assert.equal(result[0].id._serialized,'one@g.us');assert.equal(result[0].isGroup,true);
 assert.equal(originalCalls,0);assert.equal(metadataRequests,0);
});
test('no 45-second cutoff remains and disabled timeout simply awaits result',async()=>{
 const {LIMITS,withTimeout}=require('../operation-policy');assert.equal(LIMITS.timeout,0);
 assert.equal(await withTimeout(Promise.resolve('ready'),0,'group'),'ready');
});

test('sync readiness polls only cached state and cancellation interrupts that wait',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
 const a=source.indexOf('async function sohbetHazirliginiBekle('),b=source.indexOf('async function telefonOnayiniBekle',a);
 let reads=0,requests=0;const statuses=[];
 const ctx={kontrol:i=>{if(i.iptal)throw new Error('cancelled');},bekle:async()=>{},yolla:(_c,d)=>statuses.push(d)};
 vm.createContext(ctx);vm.runInContext(source.slice(a,b),ctx);
 const i={iptal:false};await ctx.sohbetHazirliginiBekle({pupPage:{evaluate:async()=>++reads>=3},getChats:()=>requests++},i,['selected']);
 assert.equal(reads,3);assert.equal(requests,0);assert.equal(statuses.length,2);
 await assert.rejects(ctx.sohbetHazirliginiBekle({pupPage:{evaluate:async()=>{i.iptal=true;return false;}}},i),/cancelled/);
});

test('phone sync confirmation blocks chat collection until approved',async t=>{
 const h=harness(t,[]);writeJson(path.join(h.dir,'senkronizasyon-onayi.json'),{tamam:false});
 const pending=h.invoke('baglan');h.clients[0].emit('ready');
 await new Promise(r=>setTimeout(r,20));
 assert.equal(h.invoke('durum-al').calisiyor,true);
 assert.equal(h.invoke('senkronizasyon-onayla'),true);
 assert.equal((await pending).bagli,true);await h.settle();
 assert.equal(readJson(path.join(h.dir,'senkronizasyon-onayi.json'),{}).tamam,true);
});
test('real logout requires an existing connected client',async t=>{
 const h=harness(t,[]);assert.match((await h.invoke('whatsapp-cikis')).hata,/Gerçek çıkış/);
 assert.equal(h.clients.length,0);
});
for(const kind of ['cancel','success','failure'])test('real logout '+kind,async t=>{
 const h=harness(t,[],false,{confirm:kind==='cancel'?0:1,logoutFailure:kind==='failure'});
 const pending=h.invoke('baglan');h.clients[0].emit('ready');await pending;
 const result=await h.invoke('whatsapp-cikis');
 if(kind==='success'){assert.equal(result.cikildi,true);assert.equal(h.clients[0].loggedOut,true);assert.equal(h.invoke('durum-al').bagli,false);}
 else if(kind==='failure'){assert.match(result.hata,/doğrulanamadı/);assert.equal(h.invoke('durum-al').bagli,true);}
 else{assert.equal(result.cikildi,false);assert.equal(h.clients[0].loggedOut,undefined);}
});

test('fresh release profile does not copy previous settings or session',t=>{
 const root=temp(t);writeJson(path.join(root,'ayarlar.json'),{old:true});fs.mkdirSync(path.join(root,'oturum'));
 const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
 const a=source.indexOf('const SMOKE ='),b=source.indexOf('\n}',a)+2;let chosen;
 const ctx={process:{argv:[]},app:{getPath:()=>root,setPath:(_key,p)=>chosen=p},path,fs,require:()=>({version:'1.4.3'})};
 vm.createContext(ctx);vm.runInContext(source.slice(a,b),ctx);
 assert.equal(chosen,path.join(root,'profiller','1.4.3'));
 assert.equal(fs.existsSync(path.join(chosen,'ayarlar.json')),false);
 assert.equal(fs.existsSync(path.join(chosen,'oturum')),false);
 assert.equal(readJson(path.join(root,'ayarlar.json'),{}).old,true);
});
test('cancel during phone confirmation does not persist completion',async t=>{
 const h=harness(t,[]);writeJson(path.join(h.dir,'senkronizasyon-onayi.json'),{tamam:false});
 const pending=h.invoke('baglan');h.clients[0].emit('ready');await new Promise(r=>setTimeout(r,20));
 await h.invoke('durdur');assert.match((await pending).hata,/iptal/);
 assert.equal(readJson(path.join(h.dir,'senkronizasyon-onayi.json'),{}).tamam,false);await h.settle();
});

test('group names are persisted before phone synchronization approval',async t=>{
 const h=harness(t,[group('one',async()=>[])]);writeJson(path.join(h.dir,'senkronizasyon-onayi.json'),{tamam:false});
 const pending=h.invoke('baglan');h.clients[0].emit('ready');await new Promise(r=>setTimeout(r,20));
 assert.equal(readJson(path.join(h.dir,'gruplar.json'),[]).length,1);
 assert.equal(h.invoke('durum-al').calisiyor,true);
 h.invoke('senkronizasyon-onayla');await pending;
});
test('group refresh never asks for phone synchronization approval',async t=>{
 const h=harness(t,[]);writeJson(path.join(h.dir,'senkronizasyon-onayi.json'),{tamam:false});
 const pending=h.invoke('gruplari-getir');h.clients[0].emit('ready');await pending;
 assert.equal(h.invoke('senkronizasyon-onayla'),false);
});
test('logout restores a stored session once after application restart',async t=>{
 const h=harness(t,[],false,{confirm:1});writeJson(path.join(h.dir,'eslesme-durumu.json'),{giris:true});
 const pending=h.invoke('whatsapp-cikis');await new Promise(r=>setTimeout(r,10));
 assert.equal(h.clients.length,1);h.clients[0].emit('ready');assert.equal((await pending).cikildi,true);
 assert.equal(readJson(path.join(h.dir,'eslesme-durumu.json'),{}).giris,false);
});
test('logout cannot silently replace an invalid stored session with QR pairing',async t=>{
 const h=harness(t,[],false,{confirm:1});writeJson(path.join(h.dir,'eslesme-durumu.json'),{giris:true});
 const pending=h.invoke('whatsapp-cikis');await new Promise(r=>setTimeout(r,10));h.clients[0].emit('qr','secret');
 assert.match((await pending).hata,/doğrulanamadı/);assert.equal(h.clients[0].destroyed,true);
 assert.equal(readJson(path.join(h.dir,'eslesme-durumu.json'),{}).giris,true);
});
