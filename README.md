# Archivo

WhatsApp gruplarındaki fotoğrafları yerel diskte tarih ve grup klasörlerine arşivleyen Electron masaüstü uygulaması.

## Paketler

- Apple Silicon Mac: `Archivo-2.0.0-mac-arm64.dmg`
- Intel Mac: `Archivo-2.0.0-mac-x64.dmg` (ayrı derleme)
- Windows 10/11 x64: `Archivo-2.0.0-win-x64.exe` (taşınabilir, yönetici veya Node.js kurulumu gerektirmez)

Windows taşınabilir uygulaması çalışırken kullanıcıya ait geçici klasöre açılır; ayarlar ve oturum kullanıcı veri klasörüne yazılır. Kurumun uygulama çalıştırma ve ağ kuralları yine geçerlidir. Eski çalışan EXE'yi yeni sürüm aynı iş bilgisayarında doğrulanana kadar saklayın. Mac üzerinden üretilen Windows paketinde EXE kaynak simgesi/sürüm düzenleme kapalıdır; Windows üzerinde derleme bunları korur.

Mac'te DMG içinden Archivo'yu Applications klasörüne sürükleyin. Mevcut paketler Developer ID ile imzalanmış ve Apple tarafından notarize edilmiş değildir. Genel dağıtım için bu işlemler ayrıca tamamlanmalıdır.

## Geliştirme

Node.js 22.13+ ve pnpm 11 kullanın:

```sh
pnpm install --frozen-lockfile
pnpm prepare-browser
pnpm start
pnpm test
```

Puppeteer, whatsapp-web.js ile aynı sürümdeki Chrome for Testing'i `chromium/` altında saklar. Derleme betiği her hedef için doğru işletim sistemi ve işlemci mimarisindeki tarayıcıyı indirip pakete ekler. Kullanıcı bilgisayarına ayrıca Chrome kurulması gerekmez.

```sh
pnpm mac:arm64
pnpm mac:x64
pnpm exe
pnpm kurulum-exe
```

Mac paketi Mac üzerinde derlenir. Windows EXE Mac üzerinde de paketlenebilir; Windows'taki açılış testi Windows makinede yapılmalıdır. Çıktılar sürüm numarasıyla `dist/<sürüm>/` klasörüne yazılır; 2.0.0 paketleri derlendiğinde `dist/2.0.0/` içine yazılır (2.0.0 paketleri henüz derlenmedi; `dist/1.4.4/` önceki sürümdür). GitHub iş akışı yalnızca derleme artefaktı üretir; otomatik yayın yapmaz.

## Veri güvenilirliği

- İlerleme sohbet kimliği bazında saklanır. Başarısız indirme, boş medya yanıtı veya eksik tarama varsa o sohbetin ilerlemesi artırılmaz.
- Başlangıçtan sonra gelen mesajlar bir sonraki taramaya bırakılır; sınırdaki saniye örtüşür.
- Yeniden taramada daha önce kaydedilmiş mesajlar, içerik benzerliği seçeneği kapalı olsa da tekrar kaydedilmez.
- Eski son-calisma.json biçimi okunur ve ilk yeni taramada sohbet bazındaki kayıtlarla genişletilir.
- Her grup için tarama güvenlik tavanı 20000 mesajdır; tavana ulaşıldığında erişim sınırı raporlanır (2.0.0’ten önce bu tavan 500’dü).
- JSON yazımları geçici dosya ve yeniden adlandırma ile yapılır; önceki sürüm `.bak` dosyasında tutulur. Bozuk JSON sessizce sıfırlanmaz. Bu yedekler tam arşiv yedeği yerine geçmez.
- Fotoğraflar: Pictures/Archivo <sürüm> Arsivi (2.0.0 için Archivo 2.0.0 Arsivi) veya seçtiğiniz klasör. Ayarlar/oturum: Electron'un kullanıcı veri klasörü; uygulamadaki “Veri klasörü” düğmesinden açılır.

## Gizlilik ve sınırlar

Oturum, arşiv, açıklamalar ve grup/kişi bilgileri kişisel veridir; GitHub'a yüklemeyin. `.gitignore` yaygın veri klasörlerini hariç tutar, fakat paylaşmadan önce tüm dosyaları kontrol edin.

whatsapp-web.js resmi WhatsApp API'si değildir. WhatsApp Web değişiklikleri bağlantıyı veya indirmeyi bozabilir; hesabın kısıtlanmayacağı garantisi verilemez. Oturum ve indirme işlemleri gerçek hesapla ayrıca doğrulanmalıdır.

Mevcut ekran son 60 tarih bölümünü gösterir. Videolar indirilebilir ancak galeri fotoğraf odaklıdır. Grup seçimi hâlâ grup adıyla yapılır. Bunlar sonraki geliştirme aşamasındadır.

## 1.4.0 toplama akışı

(2.0.0’ten önce Topla yalnızca bugünü toplar ve geçmiş eksikleri Evet/Hayır ile sorardı; bu davranış 2.0.0’te değişti, aşağıdaki “2.0.0 eksiksiz toplama” bölümüne bakın.) Geçmişi Tara indirme yapmaz; Geçmişi İndir seçili aralığı indirir. Silinen görseller ayrıca sorulur; hepsine uygula kutusu yalnızca mevcut işlemdeki soruları etkiler. Tarama sırasında verilen yeniden ekleme izni sonraki indirmede kullanılmak üzere kaydedilir.

Tarih kapsülündeki X, Evet/Hayır onayı sonrası o günün görsellerini Çöp Kutusu’na taşır ve önizleme/dizin kayıtlarını temizler. WhatsApp içeriği değişmez. Toplu silmede hata olursa kalan dosyalar korunur ve tamamlanan sayı bildirilir. Silinen görsellerin mesaj kimlikleri yeniden ekleme kararı için saklanır.

Eksik raporu yalnızca Web’den erişilebilen geçmişi kapsar. İstenen tarihe ulaşılamıyorsa erişim belirsiz veya sınır raporu gösterilir; tüm geçmişin eksiksiz olduğu iddia edilmez.

## 1.4.2 bağlantı ve senkronizasyon

QR sonrası modal hazırlık penceresi işlem düğmelerini engeller. WhatsApp loading_screen yüzdesi bildirirse bar o değeri gösterir; yüzde yoksa belirsiz hareketli gösterge kullanılır. Hazırlık kontrolü, Web hasSynced/çevrimdışı teslim ilerlemesini ve seçili sohbetlerin yerel listede bulunmasını bekler. Bu, telefondaki tüm geçmiş medya senkronizasyonunun eksiksiz bittiğini garanti etmez.

45 saniyelik işlem timeoutları ve 180 saniyelik uygulama başlatma kesintisi kaldırıldı. Durdur her zaman kullanılabilir. Tarama/indirme süre bütçesi hazırlık sonrası başlar (2.0.0’te 60 dakika; istek, medya ve MB tavanları kaldırıldı, art arda hata sınırı korunur; “2.0.0 insan hızı” bölümüne bakın). Hazır istemci işlem sonunda/hata sonrasında açık tutulur; Durdur veya uygulamadan tam çıkış kapatır.

Grup listesi yerel önbellekten okunur. GroupMetadata.update çağrılmaz; seçili grup filtresi model dönüşümünden önce uygulanır. Senkronizasyonun kendi protokol trafiği hesap genelinde sürebilir.

## 1.4.4 eşleşme ve boş profil

Bu sürüm kullanıcı veri klasöründeki `profiller/1.4.4` altında ayrı, boş bir profil kullanır. Eski ayarlar, grup listesi, önizlemeler ve WhatsApp oturumu kopyalanmaz. Önceki profil ve fotoğraf arşivi korunur. Önceki sürümün telefondaki bağlı cihaz kaydı otomatik kaldırılmaz; gerekiyorsa telefonun Bağlı Cihazlar ekranından kaldırın.

Ayarlar’daki QR simgesi bağlantı yokken “QR kod göster”, hazır bağlantıda “Bağlandı” etiketini taşır. “WhatsApp’tan çıkış yap” onay sonrası gerçek `client.logout()` işlemini kullanır. Başarısız çıkış başarılı gösterilmez ve yerel eşleşme zorla silinmez. Gerçek çıkış için açık, hazır bağlantı gerekir.

Yeni eşleşmede Web hazırlığı tamamlandıktan sonra telefondaki senkronizasyonun tamamlandığını kullanıcı “Telefonda tamamlandı · Devam et” ile onaylar. O zamana kadar tarama/indirme başlamaz. Telefonda bitişi otomatik ve kesin okumak mümkün olmadığından sahte yüzde veya otomatik tamamlandı durumu kullanılmaz. Tamamlanan bağlantının geç gelen sayfa olayları hazırlık panelini tekrar açamaz.

Yerel testler gerçek WhatsApp hesabına bağlanmadan yürütülür. Windows ve Intel Mac üzerinde açılış ve gerçek hesap davranışı ayrıca kullanıcı tarafından doğrulanmalıdır.

## 1.4.4 grup listesi ve çıkış

Eşleşme akışında Web istemcisi hazır olur olmaz grup isimleri alınarak Ayarlar’daki listeye eklenir; telefon senkronizasyon onayı ayrıca yalnızca yeni eşleşmenin tamamlanması için beklenir. Grup listesi yenilemesi bu onayı istemez. Tamamlanınca grup sayısı bildirilir. Liste güncellenirken mevcut seçili grup adları korunur.

QR düğmesi kayıtlı eşleşme veya açık bağlantı olduğunda gri ve pasiftir. Çıkış düğmesi bu durumda turuncu ve aktiftir; eşleşme yokken gri ve pasiftir. Çalışan işlemler sırasında ikisi de pasiftir. Uygulama yeniden açıldıktan sonra gerçek çıkış yapmak için kayıtlı oturum bir kez açılır; QR ile yeni oturum oluşturulmaz. Oturum geçersiz veya ağ erişimi başarısızsa çıkış doğrulanamadığı açıkça bildirilir.

## 2.0.0 eksiksiz toplama

Amaç, indirilebilen hiçbir görselin sessizce eksik kalmamasıdır.

- Topla her grubu kendi son başarılı toplama zamanından başlatır. Kaydı olmayan (yeni eklenen) grup için Ayarlar’daki ilk çalışma gün sayısı kullanılır. Uzun ara verildiğinde tarama o aralığın tamamını kapsar (en fazla 90 gün). Gecikmeli ulaşan mesajlar için kayıttan 2 saat önce başlanır; aynı mesajın tekrar indirilmesini mesaj kimliği engeller. Son toplamadan beri etkinlik olmayan grup hiç taranmaz.
- Topla artık geçmiş günler için soru sormaz. Derin geçmiş için Geçmişi Tara ve Geçmişi İndir kullanılır.
- Çalışma grup grup ilerler: grup taranır, görselleri indirilir, kaydı ilerletilir, sonra sıradaki gruba geçilir. Kaydı en eski (veya hiç olmayan) grup önce işlenir. Süre sınırı dolsa ya da bir hata çıksa bile biten gruplar korunur; kalan gruplar erişim raporunda “Sırada” görünür ve sonraki Topla’da devam edilir.
- WhatsApp’tan boş dönen veya alınamayan bir görsel 3 ayrı Topla’da denenir. Hâlâ alınamazsa kullanıcı veri klasöründeki `alinamayan-medya.json` dosyasına yazılır, grubun ilerlemesini engellemez ve erişim raporunda “Alınamayan medya” altında gösterilir. Sonradan inerse listeden çıkar.
- Belge olarak gönderilen fotoğraflar (dosya türü resim olan ya da adı jpg, png, heic, webp, gif uzantılı olanlar) resim gibi alınır. PDF gibi resim olmayan belgeler alınmaz.
- Kayıtlarda görülen “detached Frame” hatası giderildi: hazır tutulan WhatsApp tarayıcısı kullanılmadan önce yoklanır, bozuksa kapatılıp yenisi açılır (QR gerekmez). Tanı kaydına ana çerçeve kopması ve sayfa kapanması eklendi.
- Garanti edilemeyenler: WhatsApp sunucusunda süresi dolmuş medya, telefonda silinmiş mesajlar, Web’den erişilemeyen eski geçmiş ve bir grupta 20000 mesajı aşan boşluk (raporda sınır/erişilemedi olarak görünür). Hesabın kısıtlanmayacağı garanti edilmez.

## 2.0.0 insan hızı

Sert çalışma başı tavanlar (24 istek, 100 medya, 100 MB, grup başına 500 mesaj, 15 dakika) kaldırıldı; yerine insan gibi tempo kullanılır. Aralıklar her seferinde rastgele seçilir:

- Geçmiş sayfa sayfa yüklenir: her sayfadan önce 1–3 saniye beklenir ve istenen tarihe ulaşılınca durulur (fazla yüklenmez). Kütüphanenin aralıksız arka arkaya yüklemesi kullanılmaz.
- Her fotoğraf indirilmeden önce 2–5 saniye, gönderen ve alıntı sorgularından önce 0,5–1,5 saniye beklenir.
- Her 100 indirmeden sonra 2–5 dakika mola verilir; molada arayüze her 15 saniyede durum gönderilir. Durdur molada da hemen çalışır.
- Emniyet sınırları: çalışma başına 60 dakika, art arda 3 medya hatasında durma ve grup başına 20000 mesaj tavanı. Süre dolarsa biten gruplar korunur, kalanlar “Sırada” görünür; Topla’ya yeniden basarak devam edilir. Topla’lar arası 30 dakika bekleme kuralı kaldırıldı; yeni bağlantı açmak için 1 dakika kuralı sürer.
- Bu değerler önerilen tempodur; WhatsApp’ın gerçek eşiği bilinmez ve hesabın kısıtlanmayacağı garanti edilmez. Uygulama mesaj göndermez ve okundu işaretlemez.
- Aralıklar `operation-policy.js` içindeki `PACE` ve `LIMITS` tablosundadır.
- WhatsApp Web sayfayı işlem sırasında kendiliğinden yenileyebilir (canlı testte eşleşmeden sonra ve bir indirme sırasında görüldü); yenilenince sayfadaki `window.WWebJS` ve uygulamanın taktığı indirme yaması silinir. Uygulama her sayfa isteğinden önce sayfanın hazır olmasını bekler (en çok yaklaşık bir dakika), silinen yamayı yeniden uygular ve isteği en fazla 2 kez yeniden dener. Bu yeniden denemeler fotoğraf için “başarısız deneme” sayılmaz ve 3 hata üst üste kuralına girmez; sayfa toparlanamazsa işlem “WhatsApp sayfası yenilendi ve hazır olmadı” hatasıyla durur.
- Alınamayan her fotoğrafın kaydına mesajın iletilmiş olup olmadığı (`iletildi`) ve türü yazılır; mesaj içeriği yazılmaz.
- Hazır nöbetçisi (canlı testte eşleşmeden sonra “hazır” olayının hiç gelmediği, grup listesinin boş kaldığı denemelerden sonra): kütüphane `ready` olayını yalnızca WhatsApp Web’in `hasSynced` değerinin **değişmesinden** yayınlıyor. Sayfa yenilenip bu işlem yarıda kesilirse ya da olay kaçırılırsa, WhatsApp “bağlı ve senkron” dese bile `ready` gelmiyordu (telefon “Aktif, son mesajlar senkronize edildi” gösteriyordu). Uygulama artık yeni açtığı her bağlantıda beş saniyede bir sayfanın durumuna bakar; durum üst üste üç yoklamada `CONNECTED` ve `hasSynced=true` olduğu hâlde `ready` gelmemişse kütüphanenin kendi `ready` işlemini (`window.onAppStateHasSyncedEvent`) yeniden tetikler (en çok 5 kez, tanıda `hazir-tetiklendi`). Çıkış, Bağlan ve Topla akışlarının hepsinde etkindir.
- Çıkış düzeltmesi (canlı testte telefondan çıkış yapılmış bir oturumda uygulama içi çıkış takılı kalmıştı): “WhatsApp’tan çıkış yap” artık (a) WhatsApp kayıtlı oturum için QR isterse (telefondan çıkış yapılmış demektir) bunu “zaten çıkılmış” sayıp yerel eşleşmeyi ve grup listesini temizler, böylece bağlan düğmesi açılır; (b) 90 saniyede yanıt gelmezse ya da eşleşme doğrulanamazsa, yalnızca kullanıcı **Evet** derse yerel eşleşmeyi temizler (WhatsApp’taki cihaz kaydı telefondan silinmelidir); (c) Durdur ile iptal edilebilir; (d) uygulama kapanırken çıkış için açılan tarayıcı da kapatılır; (e) bitince pencereye haber verir, böylece pencere yeniden açılsa bile “İşlem sürüyor” paneli açık kalmaz ve sonuç mesajı özet satırında görünür (önceden yükleme bittikten sonra mesajın üzerine yazılıyordu). Gerçek `logout()` başarılıysa davranış aynıdır.
- Hazırlık beklemesi sınırı (canlı testte bulundu): her Topla’dan önce uygulama WhatsApp’ın senkronu bitirmesini, kapalıyken gelen mesajların teslimini (çevrimdışı teslim ilerlemesi) ve seçili grupların yerel listede görünmesini bekler; bu sırada “Senkronizasyon devam ediyor” paneli açılır. WhatsApp’ın kapalıyken gelen mesaj sayacı takılabiliyor: 2,5 saat kapalı kalan uygulamada sayaç 11/12 = %92’de kalıp hiç %100 olmadı, yönetici “COMPLETE” dediği hâlde. Önceki sürüm bu durumda sonsuza kadar bekliyordu. Artık sayaç 45 saniye hiç ilerlemezse ya da toplam bekleme 5 dakikayı aşarsa (hangi nedenle olursa olsun) devam edilir. Sayaç ilerlemeye devam ettiği sürece beklenir. Bekleme nedeni tanıda yazılır: `hazirlik-bekleniyor` (neden: `cevrimdisi`, `senkron` ya da `sohbet`) ve `hazirlik-bitti` (sonuç: `hazir`, `durgun` ya da `zaman-asimi`). Sonraki Topla son toplamadan 2 saat geri taradığı için gecikmeli gelen mesaj yine yakalanır. Sınırlar `LIMITS.hazirlikDurguSaniye` ve `LIMITS.hazirlikUstSaniye`’dedir.
- Bağlantı tanısı (`baglanti-tanisi.json`) WhatsApp’ın bildirdiği durum değişikliklerini (`durum-degisti`: CONNECTED, OPENING, TIMEOUT, CONFLICT, DEPRECATED_VERSION vb.), kopma nedenini, yükleme yüzdesini, WhatsApp Web sürüm numarasını (`waSurum`) ve beklerken sayfanın içindeki bağlantı durumunu (`sayfa-anlik`: durum, senkronizasyon bitti mi, sayfa yüklendi mi; yalnızca değişince kaydedilir) yazar. Yalnızca sabit kodlar, sayılar ve sürüm numarası saklanır; metin, adres, telefon veya mesaj içeriği saklanmaz. Canlı testte “hazır” olayının hiç gelmediği bir denemeden sonra eklendi.

## 2.0.0 arayüz

Önizleme ve tüm düğmeler yenilendi (koyu zemin üzerinde “liquid glass” cam yüzeyler; vurgu rengi kurumsal mavi, turuncu yalnızca amblemde).

- **Filtre kartı.** Solda `Tümü · N`, yanında `Gruplar ▾` (grup sayısı karta sığandan çoksa; en çok 6 grup düğmesi görünür, sığmayanlar Gruplar listesine düşer, listede arama kutusu vardır), sağ köşede `Açıklamada ara`. Bir grup seçilince yalnızca o grubun fotoğrafları listelenir; diğer gruplar gizlenir ve gün başlıklarındaki sayılar süzülmüş sayılardır.
- **Grup sırası.** Grup düğmeleri ve liste tek sıralı bir dizidir (ilk N kartta, kalanı listede). Düğmeler sürükle-bırakla (animasyonlu) birbiriyle ve listeyle yer değiştirir; sıra bu bilgisayarda hatırlanır.
- **Grup adı standardı.** WhatsApp’ta büyük/küçük karışık yazılan adlar yalnızca arayüzde standartlaştırılır: her kelimenin ilk harfi büyük (Türkçe kurallarla), `3. Bölge at kaç` → `3.Bölge At Kaç`, `ve` gibi bağlaçlar küçük, 2–4 harfli büyük harfli kısaltmalar (`YBO`, `İETT`) korunur. Diskteki klasör ve dosya adları değişmez.
- **Tarih filtresi (Tümü’nde ve gruplarda).** Takvim (fotoğraf olan günler noktalı, iki tıklamayla başlangıç–bitiş aralığı, aynı güne iki kez tıklayınca tek gün), `Bugün`, `Son 7 gün`, `Son 30 gün` kısayolları ve seçili aralığı temizleme düğmesi. Önceki 60 günlük sınır kalktı; takvimle istenen eski güne gidilir.
- **Gün kartları.** Sayfa genişliğinde cam kart: tarih, o tarihteki (süzülmüş) fotoğraf sayısı ve sağ köşede çöp kutusu. Karta tıklayınca fotoğraflar kartın içine doğru kapanır, tekrar tıklayınca açılır. Bir gruba ya da Tümü’ne girince yalnızca en yeni gün açıktır; kapalı günlerin fotoğrafları çizilmez, bu yüzden arşiv büyüse de sayfa yavaşlamaz. Başlık kaydırırken filtre kartının altında yapışık kalır.
- **Silme.** Grup görünümünde çöp kutusu yalnızca o grubun o tarihteki fotoğraflarını siler (onayda grup adı ve sayı yazar); Tümü’nde onay penceresi büyük harfle “bu tarihteki TÜM grupların fotoğrafları silinecek” uyarısını verir. Dosyalar Çöp Kutusu’na taşınır, WhatsApp değişmez.
- **Sayfalama.** Bir günde 50’den fazla fotoğraf varsa kartın altında `Sayfa başına 50 · 100 · 200` (varsayılan 100, ortak ve hatırlanır) ve marka yazı tipiyle `ARCHIV` + sayfa sayısı kadar `O` çıkar: bulunulan sayfanın `O`’su vurgulu, numaralar altında, en çok 10 sayfa kayan pencere, `Önceki`/`Sonraki`. Büyük önizlemedeki oklar süzülmüş tüm fotoğraflar arasında gezer; önizleme kapanınca kart son bakılan fotoğrafın sayfasına geçer.
- **Düğmeler.** Yazıdan ibaret tüm düğmeler renkli cam ikon karosu + altında adı olarak yeniden çizildi (vurgu mavisi, nötr grafit, onay yeşili, tehlike kırmızısı). İkonlar [Tabler Icons](https://github.com/tabler/tabler-icons) (MIT, `Tabler-LISANS.txt`) setindendir ve dosyaya gömülüdür, internet gerekmez.
- **Hata yazıları.** Topla sırasında oluşan uyarılar artık sayfada kalıcı değildir: yeni Topla/Geçmişi Tara/Geçmişi İndir başlayınca silinir ve her uyarı `Kapat` ile elle kapatılabilir.
- **Hazırlık beklemesi.** Bkz. “Hazırlık beklemesi sınırı” maddesi: WhatsApp’ın kapalıyken gelen mesaj sayacı takılırsa Topla artık sonsuza kadar beklemez.

## Sürüm ve veri kuralı

Her yeni sürümde sürüm numarası artar (örneğin 1.4.4 → 2.0.0). Yeni sürüm `profiller/<sürüm>` altında boş bir profille ve `Pictures/Archivo <sürüm> Arsivi` klasörüyle başlar; eski sürümün profili ve fotoğraf arşivi kendi klasöründe olduğu gibi kalır, silinmez. Bu nedenle her yeni sürümde WhatsApp eşleşmesi yeniden yapılır ve ilk çalışmada Ayarlar’daki gün sayısı kadar geriye bakılır. Telefondaki eski bağlı cihaz kayıtları otomatik silinmez; WhatsApp en fazla 4 bağlı cihaza izin verir, gerekirse telefonun Bağlı Cihazlar ekranından eskileri kaldırın. 2.0.0, 1.4.x sürümlerinin verisini hiç getirmez: temiz bir profille açılır ve WhatsApp eşleşmesi sıfırdan yapılır.

Programın işlevleri, yapılan çalışmalar ve doğrulama sınırları: [PROGRAM-VE-YAPILANLAR.md](PROGRAM-VE-YAPILANLAR.md).
