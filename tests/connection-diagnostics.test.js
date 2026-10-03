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
