const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
async function renderer() {
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const elements=new Map();
 function element(){return {hidden:false,disabled:false,value:'',textContent:'',innerHTML:'',dataset:{},children:[],events:{},attrs:{},style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},addEventListener(name,fn){this.events[name]=fn;},setAttribute(name,v){this.attrs[name]=v;},getAttribute(name){return this.attrs[name];},scrollTop:0,scrollTo(options){this.scrollTop=options.top;},getBoundingClientRect(){return {height:40};},querySelectorAll(){return [];},append(){},prepend(){},remove(){}};}
 for(const [,id] of html.matchAll(/\bid="([^"]+)"/g))elements.set(id,element());
 const callbacks={},calls=[],ticks=[];
 const state={ayar:{hedefKlasor:'/tmp/test',ilkCalismaGunSayisi:3,sadeceSuGruplar:[]},calisiyor:false,baglantiDurumu:'Bağlantı kapalı',rapor:null};
 const api={durumAl:async()=>state,whatsappCikis:async()=>{calls.push(['cikis']);return state.cikis||{cikildi:true};},arsivAl:async()=>[],gruplarAl:async()=>[],ayarKaydet:async a=>{calls.push(['save',a]);return {...state.ayar,...a};},degisiklikSor:async()=>{calls.push(['confirm']);return state.saveChoice ?? true;},gecmisKontrol:async a=>{calls.push(['scan',a]);return {tamam:true};},topla:async(...args)=>{calls.push(['topla',...args]);return {tamam:true};},baglan:async()=>{calls.push(['baglan']);state.baglantiDurumu='Bağlı';state.bagli=true;return {bagli:true};},durdur:async()=>{calls.push(['durdur']);state.calisiyor=false;}};
 for(const name of ['onGruplar','onQr','onDurum','onDosya','onYinelenen','onBitti','onHata'])api[name]=fn=>callbacks[name]=fn;
 const context={window:{api,addEventListener(){},matchMedia:()=>({matches:true})},document:{getElementById:id=>{assert.ok(elements.has(id),'Unknown element '+id);return elements.get(id);},documentElement:element(),createElement:element,addEventListener(){}},IntersectionObserver:class{observe(){}unobserve(){}},setInterval:fn=>ticks.push(fn),setTimeout:()=>0,console};
 vm.createContext(context);vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
 for(let n=0;n<8;n++)await Promise.resolve();
 return {elements,callbacks,calls,ticks,state};
}
test('settings connection is independent of collection and history uses selected days',async()=>{
 const h=await renderer();
 await h.elements.get('baglanDugme').events.click();
 assert.deepEqual(h.calls,[['baglan']]);
 assert.equal(h.elements.get('baglantiEtiket').textContent,'Bağlı');
 assert.equal(h.elements.get('islemPanel').hidden,true);
 h.elements.get('gecmisGun').value='15';
 h.elements.get('videoAnahtar').events.click();
 await h.elements.get('gecmisTara').events.click();
 assert.equal(h.calls[1][0],'scan');
 assert.equal(h.calls[1][1].ilkCalismaGunSayisi,15);
 assert.equal(h.calls.some(c=>c[0]==='topla'||c[0]==='save'),false);
 assert.equal(h.elements.get('islemPanel').hidden,false);
});
test('progress panel shows stages, elapsed time, stale progress, QR and cancellation',async()=>{
 const h=await renderer();const now=Date.now();
 h.callbacks.onDurum({metin:'Senkronize ediliyor',baslangic:now-65000,sonIlerleme:now-40000});
 assert.equal(h.elements.get('topla').disabled,true);
 h.ticks[0]();
 assert.match(h.elements.get('islemSure').textContent,/Yeni ilerleme bilgisi alınamıyor/);
 assert.equal(h.elements.get('islemAsama').textContent,'Senkronize ediliyor');
 h.callbacks.onQr('fake-qr');assert.equal(h.elements.get('qrKatman').hidden,false);
 h.callbacks.onQr(null);assert.equal(h.elements.get('qrKatman').hidden,true);
 await h.elements.get('islemDurdur').events.click();
 assert.deepEqual(h.calls,[['durdur']]);
 assert.equal(h.elements.get('islemPanel').hidden,true);
});
test('failed media details appear in the report as plain text',async()=>{
 const h=await renderer();
 h.state.rapor={baslangic:1,sonuc:'eksik',gruplar:[],alinamayanMedya:[{grup:'test',tur:'image',zaman:2,neden:'<script>not executable</script>'}]};
 await h.callbacks.onBitti({indirilen:0,atlanan:1,hata:0});
 const text=h.elements.get('erisimRaporu').textContent;
 assert.match(text,/Alınamayan medya \(1\)/);
 assert.match(text,/image/);
 assert.match(text,/<script>not executable<\/script>/);
});
test('settings X saves only with Yes and restores draft on No; unchanged closes without asking',async()=>{
 const h=await renderer();
 await h.elements.get('ayarAc').events.click();
 await h.elements.get('ayarX').events.click();
 assert.equal(h.calls.length,0);
 await h.elements.get('ayarAc').events.click();h.elements.get('videoAnahtar').events.click();h.state.saveChoice=false;
 await h.elements.get('ayarX').events.click();assert.deepEqual(h.calls,[['confirm']]);
 await h.elements.get('ayarAc').events.click();h.elements.get('videoAnahtar').events.click();h.state.saveChoice=true;
 await h.elements.get('ayarX').events.click();assert.equal(h.calls[2][0],'save');assert.equal(h.calls[2][1].videolariDaIndir,true);
 assert.equal(h.elements.get('ayarKatman').hidden,true);
});
test('wheel picker supports scrolling and keyboard within 1–90 days',async()=>{
 const h=await renderer();await h.elements.get('ayarAc').events.click();
 const wheel=h.elements.get('gunTekerlek');wheel.scrollTop=14*40;wheel.events.scroll();assert.equal(h.elements.get('gecmisGun').value,15);
 wheel.events.keydown({key:'End',preventDefault(){}});assert.equal(h.elements.get('gecmisGun').value,90);
 wheel.events.keydown({key:'ArrowDown',preventDefault(){}});assert.equal(h.elements.get('gecmisGun').value,90);
 wheel.events.keydown({key:'Home',preventDefault(){}});assert.equal(h.elements.get('gecmisGun').value,1);
});

test('homepage Topla uses today mode and history download has its own button',async()=>{
 const h=await renderer();await h.elements.get('topla').events.click();assert.deepEqual(h.calls,[['topla',false,false]]);
 assert.ok(h.elements.has('gecmisIndir'));assert.equal(h.elements.get('gecmisIndir').disabled,true);
});

test('sync dialog blocks operations, shows only reported percentage and clears on completion',async()=>{
 const h=await renderer();h.callbacks.onDurum({metin:'Senkronize ediliyor',yuklemeYuzdesi:62});
 assert.equal(h.elements.get('syncKatman').hidden,false);assert.equal(h.elements.get('topla').disabled,true);
 assert.equal(h.elements.get('syncDolgu').style.width,'62%');
 h.callbacks.onDurum({metin:'Senkronize ediliyor'});assert.match(h.elements.get('syncBilgi').textContent,/Kesin ilerleme yüzdesi alınmadı/);
 h.callbacks.onDurum({metin:'Grup listesi alınıyor'});assert.equal(h.elements.get('syncKatman').hidden,true);
 await h.callbacks.onBitti({indirilen:0});assert.equal(h.elements.get('topla').disabled,false);
});

test('stored pairing disables QR and enables logout even while browser is closed',async()=>{
 const h=await renderer();h.state.eslesmeKayitli=true;h.state.bagli=false;
 await h.elements.get('ayarAc').events.click();
 assert.equal(h.elements.get('baglanDugme').disabled,true);
 assert.equal(h.elements.get('esleşmeSifirla').disabled,false);
 h.state.eslesmeKayitli=false;await h.elements.get('ayarAc').events.click();
 assert.equal(h.elements.get('baglanDugme').disabled,false);
 assert.equal(h.elements.get('esleşmeSifirla').disabled,true);
});

// Cikis duzeltmesi: ana surec bitisi bildirince panel kapanir ve sonuc mesaji gosterilir.
test('a logout result message closes the progress panel and becomes the summary',async()=>{
 const h=await renderer();
 h.callbacks.onDurum({metin:'İşlem sürüyor'});
 assert.equal(h.elements.get('topla').disabled,true);
 await h.callbacks.onBitti({mesaj:'WhatsApp bu oturumu zaten kapatmış'});
 assert.equal(h.elements.get('islemPanel').hidden,true);
 assert.equal(h.elements.get('topla').disabled,false);
 assert.equal(h.elements.get('ozet').textContent,'WhatsApp bu oturumu zaten kapatmış');
});
test('the logout button shows the message returned by the main process',async()=>{
 const h=await renderer();h.state.cikis={cikildi:true,zatenCikilmis:true,mesaj:'Telefondan zaten çıkılmış; yerel eşleşme temizlendi'};
 await h.elements.get('esleşmeSifirla').events.click();
 assert.equal(h.elements.get('ozet').textContent,'Telefondan zaten çıkılmış; yerel eşleşme temizlendi');
});
