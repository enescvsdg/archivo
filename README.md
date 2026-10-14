# Archivo

WhatsApp gruplarındaki fotoğrafları yerel diskte tarih ve grup klasörlerine arşivleyen Electron masaüstü uygulaması.

## Paketler

- Apple Silicon Mac: `Archivo-2.0.2-mac-arm64.dmg`
- Intel Mac: `Archivo-2.0.2-mac-x64.dmg` (ayrı derleme)
- Windows 10/11 x64: `Archivo-2.0.2-win-x64.exe` (taşınabilir, yönetici veya Node.js kurulumu gerektirmez)

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

Mac paketi Mac üzerinde derlenir. Windows EXE Mac üzerinde de paketlenebilir; Windows'taki açılış testi Windows makinede yapılmalıdır. Çıktılar sürüm numarasıyla `dist/<sürüm>/` klasörüne yazılır; 2.0.1 paketleri `dist/2.0.1/` içine yazılır (Mac Apple Silicon paketi bu bilgisayarda derlendi; Windows ve Intel Mac paketleri GitHub Actions ile derlenir). GitHub iş akışı yalnızca derleme artefaktı üretir; otomatik yayın yapmaz.

## Veri güvenilirliği

- İlerleme sohbet kimliği bazında saklanır. Başarısız indirme, boş medya yanıtı veya eksik tarama varsa o sohbetin ilerlemesi artırılmaz.
- Başlangıçtan sonra gelen mesajlar bir sonraki taramaya bırakılır; sınırdaki saniye örtüşür.
- Yeniden taramada daha önce kaydedilmiş mesajlar, içerik benzerliği seçeneği kapalı olsa da tekrar kaydedilmez.
- Eski son-calisma.json biçimi okunur ve ilk yeni taramada sohbet bazındaki kayıtlarla genişletilir.
- Her grup için tarama güvenlik tavanı 20000 mesajdır; tavana ulaşıldığında erişim sınırı raporlanır (2.0.0’ten önce bu tavan 500’dü).
- JSON yazımları geçici dosya ve yeniden adlandırma ile yapılır; önceki sürüm `.bak` dosyasında tutulur. Bozuk JSON sessizce sıfırlanmaz. Bu yedekler tam arşiv yedeği yerine geçmez.
- Fotoğraflar: Pictures/Archivo <sürüm> Arsivi (2.0.1 için Archivo 2.0.1 Arsivi) veya seçtiğiniz klasör. Ayarlar/oturum: Electron'un kullanıcı veri klasörü; uygulamadaki “Veri klasörü” düğmesinden açılır.

## Gizlilik ve sınırlar

Oturum, arşiv, açıklamalar ve grup/kişi bilgileri kişisel veridir; GitHub'a yüklemeyin. `.gitignore` yaygın veri klasörlerini hariç tutar, fakat paylaşmadan önce tüm dosyaları kontrol edin.

whatsapp-web.js resmi WhatsApp API'si değildir. WhatsApp Web değişiklikleri bağlantıyı veya indirmeyi bozabilir; hesabın kısıtlanmayacağı garantisi verilemez. Oturum ve indirme işlemleri gerçek hesapla ayrıca doğrulanmalıdır.

Galeri günleri sayfa başına 7, 15 veya 30 gün olacak şekilde sayfalar (2.0.1). Videolar indirilebilir ancak galeri fotoğraf odaklıdır. Grup seçimi hâlâ grup adıyla yapılır.

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
- Her fotoğraf indirilmeden önce (varsayılan Yavaş hızda) 2–5 saniye, gönderen ve alıntı sorgularından önce 0,5–1,5 saniye beklenir. 2.0.1’den itibaren Ayarlar’daki İndirme Hızı (Yavaş/Orta/Hızlı) bu bekleme ve mola değerlerini değiştirir.
- Her 100 indirmeden sonra (Yavaş hızda) 2–5 dakika mola verilir; molada arayüze her 15 saniyede durum gönderilir. Durdur molada da hemen çalışır.
- Emniyet sınırları: çalışma başına 60 dakika, art arda 3 medya hatasında durma ve grup başına 20000 mesaj tavanı. Süre dolarsa biten gruplar korunur, kalanlar “Sırada” görünür; Topla’ya yeniden basarak devam edilir. Topla’lar arası 30 dakika bekleme kuralı kaldırıldı; yeni bağlantı açmak için 1 dakika kuralı sürer.
- Bu değerler önerilen tempodur; WhatsApp’ın gerçek eşiği bilinmez ve hesabın kısıtlanmayacağı garanti edilmez. Uygulama mesaj göndermez ve okundu işaretlemez.
- Aralıklar `operation-policy.js` içindeki `PACE` ve `LIMITS` tablosundadır.
- WhatsApp Web sayfayı işlem sırasında kendiliğinden yenileyebilir (canlı testte eşleşmeden sonra ve bir indirme sırasında görüldü); yenilenince sayfadaki `window.WWebJS` ve uygulamanın taktığı indirme yaması silinir. Uygulama her sayfa isteğinden önce sayfanın hazır olmasını bekler (en çok yaklaşık bir dakika), silinen yamayı yeniden uygular ve isteği en fazla 2 kez yeniden dener. Bu yeniden denemeler fotoğraf için “başarısız deneme” sayılmaz ve 3 hata üst üste kuralına girmez; sayfa toparlanamazsa işlem “WhatsApp sayfası yenilendi ve hazır olmadı” hatasıyla durur.
- Alınamayan her fotoğrafın kaydına mesajın iletilmiş olup olmadığı (`iletildi`) ve türü yazılır; mesaj içeriği yazılmaz.
- Hazır nöbetçisi (canlı testte eşleşmeden sonra “hazır” olayının hiç gelmediği, grup listesinin boş kaldığı denemelerden sonra): kütüphane `ready` olayını yalnızca WhatsApp Web’in `hasSynced` değerinin **değişmesinden** yayınlıyor. Sayfa yenilenip bu işlem yarıda kesilirse ya da olay kaçırılırsa, WhatsApp “bağlı ve senkron” dese bile `ready` gelmiyordu (telefon “Aktif, son mesajlar senkronize edildi” gösteriyordu). Uygulama artık yeni açtığı her bağlantıda beş saniyede bir sayfanın durumuna bakar; durum üst üste üç yoklamada `CONNECTED` ve `hasSynced=true` olduğu hâlde `ready` gelmemişse kütüphanenin kendi `ready` işlemini (`window.onAppStateHasSyncedEvent`) yeniden tetikler (en çok 5 kez, tanıda `hazir-tetiklendi`). Çıkış, Bağlan ve Topla akışlarının hepsinde etkindir.
- Çıkış düzeltmesi (canlı testte telefondan çıkış yapılmış bir oturumda uygulama içi çıkış takılı kalmıştı): “WhatsApp’tan çıkış yap” artık (a) WhatsApp kayıtlı oturum için QR isterse (telefondan çıkış yapılmış demektir) bunu “zaten çıkılmış” sayıp yerel eşleşmeyi ve grup listesini temizler, böylece bağlan düğmesi açılır; (b) 90 saniyede yanıt gelmezse ya da eşleşme doğrulanamazsa, yalnızca kullanıcı **Evet** derse yerel eşleşmeyi temizler (WhatsApp’taki cihaz kaydı telefondan silinmelidir); (c) Durdur ile iptal edilebilir; (d) uygulama kapanırken çıkış için açılan tarayıcı da kapatılır; (e) bitince pencereye haber verir, böylece pencere yeniden açılsa bile “İşlem sürüyor” paneli açık kalmaz ve sonuç mesajı özet satırında görünür (önceden yükleme bittikten sonra mesajın üzerine yazılıyordu). Gerçek `logout()` başarılıysa davranış aynıdır.
- Hazırlık beklemesi sınırı (canlı testte bulundu): her Topla’dan önce uygulama WhatsApp’ın senkronu bitirmesini, kapalıyken gelen mesajların teslimini (çevrimdışı teslim ilerlemesi) ve seçili grupların yerel listede görünmesini bekler; bu sırada “Senkronizasyon devam ediyor” paneli açılır. WhatsApp’ın kapalıyken gelen mesaj sayacı takılabiliyor: 2,5 saat kapalı kalan uygulamada sayaç 11/12 = %92’de kalıp hiç %100 olmadı, yönetici “COMPLETE” dediği hâlde. Önceki sürüm bu durumda sonsuza kadar bekliyordu. Artık sayaç 45 saniye hiç ilerlemezse ya da toplam bekleme 5 dakikayı aşarsa (hangi nedenle olursa olsun) devam edilir. Sayaç ilerlemeye devam ettiği sürece beklenir. Bekleme nedeni tanıda yazılır: `hazirlik-bekleniyor` (neden: `cevrimdisi`, `senkron` ya da `sohbet`) ve `hazirlik-bitti` (sonuç: `hazir`, `durgun` ya da `zaman-asimi`). Sonraki Topla son toplamadan 2 saat geri taradığı için gecikmeli gelen mesaj yine yakalanır. Sınırlar `LIMITS.hazirlikDurguSaniye` ve `LIMITS.hazirlikUstSaniye`’dedir. 2.0.1’de sayaç %99 ve üzerinde takılırsa ve WhatsApp açıkça “senkron tamam” (`hasSynced=true`) derse bekleme 45 yerine 10 saniyedir (`LIMITS.hazirlikKisaDurguSaniye`, `LIMITS.hazirlikKisaEsik`).
- Bağlantı tanısı (`baglanti-tanisi.json`) WhatsApp’ın bildirdiği durum değişikliklerini (`durum-degisti`: CONNECTED, OPENING, TIMEOUT, CONFLICT, DEPRECATED_VERSION vb.), kopma nedenini, yükleme yüzdesini, WhatsApp Web sürüm numarasını (`waSurum`) ve beklerken sayfanın içindeki bağlantı durumunu (`sayfa-anlik`: durum, senkronizasyon bitti mi, sayfa yüklendi mi; yalnızca değişince kaydedilir) yazar. Yalnızca sabit kodlar, sayılar ve sürüm numarası saklanır; metin, adres, telefon veya mesaj içeriği saklanmaz. Canlı testte “hazır” olayının hiç gelmediği bir denemeden sonra eklendi.

## 2.0.0 arayüz

Önizleme ve tüm düğmeler yenilendi (koyu zemin üzerinde “liquid glass” cam yüzeyler; vurgu rengi kurumsal mavi, turuncu yalnızca amblemde).

- **Filtre kartı.** Solda `Tümü · N`, yanında `Gruplar ▾` (grup sayısı karta sığandan çoksa; en çok 6 grup düğmesi görünür, sığmayanlar Gruplar listesine düşer, listede arama kutusu vardır), sağ köşede `Açıklamada ara`. Bir grup seçilince yalnızca o grubun fotoğrafları listelenir; diğer gruplar gizlenir ve gün başlıklarındaki sayılar süzülmüş sayılardır.
- **Grup sırası.** Grup düğmeleri ve liste tek sıralı bir dizidir (ilk N kartta, kalanı listede). Düğmeler sürükle-bırakla (animasyonlu) birbiriyle ve listeyle yer değiştirir; sıra bu bilgisayarda hatırlanır.
- **Grup adı standardı.** WhatsApp’ta büyük/küçük karışık yazılan adlar yalnızca arayüzde standartlaştırılır: her kelimenin ilk harfi büyük (Türkçe kurallarla), `3. Bölge at kaç` → `3.Bölge At Kaç`, `ve` gibi bağlaçlar küçük, 2–4 harfli büyük harfli kısaltmalar (`YBO`, `İETT`) korunur. Diskteki klasör ve dosya adları değişmez.
- **Tarih filtresi (Tümü’nde ve gruplarda).** Takvim (fotoğraf olan günler noktalı, iki tıklamayla başlangıç–bitiş aralığı, aynı güne iki kez tıklayınca tek gün), `Bugün`, `Son 7 gün`, `Son 30 gün` kısayolları ve seçili aralığı temizleme düğmesi. Önceki 60 günlük sınır kalktı; takvimle istenen eski güne gidilir.
- **Gün kartları.** Sayfa genişliğinde cam kart: tarih, o tarihteki (süzülmüş) fotoğraf sayısı ve sağ köşede çöp kutusu. Karta tıklayınca fotoğraflar kartın içine doğru kapanır, tekrar tıklayınca açılır. Bir gruba ya da Tümü’ne girince yalnızca en yeni gün açıktır; kapalı günlerin fotoğrafları çizilmez, bu yüzden arşiv büyüse de sayfa yavaşlamaz. Başlık kaydırırken filtre kartının altında yapışık kalır.
- **Silme.** Grup görünümünde çöp kutusu yalnızca o grubun o tarihteki fotoğraflarını siler (onayda grup adı ve sayı yazar); Tümü’nde onay penceresi büyük harfle “bu tarihteki TÜM grupların fotoğrafları silinecek” uyarısını verir. Dosyalar Çöp Kutusu’na taşınır, WhatsApp değişmez.
- **Sayfalama.** 2.0.0’de gün kartı başına fotoğraf sayfalamasıydı (50/100/200); 2.0.1’de genel ve güne göre oldu, bkz. “2.0.1 değişiklikleri”.
- **Düğmeler.** Yazıdan ibaret tüm düğmeler renkli cam ikon karosu + altında adı olarak yeniden çizildi (vurgu mavisi, nötr grafit, onay yeşili, tehlike kırmızısı). İkonlar [Tabler Icons](https://github.com/tabler/tabler-icons) (MIT, `Tabler-LISANS.txt`) setindendir ve dosyaya gömülüdür, internet gerekmez.
- **Hata yazıları.** Topla sırasında oluşan uyarılar sayfada kalıcı değildir: yeni Topla/Geçmişi Tara/Geçmişi İndir başlayınca silinir ve her uyarı `Kapat` ile elle kapatılabilir. 2.0.1’de ayrıca yalnızca Tümü görünümünde görünür ve 30 saniye sonra kaybolur.
- **Hazırlık beklemesi.** Bkz. “Hazırlık beklemesi sınırı” maddesi: WhatsApp’ın kapalıyken gelen mesaj sayacı takılırsa Topla artık sonsuza kadar beklemez.

## 2.0.1 değişiklikleri

2.0.1, 2.0.0’ın canlı testinde bulunan eksikleri ve arayüz isteklerini kapsar. Telefon eşleşmesi ve veri 2.0.0’dan taşınmaz (bkz. “Sürüm ve veri kuralı”).

- **Aşamalı senkron paneli.** Eşleşme sonrası panel üç aşamayı gösterir (WhatsApp’a bağlanma, grup listesi, telefondan mesajlar). Ekranı kilitlemez, Devam et düğmesi sonradan gelen durum olaylarıyla gizlenmez. Telefondan gelen mesajların yerel sayısı (yalnızca sayı, içerik değil) deneme olarak izlenir; sayı uzun süre değişmezse panel “büyük olasılıkla bitti” der, karar yine kullanıcıdadır. İş bitince ya da Durdur’la senkron, işlem ve QR pencereleri her zaman kapanır.
- **İşlem kapsülü ve bildirim.** Çalışırken alt çubuğun yerini küçük, cam, tek satırlık bir kapsül alır (dönen gösterge, aşama ve ayrıntı, süre, sağ köşede Durdur). “Yeni ilerleme bilgisi alınamıyor” uyarısı yalnızca 30 saniye ilerleme olmazsa çıkar. Pencere önde değilken iş bitince işletim sistemi bildirimi gönderilir (“N fotoğraf indirildi”, “Yeni fotoğraf yok”, “İşlem durduruldu” vb.; grup adı veya içerik yazılmaz); tıklayınca pencere açılır.
- **Bitiş kartı.** Bir işlem bitince Topla çubuğunun yerini cam bir sonuç kartı alır; Tamam’a ya da yeni bir işleme kadar kalır. Başlık büyük harfle yazılır: İNDİRME TAMAMLANDI (alınamayan varsa kırmızımsı ayrıntıyla), YENİ FOTOĞRAF YOK, İŞLEM TAMAMLANAMADI, İŞLEM DURDURULDU, GEÇMİŞ TARAMASI TAMAMLANDI. Ayrıntı satırında indirilen, yinelenen ve alınamayan sayıları ile süre yazar; Klasörü aç düğmesi yalnızca fotoğraf indiyse görünür.
- **Genel sayfalama (güne göre).** Gün kartları sayfa başına 7, 15 veya 30 gün olacak şekilde bölünür (varsayılan 7; Tümü ve gruplarda ortak, hatırlanır). Sayfanın en altında marka yazı tipiyle `ARCHIV` + sayfa sayısı kadar `O`, sayfa numaraları, `Önceki`/`Sonraki` ve `Sayfa başına gün 7 · 15 · 30` seçimi bulunur; liste kısaysa çubuk pencerenin dibine yaslanır. Toplam gün sayısı 7 veya azsa gizlenir. Bir gün kartı artık tüm fotoğraflarını tek seferde gösterir (kart içi 50/100/200 sayfalaması kaldırıldı). Her sayfada yalnızca en yeni gün açıktır. Büyük önizlemedeki oklar tüm sayfalardaki fotoğraflar arasında gezer; kapatınca fotoğrafın günü hangi sayfadaysa o sayfa açılır.
- **Hata bildirimleri.** Yalnızca Tümü görünümünde görünür, 30 saniye sonra kendiliğinden kaybolur (2.0.2’de 10 saniye) (süre yalnızca görünürken işler; grup sayfasında gezerken dolmaz), Kapat ile kapanır, yeni çalışmada silinir.
- **Telefon eşlemesi.** Ayarlar’da başlık ve açıklama solda, durum rozeti sağ köşede (yeşil nokta yalnızca “Bağlı”, gri “Bağlı değil”, mavi “WhatsApp açılıyor / QR bekleniyor / Senkronize ediliyor”), altında iki eşit cam kutulu düğme (QR kod göster / WhatsApp’tan çıkış yap). Eşleşme kayıtlıysa rozet “Bağlı” gösterir; tarayıcı kapalıysa açıklamada “Eşleşme kayıtlı; WhatsApp Topla ile açılır” yazar.
- **Ayarlar başlıkları.** Ayarlar’daki tüm başlıkların her kelimesinin ilk harfi büyük ve yazı kalındır; açıklama yazıları normaldir.
- **Hazırlık beklemesi kısaltması.** Çevrimdışı teslim sayacı %99 ve üzerinde takılırsa ve WhatsApp “senkron tamam” derse 10 saniye beklenir (önceden 45); %98 ve altı ile bilgi yokluğunda eski 45 saniye kuralı geçerlidir.
- **İndirme hızı.** Ayarlar’da Yavaş (varsayılan, 2.0.0’daki değerler), Orta (indirmeden önce 1–3 sn, her 150 indirmede 1–3 dk mola) ve Hızlı (0,5–1,5 sn, her 200 indirmede 1–2 dk mola). Sayfa ve sorgu beklemeleri değişmez. Orta ve Hızlı’da risk uyarısı gösterilir; Hızlı seçilirken ana süreç bir kez onay sorar (varsayılan Vazgeç). “Bir çalışmada yaklaşık 400/600/800 fotoğraf” rakamları tahmindir; yalnızca Yavaş canlı ölçüldü. Daha hızlı seçenekler hesabın kısıtlanma riskini artırabilir, garanti verilemez. Seçim `indirmeHizi` ayarında saklanır; geçersiz değer Yavaş sayılır. Değerler `operation-policy.js` içindeki `HIZ_SECENEKLERI`’dedir.

## 2.0.2 değişiklikleri

2.0.2, 2.0.1’in canlı testinde bulunan hataları ve yeni istekleri kapsar. Telefon eşleşmesi ve veri 2.0.1’den taşınmaz.

- **Telefondan çıkış.** Telefonun Bağlı Cihazlar ekranından çıkış yapılınca Archivo da “Bağlı değil / QR kod göster” durumuna döner: yerel eşleşme, grup listesi ve senkron onayı silinir, grup seçimi korunur. WhatsApp kütüphanesinin kopma nedeni okunur (`LOGOUT`, `UNPAIRED`, `UNPAIRED_IDLE`; ayrıca kayıtlı eşleşme varken QR istenmesi). Uyku ya da internet kopması eşleşmeyi silmez. Son kopma nedeni `son-kopma.json`’a yazılır.
- **Elle çıkış.** “WhatsApp’tan çıkış yap” onaylanınca Ayarlar’da hemen “Çıkış yapılıyor” görünür (çıkış geçici bir tarayıcı açtığında 90 saniyeye kadar sürebilir); iş bitince rozet ve QR kod göster düğmesi Bitti’ye basmadan güncellenir.
- **Yetim Chrome.** Uyku ya da çökme sonrası açık kalan kendi Chrome’umuz (“The browser is already running” hatası) yeni tarayıcı açılmadan önce, uygulama açılışında ve bağlantı kapanınca kapatılır. Yalnızca bu sürümün oturum klasörüyle (`profiller/<sürüm>/oturum/session`) açılmış süreçlere dokunulur; kullanıcının kendi Chrome’u ya da başka sürümün klasörü etkilenmez (`browser-processes.js`; Mac/Linux `ps`, Windows PowerShell).
- **Grup seçimi.** Hiç grup seçili değilken Topla, Geçmişi Tara ve Geçmişi İndir önce “Hiç grup seçmedin. Tüm gruplar taransın mı?” diye sorar (Vazgeç varsayılan). Çıkışta grup seçimi silinmez; yeni gelen listede olmayan gruplar seçimden düşer.
- **PDF’leri de İndir.** Ayarlar’da Videoları da İndir’in altında (varsayılan kapalı). PDF gün/grup klasörüne kendi adıyla iner (`<tarih>_<saat>_<grup>_<ad>.pdf`), açıklaması ve yakın mesajları fotoğraflardaki gibi kaydedilir. Belge türleri `collection-plan.js` içindeki `BELGE_TURLERI` tablosundadır; tabloda olmayan belgeler (Word, Excel, CAD…) indirilmez, yalnızca sayılır (`atlanan-belgeler.json`).
- **Galeride video ve PDF.** Video ve PDF karoları tür etiketiyle görünür (videoda oynat işareti); küçük resim işletim sisteminden gelir (Mac Quick Look, Windows kabuk), yoksa ikon gösterilir. Büyük görünümde video uygulamada oynar; PDF için kart ve “PDF’i Aç” (bilgisayarın kendi programı; yalnızca arşivdeki PDF ve videolar). Silme, gün silme ve arama bunlarla da çalışır; gün başlığında video/PDF varsa “N dosya” yazar.
- **Önceki hata: ikinci indirme.** “Zaten indirildi” kontrolü yalnızca fotoğrafları görüyordu; videolar 2 saatlik örtüşmede yeniden inebiliyordu. Artık tüm arşiv türleri kontrol edilir.
- **Açılışta Otomatik Topla.** Tek anahtar (varsayılan kapalı; eski “Açılışta Uygulamayı Aç”ın yerine). Açıkken bilgisayar açılınca ya da uykudan uyanınca Archivo pencere açmadan 5 dakika bekler ve Topla ile aynı kurallarla bir kez toplar. Son başarılı toplamadan 6 saat geçmediyse, eşleşme ya da telefon senkron onayı yoksa, hiç grup seçili değilse ya da elle bir Topla sürüyorsa toplamaz; internet yoksa 5 dakika arayla 6 kez dener. QR gerekirse pencere açılmaz, bildirim gelir. Her bitişte bildirim gelir, hata olursa ayrıca. Menü çubuğu simgesinin menüsünde durumu yazar; son karar `otomatik-toplama.json`’dadır. Windows’ta giriş öğesi taşınabilir paketin asıl exe yoluna yazılır (2.0.1’de geçici klasörü gösteriyordu).
- **Ayarlar kartı %30 büyük.** Yazı, düğme, ikon ve anahtarlar aynı oranda büyür (494 piksel); sıra ve yerleşim değişmez, en küçük pencerede de taşmaz.
- **Küçük düzeltmeler.** Hata bildirimleri 10 saniyede kaybolur; bağlandıktan sonra alt çubuktaki “WhatsApp’tan çıkış yapıldı” yazısı “Bağlandı · Topla’ya hazır” olur.

## Sürüm ve veri kuralı

Her yeni sürümde sürüm numarası artar (örneğin 1.4.4 → 2.0.0 → 2.0.1). Yeni sürüm `profiller/<sürüm>` altında boş bir profille ve `Pictures/Archivo <sürüm> Arsivi` klasörüyle başlar; eski sürümün profili ve fotoğraf arşivi kendi klasöründe olduğu gibi kalır, silinmez. Bu nedenle her yeni sürümde WhatsApp eşleşmesi yeniden yapılır ve ilk çalışmada Ayarlar’daki gün sayısı kadar geriye bakılır. Telefondaki eski bağlı cihaz kayıtları otomatik silinmez; WhatsApp en fazla 4 bağlı cihaza izin verir, gerekirse telefonun Bağlı Cihazlar ekranından eskileri kaldırın. 2.0.2, önceki sürümlerin verisini hiç getirmez: temiz bir profille (`profiller/2.0.2`) ve `Pictures/Archivo 2.0.2 Arsivi` klasörüyle açılır, WhatsApp eşleşmesi sıfırdan yapılır.

Programın işlevleri, yapılan çalışmalar ve doğrulama sınırları: [PROGRAM-VE-YAPILANLAR.md](PROGRAM-VE-YAPILANLAR.md).
