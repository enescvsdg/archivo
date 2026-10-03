# Archivo: programın işlevleri ve yapılan çalışmalar

Bu belge Archivo 1.4.4 kaynak kodunun özelliklerini, son değişikliklerini ve doğrulama sınırlarını açıklar.

## Program ne yapar?

Archivo, kullanıcının seçtiği WhatsApp gruplarındaki görselleri bilgisayarda tarih ve grup klasörlerine arşivler. Electron ve whatsapp-web.js kullanır; resmi WhatsApp API’si değildir.

- QR ile telefon eşleştirmesi yapılır. Eşleşme akışında Web istemcisi hazır olduğunda grup adları alınarak Ayarlar listesine eklenir. Liste güncellenirken mevcut seçimler korunur.
- Yeni eşleşmede senkronizasyon paneli işlem düğmelerini engeller. WhatsApp yüzde bildirirse gösterilir; kesin yüzde yoksa hareketli gösterge kullanılır. Telefonda senkronizasyon tamamlandığında kullanıcı Devam et ile onaylar. Telefonun tüm geçmiş medya senkronizasyonunun bittiği otomatik olarak kesin doğrulanamaz.
- Ana sayfadaki Topla, yerel tarihe göre bugün 00:00 ile işlemin başladığı saat arasındaki görselleri toplar. Seçilen geçmiş aralığında erişilebilen eksikler varsa gün/adet bilgisiyle indirme onayı ister.
- Ayarlar’da 1–90 günlük geçmiş aralığı seçilir. Geçmişi Tara yalnızca erişim raporu üretir; Geçmişi İndir indirme işlemini başlatır.
- Önizlemede tek görsel veya tarih kapsülündeki X ile o güne ait dosyalar onay sonrası yerel Çöp Kutusu’na taşınabilir. Dizin ve küçük resim kayıtları temizlenir. WhatsApp’taki görseller silinmez.
- Daha önce yerel olarak silinmiş bir görsel yeniden bulunursa tekrar ekleme kararı sorulur. Hepsine uygula seçeneği mevcut işlemdeki sorulara uygulanır.
- Ayarlar X/Escape ile kapatılabilir; değişiklik varsa kaydetme kararı sorulur. Gün seçimi tekerlek ile yapılabilir.
- WhatsApp’tan çıkış yap düğmesi onay sonrası gerçek oturum çıkışını kullanır. Uygulama yeniden açılmışsa kayıtlı oturum bir kez açılarak çıkış denenir; yeni QR eşleşmesi başlatılmaz. Başarısız işlem başarılı gösterilmez.
- Kayıtlı eşleşmede QR düğmesi gri/pasif, çıkış düğmesi turuncu/aktiftir. Eşleşme yokken durum tersidir. İşlem sürerken ikisi de pasiftir.

## Veri ve çalışma sınırları

Fotoğraf arşivi yerel disktedir. Ayarlar, eşleşme ve tarama kayıtları kullanıcı veri klasöründedir. Mevcut sürüm ayrı `profiller/1.4.4` profili ve varsayılan `Pictures/Archivo 1.4.4 Arsivi` klasörü kullanır; eski sürüm verileri yeni profile kopyalanmaz. Eski kullanıcı verileri ve fotoğraf arşivi proje temizliğinde silinmedi. Önceki sürümlerin telefondaki bağlı cihaz kayıtları otomatik kaldırılmış sayılmaz.

İşlemler sırayla yürür; grup başına en fazla 500 mesaj, çalışma başına 24 uygulama düzeyinde sohbet/mesaj bilgisi isteği, 100 medya, 100 MB kaydedilen veri ve 15 dakika sınırları bulunur. İstekler arasında en az 1,5 saniye beklenir; art arda üç medya hatasında işlem durur. Dosya boyutu indirmeden önce kesin bilinmeyebilir. Bu sınırlar WhatsApp hesabının kısıtlanmayacağını garanti etmez.

Erişim raporu yalnızca Web’den ulaşılabilen geçmişi kapsar. İstenen tarihe ulaşılamadığında erişim belirsizliği veya sınır bildirilir. Telefonda bulunan tüm geçmişin Web’de erişilebilir olduğu varsayılmaz.

## Yapılan çalışmalar

- Mac Apple Silicon, Intel Mac ve Windows x64 paketleme akışları hazırlandı. Paketler tarayıcıyı içerir; Windows taşınabilir EXE ayrıca Node.js kurulumu istemez. Kurumun çalıştırma politikaları geçerlidir.
- Bağlantı aşamalarını ve sabit hata kodlarını tutan yerel tanı kaydı eklendi; tanı çıktılarında kişisel içerik gösterilmez.
- 45 saniyelik uygulama kesintisi kaldırıldı. Hazır bağlantı işlem sonrasında korunur. Grup modelleri yerel önbellekten okunarak gereksiz grup metadatası güncellemeleri önlendi.
- Tamamlanan işlemden sonra geç gelen sayfa olaylarının senkronizasyon panelini yeniden açması düzeltildi.
- Geçmiş tarama/indirme ayrımı, günlük toplama, eksik görsel onayı ve yerel silme akışları eklendi.
- Ayarlar kapatma/onay davranışı, kart içindeki kaydırma çubuğu, gün tekerleği ve açıklamalı ikonlar düzenlendi.
- 1.4.4’te grup isimlerinin senkronizasyon onayından önce listeye eklenmesi, eşleşme durumuna göre düğmeler ve yeniden açılış sonrası gerçek çıkış düzeltildi.
- Eski proje paketleri, kaynak ZIP’leri ve geçici çıktılar temizlendi. Güncel paketler `dist/1.4.4` içindedir. Derleme bağımlılıkları korunur.
- Güncel kaynak ve gerekli proje dosyaları https://github.com/enescvsdg/archivo reposuna yüklendi. Kişisel oturum, fotoğraf arşivi ve kullanıcı kayıtları yüklenmedi.
- GitHub’ın ilk Windows çalışmasında satır sonu dönüşümü CSP özet testini bozdu. Aynı hata CRLF ile yerelde üretildi. `.gitattributes` kaynak satır sonlarını LF olarak sabitler; güvenlik politikası ve test devre dışı bırakılmadı. Bu düzeltme uygulamanın iş akışını değiştirmez.

## Doğrulama ve sınırlar

1.4.4 için 62 yerel test geçti. Testler sahte WhatsApp istemcisi kullanır; gerçek hesap üzerinde otomatik bağlantı, QR, indirme veya çıkış denemesi yapılmadı. Paket içindeki kaynak dosyalarının güncel kaynakla aynı olduğu kontrol edildi.

İlk GitHub çalışmasında iki Mac derlemesi başarılı, Windows test aşaması başarısızdı. Düzeltmenin sonraki GitHub sonucu Actions ekranından kontrol edilmelidir: https://github.com/enescvsdg/archivo/actions.

Windows ve Intel Mac’te gerçek kullanıcı açılışı ile canlı WhatsApp davranışı ayrıca doğrulanmalıdır. Paketler imzasızdır; Mac notarizasyonu yapılmamıştır. Yeni sürüm, otomatik olarak tüm geçmişe erişim veya kısıtlanma riskinin ortadan kalkması anlamına gelmez.
