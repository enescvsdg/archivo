const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {observeConnection,errorText}=require('../connection-diagnostics');
function file(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archivo-diag-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'connection.json');}
test('records opening, page, pairing and ready without personal data; removes listeners',async t=>{
 const client=new EventEmitter(),page=new EventEmitter();let navigation=0;
 page.goto=()=>navigation++;page.evaluate=async()=>({belge:'complete',cevrimici:true,whatsappKodHazir:true,kutuphaneHazir:true,whatsappSayfasi:true,secret:'never-save'});client.pupPage=page;
 const f=file(t),d=observeConnection(client,f);
 page.emit('load');client.emit('qr','SECRET QR');client.emit('authenticated','SECRET ID');client.emit('ready');await d.finish('bitti');
 const saved=JSON.parse(fs.readFileSync(f));assert.equal(saved.asama,'hazir');assert.equal(saved.sayfa.kutuphaneHazir,true);assert.equal(navigation,0);
 assert.equal(JSON.stringify(saved).includes('SECRET'),false);assert.equal(JSON.stringify(saved).includes('never-save'),false);
 assert.equal(page.listenerCount('load'),0);assert.equal(client.listenerCount('ready'),0);
});
test('network diagnostics retain only fixed error code, never URL or response body',async t=>{
 const client=new EventEmitter();client.pupPage=new EventEmitter();const f=file(t),d=observeConnection(client,f);
 client.pupPage.emit('requestfailed',{failure:()=>({errorText:'net::ERR_NAME_NOT_RESOLVED https://private.invalid/secret?token=abc'})});
 await d.finish('hata','goto https://private.invalid/secret failed');const text=fs.readFileSync(f,'utf8');
 assert.match(text,/ERR_NAME_NOT_RESOLVED/);assert.equal(text.includes('private.invalid'),false);assert.equal(text.includes('token'),false);
});
test('late page assignment does not replace ready stage at final snapshot',async t=>{
 const client=new EventEmitter(),f=file(t),d=observeConnection(client,f);client.emit('ready');client.pupPage=new EventEmitter();
 await d.finish('bitti');assert.equal(JSON.parse(fs.readFileSync(f)).asama,'hazir');
});
test('string initialization errors are retained and finalization is idempotent',async t=>{
 const client=new EventEmitter(),f=file(t),d=observeConnection(client,f);await d.finish('hata','auth timeout');await d.finish('bitti');
 assert.equal(JSON.parse(fs.readFileSync(f)).hata,'auth timeout');assert.equal(errorText('auth timeout'),'auth timeout');assert.equal(client.listenerCount('ready'),0);
});

test('Puppeteer off-only emitter detaches page callbacks and late load cannot notify the UI',async t=>{
 const client=new EventEmitter(),emitter=new EventEmitter(),events=[];
 const page={on:(...args)=>emitter.on(...args),off:(...args)=>emitter.off(...args)};
 client.pupPage=page;const d=observeConnection(client,file(t),x=>events.push(x));
 const queuedLoad=emitter.listeners('load')[0];client.emit('ready');await d.finish('bitti');const before=events.length;
 assert.equal(emitter.listenerCount('load'),0);emitter.emit('load');queuedLoad();
 assert.equal(events.length,before);assert.equal(d.state.asama,'hazir');
});

test('records main-frame detach and page close as fixed stages; ignores sub-frames and never stores frame URLs',async t=>{
 const client=new EventEmitter(),page=new EventEmitter();client.pupPage=page;
 const f=file(t),d=observeConnection(client,f);
 page.emit('framedetached',{parentFrame:()=>({}),url:()=>'https://private.invalid/sub?token=abc'});
 assert.equal(d.state.olaylar.some(o=>o.asama==='sayfa-cercevesi-koptu'),false);
 page.emit('framedetached',{parentFrame:()=>null,url:()=>'https://web.whatsapp.com/?secret=1'});
 page.emit('close');
 await d.finish('hata','x');
 const saved=JSON.parse(fs.readFileSync(f)),stages=saved.olaylar.map(o=>o.asama);
 assert.equal(stages.filter(a=>a==='sayfa-cercevesi-koptu').length,1);
 assert.ok(stages.includes('sayfa-kapandi'));
 const text=JSON.stringify(saved);assert.equal(text.includes('private.invalid'),false);assert.equal(text.includes('secret'),false);assert.equal(text.includes('token'),false);
 assert.equal(page.listenerCount('framedetached'),0);assert.equal(page.listenerCount('close'),0);
});

// ---- Canli testte "hazir" gelmedi: bekleme nedenini gormek icin yeni tani bilgileri (yalnizca sabit kodlar ve sayilar) ----
test('records WhatsApp state changes and disconnect reasons as fixed codes only',async t=>{
 const client=new EventEmitter(),f=file(t),d=observeConnection(client,f);
 client.emit('change_state','OPENING');client.emit('change_state','tel:+905551112233 gizli');client.emit('disconnected','NAVIGATION');client.emit('disconnected','kisi adi gizli');
 await d.finish('hata');const saved=JSON.parse(fs.readFileSync(f)),text=JSON.stringify(saved);
 const durumlar=saved.olaylar.filter(o=>o.asama==='durum-degisti').map(o=>o.kod),kesintiler=saved.olaylar.filter(o=>o.asama==='baglanti-kesildi').map(o=>o.kod);
 assert.deepEqual(durumlar,['OPENING','bilinmiyor']);assert.deepEqual(kesintiler,['NAVIGATION','bilinmiyor']);
 assert.equal(text.includes('905551112233'),false);assert.equal(text.includes('gizli'),false);
});
test('records the loading percentage as a number and the web version as a safe string',async t=>{
 const client=new EventEmitter(),f=file(t);client.getWWebVersion=async()=>'2.3000.1038765123';
 const d=observeConnection(client,f);
 client.emit('loading_screen',42,'Mesajlariniz yukleniyor gizli');client.emit('ready');await new Promise(r=>setTimeout(r,20));await d.finish('bitti');
 const saved=JSON.parse(fs.readFileSync(f));
 assert.equal(saved.olaylar.find(o=>o.asama==='senkronizasyon').yuzde,42);assert.equal(saved.waSurum,'2.3000.1038765123');
 assert.equal(JSON.stringify(saved).includes('gizli'),false);
 const kotu=new EventEmitter();kotu.getWWebVersion=async()=>'<script>x</script>';const f2=file(t),d2=observeConnection(kotu,f2);
 kotu.emit('ready');await new Promise(r=>setTimeout(r,20));await d2.finish('bitti');assert.equal(JSON.parse(fs.readFileSync(f2)).waSurum,undefined);
});
test('while waiting, an in-page state snapshot is recorded only when it changes, with sanitized fields, and stops at finish',async t=>{
 const client=new EventEmitter(),page=new EventEmitter();let n=0;
 page.evaluate=async()=>{n++;return n<4?{durum:'OPENING',senkron:false,belge:'complete',surum:'2.3000.1',gizli:'tel:+90555'}:{durum:'tel:+90555',senkron:true,belge:'<b>',surum:'x'};};
 client.pupPage=page;const f=file(t),d=observeConnection(client,f,()=>{},false,{anlikMs:15});
 await new Promise(r=>setTimeout(r,160));await d.finish('hata');const once=n;await new Promise(r=>setTimeout(r,80));
 const saved=JSON.parse(fs.readFileSync(f)),anlik=saved.olaylar.filter(o=>o.asama==='sayfa-anlik');
 assert.equal(anlik.length,2);assert.deepEqual([anlik[0].durum,anlik[0].senkron,anlik[0].belge,anlik[0].surum],['OPENING',false,'complete','2.3000.1']);
 assert.deepEqual([anlik[1].durum,anlik[1].senkron,anlik[1].belge,anlik[1].surum],['bilinmiyor',true,'bilinmiyor','bilinmiyor']);
 assert.equal(JSON.stringify(saved).includes('90555'),false);assert.equal(JSON.stringify(saved).includes('gizli'),false);
 assert.equal(n,once);
});
