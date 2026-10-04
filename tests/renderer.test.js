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
 const api={durumAl:async()=>state,klasorAc:async()=>{calls.push(['klasorAc']);},hizOnayi:async()=>{calls.push(['hizOnayi']);return state.hizOnayi??true;},whatsappCikis:async()=>{calls.push(['cikis']);return state.cikis||{cikildi:true};},senkronizasyonOnayla:async()=>{calls.push(['onay']);return true;},arsivAl:async()=>[],gruplarAl:async()=>[],ayarKaydet:async a=>{calls.push(['save',a]);return {...state.ayar,...a};},degisiklikSor:async()=>{calls.push(['confirm']);return state.saveChoice ?? true;},gecmisKontrol:async a=>{calls.push(['scan',a]);return {tamam:true};},topla:async(...args)=>{calls.push(['topla',...args]);return {tamam:true};},baglan:async()=>{calls.push(['baglan']);state.baglantiDurumu='Bağlı';state.bagli=true;return {bagli:true};},durdur:async()=>{calls.push(['durdur']);state.calisiyor=false;}};
 for(const name of ['onGruplar','onQr','onDurum','onDosya','onYinelenen','onBitti','onHata','onSenkron'])api[name]=fn=>callbacks[name]=fn;
 const context={window:{api,addEventListener(){},matchMedia:()=>({matches:true})},document:{getElementById:id=>{assert.ok(elements.has(id),'Unknown element '+id);return elements.get(id);},documentElement:element(),createElement:element,addEventListener(){}},IntersectionObserver:class{observe(){}unobserve(){}},setInterval:fn=>ticks.push(fn),setTimeout:()=>0,clearTimeout(){},console};
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

test('the Devam et button stays visible after later status events, stages fill in, and every panel closes when the work ends',async()=>{
 const h=await renderer();const e=h.elements;
 await e.get('topla').events.click();
 h.callbacks.onSenkron({baglandi:true});h.callbacks.onSenkron({grupSayisi:41});
 assert.equal(e.get('syncAdim1').attrs['data-durum'],'tamam');assert.equal(e.get('syncAdim2').attrs['data-durum'],'tamam');assert.match(e.get('syncAdim2Yazi').textContent,/Grup listesi alındı \(41 grup\)/);
 h.callbacks.onDurum({metin:'Senkronize ediliyor',telefonOnayi:true});
 h.callbacks.onSenkron({onayBekliyor:true,mesajSayisi:12430,durduSn:3});
 assert.equal(e.get('syncDevam').hidden,false);assert.equal(e.get('syncKatman').hidden,false);
 assert.match(e.get('syncAdim3Yazi').textContent,/12\.430 mesaj · artıyor/);
 h.callbacks.onDurum({metin:'Senkronize ediliyor',yuklemeYuzdesi:99});
 assert.equal(e.get('syncDevam').hidden,false,'sonradan gelen %99 bildirimi düğmeyi gizlememeli');assert.equal(e.get('syncKatman').hidden,false);
 h.callbacks.onDurum({metin:'Başka bir durum metni'});
 assert.equal(e.get('syncKatman').hidden,false,'onay beklenirken panel durum metni değişse de kapanmamalı');assert.equal(e.get('syncDevam').hidden,false);
 assert.equal(e.get('islemPanel').hidden,true,'senkron paneli açıkken işlem paneli gizli');
 h.callbacks.onSenkron({durduSn:130});assert.match(e.get('syncAdim3Yazi').textContent,/2 dakikadır değişmedi, büyük olasılıkla bitti/);
 h.callbacks.onSenkron({durduSn:40});assert.match(e.get('syncAdim3Yazi').textContent,/40 saniyedir değişmedi$/);
 await e.get('syncDevam').events.click();assert.equal(e.get('syncDevam').hidden,true);
 assert.equal(h.calls.filter(c=>c[0]==='onay').length,1,'onay ana sürece iletilmeli');
 await h.callbacks.onBitti({indirilen:0});
 for(const id of ['syncKatman','islemPanel','qrKatman'])assert.equal(e.get(id).hidden,true,id+' iş bitince kapanmalı');
 assert.equal(e.get('syncAdim1').attrs['data-durum'],'surer','sonraki işlem için aşamalar sıfırlanır');
});
test('stages start over for the next run and show waiting state before the connection is made',async()=>{
 const h=await renderer();const e=h.elements;
 await e.get('topla').events.click();
 assert.equal(e.get('syncAdim1').attrs['data-durum'],'surer');assert.equal(e.get('syncAdim2').attrs['data-durum'],'bekliyor');assert.equal(e.get('syncAdim3').attrs['data-durum'],'bekliyor');
 assert.match(e.get('syncAdim2Yazi').textContent,/bekleniyor/);assert.equal(e.get('syncDevam').hidden,true);
 h.callbacks.onSenkron({baglandi:true});assert.equal(e.get('syncAdim2').attrs['data-durum'],'surer');assert.match(e.get('syncAdim2Yazi').textContent,/alınıyor/);
 await h.callbacks.onBitti({indirilen:1});
 await e.get('topla').events.click();assert.equal(e.get('syncAdim1').attrs['data-durum'],'surer');assert.match(e.get('syncAdim1Yazi').textContent,/bağlanılıyor/);
});

test('completion card: uppercase title, outcome texts, folder button only when photos arrived, Tamam and a new run close it',async()=>{
 const h=await renderer();const e=h.elements;const txt=()=>[e.get('bitisBaslik').textContent,e.get('bitisAyrinti').textContent+e.get('bitisEksik').textContent+e.get('bitisSure').textContent];
 // basarili + gecen sure (ilerleme baslangicindan)
 h.callbacks.onDurum({metin:'Fotoğraflar indiriliyor',baslangic:Date.now()-860000});
 await h.callbacks.onBitti({indirilen:100,yinelenen:12,atlanan:0,hata:0,rapor:{sonuc:'bitti'}});
 assert.equal(e.get('bitisKart').hidden,false);
 assert.deepEqual(txt(),['İNDİRME TAMAMLANDI','100 fotoğraf indirildi · 12 yinelenen atlandı · 14 dk 20 sn']);
 assert.equal(e.get('bitisKlasor').hidden,false);
 assert.equal(e.get('bitisIkon').className,'tl t-yesil');
 // kismi
 await h.callbacks.onBitti({indirilen:98,atlanan:2,hata:0,rapor:{sonuc:'eksik'}});
 assert.equal(e.get('bitisBaslik').textContent,'İNDİRME TAMAMLANDI');
 assert.match(e.get('bitisAyrinti').textContent+e.get('bitisEksik').textContent,/98 fotoğraf indirildi · 2 alınamadı, sonraki Topla’da yeniden denenecek/);
 // yeni foto yok / gecmis taramasi / basarisiz / durduruldu
 await h.callbacks.onBitti({indirilen:0,rapor:{sonuc:'bitti'}});
 assert.equal(e.get('bitisBaslik').textContent,'YENİ FOTOĞRAF YOK');assert.equal(e.get('bitisKlasor').hidden,true);assert.equal(e.get('bitisSure').textContent,'','süre bilinmiyorsa yazılmaz');
 await h.callbacks.onBitti({indirilen:0,rapor:{sonuc:'bitti',sadeceTara:true}});
 assert.equal(e.get('bitisBaslik').textContent,'GEÇMİŞ TARAMASI TAMAMLANDI');
 await h.callbacks.onBitti({indirilen:0,hata:2,rapor:{sonuc:'eksik'}});
 assert.equal(e.get('bitisBaslik').textContent,'İŞLEM TAMAMLANAMADI');assert.equal(e.get('bitisIkon').className,'tl t-kirmizi');assert.equal(e.get('bitisKlasor').hidden,true);
 await h.callbacks.onBitti({indirilen:12,rapor:{sonuc:'iptal'}});
 assert.equal(e.get('bitisBaslik').textContent,'İŞLEM DURDURULDU');assert.equal(e.get('bitisAyrinti').textContent,'12 fotoğraf indirildi');assert.equal(e.get('bitisKlasor').hidden,false);
 await e.get('bitisKlasor').events.click();assert.deepEqual(h.calls.filter(c=>c[0]==='klasorAc').length,1);
 // Tamam kapatir
 await e.get('bitisTamam').events.click();assert.equal(e.get('bitisKart').hidden,true);
 // yeni calisma kapatir
 await h.callbacks.onBitti({indirilen:1,rapor:{sonuc:'bitti'}});assert.equal(e.get('bitisKart').hidden,false);
 await e.get('topla').events.click();assert.equal(e.get('bitisKart').hidden,true);
 // cikis mesaji kart acmaz
 await h.callbacks.onBitti({mesaj:'WhatsApp bu oturumu zaten kapatmış'});assert.equal(e.get('bitisKart').hidden,true);
});

test('phone pairing badge: green dot only for Bağlı, grey for Bağlı değil, blue while connecting; buttons follow the pairing state',async()=>{
 const h=await renderer();const e=h.elements;
 const rozet=()=>[e.get('baglantiEtiket').textContent,e.get('baglantiEtiket').attrs['data-durum'],e.get('baglantiAyrinti').textContent];
 const yenile=async()=>{await h.callbacks.onBitti({indirilen:0,rapor:{sonuc:'bitti'}});};
 // eslesmemis
 Object.assign(h.state,{eslesmeKayitli:false,bagli:false,baglantiDurumu:'Bağlantı kapalı',calisiyor:false});await yenile();
 assert.deepEqual(rozet(),['Bağlı değil','degil','Telefondaki WhatsApp ile bağlantı']);
 assert.equal(e.get('baglanDugme').disabled,false);assert.equal(e.get('baglanYazi').textContent,'QR kod göster');assert.equal(e.get('esleşmeSifirla').disabled,true);
 // eslesmis, tarayici kapali
 Object.assign(h.state,{eslesmeKayitli:true,bagli:false,baglantiDurumu:'Bağlantı kapalı'});await yenile();
 assert.deepEqual(rozet(),['Bağlı','bagli','Eşleşme kayıtlı; WhatsApp Topla ile açılır']);
 assert.equal(e.get('baglanDugme').disabled,true);assert.equal(e.get('baglanYazi').textContent,'Bağlandı');assert.equal(e.get('esleşmeSifirla').disabled,false);
 // eslesmis ve baglanti acik
 Object.assign(h.state,{baglantiDurumu:'Bağlı',bagli:true});await yenile();
 assert.deepEqual(rozet(),['Bağlı','bagli','Telefondaki WhatsApp ile bağlantı']);
 // gecici durumlar mavi
 for(const metin of ['WhatsApp açılıyor','Senkronize ediliyor','QR bekleniyor']){h.callbacks.onDurum({metin});assert.deepEqual(rozet().slice(0,2),[metin,'surer'],metin);}
 // is bitince gercek duruma doner
 await yenile();assert.equal(rozet()[1],'bagli');
 // eslesme kaldirilinca gri
 Object.assign(h.state,{eslesmeKayitli:false,bagli:false,baglantiDurumu:'Bağlantı kapalı'});await yenile();
 assert.deepEqual(rozet().slice(0,2),['Bağlı değil','degil']);
});

test('speed setting: loads from settings, Hizli needs confirmation, Orta and Hizli show a warning, choice is part of the saved draft',async()=>{
 const h=await renderer();const e=h.elements;
 const basili=()=>['hizYavas','hizOrta','hizHizli'].map(id=>e.get(id).attrs['aria-pressed']);
 h.state.ayar.indirmeHizi='orta';
 await e.get('ayarAc').events.click();
 assert.deepEqual(basili(),['false','true','false']);assert.equal(e.get('hizUyari').hidden,false);assert.match(e.get('hizAciklama').textContent,/1–3 sn.*150 indirmede/);
 // Hizli: onay verilmezse degismez
 h.state.hizOnayi=false;await e.get('hizHizli').events.click();
 assert.deepEqual(basili(),['false','true','false']);assert.equal(h.calls.filter(c=>c[0]==='hizOnayi').length,1);
 // onay verilirse Hizli
 h.state.hizOnayi=true;await e.get('hizHizli').events.click();
 assert.deepEqual(basili(),['false','false','true']);assert.match(e.get('hizUyari').textContent,/belirgin şekilde artırabilir/);assert.match(e.get('hizAciklama').textContent,/0,5–1,5 sn.*200 indirmede/);
 // Yavas: onay istemez, uyari gizlenir
 await e.get('hizYavas').events.click();
 assert.deepEqual(basili(),['true','false','false']);assert.equal(e.get('hizUyari').hidden,true);assert.equal(h.calls.filter(c=>c[0]==='hizOnayi').length,2,'Yavaş için onay sorulmaz');
 // Orta: onay istemez ama uyari gorunur
 await e.get('hizOrta').events.click();assert.equal(e.get('hizUyari').hidden,false);assert.equal(h.calls.filter(c=>c[0]==='hizOnayi').length,2);
 // secim kaydedilen taslaga girer
 await e.get('ayarKapat').events.click();
 const kayit=h.calls.filter(c=>c[0]==='save').pop();assert.equal(kayit[1].indirmeHizi,'orta');
});
