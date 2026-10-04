// Insan hizi modeli: sert istek/medya/MB tavanlari yerine tempo. Tek emniyet siniri sure (60 dk) ve art arda 3 hatadir.
// Bu ayarlar hesabin kisitlanmayacagini garanti etmez.
const LIMITS = Object.freeze({ days: 90, messages: 20000, duration: 60 * 60 * 1000, failures: 3, timeout: 0, cikisZamanAsimi: 90000, hazirBekciAraligi: 5000, hazirlikDurguSaniye: 45, hazirlikUstSaniye: 300, mesajSayaciAraligi: 5000 });
// Araliklar [en az, en cok] milisaniyedir; her seferinde rastgele secilir (insan duzenli degildir).
const PACE = Object.freeze({
  sayfa: [1000, 3000],      // gecmis mesaj sayfalari arasinda
  indirme: [2000, 5000],    // her fotograf indirilmeden once
  arama: [500, 1500],       // gonderen / alinti bilgisi sorgulari arasinda
  molaHer: 100,             // bu kadar indirmeden sonra mola
  mola: [120000, 300000],   // mola suresi (2-5 dakika)
});
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
module.exports = { LIMITS, PACE, days, withTimeout, budget };
