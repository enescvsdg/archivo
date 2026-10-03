# Archivo

WhatsApp gruplarındaki fotoğrafları yerel diskte tarih ve grup klasörlerine arşivleyen Electron masaüstü uygulaması.

## Paketler

- Apple Silicon Mac: `Archivo-1.4.4-mac-arm64.dmg`
- Intel Mac: `Archivo-1.4.4-mac-x64.dmg` (ayrı derleme)
- Windows 10/11 x64: `Archivo-1.4.4-win-x64.exe` (taşınabilir, yönetici veya Node.js kurulumu gerektirmez)

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

Mac paketi Mac üzerinde derlenir. Windows EXE Mac üzerinde de paketlenebilir; Windows'taki açılış testi Windows makinede yapılmalıdır. Çıktılar sürüm numarasıyla `dist/<sürüm>/` klasörüne yazılır; güncel paketler `dist/1.4.4/` içindedir. GitHub iş akışı yalnızca derleme artefaktı üretir; otomatik yayın yapmaz.

## Veri güvenilirliği

- İlerleme sohbet kimliği bazında saklanır. Başarısız indirme, boş medya yanıtı veya eksik tarama varsa o sohbetin ilerlemesi artırılmaz.
- Başlangıçtan sonra gelen mesajlar bir sonraki taramaya bırakılır; sınırdaki saniye örtüşür.
- Yeniden taramada daha önce kaydedilmiş mesajlar, içerik benzerliği seçeneği kapalı olsa da tekrar kaydedilmez.
- Eski son-calisma.json biçimi okunur ve ilk yeni taramada sohbet bazındaki kayıtlarla genişletilir.
- Her grup için tarama en fazla 500 mesajla sınırlıdır; tavana ulaşıldığında erişim sınırı raporlanır.
- JSON yazımları geçici dosya ve yeniden adlandırma ile yapılır; önceki sürüm `.bak` dosyasında tutulur. Bozuk JSON sessizce sıfırlanmaz. Bu yedekler tam arşiv yedeği yerine geçmez.
- Fotoğraflar: Pictures/Archivo 1.4.4 Arsivi veya seçtiğiniz klasör. Ayarlar/oturum: Electron'un kullanıcı veri klasörü; uygulamadaki “Veri klasörü” düğmesinden açılır.

## Gizlilik ve sınırlar

Oturum, arşiv, açıklamalar ve grup/kişi bilgileri kişisel veridir; GitHub'a yüklemeyin. `.gitignore` yaygın veri klasörlerini hariç tutar, fakat paylaşmadan önce tüm dosyaları kontrol edin.

whatsapp-web.js resmi WhatsApp API'si değildir. WhatsApp Web değişiklikleri bağlantıyı veya indirmeyi bozabilir; hesabın kısıtlanmayacağı garantisi verilemez. Oturum ve indirme işlemleri gerçek hesapla ayrıca doğrulanmalıdır.

Mevcut ekran son 60 tarih bölümünü gösterir. Videolar indirilebilir ancak galeri fotoğraf odaklıdır. Grup seçimi hâlâ grup adıyla yapılır. Bunlar sonraki geliştirme aşamasındadır.

## 1.4.0 toplama akışı

Topla yerel tarihe göre bugün 00:00–işlem başlangıcı arasını toplar. Aynı taramada Ayarlar’da seçilen geçmiş aralığını kontrol eder; erişilebilen eksikleri gün/adet listesiyle Evet/Hayır onayına sunar. Geçmişi Tara indirme yapmaz; Geçmişi İndir seçili aralığı indirir. Silinen görseller ayrıca sorulur; hepsine uygula kutusu yalnızca mevcut işlemdeki soruları etkiler. Tarama sırasında verilen yeniden ekleme izni sonraki indirmede kullanılmak üzere kaydedilir.

Tarih kapsülündeki X, Evet/Hayır onayı sonrası o günün görsellerini Çöp Kutusu’na taşır ve önizleme/dizin kayıtlarını temizler. WhatsApp içeriği değişmez. Toplu silmede hata olursa kalan dosyalar korunur ve tamamlanan sayı bildirilir. Silinen görsellerin mesaj kimlikleri yeniden ekleme kararı için saklanır.

Eksik raporu yalnızca Web’den erişilebilen geçmişi kapsar. İstenen tarihe ulaşılamıyorsa erişim belirsiz veya sınır raporu gösterilir; tüm geçmişin eksiksiz olduğu iddia edilmez.

## 1.4.2 bağlantı ve senkronizasyon

QR sonrası modal hazırlık penceresi işlem düğmelerini engeller. WhatsApp loading_screen yüzdesi bildirirse bar o değeri gösterir; yüzde yoksa belirsiz hareketli gösterge kullanılır. Hazırlık kontrolü, Web hasSynced/çevrimdışı teslim ilerlemesini ve seçili sohbetlerin yerel listede bulunmasını bekler. Bu, telefondaki tüm geçmiş medya senkronizasyonunun eksiksiz bittiğini garanti etmez.

45 saniyelik işlem timeoutları ve 180 saniyelik uygulama başlatma kesintisi kaldırıldı. Durdur her zaman kullanılabilir. 15 dakikalık tarama/indirme bütçesi hazırlık sonrası başlar; istek/adet/MB/ardışık hata sınırları korunur. Hazır istemci işlem sonunda/hata sonrasında açık tutulur; Durdur veya uygulamadan tam çıkış kapatır.

Grup listesi yerel önbellekten okunur. GroupMetadata.update çağrılmaz; seçili grup filtresi model dönüşümünden önce uygulanır. Senkronizasyonun kendi protokol trafiği hesap genelinde sürebilir.

## 1.4.4 eşleşme ve boş profil

Bu sürüm kullanıcı veri klasöründeki `profiller/1.4.4` altında ayrı, boş bir profil kullanır. Eski ayarlar, grup listesi, önizlemeler ve WhatsApp oturumu kopyalanmaz. Önceki profil ve fotoğraf arşivi korunur. Önceki sürümün telefondaki bağlı cihaz kaydı otomatik kaldırılmaz; gerekiyorsa telefonun Bağlı Cihazlar ekranından kaldırın.

Ayarlar’daki QR simgesi bağlantı yokken “QR kod göster”, hazır bağlantıda “Bağlandı” etiketini taşır. “WhatsApp’tan çıkış yap” onay sonrası gerçek `client.logout()` işlemini kullanır. Başarısız çıkış başarılı gösterilmez ve yerel eşleşme zorla silinmez. Gerçek çıkış için açık, hazır bağlantı gerekir.

Yeni eşleşmede Web hazırlığı tamamlandıktan sonra telefondaki senkronizasyonun tamamlandığını kullanıcı “Telefonda tamamlandı · Devam et” ile onaylar. O zamana kadar tarama/indirme başlamaz. Telefonda bitişi otomatik ve kesin okumak mümkün olmadığından sahte yüzde veya otomatik tamamlandı durumu kullanılmaz. Tamamlanan bağlantının geç gelen sayfa olayları hazırlık panelini tekrar açamaz.

Yerel testler gerçek WhatsApp hesabına bağlanmadan yürütülür. Windows ve Intel Mac üzerinde açılış ve gerçek hesap davranışı ayrıca kullanıcı tarafından doğrulanmalıdır.

## 1.4.4 grup listesi ve çıkış

Eşleşme akışında Web istemcisi hazır olur olmaz grup isimleri alınarak Ayarlar’daki listeye eklenir; telefon senkronizasyon onayı ayrıca yalnızca yeni eşleşmenin tamamlanması için beklenir. Grup listesi yenilemesi bu onayı istemez. Tamamlanınca grup sayısı bildirilir. Liste güncellenirken mevcut seçili grup adları korunur.

QR düğmesi kayıtlı eşleşme veya açık bağlantı olduğunda gri ve pasiftir. Çıkış düğmesi bu durumda turuncu ve aktiftir; eşleşme yokken gri ve pasiftir. Çalışan işlemler sırasında ikisi de pasiftir. Uygulama yeniden açıldıktan sonra gerçek çıkış yapmak için kayıtlı oturum bir kez açılır; QR ile yeni oturum oluşturulmaz. Oturum geçersiz veya ağ erişimi başarısızsa çıkış doğrulanamadığı açıkça bildirilir.
