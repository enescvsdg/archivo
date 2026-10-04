const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { readJson, writeJson, scanMessages, scanPaced } = require('../archive-state');

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
  const dir = temp(t), handlers = new Map(), clients = [], appOn = {};
  let quitSayisi = 0;
  writeJson(path.join(dir,'senkronizasyon-onayi.json'),{tamam:true});
  class FakeClient extends EventEmitter {
    constructor() { super(); clients.push(this); }
    async initialize() { if (failure) throw new Error('offline'); }
    async destroy() { this.destroyed = true; }
    async getChats() { return chats; }
    async logout() { if (options.logoutFailure) throw new Error('logout offline');this.loggedOut=true; }
    async getWWebVersion() { return 'test'; }
  }
  const app = { isPackaged: false, getPath: () => dir, setPath: () => {}, whenReady: () => new Promise(() => {}), on: (olay, fn) => { (appOn[olay] ||= []).push(fn); }, setLoginItemSettings: () => {}, requestSingleInstanceLock: () => true, quit: () => { quitSayisi++; } };
  const bildirimler = [];
  const electron = { app, Notification: options.bildirimYok ? undefined : class { static isSupported() { return true; } constructor(o) { this.o = o; this.dinleyici = {}; bildirimler.push(this); } on(k, fn) { this.dinleyici[k] = fn; } show() { this.gosterildi = true; } }, dialog: { showMessageBox: async (_window, config) => { if (options.dialog) return options.dialog(config); return { response: options.confirm ?? 0 }; } }, shell: { trashItem: options.trash || (async file => fs.unlinkSync(file)) }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) } };
  // Testlerde bekleme yoktur; istenirse options.pace ile tempo araligi verilir, options.beklemeler gercek beklemeleri kaydeder.
  const gercekPolitika = require('../operation-policy');
  const politika = { ...gercekPolitika, LIMITS: { ...gercekPolitika.LIMITS, ...(options.limits || {}) }, PACE: { sayfa: [0, 0], indirme: [0, 0], arama: [0, 0], molaHer: 100, mola: [0, 0], ...(options.pace || {}) } };
  const context = {
    require: name => name === 'electron' ? electron : name === 'qrcode' ? { toDataURL: async () => 'qr' }
      : name === 'whatsapp-web.js' ? { Client: FakeClient, LocalAuth: class {} }
      : name === 'whatsapp-web.js/package.json' ? { version: 'test' }
      : name === './package.json' ? require('../package.json') : name === './connection-diagnostics' ? require('../connection-diagnostics') : name === './collection-plan' ? require('../collection-plan') : name === './archive-state' ? require('../archive-state') : name === './connection-config' ? require('../connection-config') : name === './operation-policy' ? politika : require(name),
    __dirname: path.join(__dirname, '..'), process: { argv: [], platform: 'darwin', pid: process.pid },
    Buffer, console: { log() {}, error() {} }, setTimeout: (fn, ms) => { if (options.beklemeler) options.beklemeler.push(ms); return setTimeout(fn, ms <= 1500 ? 1 : ms); }, clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), context);
  const invoke = (name, ...args) => handlers.get(name)(null, ...args);
  const settle = async () => { for (let n = 0; n < 1500 && invoke('durum-al').calisiyor; n++) await new Promise(r => setTimeout(r, 10)); assert.equal(invoke('durum-al').calisiyor, false); };
  return { dir, clients, invoke, settle, ctx: context, appOn, bildirimler, quitSayisi: () => quitSayisi };
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
test('invalid days are rejected and a failed connection cannot be reopened within a minute', async t => {
  const h=harness(t,[],true);
  assert.throws(()=>h.invoke('ayar-kaydet',{ilkCalismaGunSayisi:0}),/1–90/);
  assert.throws(()=>h.invoke('ayar-kaydet',{ilkCalismaGunSayisi:91}),/1–90/);
  await h.invoke('topla',false);await h.settle();
  assert.match((await h.invoke('topla',false)).hata,/en az 1 dakika/);
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
// Insan hizi modeli: istek/medya/MB tavanlari kalkti; yalnizca sure siniri (60 dk) ve art arda 3 hata durdurur.
test('human-pace policy: no request, media or byte caps; duration ceiling, three failures and timeout timers remain',async()=>{
  const {budget,LIMITS,PACE,withTimeout}=require('../operation-policy');
  const b=budget();for(let n=0;n<5000;n++){b.request();b.media();b.bytes(50*1024*1024);}
  let now=0;const clock=budget(()=>now);now=LIMITS.duration;assert.throws(()=>clock.check(),/60 dakika/);
  assert.equal(LIMITS.duration,60*60*1000);
  const f=budget();f.failed();f.failed();assert.throws(()=>f.failed(),/3 medya hatası/);
  assert.deepEqual(PACE.sayfa,[1000,3000]);assert.deepEqual(PACE.indirme,[2000,5000]);assert.deepEqual(PACE.arama,[500,1500]);
  assert.equal(PACE.molaHer,100);assert.deepEqual(PACE.mola,[120000,300000]);
  assert.equal(LIMITS.messages,20000);assert.equal(LIMITS.hazirBekciAraligi,5000);
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
 // Canli sayfa: saglik yoklamasi (argumansiz) yanit verir, kurulum betikleri hata atar.
 h.clients[0].pupPage={isClosed:()=>false,mainFrame:()=>({detached:false}),evaluate:async(_fn,...args)=>{if(args.length)throw new Error('setup failed');return true;}};
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

// 1. adim: Topla artik gecmis gunler icin soru sormaz; kaydi olmayan grup ilk calisma penceresini (3 gun) alir.
test('Topla scans once, includes local midnight and the whole window, excludes future and never asks', async t => {
 const {dayStart}=require('../collection-plan');const now=Math.floor(Date.now()/1000), start=dayStart(now);
 let fetches=0;const downloaded=[],questions=[];
 const messages=[['old',start-60],['midnight',start],['today',now-1],['future',now+60]].map(([id,timestamp])=>({timestamp,type:'image',hasMedia:true,id:{_serialized:id},downloadMedia:async()=>{downloaded.push(id);return null;}}));
 const h=harness(t,[group('g',async()=>{fetches++;return messages;})],false,{dialog:async q=>{questions.push(q);return {response:0};}});
 await h.invoke('topla',true,false);h.clients[0].emit('ready');await h.settle();
 assert.equal(fetches,1);assert.equal(questions.length,0);
 assert.deepEqual(downloaded,['old','midnight','today']);
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
  const h=harness(t,[],false,{dialog:async q=>{questions++;assert.deepEqual(Array.from(q.buttons),['Vazgeç','Tüm fotoğrafları sil']);assert.match(q.message,/DİKKAT: 02\.10\.2026 TARİHİNDEKİ TÜM GRUPLARIN FOTOĞRAFLARI SİLİNECEK/);assert.match(q.detail,/toplam 2 fotoğraf/);assert.equal(q.defaultId,0);return {response:yes?1:0};}});
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
function gunGrupKur(h){
 const root=path.join(h.dir,'archive');writeJson(path.join(h.dir,'ayarlar.json'),{hedefKlasor:root});
 const entries={};
 for(const [gunTR,grup,name] of [['02.10.2026','Grup A','a1.jpg'],['02.10.2026','Grup A','a2.jpg'],['02.10.2026','Grup B','b1.jpg'],['01.10.2026','Grup A','a3.jpg']]){
  const iso=gunTR.split('.').reverse().join('-');
  const folder=path.join(root,'2026','Ekim',gunTR,grup);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,name),'image');entries[name]={mesajKimligi:name,zaman:1,grup};
  const cache=path.join(h.dir,'kucuk',iso,name);fs.mkdirSync(path.dirname(cache),{recursive:true});fs.writeFileSync(cache,'thumb');
 }
 writeJson(path.join(h.dir,'dizin.json'),entries);
 const var_=(gunTR,grup,name)=>path.join(root,'2026','Ekim',gunTR,grup,name);
 return {root,entries,var_};
}
test('deleting a day inside a group view removes only that group’s photos of that day and names the group in the question',async t=>{
 for(const yes of [false,true]){
  const asked=[];
  const h=harness(t,[],false,{dialog:async q=>{asked.push(q);return {response:yes?1:0};}});
  const k=gunGrupKur(h);
  const result=await h.invoke('gun-sil','2026-10-02','Grup A');
  assert.equal(result.silindi,yes);assert.equal(asked.length,1);
  assert.deepEqual(Array.from(asked[0].buttons),['Hayır','Evet']);assert.match(asked[0].message,/02\.10\.2026 tarihli “Grup A” fotoğrafları silinsin mi\?/);assert.match(asked[0].detail,/^2 fotoğraf/);assert.match(asked[0].detail,/diğer gruplara dokunulmaz/);
  assert.equal(fs.existsSync(k.var_('02.10.2026','Grup A','a1.jpg')),!yes);assert.equal(fs.existsSync(k.var_('02.10.2026','Grup A','a2.jpg')),!yes);
  assert.equal(fs.existsSync(k.var_('02.10.2026','Grup B','b1.jpg')),true,'başka grup silinmemeli');
  assert.equal(fs.existsSync(k.var_('01.10.2026','Grup A','a3.jpg')),true,'başka gün silinmemeli');
  assert.equal(fs.existsSync(path.join(h.dir,'kucuk','2026-10-02','a1.jpg')),!yes);assert.equal(fs.existsSync(path.join(h.dir,'kucuk','2026-10-02','b1.jpg')),true);
  assert.deepEqual(Object.keys(readJson(path.join(h.dir,'dizin.json'),{})).sort(),yes?['a3.jpg','b1.jpg']:['a1.jpg','a2.jpg','a3.jpg','b1.jpg']);
 }
});
test('deleting a day without a group (Tümü view) removes every group of that day and keeps other days',async t=>{
 const asked=[];const h=harness(t,[],false,{dialog:async q=>{asked.push(q);return {response:1};}});
 const k=gunGrupKur(h);
 const result=await h.invoke('gun-sil','2026-10-02');
 assert.equal(result.silindi,true);assert.equal(result.adet,3);assert.match(asked[0].detail,/2 gruptan toplam 3 fotoğraf/);
 for(const [g,n] of [['Grup A','a1.jpg'],['Grup A','a2.jpg'],['Grup B','b1.jpg']])assert.equal(fs.existsSync(k.var_('02.10.2026',g,n)),false);
 assert.equal(fs.existsSync(k.var_('01.10.2026','Grup A','a3.jpg')),true);
});
test('day deletion with an unknown group asks nothing, deletes nothing, and a malformed group is rejected',async t=>{
 let asked=0;const h=harness(t,[],false,{dialog:async()=>{asked++;return {response:1};}});
 const k=gunGrupKur(h);
 const result=await h.invoke('gun-sil','2026-10-02','Grup Yok');
 assert.equal(result.silindi,false);assert.equal(asked,0);assert.equal(fs.existsSync(k.var_('02.10.2026','Grup A','a1.jpg')),true);
 for(const bad of [42,'   ',{}])await assert.rejects(h.invoke('gun-sil','2026-10-02',bad),/Geçersiz grup/);
 assert.equal(asked,0);
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

test('a message whose local file is missing is downloaded again instead of being skipped by an old index entry',async t=>{
 const now=Math.floor(Date.now()/1000);let downloads=0,questions=0;
 const h=harness(t,[group('g',async()=>[{timestamp:now-86400,type:'image',hasMedia:true,id:{_serialized:'gone'},downloadMedia:async()=>{downloads++;return null;}}])],false,{dialog:async()=>{questions++;return {response:1};}});
 writeJson(path.join(h.dir,'dizin.json'),{'gone.jpg':{mesajKimligi:'gone',hash:'old'}});
 await h.invoke('topla',true);h.clients[0].emit('ready');await h.settle();assert.equal(questions,0);assert.equal(downloads,1);
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

function hazirlikKur(){
 const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
 const a=source.indexOf('async function sohbetHazirliginiBekle('),b=source.indexOf('async function telefonOnayiniBekle',a);
 const statuses=[],waits=[],records=[];
 const ctx={kontrol:i=>{if(i.iptal)throw new Error('cancelled');},bekle:async ms=>{waits.push(ms);},yolla:(_c,d)=>statuses.push(d),LIMITS:require('../operation-policy').LIMITS};
 vm.createContext(ctx);vm.runInContext(source.slice(a,b),ctx);
 return {ctx,statuses,waits,records,kayit:(asama,bilgi)=>records.push({asama,...bilgi}),toplamSure:()=>waits.reduce((x,y)=>x+y,0)};
}

test('sync readiness polls only cached state and cancellation interrupts that wait',async()=>{
 const k=hazirlikKur();let reads=0,requests=0;
 const i={iptal:false};await k.ctx.sohbetHazirliginiBekle({pupPage:{evaluate:async()=>({bekle:++reads<3,neden:'sohbet'})},getChats:()=>requests++},i,['selected'],k.kayit);
 assert.equal(reads,3);assert.equal(requests,0);assert.equal(k.statuses.length,2);
 assert.deepEqual(k.records.map(r=>r.asama),['hazirlik-bekleniyor','hazirlik-bitti']);assert.equal(k.records[1].kod,'hazir');
 await assert.rejects(k.ctx.sohbetHazirliginiBekle({pupPage:{evaluate:async()=>{i.iptal=true;return {bekle:true,neden:'sohbet'};}}},i),/cancelled/);
});

test('ready wait that was never needed leaves no diagnostic trace',async()=>{
 const k=hazirlikKur();
 await k.ctx.sohbetHazirliginiBekle({pupPage:{evaluate:async()=>({bekle:false})}},{iptal:false},[],k.kayit);
 assert.deepEqual(k.records,[]);assert.deepEqual(k.waits,[]);
});

test('offline delivery counter frozen at 92 percent no longer blocks forever: proceeds after 45 seconds and records why',async()=>{
 const k=hazirlikKur();let reads=0;
 await k.ctx.sohbetHazirliginiBekle({pupPage:{evaluate:async()=>{reads++;return {bekle:true,neden:'cevrimdisi',ilerleme:92};}}},{iptal:false},['g'],k.kayit);
 assert.ok(k.toplamSure()>=45000&&k.toplamSure()<=50000,'toplam bekleme '+k.toplamSure());assert.ok(reads>=23&&reads<=26,'okuma '+reads);
 assert.deepEqual(k.records,[{asama:'hazirlik-bekleniyor',kod:'cevrimdisi',ilerleme:92},{asama:'hazirlik-bitti',kod:'durgun',ilerleme:92}]);
 assert.ok(k.statuses.every(s=>s.metin==='Senkronize ediliyor'&&/Kapalıyken gelen mesajlar alınıyor: %92/.test(s.ayrinti)&&s.yuklemeYuzdesi===92));
});

test('offline delivery counter that keeps moving is waited for until it completes, however slowly',async()=>{
 const k=hazirlikKur();let reads=0;
 await k.ctx.sohbetHazirliginiBekle({pupPage:{evaluate:async()=>{reads++;
  // her 20 okumada (40 sn) bir ilerler: durgun sayaci hic 45 sn'ye varmaz
  const adim=Math.floor((reads-1)/20)+1;return adim>=5?{bekle:false}:{bekle:true,neden:'cevrimdisi',ilerleme:20*adim};}}},{iptal:false},[],k.kayit);
 assert.equal(reads,81);assert.ok(k.toplamSure()>=150000&&k.toplamSure()<=170000,'toplam '+k.toplamSure());
 assert.equal(k.records[k.records.length-1].kod,'hazir');
});

test('counter stuck at 99+ after WhatsApp says synced passes in 10 seconds; anything else keeps the 45 second rule',async()=>{
 const ornek=async(sayac)=>{const k=hazirlikKur();let reads=0;await k.ctx.sohbetHazirliginiBekle({pupPage:{evaluate:async()=>{reads++;return sayac(reads);}}},{iptal:false},['g'],k.kayit);return {k,reads};};
 // %99 + senkron tamam: 10 sn
 let r=await ornek(()=>({bekle:true,neden:'cevrimdisi',ilerleme:99,senkronTamam:true}));
 assert.equal(r.k.toplamSure(),10000);assert.equal(r.reads,6);
 assert.deepEqual(r.k.records,[{asama:'hazirlik-bekleniyor',kod:'cevrimdisi',ilerleme:99},{asama:'hazirlik-bitti',kod:'durgun',ilerleme:99}]);
 // %99 ama senkron tamam bilgisi yok / false: eski 45 sn kurali
 for(const senkronTamam of [undefined,false]){r=await ornek(()=>({bekle:true,neden:'cevrimdisi',ilerleme:99,senkronTamam}));assert.ok(r.k.toplamSure()>=45000&&r.k.toplamSure()<=50000,'senkronTamam='+senkronTamam+' '+r.k.toplamSure());}
 // %98 ve altinda: senkron tamam olsa da 45 sn
 r=await ornek(()=>({bekle:true,neden:'cevrimdisi',ilerleme:98,senkronTamam:true}));assert.ok(r.k.toplamSure()>=45000&&r.k.toplamSure()<=50000,'%98 '+r.k.toplamSure());
 // once ilerleyip sonra %99da takilirsa sayac %99a gelince 10 sn beklenir
 r=await ornek((n)=>({bekle:true,neden:'cevrimdisi',ilerleme:n<=3?90:99,senkronTamam:true}));
 assert.equal(r.k.toplamSure(),16000,'3 okuma %90 (+4 bekleme sonra 4. okumada %99) sonra 10 sn: '+r.k.toplamSure());
 // 10 sn dolmadan sayac 100e ulasirsa beklemeden devam eder
 r=await ornek((n)=>n<4?{bekle:true,neden:'cevrimdisi',ilerleme:99,senkronTamam:true}:{bekle:false});
 assert.equal(r.reads,4);assert.equal(r.k.records[r.k.records.length-1].kod,'hazir');
});

test('the in-page readiness check reports hasSynced only when WhatsApp explicitly says true',async()=>{
 const sayfa=(ctx,hasSynced)=>({evaluate:async(fn,arg)=>{
  ctx.window={require:()=>({Chat:{getModelsArray:()=>[{formattedTitle:'g'}]}}),AuthStore:{AppState:hasSynced===undefined?{}:{hasSynced},OfflineMessageHandler:{getOfflineDeliveryProgress:()=>99}}};
  return fn(arg);}});
 for(const [hasSynced,sure] of [[true,10000],[undefined,null],[false,300000]]){
  const k=hazirlikKur();await k.ctx.sohbetHazirliginiBekle({pupPage:sayfa(k.ctx,hasSynced)},{iptal:false},['g'],k.kayit);
  if(sure===10000)assert.equal(k.toplamSure(),10000,'hasSynced=true: '+k.toplamSure());
  else if(sure===null)assert.ok(k.toplamSure()>=45000&&k.toplamSure()<=50000,'bilinmiyor: '+k.toplamSure());
  else{assert.ok(k.toplamSure()>=298000&&k.toplamSure()<=302000,'senkron tamam degil: '+k.toplamSure());assert.equal(k.records[0].kod,'senkron');}
 }
});

test('ready wait has a five minute ceiling for every reason and names the reason',async()=>{
 for(const neden of ['sohbet','senkron']){
  const k=hazirlikKur();
  await k.ctx.sohbetHazirliginiBekle({pupPage:{evaluate:async()=>({bekle:true,neden})}},{iptal:false},['g'],k.kayit);
  assert.ok(k.toplamSure()>=298000&&k.toplamSure()<=302000,neden+' '+k.toplamSure());
  assert.deepEqual(k.records,[{asama:'hazirlik-bekleniyor',kod:neden},{asama:'hazirlik-bitti',kod:'zaman-asimi'}]);
 }
});

test('ready wait limits are configurable and the real call sites pass the diagnostic recorder',()=>{
 const {LIMITS}=require('../operation-policy');assert.equal(LIMITS.hazirlikDurguSaniye,45);assert.equal(LIMITS.hazirlikUstSaniye,300);assert.equal(LIMITS.hazirlikKisaDurguSaniye,10);assert.equal(LIMITS.hazirlikKisaEsik,99);
 const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
 assert.equal((source.match(/sohbetHazirliginiBekle\([^)]*tani\.record\)/g)||[]).length,2);
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
test('while waiting for the phone confirmation the window gets stage info and an experimental message counter that stops once approved',async t=>{
 const olaylar=[];let n=1000,okuma=0;
 const h=harness(t,[group('A',async()=>[]),group('B',async()=>[])],false,{limits:{mesajSayaciAraligi:5}});
 writeJson(path.join(h.dir,'senkronizasyon-onayi.json'),{tamam:false});
 h.ctx.__gonder=(k,v)=>olaylar.push([k,v]);
 vm.runInContext('pencere = { isDestroyed: () => false, webContents: { send: (k, v) => __gonder(k, v) } }',h.ctx);
 const {sayfa}=bekciSayfasi();const eski=sayfa.evaluate;
 sayfa.evaluate=async(fn,arg)=>{if(arg&&arg.islem==='mesaj-sayaci'){okuma++;return n+=7;}return eski(fn,arg);};
 const pending=h.invoke('baglan');h.clients[0].pupPage=sayfa;h.clients[0].emit('ready');
 for(let k=0;k<800&&olaylar.filter(([a,v])=>a==='senkron'&&v.mesajSayisi).length<3;k++)await new Promise(r=>setTimeout(r,5));
 const sen=olaylar.filter(([a])=>a==='senkron').map(([,v])=>v);
 assert.ok(sen.some(v=>v.baglandi===true),'bağlandı bilgisi');
 assert.ok(sen.some(v=>v.grupSayisi===2),'grup listesi alındı bilgisi (2 grup)');
 assert.ok(sen.some(v=>v.onayBekliyor===true&&v.grupSayisi===2),'onay bekleniyor bilgisi');
 const sayilar=sen.filter(v=>v.mesajSayisi).map(v=>v.mesajSayisi);
 assert.ok(sayilar.length>=3);assert.deepEqual(sayilar.slice(0,3),[1007,1014,1021]);
 assert.ok(sen.filter(v=>v.mesajSayisi).every(v=>v.durduSn===0),'sayı artarken durma süresi 0');
 assert.ok(olaylar.some(([k,v])=>k==='durum'&&v.telefonOnayi===true),'eski durum olayı korunur');
 assert.equal(h.invoke('senkronizasyon-onayla'),true);assert.equal((await pending).bagli,true);await h.settle();
 const sonraki=okuma;await new Promise(r=>setTimeout(r,60));assert.equal(okuma,sonraki,'onaydan sonra sayaç durmalı');
 const tani=readJson(path.join(h.dir,'baglanti-tanisi.json'),{});
 const kayit=(tani.olaylar||[]).filter(o=>o.asama==='mesaj-sayaci');
 assert.equal(kayit.length,1,'tanıya en çok 30 saniyede bir yazılır');assert.equal(kayit[0].ilerleme,1007);assert.equal(JSON.stringify(tani).includes('Msg'),false);
});

test('the message counter ignores page errors, reports an unchanged count as a growing stall time, and stops when the operation is stopped',async t=>{
 const olaylar=[];let cagri=0;
 const h=harness(t,[group('A',async()=>[])],false,{limits:{mesajSayaciAraligi:5}});
 writeJson(path.join(h.dir,'senkronizasyon-onayi.json'),{tamam:false});
 h.ctx.__gonder=(k,v)=>olaylar.push([k,v]);
 vm.runInContext('pencere = { isDestroyed: () => false, webContents: { send: (k, v) => __gonder(k, v) } }',h.ctx);
 const {sayfa}=bekciSayfasi();const eski=sayfa.evaluate;
 sayfa.evaluate=async(fn,arg)=>{if(arg&&arg.islem==='mesaj-sayaci'){cagri++;if(cagri%2===1)throw new Error('Execution context was destroyed');return 5000;}return eski(fn,arg);};
 const pending=h.invoke('baglan');h.clients[0].pupPage=sayfa;h.clients[0].emit('ready');
 for(let k=0;k<1200&&olaylar.filter(([a,v])=>a==='senkron'&&v.mesajSayisi===5000).length<2;k++)await new Promise(r=>setTimeout(r,5));
 const olculer=olaylar.filter(([a,v])=>a==='senkron'&&v.mesajSayisi===5000).map(([,v])=>v.durduSn);
 assert.ok(olculer.length>=2,'hata veren turlar atlanır, sayaç çalışmaya devam eder');assert.ok(olculer.every((d,i)=>i===0||d>=olculer[i-1]),'değişmeyen sayıda durma süresi azalmaz');
 await h.invoke('durdur');await pending.catch(()=>{});
 const sonraki=cagri;await new Promise(r=>setTimeout(r,60));assert.equal(cagri,sonraki,'Durdur sonrası sayaç durmalı');
});

test('collection also reports connection and group-list stages before asking for the phone confirmation',async t=>{
 const olaylar=[];
 const h=harness(t,[group('g',async()=>[])]);
 writeJson(path.join(h.dir,'senkronizasyon-onayi.json'),{tamam:false});writeJson(path.join(h.dir,'gruplar.json'),[{ad:'g',son:1},{ad:'h',son:2},{ad:'i',son:3}]);
 h.ctx.__gonder=(k,v)=>olaylar.push([k,v]);
 vm.runInContext('pencere = { isDestroyed: () => false, webContents: { send: (k, v) => __gonder(k, v) } }',h.ctx);
 await h.invoke('topla',true);h.clients[0].emit('ready');
 for(let k=0;k<400&&!olaylar.some(([a,v])=>a==='senkron'&&v.onayBekliyor);k++)await new Promise(r=>setTimeout(r,5));
 const sen=olaylar.filter(([a])=>a==='senkron').map(([,v])=>v);
 assert.ok(sen.some(v=>v.baglandi===true&&v.grupSayisi===3));assert.ok(sen.some(v=>v.onayBekliyor===true&&v.grupSayisi===3));
 assert.equal(h.invoke('senkronizasyon-onayla'),true);await h.settle();
 assert.equal(sen.filter(v=>v.mesajSayisi).length,0,'sayfa yokken sayaç çalışmaz');
});

test('when no window is in front the result also goes to the notification center with a plain summary',async t=>{
 const now=Math.floor(Date.now()/1000);
 const foto=(id,fark)=>({timestamp:now-fark,type:'image',hasMedia:true,id:{_serialized:id},downloadMedia:async()=>({mimetype:'image/jpeg',data:Buffer.from('bildirim-'+id).toString('base64')})});
 const h=harness(t,[group('g',async()=>[foto('a',600),foto('b',500)])]);
 await h.invoke('topla',true);h.clients[0].emit('ready');await h.settle();
 assert.equal(h.bildirimler.length,1);assert.equal(h.bildirimler[0].o.title,'Archivo');assert.equal(h.bildirimler[0].o.body,'2 fotoğraf indirildi');assert.equal(h.bildirimler[0].gosterildi,true);
 assert.equal(typeof h.bildirimler[0].dinleyici.click,'function','tıklanınca pencere açılmalı');
 assert.equal(JSON.stringify(h.bildirimler[0].o).includes('Bölge'),false,'bildirimde grup adı ya da içerik olmaz');
});
test('no notification while the Archivo window is in front and focused, and none when notifications are unsupported',async t=>{
 const now=Math.floor(Date.now()/1000);
 const foto=(id)=>({timestamp:now-100,type:'image',hasMedia:true,id:{_serialized:id},downloadMedia:async()=>({mimetype:'image/jpeg',data:Buffer.from('on-'+id).toString('base64')})});
 const h=harness(t,[group('g',async()=>[foto('a')])]);
 vm.runInContext('pencere = { isDestroyed: () => false, isVisible: () => true, isFocused: () => true, webContents: { send() {} } }',h.ctx);
 await h.invoke('topla',true);h.clients[0].emit('ready');await h.settle();assert.equal(h.bildirimler.length,0);
 const g=harness(t,[group('g',async()=>[foto('b')])],false,{bildirimYok:true});
 await g.invoke('topla',true);g.clients[0].emit('ready');await g.settle();assert.equal(g.bildirimler.length,0);
 vm.runInContext('pencere = { isDestroyed: () => false, isVisible: () => true, isFocused: () => false, webContents: { send() {} } }',h.ctx);
 const k=harness(t,[group('g',async()=>[foto('c')])]);
 vm.runInContext('pencere = { isDestroyed: () => false, isVisible: () => true, isFocused: () => false, webContents: { send() {} } }',k.ctx);
 await k.invoke('topla',true);k.clients[0].emit('ready');await k.settle();assert.equal(k.bildirimler.length,1,'pencere arka plandaysa bildirim gider');
});
test('notification text covers finished, partial, failed, nothing new, history scan and stopped runs',async t=>{
 const h=harness(t,[]);const m=(sayac,rapor,iptal)=>vm.runInContext('bitisBildirimMetni('+JSON.stringify(sayac)+','+JSON.stringify(rapor)+','+!!iptal+')',h.ctx);
 assert.equal(m({indirilen:3},{}),'3 fotoğraf indirildi');
 assert.equal(m({indirilen:3,hata:1},{}),'3 fotoğraf indirildi (bazıları alınamadı)');
 assert.equal(m({indirilen:0,atlanan:2},{}),'İşlem tamamlanamadı; ayrıntı için Archivo’yu açın');
 assert.equal(m({indirilen:0},{}),'Yeni fotoğraf yok');
 assert.equal(m({indirilen:0},{sadeceTara:true}),'Geçmiş taraması tamamlandı');
 assert.equal(m({indirilen:5},{},true),'İşlem durduruldu');
});
test('real logout requires an existing connected client',async t=>{
 const h=harness(t,[]);assert.match((await h.invoke('whatsapp-cikis')).hata,/Gerçek çıkış/);
 assert.equal(h.clients.length,0);
});
for(const kind of ['cancel','success','failure'])test('real logout '+kind,async t=>{
 let soru=0;const h=harness(t,[],false,{confirm:kind==='cancel'?0:1,logoutFailure:kind==='failure',dialog:kind==='failure'?async()=>({response:soru++===0?1:0}):undefined});
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
// Kayitlarda gorulen hata: hazir tutulan tarayicinin sayfa cercevesi kopmus ("detached Frame")
// ve uygulama ayni bozuk istemciyi sonraki islemlerde yeniden kullanmisti.
function fakePage(state = {}) {
  return {
    isClosed: () => false,
    mainFrame: () => ({ detached: !!state.broken }),
    evaluate: async () => { if (state.broken) throw new Error("Attempted to use detached Frame 'B63985460E9263269F6384835749858B'."); },
  };
}
test('a ready client whose page frame detached while idle is replaced before the next operation', async t => {
  const h = harness(t, []);
  const page = { broken: false };
  const listing = h.invoke('gruplari-getir');
  h.clients[0].pupPage = fakePage(page);
  h.clients[0].emit('ready');
  await listing;
  assert.equal(h.invoke('durum-al').bagli, true);
  page.broken = true;
  await h.invoke('topla', true);
  assert.equal(h.clients[0].destroyed, true);
  assert.equal(h.clients.length, 2);
  await h.invoke('durdur'); await h.settle();
});
test('a client whose page broke during an operation is closed instead of kept as ready', async t => {
  const h = harness(t, []);
  await h.invoke('topla', true);
  h.clients[0].pupPage = fakePage({ broken: true });
  h.clients[0].emit('ready');
  await h.settle();
  assert.equal(h.clients[0].destroyed, true);
  assert.equal(h.invoke('durum-al').bagli, false);
});
test('a ready client with a responsive page is still reused', async t => {
  const h = harness(t, []);
  const listing = h.invoke('gruplari-getir');
  h.clients[0].pupPage = fakePage();
  h.clients[0].emit('ready');
  await listing;
  await h.invoke('topla', true); await h.settle();
  assert.equal(h.clients.length, 1);
  assert.notEqual(h.clients[0].destroyed, true);
  await h.invoke('durdur');
});

// ---- 1. adim: her grup kendi son toplama zamanindan baslar (eksiksiz toplama) ----
async function toplaCalistir(t, durum, kur, secenek = {}) {
  const indirilen = [], sorular = [], istekler = {}, olaylar = [];
  const mesaj = (id, timestamp) => ({ timestamp, type: 'image', hasMedia: true, id: { _serialized: id },
    downloadMedia: async () => { indirilen.push(id); olaylar.push('indir:' + id); return { mimetype: 'image/jpeg', data: Buffer.from('foto-' + id).toString('base64') }; } });
  const sohbet = (ad, liste, sonEtkinlik = 0) => {
    istekler[ad] = 0;
    const sirali = [...liste].sort((a, b) => a.timestamp - b.timestamp);
    return Object.assign(group(ad, async ({ limit }) => { istekler[ad]++; olaylar.push('tara:' + ad); return sirali.slice(-limit); }), { timestamp: sonEtkinlik });
  };
  const h = harness(t, kur(mesaj, sohbet), false, { dialog: async q => { sorular.push(q); return { response: 1 }; }, ...secenek });
  if (durum) writeJson(path.join(h.dir, 'son-calisma.json'), durum);
  await h.invoke('topla', true); h.clients[0].emit('ready'); await h.settle();
  return { h, indirilen, sorular, istekler, olaylar };
}
test('Topla starts from the group checkpoint and never asks about past days', async t => {
  const now = Math.floor(Date.now() / 1000);
  const r = await toplaCalistir(t, { sonZaman: now - 60, sohbetler: { g: now - 3600 } }, (mesaj, sohbet) => [
    sohbet('g', [mesaj('dunku', now - 100000), mesaj('yeni', now - 600)])]);
  assert.deepEqual(r.indirilen, ['yeni']);
  assert.equal(r.sorular.length, 0);
});
test('a group without its own record gets the first-run day window even if other groups were collected recently', async t => {
  const now = Math.floor(Date.now() / 1000);
  const r = await toplaCalistir(t, { sonZaman: now - 60, sohbetler: { baska: now - 600 } }, (mesaj, sohbet) => [
    sohbet('yeniGrup', [mesaj('ikiGunOnce', now - 2 * 86400), mesaj('yeni', now - 600)])]);
  assert.deepEqual(r.indirilen, ['ikiGunOnce', 'yeni']);
  assert.equal(r.sorular.length, 0);
});
test('a long gap since the last collection is covered fully, not cut to the first-run window', async t => {
  const now = Math.floor(Date.now() / 1000);
  const r = await toplaCalistir(t, { sonZaman: now - 60, sohbetler: { g: now - 10 * 86400 } }, (mesaj, sohbet) => [
    sohbet('g', [mesaj('sekizGunOnce', now - 8 * 86400), mesaj('yeni', now - 600)])]);
  assert.deepEqual(r.indirilen, ['sekizGunOnce', 'yeni']);
});
test('a group with no activity since its checkpoint is not scanned at all', async t => {
  const now = Math.floor(Date.now() / 1000);
  const r = await toplaCalistir(t, { sonZaman: now - 60, sohbetler: { sakin: now - 3600 } }, (mesaj, sohbet) => [
    sohbet('sakin', [mesaj('eski', now - 5 * 3600)], now - 5 * 3600)]);
  assert.equal(r.istekler.sakin, 0);
  assert.deepEqual(r.indirilen, []);
});
test('old-format state with only a global last collection time is the start for every group', async t => {
  const now = Math.floor(Date.now() / 1000);
  const r = await toplaCalistir(t, { sonZaman: now - 3600 }, (mesaj, sohbet) => [
    sohbet('g', [mesaj('dunku', now - 100000), mesaj('yeni', now - 600)])]);
  assert.deepEqual(r.indirilen, ['yeni']);
  assert.equal(r.sorular.length, 0);
});
test('a message delivered late just before the checkpoint is still collected (2 hour overlap)', async t => {
  const now = Math.floor(Date.now() / 1000);
  const r = await toplaCalistir(t, { sonZaman: now - 60, sohbetler: { g: now - 3600 } }, (mesaj, sohbet) => [
    sohbet('g', [mesaj('cokEski', now - 4 * 3600), mesaj('gecGelen', now - 2 * 3600), mesaj('yeni', now - 600)])]);
  assert.deepEqual(r.indirilen, ['gecGelen', 'yeni']);
});

// ---- 2. adim: grup grup calisma ve en eski kayitli grup once ----
test('each group is downloaded and checkpointed before the next group is scanned', async t => {
  const now = Math.floor(Date.now() / 1000);
  const r = await toplaCalistir(t, null, (mesaj, sohbet) => [
    sohbet('a', [mesaj('a1', now - 600)]), sohbet('b', [mesaj('b1', now - 500)])]);
  assert.deepEqual(r.olaylar, ['tara:a', 'indir:a1', 'tara:b', 'indir:b1']);
});
// Kesinti: besinci grupta baglanti hatasi. Yarida kalan calismada biten gruplar korunmali.
function yarimKalanGruplar(now, adlar) {
  return (mesaj, sohbet) => {
    const gruplar = adlar.map(ad => sohbet(ad, [mesaj('eski-' + ad, now - 4 * 86400), mesaj('foto-' + ad, now - 300)]));
    gruplar[4].fetchMessages = async () => { throw new Error('baglanti koptu'); };
    return gruplar;
  };
}
test('when a run is interrupted, groups already finished keep their photos and checkpoints', async t => {
  const now = Math.floor(Date.now() / 1000);
  const r = await toplaCalistir(t, null, yarimKalanGruplar(now, ['g1', 'g2', 'g3', 'g4', 'g5']));
  assert.deepEqual(r.indirilen.filter(x => x.startsWith('foto-')), ['foto-g1', 'foto-g2', 'foto-g3', 'foto-g4']);
  const durum = readJson(path.join(r.h.dir, 'son-calisma.json'), {});
  for (const ad of ['g1', 'g2', 'g3', 'g4']) assert.ok(durum.sohbetler[ad] >= now - 1, ad + ' kaydi ilerlemedi');
  assert.ok(durum.sohbetler.g5 <= now - 2 * 86400, 'yarida kalan grubun eski siniri korunmali');
});
test('the group that waited longest is processed first, groups without a record before all', async t => {
  const now = Math.floor(Date.now() / 1000);
  const r = await toplaCalistir(t, { sonZaman: now - 60, sohbetler: { a: now - 1000, b: now - 5000, c: now - 3000 } }, (mesaj, sohbet) => [
    sohbet('a', []), sohbet('b', []), sohbet('c', []), sohbet('d', [])]);
  assert.deepEqual(r.olaylar.filter(x => x.startsWith('tara:')), ['tara:d', 'tara:b', 'tara:c', 'tara:a']);
});

// ---- 3. adim: alinamayan fotograf kuyrugu tikamaz, ama sessizce kaybolmaz ----
const gecerliMedya = ad => ({ mimetype: 'image/jpeg', data: Buffer.from('foto-' + ad).toString('base64') });
test('a photo that keeps coming back empty is given up after 3 attempts, then the group checkpoint advances and it is listed', async t => {
  const now = Math.floor(Date.now() / 1000);
  let kotuDeneme = 0, iyiDeneme = 0;
  const kotu = { timestamp: now - 900, type: 'image', hasMedia: true, id: { _serialized: 'kotu' }, downloadMedia: async () => { kotuDeneme++; return null; } };
  const iyi = { timestamp: now - 600, type: 'image', hasMedia: true, id: { _serialized: 'iyi' }, downloadMedia: async () => { iyiDeneme++; return gecerliMedya('iyi'); } };
  const h = harness(t, [group('g', async () => [kotu, iyi])]);
  const durum = () => readJson(path.join(h.dir, 'son-calisma.json'), {});
  const liste = () => readJson(path.join(h.dir, 'alinamayan-medya.json'), {});
  await h.invoke('topla', true); h.clients[0].emit('ready'); await h.settle();
  assert.equal(liste().kotu.deneme, 1);
  assert.ok(durum().sohbetler.g <= now - 2 * 86400, 'ilk denemede kayit ilerlememeli');
  await h.invoke('topla', true); await h.settle();
  assert.equal(liste().kotu.deneme, 2);
  await h.invoke('topla', true); await h.settle();
  assert.equal(liste().kotu.vazgecildi, true);
  assert.ok(durum().sohbetler.g >= now - 1, 'vazgecilince kayit ilerlemeli');
  await h.invoke('topla', true); await h.settle();
  assert.equal(kotuDeneme, 3);
  assert.equal(iyiDeneme, 1);
  const rapor = readJson(path.join(h.dir, 'tarama-raporu.json'), {});
  assert.ok(rapor.alinamayanMedya.some(m => m.mesajKimligi === 'kotu' && /vazgeçildi/.test(m.neden)));
});
test('photos already given up neither spend requests nor trigger the three-failures stop', async t => {
  const now = Math.floor(Date.now() / 1000);
  let denemeler = 0, iyiDeneme = 0;
  const kotu = (id, fark) => ({ timestamp: now - fark, type: 'image', hasMedia: true, id: { _serialized: id }, downloadMedia: async () => { denemeler++; return null; } });
  const iyi = { timestamp: now - 100, type: 'image', hasMedia: true, id: { _serialized: 'iyi' }, downloadMedia: async () => { iyiDeneme++; return gecerliMedya('iyi'); } };
  const h = harness(t, [group('g', async () => [kotu('k1', 900), kotu('k2', 890), kotu('k3', 880), iyi])]);
  const vazgecilen = { deneme: 3, vazgecildi: true, grup: 'g', tur: 'image', zaman: now - 900, neden: 'bos' };
  writeJson(path.join(h.dir, 'alinamayan-medya.json'), { k1: vazgecilen, k2: vazgecilen, k3: vazgecilen });
  await h.invoke('topla', true); h.clients[0].emit('ready'); await h.settle();
  assert.equal(denemeler, 0);
  assert.equal(iyiDeneme, 1);
});
test('a photo that finally downloads is removed from the unavailable list', async t => {
  const now = Math.floor(Date.now() / 1000);
  let calisir = false;
  const foto = { timestamp: now - 600, type: 'image', hasMedia: true, id: { _serialized: 'x' }, downloadMedia: async () => calisir ? gecerliMedya('x') : null };
  const h = harness(t, [group('g', async () => [foto])]);
  const liste = () => readJson(path.join(h.dir, 'alinamayan-medya.json'), {});
  await h.invoke('topla', true); h.clients[0].emit('ready'); await h.settle();
  assert.equal(liste().x.deneme, 1);
  calisir = true;
  await h.invoke('topla', true); await h.settle();
  assert.equal(liste().x, undefined);
});

// ---- 4. adim: belge olarak gonderilen fotograflar da alinir ----
test('document messages count as photos only when they are images by type or file name', () => {
  const { eligibleMedia } = require('../collection-plan');
  const belge = veri => ({ hasMedia: true, type: 'document', _data: veri });
  assert.equal(eligibleMedia(belge({ mimetype: 'image/jpeg' })), true);
  assert.equal(eligibleMedia(belge({ mimetype: 'image/heic', filename: 'x.heic' })), true);
  assert.equal(eligibleMedia(belge({ mimetype: 'application/octet-stream', filename: 'saha.JPG' })), true);
  assert.equal(eligibleMedia(belge({ filename: 'saha.png' })), true);
  assert.equal(eligibleMedia(belge({ mimetype: 'application/pdf', filename: 'rapor.pdf' })), false);
  assert.equal(eligibleMedia(belge({})), false);
  assert.equal(eligibleMedia({ hasMedia: false, type: 'document', _data: { mimetype: 'image/jpeg' } }), false);
  assert.equal(eligibleMedia({ hasMedia: true, type: 'image' }), true);
  assert.equal(eligibleMedia({ hasMedia: true, type: 'video' }), false);
});
test('photos sent as documents are collected and saved as images; other documents are ignored', async t => {
  const now = Math.floor(Date.now() / 1000);
  const indirilen = [];
  const b64 = ad => Buffer.from('belge-' + ad).toString('base64');
  const belge = (id, fark, veri, media) => ({ timestamp: now - fark, type: 'document', hasMedia: true, id: { _serialized: id }, _data: veri,
    downloadMedia: async () => { indirilen.push(id); return { ...media, data: b64(id) }; } });
  const h = harness(t, [group('g', async () => [
    belge('resim', 900, { mimetype: 'image/jpeg', filename: 'saha-1.jpg' }, { mimetype: 'image/jpeg', filename: 'saha-1.jpg' }),
    belge('pdf', 800, { mimetype: 'application/pdf', filename: 'rapor.pdf' }, { mimetype: 'application/pdf', filename: 'rapor.pdf' }),
    belge('adsiz', 700, { mimetype: 'application/octet-stream', filename: 'saha-2.JPG' }, { mimetype: 'application/octet-stream', filename: 'saha-2.JPG' }),
  ])]);
  await h.invoke('topla', true); h.clients[0].emit('ready'); await h.settle();
  assert.deepEqual(indirilen, ['resim', 'adsiz']);
  const dosyalar = (await h.invoke('arsiv-al', 60)).flatMap(g => g.dosyalar.map(d => d.ad));
  assert.equal(dosyalar.length, 2);
  assert.ok(dosyalar.every(ad => /\.jpe?g$/i.test(ad)), 'uzantilar: ' + dosyalar.join(', '));
});

// ---- 5. adim: durust sonuc - yarida kalan gruplar raporda gorunur ----
test('an interrupted run reports every group that is still waiting, and a complete run reports none', async t => {
  const now = Math.floor(Date.now() / 1000);
  const yarim = await toplaCalistir(t, null, yarimKalanGruplar(now, ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']));
  const rapor = readJson(path.join(yarim.h.dir, 'tarama-raporu.json'), {});
  assert.equal(rapor.bekleyenGrupSayisi, 2);
  assert.equal(rapor.gruplar.find(g => g.ad === 'g6').durum, 'Sırada');
  assert.equal(rapor.gruplar.filter(g => g.ad === 'g6').length, 1);
  assert.equal(rapor.gruplar.filter(g => g.ad === 'g5').length, 1);
  const tam = await toplaCalistir(t, null, (mesaj, sohbet) => [sohbet('a', [mesaj('a1', now - 600)])]);
  assert.equal(readJson(path.join(tam.h.dir, 'tarama-raporu.json'), {}).bekleyenGrupSayisi, 0);
});

// ---- Insan hizi: gecmisi sayfa sayfa, bekleyerek yukleme ----
function sayfaliSohbet(toplam, sayfaBoyu, simdi, ilkYuklu = 0) {
  const mesajlar = Array.from({ length: toplam }, (_, n) => ({ timestamp: simdi - n * 60, hasMedia: n % 10 === 0, type: 'image' }));
  let yuklu = ilkYuklu;
  const durum = () => ({ toplam: yuklu, enEski: yuklu ? mesajlar[yuklu - 1].timestamp : null });
  const sohbet = {
    yuklemeler: 0,
    bak: async () => durum(),
    yukle: async () => { sohbet.yuklemeler++; const once = yuklu; yuklu = Math.min(toplam, yuklu + sayfaBoyu); return { ...durum(), yeni: yuklu - once }; },
    fetchMessages: async () => mesajlar.slice(0, yuklu).reverse(),
  };
  return sohbet;
}
test('paced scan loads page by page, waits before every load and stops as soon as the date is reached', async () => {
  const now = Math.floor(Date.now() / 1000), sohbet = sayfaliSohbet(1000, 50, now);
  let beklemeler = 0;
  const r = await scanPaced(sohbet, now - 249 * 60, now, 20000, async () => { beklemeler++; }, () => {});
  assert.equal(sohbet.yuklemeler, 5);
  assert.equal(beklemeler, 5);
  assert.equal(r.tamam, true);
  assert.equal(r.erisim.durum, 'ulasildi');
  assert.equal(r.erisim.mesaj, 250);
  assert.equal(r.medyalar.length, 25);
});
test('paced scan loads nothing when the loaded messages already reach the date', async () => {
  const now = Math.floor(Date.now() / 1000), sohbet = sayfaliSohbet(1000, 50, now, 300);
  let beklemeler = 0;
  const r = await scanPaced(sohbet, now - 100 * 60, now, 20000, async () => { beklemeler++; }, () => {});
  assert.equal(sohbet.yuklemeler, 0);
  assert.equal(beklemeler, 0);
  assert.equal(r.erisim.durum, 'ulasildi');
});
test('paced scan reports access as uncertain when the history ends before the requested date', async () => {
  const now = Math.floor(Date.now() / 1000), sohbet = sayfaliSohbet(120, 50, now);
  const r = await scanPaced(sohbet, now - 99999 * 60, now, 20000, async () => {}, () => {});
  assert.equal(sohbet.yuklemeler, 4);
  assert.equal(r.tamam, true);
  assert.equal(r.erisim.durum, 'erisim-belirsiz');
  assert.equal(r.erisim.mesaj, 120);
});
test('paced scan stops at the safety ceiling and reports the limit', async () => {
  const now = Math.floor(Date.now() / 1000), sohbet = sayfaliSohbet(1000, 50, now);
  const r = await scanPaced(sohbet, now - 99999 * 60, now, 200, async () => {}, () => {});
  assert.equal(sohbet.yuklemeler, 4);
  assert.equal(r.tamam, false);
  assert.equal(r.erisim.durum, 'sinir');
  assert.equal(r.erisim.mesaj, 200);
});
test('paced scan stops between pages when the operation is cancelled', async () => {
  const now = Math.floor(Date.now() / 1000), sohbet = sayfaliSohbet(1000, 50, now);
  let cagri = 0;
  await assert.rejects(scanPaced(sohbet, now - 99999 * 60, now, 20000, async () => {}, () => { if (++cagri > 3) throw new Error('iptal'); }), /iptal/);
  assert.ok(sohbet.yuklemeler <= 2);
});

// ---- Insan hizi: main.js entegrasyonu ----
function derinGecmisKur(t, secenek = {}) {
  const now = Math.floor(Date.now() / 1000), toplam = 1500;
  const mesajlar = Array.from({ length: toplam }, (_, n) => ({ timestamp: now - n * 60, type: n % 700 === 0 ? 'image' : 'chat', hasMedia: n % 700 === 0, id: { _serialized: 'm' + n } }));
  const durum = { toplam, sayfa: 100, yuklu: 0, yuklemeler: 0 };
  const sayfa = {
    isClosed: () => false, mainFrame: () => ({ detached: false }),
    evaluate: async (_fn, arg) => {
      if (arg && typeof arg === 'object' && arg.islem === 'hazirlik') return { wwebjs: true, req: true, medya: true };
      if (arg && typeof arg === 'object' && arg.islem) {
        let yeni = 0;
        if (arg.islem === 'yukle') { durum.yuklemeler++; const once = durum.yuklu; durum.yuklu = Math.min(toplam, once + durum.sayfa); yeni = durum.yuklu - once; }
        return { toplam: durum.yuklu, enEski: durum.yuklu ? mesajlar[durum.yuklu - 1].timestamp : null, yeni };
      }
      if (typeof arg === 'string') return { mimetype: 'image/jpeg', filename: arg + '.jpg', data: Buffer.from('derin-' + arg).toString('base64') };
      return undefined;
    },
  };
  const h = harness(t, [group('g', async () => mesajlar.slice(0, durum.yuklu).reverse())], false, secenek);
  return { h, durum, sayfa };
}
async function derinGecmisCalistir(t, secenek) {
  const k = derinGecmisKur(t, secenek);
  await k.h.invoke('topla', true); k.h.clients[0].pupPage = k.sayfa; k.h.clients[0].emit('ready'); await k.h.settle();
  return k;
}
test('Topla loads history page by page and collects photos far beyond the old 500-message cap', async t => {
  const { h, durum } = await derinGecmisCalistir(t);
  const dosyalar = (await h.invoke('arsiv-al', 60)).flatMap(g => g.dosyalar.map(d => d.ad));
  assert.equal(dosyalar.length, 3);
  assert.equal(durum.yuklemeler, 16);
  assert.equal(durum.yuklu, 1500);
});
test('a pause is taken before every history page, chosen inside the configured range', async t => {
  const beklemeler = [];
  const { durum } = await derinGecmisCalistir(t, { pace: { sayfa: [100, 100] }, beklemeler });
  assert.equal(durum.yuklemeler, 16);
  assert.equal(beklemeler.filter(ms => ms === 100).length, 16);
});
test('waits between downloads are random inside the configured range', async t => {
  const now = Math.floor(Date.now() / 1000), beklemeler = [];
  await toplaCalistir(t, null, (mesaj, sohbet) => [sohbet('g', Array.from({ length: 8 }, (_, n) => mesaj('f' + n, now - 600 + n)))], { pace: { indirme: [100, 400] }, beklemeler });
  const araliktaki = beklemeler.filter(ms => ms >= 100 && ms <= 400);
  assert.equal(araliktaki.length, 8);
  assert.ok(new Set(araliktaki).size >= 2, 'beklemeler rastgele olmali');
});
test('a rest is taken after every configured number of downloads', async t => {
  const now = Math.floor(Date.now() / 1000), beklemeler = [];
  const r = await toplaCalistir(t, null, (mesaj, sohbet) => [sohbet('g', Array.from({ length: 5 }, (_, n) => mesaj('f' + n, now - 600 + n)))], { pace: { molaHer: 2, mola: [777, 777] }, beklemeler });
  assert.equal(beklemeler.filter(ms => ms === 777).length, 2);
  assert.equal(r.indirilen.length, 5);
});
test('there is no media or size cap: more than 100 photos are downloaded in one run', async t => {
  const now = Math.floor(Date.now() / 1000);
  const r = await toplaCalistir(t, null, (mesaj, sohbet) => [sohbet('g', Array.from({ length: 150 }, (_, n) => mesaj('f' + n, now - 3000 + n)))]);
  assert.equal(r.indirilen.length, 150);
});
test('Stop works promptly even in the middle of a long rest', async t => {
  const now = Math.floor(Date.now() / 1000), beklemeler = [];
  const foto = (id, fark) => ({ timestamp: now - fark, type: 'image', hasMedia: true, id: { _serialized: id }, downloadMedia: async () => ({ mimetype: 'image/jpeg', data: Buffer.from('mola-' + id).toString('base64') }) });
  const h = harness(t, [group('g', async () => [foto('a', 600), foto('b', 500), foto('c', 400)])], false, { pace: { molaHer: 1, mola: [36000000, 36000000] }, beklemeler });
  await h.invoke('topla', true); h.clients[0].emit('ready');
  for (let n = 0; n < 400 && beklemeler.filter(ms => ms === 1000).length < 5; n++) await new Promise(r => setTimeout(r, 5));
  assert.ok(beklemeler.filter(ms => ms === 1000).length >= 5, 'mola baslamadi');
  const basla = Date.now();
  await h.invoke('durdur'); await h.settle();
  assert.ok(Date.now() - basla < 3000, 'Durdur mola sirasinda gecikti');
  assert.equal(readJson(path.join(h.dir, 'tarama-raporu.json'), {}).sonuc, 'iptal');
});
test('during a long rest the window gets a fresh status every 15 seconds so progress never looks frozen', async t => {
  const now = Math.floor(Date.now() / 1000), olaylar = [];
  const foto = (id, fark) => ({ timestamp: now - fark, type: 'image', hasMedia: true, id: { _serialized: id }, downloadMedia: async () => ({ mimetype: 'image/jpeg', data: Buffer.from('mola2-' + id).toString('base64') }) });
  const h = harness(t, [group('g', async () => [foto('a', 600), foto('b', 500)])], false, { pace: { molaHer: 1, mola: [40000, 40000] } });
  h.ctx.__gonder = (kanal, veri) => olaylar.push([kanal, veri]);
  vm.runInContext('pencere = { isDestroyed: () => false, webContents: { send: (k, v) => __gonder(k, v) } }', h.ctx);
  await h.invoke('topla', true); h.clients[0].emit('ready'); await h.settle();
  assert.ok(olaylar.filter(([k, v]) => k === 'durum' && v.metin === 'Dinleniyor').length >= 3);
});
// Dogrulama: sayfa ici yukleyici, sahte bir WhatsApp penceresinde gercek kaynak koduyla calistirilir (gercek WhatsApp degil).
test('the in-page history loader reads cached messages, asks for one older page only when told, and skips notifications', async t => {
  let yakalanan = null;
  const sayfa = { isClosed: () => false, mainFrame: () => ({ detached: false }),
    evaluate: async (fn, arg) => { if (arg && arg.islem === 'hazirlik') return { wwebjs: true, req: true, medya: true }; if (arg && typeof arg === 'object' && arg.islem) { yakalanan = yakalanan || fn; return { toplam: 1, enEski: 0, yeni: 0 }; } return undefined; } };
  const h = harness(t, [group('g', async () => [])]);
  await h.invoke('topla', true); h.clients[0].pupPage = sayfa; h.clients[0].emit('ready'); await h.settle();
  assert.equal(typeof yakalanan, 'function');
  const t0 = 1000000, eskiSayfa = [{ t: t0 - 300 }, { t: t0 - 200, isNotification: true }, { t: t0 - 100 }];
  let bellek = [{ t: t0 }, { t: t0 + 10 }], yuklemeCagri = 0;
  const pencere = {
    WWebJS: { getChat: async (id, secenek) => { assert.equal(id, 'g'); assert.deepEqual(secenek, { getAsModel: false }); return { msgs: { getModelsArray: () => bellek } }; } },
    require: ad => { assert.equal(ad, 'WAWebChatLoadMessages'); return { loadEarlierMsgs: async () => { yuklemeCagri++; bellek = [...eskiSayfa, ...bellek]; return eskiSayfa; } }; },
  };
  const calistir = new Function('window', 'return (' + yakalanan.toString() + ')')(pencere);
  assert.deepEqual(await calistir({ sohbet: 'g', islem: 'bak' }), { toplam: 2, enEski: t0, yeni: 0 });
  assert.equal(yuklemeCagri, 0);
  assert.deepEqual(await calistir({ sohbet: 'g', islem: 'yukle' }), { toplam: 4, enEski: t0 - 300, yeni: 3 });
  assert.equal(yuklemeCagri, 1);
});

// ---- Sayfa yenilenmesine dayaniklilik: WhatsApp Web sayfayi islem sirasinda kendiliginden yenileyebilir ----
// Canli testte goruldu: yenilenince window.WWebJS ve sayfaya taktigimiz yamalar silindi, indirmeler
// "resolveMediaBlob is not a function" ile dustu ve 3 hata ustuste olunca islem durdu.
function yenilenenSayfaKur(secenek = {}) {
  const durum = { yama: true, yenilemede: 0, indirmeSayisi: 0, yamaUygulama: 0, taramaHatasi: secenek.taramaHatasi || 0 };
  const yenilenme = () => new Error('Execution context was destroyed, most likely because of a navigation.');
  const sayfa = {
    isClosed: () => false, mainFrame: () => ({ detached: false }),
    evaluate: async (fn, arg) => {
      if (arg && typeof arg === 'object' && arg.islem === 'hazirlik') {
        if (durum.yenilemede > 0) { durum.yenilemede--; throw yenilenme(); }
        return { wwebjs: true, req: true, medya: durum.yama };
      }
      if (arg && typeof arg === 'object' && arg.islem) {
        if (durum.taramaHatasi > 0) { durum.taramaHatasi--; durum.yenilemede = 1; throw yenilenme(); }
        return { toplam: 1, enEski: 0, yeni: 0 };
      }
      if (typeof arg === 'string') {
        durum.indirmeSayisi++;
        if (durum.indirmeSayisi === secenek.yenilemeIndirmesi) { durum.yama = false; durum.yenilemede = secenek.yenilemeSuresi ?? 3; throw yenilenme(); }
        if (!durum.yama) throw new Error('window.WWebJS.resolveMediaBlob is not a function');
        return { mimetype: 'image/jpeg', filename: arg + '.jpg', data: Buffer.from('yenile-' + arg).toString('base64') };
      }
      if (String(fn).includes('resolveMediaBlob =')) { durum.yama = true; durum.yamaUygulama++; }
      return undefined;
    },
  };
  return { durum, sayfa };
}
async function yenilenenCalistir(t, fotoSayisi, secenek) {
  const now = Math.floor(Date.now() / 1000);
  const mesajlar = Array.from({ length: fotoSayisi }, (_, n) => ({ timestamp: now - 600 + n, type: 'image', hasMedia: true, id: { _serialized: 'y' + n } }));
  const k = yenilenenSayfaKur(secenek);
  const h = harness(t, [group('g', async () => mesajlar)]);
  await h.invoke('topla', true); h.clients[0].pupPage = k.sayfa; h.clients[0].emit('ready'); await h.settle();
  const dosyalar = (await h.invoke('arsiv-al', 60)).flatMap(g => g.dosyalar.map(d => d.ad));
  return { h, ...k, dosyalar, rapor: readJson(path.join(h.dir, 'tarama-raporu.json'), {}), liste: readJson(path.join(h.dir, 'alinamayan-medya.json'), {}) };
}
test('a page reload in the middle of downloads is waited out, the patch re-applied and the photo retried without counting as a failure', async t => {
  const r = await yenilenenCalistir(t, 5, { yenilemeIndirmesi: 3, yenilemeSuresi: 3 });
  assert.equal(r.dosyalar.length, 5);
  assert.deepEqual(r.liste, {});
  assert.equal(r.rapor.sonuc, 'bitti');
  assert.ok(r.durum.yamaUygulama >= 2);
});
test('when the page never recovers after a reload, photos are not counted as failed attempts and the run ends with a clear error', async t => {
  const r = await yenilenenCalistir(t, 3, { yenilemeIndirmesi: 2, yenilemeSuresi: 100000 });
  assert.equal(r.dosyalar.length, 1);
  assert.deepEqual(r.liste, {});
  assert.match(r.rapor.neden, /yenilendi/);
});
test('a page reload during the history scan is waited out and the scan continues', async t => {
  const r = await yenilenenCalistir(t, 2, { taramaHatasi: 1 });
  assert.equal(r.dosyalar.length, 2);
  assert.equal(r.rapor.sonuc, 'bitti');
});

// ---- Tani: alinamayan fotografin iletilmis mesaj olup olmadigi (icerik yok) ----
test('failed photos record whether the message was forwarded, in the report and in the unavailable list', async t => {
  const now = Math.floor(Date.now() / 1000);
  const foto = (id, fark, iletildi) => ({ timestamp: now - fark, type: 'image', hasMedia: true, isForwarded: iletildi, id: { _serialized: id }, downloadMedia: async () => null });
  const h = harness(t, [group('g', async () => [foto('a', 600, true), foto('b', 500, false)])]);
  await h.invoke('topla', true); h.clients[0].emit('ready'); await h.settle();
  const rapor = readJson(path.join(h.dir, 'tarama-raporu.json'), {}), liste = readJson(path.join(h.dir, 'alinamayan-medya.json'), {});
  assert.deepEqual(rapor.alinamayanMedya.map(m => [m.mesajKimligi, m.iletildi]), [['a', true], ['b', false]]);
  assert.equal(liste.a.iletildi, true);
  assert.equal(liste.b.iletildi, false);
});

// ---- Topla'lar arasi 30 dakika bekleme kurali kaldirildi (kullanici karari); yeni baglanti icin 1 dakika kurali surer ----
test('there is no waiting period between runs: a second Topla right after a finished one starts', async t => {
  const h = harness(t, [group('g', async () => [])]);
  await h.invoke('topla', false); h.clients[0].emit('ready'); await h.settle();
  const ikinci = await h.invoke('topla', false); await h.settle();
  assert.equal(ikinci.hata, undefined);
  assert.equal(h.clients.length, 1);
});

// ---- Cikis duzeltmesi (canli test): oturum zaten kapaliysa, zaman asimi, Durdur, kapanista temizlik, pencereye haber ----
async function cikisAc(h) {
  const sonuc = h.invoke('whatsapp-cikis');
  for (let n = 0; n < 400 && h.clients.length < 1; n++) await new Promise(r => setTimeout(r, 5));
  return { sonuc, istemci: h.clients[0] };
}
const eslesmeKayitli = h => writeJson(path.join(h.dir, 'eslesme-durumu.json'), { giris: true });
test('when WhatsApp asks for a QR the session is already closed: local pairing is cleared and the connect button can open', async t => {
  const h = harness(t, [], false, { dialog: async () => ({ response: 1 }) });
  eslesmeKayitli(h); writeJson(path.join(h.dir, 'gruplar.json'), [{ ad: 'a', son: 1 }]);
  const { sonuc, istemci } = await cikisAc(h);
  istemci.emit('qr', 'secret');
  const r = await sonuc;
  assert.equal(r.cikildi, true); assert.equal(r.zatenCikilmis, true); assert.match(r.mesaj, /zaten/);
  assert.equal(istemci.destroyed, true);
  assert.equal(readJson(path.join(h.dir, 'eslesme-durumu.json'), {}).giris, false);
  assert.deepEqual(readJson(path.join(h.dir, 'gruplar.json'), null), []);
  assert.equal(readJson(path.join(h.dir, 'senkronizasyon-onayi.json'), {}).tamam, false);
  const d = h.invoke('durum-al'); assert.equal(d.eslesmeKayitli, false); assert.equal(d.calisiyor, false);
});
for (const neden of ['zaman asimi', 'eslesme dogrulanamadi']) for (const evet of [false, true]) {
  test('an unverifiable logout (' + neden + ') offers to clear only the local pairing, and does so only on Yes (' + (evet ? 'Yes' : 'No') + ')', async t => {
    const sorular = [];
    const h = harness(t, [], false, { limits: { cikisZamanAsimi: 5 }, dialog: async c => { sorular.push(c.message); return { response: sorular.length === 1 ? 1 : (evet ? 1 : 0) }; } });
    eslesmeKayitli(h);
    const { sonuc, istemci } = await cikisAc(h);
    if (neden === 'eslesme dogrulanamadi') istemci.emit('auth_failure', 'x');
    const r = await sonuc;
    assert.equal(sorular.length, 2);
    assert.match(sorular[1], /doğrulanamadı/);
    assert.equal(istemci.destroyed, true);
    const giris = readJson(path.join(h.dir, 'eslesme-durumu.json'), {}).giris;
    if (evet) { assert.equal(r.cikildi, true); assert.equal(r.yerelTemizlendi, true); assert.equal(giris, false); }
    else { assert.match(r.hata, /Yerel oturum silinmedi/); assert.equal(giris, true); }
    assert.equal(h.invoke('durum-al').calisiyor, false);
  });
}
test('Stop during a logout destroys the temporary client, asks nothing more and unlocks the app', async t => {
  const sorular = [];
  const h = harness(t, [], false, { dialog: async c => { sorular.push(c.message); return { response: 1 }; } });
  eslesmeKayitli(h);
  const { sonuc, istemci } = await cikisAc(h);
  await h.invoke('durdur');
  const r = await sonuc;
  assert.equal(istemci.destroyed, true); assert.equal(r.cikildi, false); assert.equal(sorular.length, 1);
  assert.equal(h.invoke('durum-al').calisiyor, false);
  assert.equal(readJson(path.join(h.dir, 'eslesme-durumu.json'), {}).giris, true);
});
test('quitting during a logout closes the temporary browser', async t => {
  const h = harness(t, [], false, { dialog: async () => ({ response: 1 }) });
  eslesmeKayitli(h);
  const { sonuc, istemci } = await cikisAc(h);
  let engellendi = false;
  h.appOn['before-quit'][0]({ preventDefault: () => { engellendi = true; } });
  await sonuc; await new Promise(r => setTimeout(r, 20));
  assert.equal(engellendi, true); assert.equal(istemci.destroyed, true); assert.equal(h.quitSayisi(), 1);
});
test('the window is told when a logout ends, so a reopened window never keeps a stale in-progress panel', async t => {
  const olaylar = [];
  const h = harness(t, [], false, { dialog: async () => ({ response: 1 }) });
  h.ctx.__gonder = (kanal, veri) => olaylar.push([kanal, veri]);
  vm.runInContext('pencere = { isDestroyed: () => false, webContents: { send: (k, v) => __gonder(k, v) } }', h.ctx);
  eslesmeKayitli(h);
  const { sonuc, istemci } = await cikisAc(h);
  istemci.emit('qr', 'x'); await sonuc;
  const bitti = olaylar.filter(([k]) => k === 'bitti');
  assert.equal(bitti.length, 1); assert.match(bitti[0][1].mesaj, /zaten/);
});

// ---- Canli test: "hazir" gelmedi. Kutuphane READY'yi yalnizca change:hasSynced OLAYINDAN yayinlar; sayfa yenilenip bu islem
// yarida kesilirse ya da olay kacirilirse WhatsApp "bagli ve senkron" dese bile hazir hic gelmez. Nobetci bunu yeniden tetikler. ----
function bekciSayfasi(secenek = {}) {
  const sayac = { tetik: 0, sorgu: 0 };
  const sayfa = {
    isClosed: () => false, mainFrame: () => ({ detached: false }),
    evaluate: async (_fn, arg) => {
      if (arg && arg.islem === 'hazirlik') return { wwebjs: true, req: true, medya: true };
      if (arg && arg.islem === 'hazirlik-bekcisi') { sayac.sorgu++; return secenek.durum || { durum: 'CONNECTED', senkron: true, fn: 'function' }; }
      if (arg && arg.islem === 'hazir-tetikle') { sayac.tetik++; if (secenek.tetikle) secenek.tetikle(sayac.tetik); return undefined; }
      if (arg && (arg.islem === 'bak' || arg.islem === 'yukle')) return { toplam: 1, enEski: 0, yeni: 0 };
      return undefined;
    },
  };
  return { sayfa, sayac };
}
test('when WhatsApp reports connected and synced but ready never arrives, the app re-triggers the library ready handler once', async t => {
  const h = harness(t, [group('g', async () => [])], false, { limits: { hazirBekciAraligi: 5 } });
  await h.invoke('topla', true);
  const istemci = h.clients[0];
  const { sayfa, sayac } = bekciSayfasi({ tetikle: () => istemci.emit('ready') });
  istemci.pupPage = sayfa;
  for (let n = 0; n < 600 && sayac.tetik < 1; n++) await new Promise(r => setTimeout(r, 5));
  assert.equal(sayac.tetik, 1);
  await h.settle();
  assert.equal(readJson(path.join(h.dir, 'tarama-raporu.json'), {}).sonuc, 'bitti');
  await new Promise(r => setTimeout(r, 60));
  assert.equal(sayac.tetik, 1, 'ready geldikten sonra tekrar tetiklenmemeli');
});
test('the ready watchdog does nothing while WhatsApp is not yet connected and synced', async t => {
  const h = harness(t, [group('g', async () => [])], false, { limits: { hazirBekciAraligi: 5 } });
  await h.invoke('topla', true);
  const { sayfa, sayac } = bekciSayfasi({ durum: { durum: 'OPENING', senkron: false, fn: 'function' } });
  h.clients[0].pupPage = sayfa;
  for (let n = 0; n < 200 && sayac.sorgu < 6; n++) await new Promise(r => setTimeout(r, 5));
  assert.ok(sayac.sorgu >= 6, 'bekci sorgulamali');
  assert.equal(sayac.tetik, 0);
  await h.invoke('durdur'); await h.settle();
});
test('the ready watchdog gives up after a limited number of triggers and stops with the run', async t => {
  const h = harness(t, [group('g', async () => [])], false, { limits: { hazirBekciAraligi: 5 } });
  await h.invoke('topla', true);
  const { sayfa, sayac } = bekciSayfasi();
  h.clients[0].pupPage = sayfa;
  for (let n = 0; n < 800 && sayac.tetik < 5; n++) await new Promise(r => setTimeout(r, 5));
  await new Promise(r => setTimeout(r, 100));
  assert.equal(sayac.tetik, 5);
  await h.invoke('durdur'); await h.settle();
  const sorgu = sayac.sorgu; await new Promise(r => setTimeout(r, 60));
  assert.equal(sayac.sorgu, sorgu, 'islem bitince nobetci durmali');
});
