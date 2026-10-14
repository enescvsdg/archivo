// Insan hizi modeli: sert istek/medya/MB tavanlari yerine tempo. Tek emniyet siniri sure (60 dk) ve art arda 3 hatadir.
// Bu ayarlar hesabin kisitlanmayacagini garanti etmez.
const LIMITS = Object.freeze({ days: 90, messages: 20000, duration: 60 * 60 * 1000, failures: 3, timeout: 0, cikisZamanAsimi: 90000, hazirBekciAraligi: 5000, hazirlikDurguSaniye: 45, hazirlikKisaDurguSaniye: 10, hazirlikKisaEsik: 99, hazirlikUstSaniye: 300, mesajSayaciAraligi: 5000,
  // Acilista otomatik toplama: acilistan 5 dk sonra; son basarili toplamadan 6 saat gecmediyse toplamaz; internet yoksa 5 dk arayla 6 deneme.
  otomatikBeklemeMs: 5 * 60 * 1000, otomatikAralikSn: 6 * 3600, otomatikInternetDeneme: 6, otomatikInternetAralikMs: 5 * 60 * 1000,
  // Mac yedegi: giris ogesi bilgisi alinamazsa bilgisayar 10 dk icinde acildiysa acilis sayilir.
  acilisPenceresiSn: 600 });
// Araliklar [en az, en cok] milisaniyedir; her seferinde rastgele secilir (insan duzenli degildir).
const PACE = Object.freeze({
  sayfa: [1000, 3000],      // gecmis mesaj sayfalari arasinda
  indirme: [2000, 5000],    // her fotograf indirilmeden once
  arama: [500, 1500],       // gonderen / alinti bilgisi sorgulari arasinda
  molaHer: 100,             // bu kadar indirmeden sonra mola
  mola: [120000, 300000],   // mola suresi (2-5 dakika)
});
// Indirme hizi secenekleri (Ayarlar > Indirme Hizi). Yavas, PACE degerleridir ve varsayilandir; sayfa ve arama beklemeleri her hizda ayni kalir.
// Daha hizli secenekler hesabin kisitlanma riskini artirabilir; garanti verilemez.
const HIZ_SECENEKLERI = Object.freeze({
  orta: Object.freeze({ indirme: [1000, 3000], molaHer: 150, mola: [60000, 180000] }),
  hizli: Object.freeze({ indirme: [500, 1500], molaHer: 200, mola: [60000, 120000] }),
});
function hizProfili(ad, taban = PACE) {
  return HIZ_SECENEKLERI[ad] || { indirme: taban.indirme, molaHer: taban.molaHer, mola: taban.mola };
}
function days(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > LIMITS.days) throw new Error('Geçmiş süresi 1–90 gün arasında olmalı');
  return n;
}
function withTimeout(promise, ms, label) {
  if (!ms) return Promise.resolve(promise);
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + ': yanıt süresi aşıldı; işlem durduruldu')), ms);
  })]).finally(() => clearTimeout(timer));
}
function budget(now = Date.now) {
  const start = now();
  let failures = 0;
  const check = () => { if (now() - start >= LIMITS.duration) throw new Error(LIMITS.duration / 60000 + ' dakikalık çalışma sınırına ulaşıldı'); };
  return {
    check,
    request() { check(); },
    media() { check(); },
    bytes() {},
    failed() { if (++failures >= LIMITS.failures) throw new Error('Art arda 3 medya hatası: yeni istekler durduruldu'); },
    succeeded() { failures = 0; },
  };
}
// Acilista otomatik toplama karari. Saf fonksiyon: ag, dosya ya da WhatsApp cagrisi yapmaz.
// Sira: ayar ve acilis -> calisan islem -> 6 saat kurali -> eslesme -> grup -> internet.
function otomatikToplamaKarari({ ayarAcik, acilistaMi, simdi, sonZaman, eslesme, seciliSayi, calisiyor, cevrimici }, limitler = LIMITS) {
  if (!ayarAcik || !acilistaMi) return { karar: 'yok' };
  if (calisiyor) return { karar: 'atla', neden: 'calisiyor' };
  if (sonZaman != null && simdi - sonZaman < limitler.otomatikAralikSn) return { karar: 'atla', neden: 'yakinda-toplandi' };
  if (!eslesme) return { karar: 'atla', neden: 'eslesme-yok' };
  if (!seciliSayi) return { karar: 'atla', neden: 'grup-yok' };
  if (!cevrimici) return { karar: 'bekle', neden: 'internet-yok' };
  return { karar: 'basla' };
}
module.exports = { LIMITS, PACE, HIZ_SECENEKLERI, hizProfili, days, withTimeout, budget, otomatikToplamaKarari };
