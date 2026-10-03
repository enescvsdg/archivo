// Limits reduce request volume; they are not a guarantee against account restrictions.
const LIMITS = Object.freeze({ days: 90, messages: 500, requests: 24, media: 100, bytes: 100 * 1024 * 1024, duration: 15 * 60 * 1000, failures: 3, pause: 1500, timeout: 0 });
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
  let requests = 0, media = 0, bytes = 0, failures = 0;
  const check = () => { if (now() - start >= LIMITS.duration) throw new Error('15 dakikalık çalışma sınırına ulaşıldı'); };
  return {
    check,
    request() { check(); if (requests >= LIMITS.requests) throw new Error('Çalışma başına 24 sohbet/mesaj bilgisi isteği sınırına ulaşıldı'); requests++; },
    media() { check(); if (media >= LIMITS.media || bytes >= LIMITS.bytes) throw new Error('Çalışma başına 100 medya / 100 MB sınırına ulaşıldı'); media++; },
    bytes(n) { bytes += n; if (bytes > LIMITS.bytes) throw new Error('100 MB çalışma sınırına ulaşıldı'); },
    failed() { if (++failures >= LIMITS.failures) throw new Error('Art arda 3 medya hatası: yeni istekler durduruldu'); },
    succeeded() { failures = 0; },
  };
}
module.exports = { LIMITS, days, withTimeout, budget };
