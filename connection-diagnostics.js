const { writeJson } = require('./archive-state');
function errorText(error) {
  return String(error?.message || error || 'Bilinmeyen hata').replace(/https?:\/\/\S+/g, '[adres]').slice(0, 300);
}
// Observe the browser created by the user's operation. Never opens a page or sends a request.
// Tanida yalnizca sabit kodlar, sayilar ve surum numarasi saklanir; metin, adres, telefon veya mesaj icerigi saklanmaz.
const SABIT_KOD = /^[A-Z_]{1,30}$/;
const guvenli = (deger, desen, yedek) => (typeof deger === 'string' && desen.test(deger) ? deger : yedek);
function observeConnection(client, file, notify = () => {}, reused = false, secenek = {}) {
  const anlikMs = secenek.anlikMs ?? 10000;
  const state = { baslangic: Date.now(), asama: reused ? 'hazir-baglanti' : 'tarayici-baslatiliyor', olaylar: [], sonuc: 'devam' };
  let page, timer, anlikZamanlayici, sonAnlik = null, bitiyor = false, stopped = false;
  const listeners = [];
  const save = () => { try { writeJson(file, state); } catch (_) {} };
  const record = (asama, bilgi = {}) => {
    if (stopped) return;
    state.asama = asama;
    state.olaylar.push({ zaman: Date.now(), asama, ...bilgi });
    state.olaylar = state.olaylar.slice(-60); save();
  };
  const on = (target, event, fn) => { if (target?.on) { target.on(event, fn); listeners.push([target, event, fn]); } };
  const phase = (asama, metin) => { if (stopped) return; record(asama); notify({ metin }); };
  on(client, 'qr', () => record('qr-bekleniyor'));
  on(client, 'authenticated', () => record('eslesme-tamamlandi'));
  on(client, 'loading_screen', yuzde => { const n = Number(yuzde); record('senkronizasyon', Number.isFinite(n) ? { yuzde: n } : {}); });
  on(client, 'ready', async () => {
    record('hazir');
    try { const v = await client.getWWebVersion?.(); if (!stopped && typeof v === 'string' && /^[0-9.]{1,24}$/.test(v)) { state.waSurum = v; save(); } } catch (_) {}
  });
  on(client, 'auth_failure', () => record('eslesme-hatasi'));
  on(client, 'disconnected', neden => record('baglanti-kesildi', { kod: guvenli(neden, SABIT_KOD, 'bilinmiyor') }));
  on(client, 'change_state', durum => record('durum-degisti', { kod: guvenli(durum, SABIT_KOD, 'bilinmiyor') }));
  // Beklerken sayfanin icindeki baglanti durumu: yalnizca degisince kaydedilir ve gecmis olay penceresini doldurmaz.
  const anlik = async () => {
    if (stopped || bitiyor || !page?.evaluate || page.isClosed?.()) return;
    let kesinti;
    try {
      const d = await Promise.race([page.evaluate(() => ({ durum: window.AuthStore?.AppState?.state, senkron: window.AuthStore?.AppState?.hasSynced, belge: document.readyState, surum: window.Debug?.VERSION })), new Promise(resolve => { kesinti = setTimeout(() => resolve(null), 2000); })]);
      if (stopped || bitiyor || !d || typeof d !== 'object') return;
      const bilgi = { durum: guvenli(d.durum, SABIT_KOD, 'bilinmiyor'), senkron: typeof d.senkron === 'boolean' ? d.senkron : null, belge: guvenli(d.belge, /^(loading|interactive|complete)$/, 'bilinmiyor'), surum: guvenli(d.surum, /^[0-9.]{1,24}$/, 'bilinmiyor') };
      const imza = JSON.stringify(bilgi);
      if (imza === sonAnlik) return;
      sonAnlik = imza;
      state.olaylar.push({ zaman: Date.now(), asama: 'sayfa-anlik', ...bilgi });
      state.olaylar = state.olaylar.slice(-60); save();
    } catch (_) {} finally { clearTimeout(kesinti); }
  };
  const attach = () => {
    if (!client.pupPage || page) return;
    page = client.pupPage;
    if (['tarayici-baslatiliyor', 'hazir-baglanti'].includes(state.asama)) phase('sayfa-yukleniyor', 'WhatsApp sayfası yükleniyor');
    on(page, 'domcontentloaded', () => phase('sayfa-dom-hazir', 'WhatsApp bağlantısı hazırlanıyor'));
    on(page, 'load', () => phase('sayfa-yuklendi', 'WhatsApp hazır olması bekleniyor'));
    on(page, 'requestfailed', request => {
      const failure = request.failure?.()?.errorText || '';
      // Record only fixed error codes. No URL, phone, QR, cookies or message contents.
      const kod = failure.match(/net::ERR_[A-Z_]+/)?.[0] || 'istek-basarisiz';
      record('ag-istegi-hatasi', { kod });
    });
    on(page, 'response', response => {
      if (response.request?.().isNavigationRequest?.() && response.status?.() >= 400) record('sayfa-http-hatasi', { kod: response.status() });
    });
    on(page, 'error', () => record('tarayici-sayfasi-coktu'));
    // "detached Frame" hatasinin ilk nedenini gormek icin: yalnizca ana cerceve, adres kaydedilmez.
    on(page, 'framedetached', frame => { if (!frame?.parentFrame?.()) record('sayfa-cercevesi-koptu'); });
    on(page, 'close', () => record('sayfa-kapandi'));
    if (!bitiyor) anlikZamanlayici = setInterval(anlik, anlikMs);
  };
  const tick = () => { if (stopped) return; attach(); if (!page) timer = setTimeout(tick, 500); };
  record(state.asama);tick();
  const snapshot = async () => {
    attach();
    if (!page?.evaluate || page.isClosed?.()) return;
    let deadline;
    try {
      const flags = await Promise.race([page.evaluate(() => ({
        belge: document.readyState,
        cevrimici: navigator.onLine,
        whatsappKodHazir: !!window.Debug?.VERSION,
        kutuphaneHazir: typeof window.WWebJS !== 'undefined',
        whatsappSayfasi: location.hostname === 'web.whatsapp.com',
      })), new Promise(resolve => { deadline = setTimeout(() => resolve(null), 2000); })]);
      if (flags && typeof flags.belge === 'string') {
        state.sayfa = { belge: flags.belge, cevrimici: !!flags.cevrimici, whatsappKodHazir: !!flags.whatsappKodHazir, kutuphaneHazir: !!flags.kutuphaneHazir, whatsappSayfasi: !!flags.whatsappSayfasi };save();
      }
    } catch (_) { state.sayfaOkunamadi = true;save(); }
    finally { clearTimeout(deadline); }
  };
  return {
    state, record,
    async finish(result, error) {
      if (stopped) return;
      bitiyor = true;
      clearTimeout(timer);
      clearInterval(anlikZamanlayici);
      await snapshot();
      state.sonuc = result;state.bitis = Date.now();
      if (error) state.hata = errorText(error);
      save();stopped = true;
      for (const [target, event, fn] of listeners) { if (target.off) target.off(event, fn); else target.removeListener?.(event, fn); }
    },
  };
}
module.exports = { observeConnection, errorText };
