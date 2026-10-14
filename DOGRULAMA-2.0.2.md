# Archivo 2.0.2 doğrulama

232 yerel test geçti (2.0.1’de 173). 40’ı gerçek Chrome for Testing ile arayüzü sürer; biri gerçek Chrome ile “The browser is already running” hatasını üretip temizliğin çözdüğünü gösterir; biri gerçek süreçlerle yetim süreç temizliğini sınar. Chrome bulunamazsa bu testler atlanır. Testler sahte WhatsApp istemcisi ve sahte `window.api` kullanır; otomatik testlerde gerçek hesap kullanılmaz.

Yeni ya da değişen davranışların her biri için düzeltme bilerek geri alınıp testin kırıldığı da denendi (mutasyon kontrolü): bağlantı ve yetim Chrome 8/8, grup seçimi 4/4, PDF 7/7, galeri 10’da 9 (video güvenlik izni satırı davranış değiştirmiyor, aşağıya bakın), otomatik toplama 14/14, Ayarlar büyütmesi 3/3.

## 2.0.1 canlı testinde bulunup 2.0.2’de düzeltilenler

- **“The browser is already running” (yetim Chrome).** Uyku sonrası uygulamanın açık tuttuğu Chrome kayboluyor ama süreç açık kalıyor, yeni Topla aynı profil klasörüne takılıyordu. Gerçek Chrome ile aynı hata yeniden üretildi; `browser-processes.js` yalnızca komut satırında tam olarak bu sürümün `oturum/session` klasörü geçen süreçleri bulup kapatır (Mac/Linux `ps`, Windows PowerShell CIM). Temizlik yeni tarayıcıdan önce, uygulama açılışında ve bağlantı kapanırken yapılır; temizlik sırasında Durdur’a basılırsa tarayıcı açılmaz. Testler: gerçek süreçlerle (benzer adlı `session-2` klasörü kapanmaz), gerçek Chrome ile hata ve çözüm, eşleşme kuralları (alt klasör, eski sürüm, kullanıcının Chrome’u, Windows tırnak/büyük-küçük harf).
- **Telefondan çıkış sonrası rozet “Bağlı” kalıyordu.** whatsapp-web.js 1.34.7 kaynak kodundan: telefondan çıkışta `disconnected` olayı `LOGOUT` nedeniyle gelir; ayrıca WhatsApp durumları `UNPAIRED`/`UNPAIRED_IDLE`. Bunlarda ve kayıtlı eşleşme varken QR istenince yerel eşleşme, grup listesi ve senkron onayı silinir; grup seçimi korunur. Diğer nedenler (uyku, ağ, `CONFLICT`) eşleşmeyi silmez. Neden `son-kopma.json`’a yazılır. Pencereye `eslesme` olayı gider, Ayarlar açıkken rozet ve QR düğmesi hemen güncellenir.
- **Elle çıkışta Bitti’ye basmadan güncellenmiyordu.** Gerçek Chrome’da yeniden üretildi: ekran iş bitince zaten güncelleniyordu, ancak çıkış geçici bir tarayıcı açtığında 90 saniyeye kadar sürüyor ve bu sırada hiçbir şey görünmüyordu. Artık onaydan hemen sonra “Çıkış yapılıyor” görünür, iki düğme kapanır, bitince Bitti beklenmeden “Bağlı değil / QR kod göster” olur.
- **Özet satırı “WhatsApp’tan çıkış yapıldı”da kalıyordu.** Bağlanınca “Bağlandı · Topla’ya hazır” yazar; bağlantı kurulamazsa değişmez.
- **0 grup = 41 grubun hepsi.** Topla, Geçmişi Tara ve Geçmişi İndir önce sorar (Vazgeç varsayılan); çıkışta grup seçimi korunur, yeni listede olmayan gruplar düşer.
- **Hata bildirimi süresi** 30 → 10 saniye.

## Yeni özellikler

- **PDF’leri de İndir** (varsayılan kapalı). Belge türleri tek tabloda (`BELGE_TURLERI`); PDF tür ya da dosya adıyla tanınır; Word/Excel/DWG/ZIP indirilmez, yalnızca sayılır (`atlanan-belgeler.json`, mesaj başına bir kez). Dosya adı `<tarih>_<saat>_<grup>_<kendi adı>.pdf`; ad klasör dışını gösteremez (`../../`, `C:\`, `/` denendi). Açıklama ve yakın mesajlar fotoğraflardaki gibi.
- **Önceki hata:** “zaten indirildi” kontrolü yalnızca fotoğrafları görüyordu, videolar 2 saatlik örtüşmede ikinci kez inebiliyordu. Test ikinci Topla’da video ve PDF’in yeniden inmediğini gösterir.
- **Galeride video ve PDF.** Karo, tür etiketi, oynat işareti, işletim sistemi küçük resmi (yalnızca arşiv içindeki dosyalar), yoksa ikon; büyük görünümde video oynatıcı ve PDF kartı; “PDF’i Aç” yalnızca arşivdeki PDF ve videoları açar (sembolik bağlantı, `.exe`, `.app`, arşiv dışı reddedilir). Silme, gün silme, arama, “N dosya / N foto”.
- **Açılışta Otomatik Topla** (varsayılan kapalı; “Açılışta Uygulamayı Aç”ın yerine). Bilgisayar açılınca ya da uykudan uyanınca pencere açmadan 5 dk bekler; karar fonksiyonu (`otomatikToplamaKarari`) her durum için sınandı: elle açılış, iş sürüyor, son 6 saatte toplandı, eşleşme yok, telefon senkron onayı yok, grup yok, internet yok (6 deneme). QR gerekirse pencere ve QR açılmaz, tek bildirim gider. Arka planda “silinen fotoğraf eklensin mi?” sorusu sorulmaz. Her bitişte bildirim, hata olursa ikincisi. Windows giriş öğesi asıl exe yoluna (`PORTABLE_EXECUTABLE_FILE`) ve `--acilis` ile yazılır (2.0.1 geçici klasörü gösteriyordu).
- **Ayarlar kartı %30 büyük** (`zoom: 1.3`). 620×520, 860×700 ve 1180×860 pencerede ölçüldü: 494 px, yan kaydırma yok, 16 satır aynı sırada, son satıra inilir, anahtar ve ikon karoları 1,3 kat, diğer kartlar etkilenmez.

## Paketlenmiş uygulama

Üç paket bu bilgisayarda internetsiz derlendi (Mac Apple Silicon: DMG+ZIP, Mac Intel: DMG+ZIP, Windows x64: taşınabilir EXE; imzasız). Mimariler: arm64, x86_64, PE32. Paket içindeki `main.js`, `preload.js`, `index.html`, `browser-processes.js`, `collection-plan.js`, `operation-policy.js` kaynakla birebir aynı; sürüm 2.0.2.

Paketlenmiş Mac arm64 uygulaması (gerçek Electron 44.5.1, gerçek ana süreç) geçici bir veri klasörüyle açıldı (gerçek `profiller/2.0.2`’ye dokunulmadığı doğrulandı): 33 API işlevi (`dosyaAc`, `onEslesme` dahil); gerçek bir PDF ve gerçek bir `.mov` için küçük resimler macOS Quick Look ile üretildi; gün başlıkları “3 dosya / 1 foto”; PDF kartı (“Keşif raporu.pdf”, grup, tarih, boyut); video gerçekten yüklenip oynatılabilir oldu (16 sn, 400 px, hata yok) ve kapatınca boşaltıldı; gerçek ana süreç `/etc/hosts`’u açmayı reddetti; Ayarlar 494 px, yeni satır metinleri doğru; konsolda hata yok.

## GitHub Actions

Çalışma https://github.com/enescvsdg/archivo/actions/runs/38491844642 (`v2.0.2` dalı, `aaf90dd`): Windows x64 (Windows Server 2025), Apple Silicon Mac ve Intel Mac üzerinde `pnpm test`, paketleme ve artefakt yükleme başarılı. Her sistemde 232 testten 191’i geçti, 0 hata; gerçek Chrome for Testing gerektiren 41 test (arayüz testleri ve gerçek Chrome ile “already running” testi) GitHub’da Chrome bulunmadığı için atlanır, bunlar yalnızca bu Mac’te (arm64) çalıştı. Windows’ta gerçek süreçlerle yetim süreç temizliği testi (PowerShell ile süreç listesi, yalnızca bizim klasörlü sürecin kapanması, benzer klasörlünün açık kalması) geçti. İlk deneme hiç başlamadı (depo o sırada gizliydi, GitHub dakika/ödeme sınırı); depo yeniden herkese açık yapılınca ikinci deneme yeşil bitti.

Ölçümle düzeltilen bir iddia: “güvenlik ayarı (CSP) videoyu engelliyor” sanılmıştı; ölçümde dosyadan açılan sayfada `'self'` dosya videolarını zaten kapsıyor. `media-src 'self' file:` yalnızca `img-src` ile aynı kuralı açıkça yazar (bu satırı kaldırmak davranışı değiştirmez).

## Doğrulanmadı

- **Gerçek WhatsApp hesabında:** telefondan çıkışta `LOGOUT` nedeninin gerçekten geldiği (kütüphane kodundan çıkarıldı); PDF mesajında açıklamanın `caption` alanında geldiği (kütüphane bunu `body`’ye koyuyor); yetim Chrome temizliğinin gerçek uyku sonrası davranışı.
- **Açılışta Otomatik Topla:** Mac’te giriş öğesiyle açılışta `wasOpenedAtLogin`’in gerçekten `true` geldiği (Electron 44’te alan var; gelmezse bilgisayar 10 dakikadan kısa süre önce açıldıysa pencere açık olarak yine toplar); uykudan uyanma olayı; bildirimlerin pencere kapalıyken görünmesi ve izin davranışı. Bilgisayarı yeniden başlatarak ve kapağı kapatıp açarak denenmelidir.
- **Windows:** taşınabilir exe’nin gerçek açılışı, giriş öğesinin asıl exe’yi başlatması ve kabuk küçük resimleri (CI’da sahte istemciyle sınandı; PowerShell ile gerçek süreç listesi ve kapatma CI’da gerçek süreçlerle geçti). **Intel Mac** gerçek açılışı.
- Yeni sürüm hesabın kısıtlanmayacağını garanti etmez.
