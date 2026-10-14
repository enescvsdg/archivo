# Archivo: programın işlevleri ve yapılan çalışmalar

Bu belge Archivo 2.0.1 kaynak kodunun özelliklerini, son değişikliklerini ve doğrulama sınırlarını açıklar.

## Program ne yapar?

Archivo, kullanıcının seçtiği WhatsApp gruplarındaki görselleri bilgisayarda tarih ve grup klasörlerine arşivler. Electron ve whatsapp-web.js kullanır; resmi WhatsApp API’si değildir.

- QR ile telefon eşleştirmesi yapılır. Eşleşme akışında Web istemcisi hazır olduğunda grup adları alınarak Ayarlar listesine eklenir. Liste güncellenirken mevcut seçimler korunur.
- Yeni eşleşmede senkronizasyon paneli işlem düğmelerini engeller. WhatsApp yüzde bildirirse gösterilir; kesin yüzde yoksa hareketli gösterge kullanılır. Telefonda senkronizasyon tamamlandığında kullanıcı Devam et ile onaylar. Telefonun tüm geçmiş medya senkronizasyonunun bittiği otomatik olarak kesin doğrulanamaz.
- Ana sayfadaki Topla, her grubu o grubun son başarılı toplama zamanından başlayarak tarar; kaydı olmayan grup için Ayarlar’daki ilk çalışma gün sayısı kullanılır. Topla geçmiş günler için soru sormaz; son toplamadan sonraki tüm görseller (belge olarak gönderilen fotoğraflar dahil) indirilir. Ayrıntılar README’deki “2.0.0 eksiksiz toplama” bölümündedir.
- Ayarlar’da 1–90 günlük geçmiş aralığı seçilir. Geçmişi Tara yalnızca erişim raporu üretir; Geçmişi İndir indirme işlemini başlatır.
- Önizlemede tek görsel veya tarih kapsülündeki X ile o güne ait dosyalar onay sonrası yerel Çöp Kutusu’na taşınabilir. Dizin ve küçük resim kayıtları temizlenir. WhatsApp’taki görseller silinmez.
- Daha önce yerel olarak silinmiş bir görsel yeniden bulunursa tekrar ekleme kararı sorulur. Hepsine uygula seçeneği mevcut işlemdeki sorulara uygulanır.
- Ayarlar X/Escape ile kapatılabilir; değişiklik varsa kaydetme kararı sorulur. Gün seçimi tekerlek ile yapılabilir.
- WhatsApp’tan çıkış yap düğmesi onay sonrası gerçek oturum çıkışını kullanır. Uygulama yeniden açılmışsa kayıtlı oturum bir kez açılarak çıkış denenir; yeni QR eşleşmesi başlatılmaz. Başarısız işlem başarılı gösterilmez.
- Kayıtlı eşleşmede QR düğmesi gri/pasif, çıkış düğmesi turuncu/aktiftir. Eşleşme yokken durum tersidir. İşlem sürerken ikisi de pasiftir.

## Veri ve çalışma sınırları

Fotoğraf arşivi yerel disktedir. Ayarlar, eşleşme ve tarama kayıtları kullanıcı veri klasöründedir. Her sürüm ayrı `profiller/<sürüm>` profili ve varsayılan `Pictures/Archivo <sürüm> Arsivi` klasörü kullanır (2.0.1 için `profiller/2.0.1`); eski sürüm verileri yeni profile kopyalanmaz, kendi klasöründe olduğu gibi kalır. Her yeni sürümde sürüm numarası artar. Eski kullanıcı verileri ve fotoğraf arşivi proje temizliğinde silinmedi. Önceki sürümlerin telefondaki bağlı cihaz kayıtları otomatik kaldırılmış sayılmaz.

İşlemler sırayla ve insan hızında yürür (README’deki “2.0.0 insan hızı” bölümü): geçmiş sayfa sayfa yüklenir, indirmeler arasında rastgele bekleme ve düzenli aralıklarla mola vardır (Ayarlar’daki İndirme Hızı: Yavaş varsayılan, Orta, Hızlı). Sert tavanlar kaldırıldı; emniyet sınırları çalışma başına 60 dakika, art arda üç medya hatasında durma ve grup başına 20000 mesajdır. Dosya boyutu indirmeden önce kesin bilinmeyebilir. Bu sınırlar WhatsApp hesabının kısıtlanmayacağını garanti etmez.

Erişim raporu yalnızca Web’den ulaşılabilen geçmişi kapsar. İstenen tarihe ulaşılamadığında erişim belirsizliği veya sınır bildirilir. Telefonda bulunan tüm geçmişin Web’de erişilebilir olduğu varsayılmaz.

## Yapılan çalışmalar

- Mac Apple Silicon, Intel Mac ve Windows x64 paketleme akışları hazırlandı. Paketler tarayıcıyı içerir; Windows taşınabilir EXE ayrıca Node.js kurulumu istemez. Kurumun çalıştırma politikaları geçerlidir.
- Bağlantı aşamalarını ve sabit hata kodlarını tutan yerel tanı kaydı eklendi; tanı çıktılarında kişisel içerik gösterilmez.
- 45 saniyelik uygulama kesintisi kaldırıldı. Hazır bağlantı işlem sonrasında korunur. Grup modelleri yerel önbellekten okunarak gereksiz grup metadatası güncellemeleri önlendi.
- Tamamlanan işlemden sonra geç gelen sayfa olaylarının senkronizasyon panelini yeniden açması düzeltildi.
- Geçmiş tarama/indirme ayrımı, günlük toplama, eksik görsel onayı ve yerel silme akışları eklendi.
- Ayarlar kapatma/onay davranışı, kart içindeki kaydırma çubuğu, gün tekerleği ve açıklamalı ikonlar düzenlendi.
- 1.4.4’te grup isimlerinin senkronizasyon onayından önce listeye eklenmesi, eşleşme durumuna göre düğmeler ve yeniden açılış sonrası gerçek çıkış düzeltildi.
- Eski proje paketleri, kaynak ZIP’leri ve geçici çıktılar temizlendi. Eski sürümlerin derleme çıktıları (`dist/1.4.4`, `dist/1.4.5`) silindi; Mac Apple Silicon paketleri bu bilgisayarda, Intel Mac ve Windows paketleri GitHub Actions ile derlendi. Derleme bağımlılıkları korunur.
- Güncel kaynak ve gerekli proje dosyaları https://github.com/enescvsdg/archivo reposuna yüklendi. Kişisel oturum, fotoğraf arşivi ve kullanıcı kayıtları yüklenmedi.
- GitHub’ın ilk Windows çalışmasında satır sonu dönüşümü CSP özet testini bozdu. Aynı hata CRLF ile yerelde üretildi. `.gitattributes` kaynak satır sonlarını LF olarak sabitler; güvenlik politikası ve test devre dışı bırakılmadı. Bu düzeltme uygulamanın iş akışını değiştirmez.
- 2.0.0: Mac’te görülen “detached Frame” hatası giderildi. Hazır tutulan WhatsApp tarayıcısı kullanılmadan önce yoklanır, bozuksa kapatılıp yenisi açılır; hatayla biten işlemin bozuk tarayıcısı hazır diye saklanmaz. Tanı kaydına ana çerçeve kopması ve sayfa kapanması eklendi.
- 2.0.0: Eksiksiz toplama. Her grup kendi son toplama zamanından taranır; çalışma grup grup ilerler ve kaydı en eski grup önce işlenir; alınamayan fotoğraf 3 denemeden sonra listeye yazılıp ilerlemeyi engellemez; belge olarak gönderilen fotoğraflar alınır; yarıda kalan gruplar raporda “Sırada” görünür. Topla geçmiş günler için soru sormaz.
- 2.0.0: Sayfa yenilenmesine dayanıklılık. WhatsApp Web sayfayı işlem sırasında yenileyebilir; uygulama hazır olmasını bekler, silinen indirme yamasını yeniden uygular, isteği yeniden dener ve bunu fotoğraf için başarısız deneme saymaz. Alınamayan fotoğraf kaydına `iletildi` bilgisi eklendi. Topla’lar arası 30 dakika bekleme kuralı kaldırıldı (yeni bağlantı için 1 dakika kuralı sürer).
- 2.0.0: Hazır nöbetçisi. Eşleşmeden sonra sayfa yenilenip kütüphanenin `ready` işlemi yarıda kesilirse WhatsApp bağlı ve senkron dese bile `ready` hiç gelmiyordu (grup listesi boş kalıyordu). Uygulama bunu algılayıp kütüphanenin hazır işlemini yeniden tetikler.
- 2.0.0: Çıkış düzeltmesi. Oturum telefondan zaten kapatılmışsa uygulama içi çıkış artık bunu algılayıp yerel eşleşmeyi temizler ve bağlan düğmesini açar; doğrulanamayan çıkışta kullanıcı onayıyla yalnızca yerel eşleşme temizlenebilir; çıkış 90 saniye zaman aşımına, Durdur’a ve kapanışta temizliğe sahip; pencereye bitiş bildirilir ve sonuç mesajı görünür.
- 2.0.0: Hazırlık beklemesi sınırı. Uygulama kapalıyken gelen mesajların WhatsApp sayacı %92’de takılınca senkronizasyon paneli sonsuza kadar açık kalıyordu; sayaç 45 saniye ilerlemezse ya da toplam bekleme 5 dakikayı aşarsa devam edilir ve neden tanıya yazılır.
- 2.0.0: İnsan hızı modeli. İstek, medya ve MB tavanları ile grup başına 500 mesaj sınırı kaldırıldı; yerine sayfa sayfa geçmiş yükleme, rastgele bekleme, her 100 indirmede mola ve 60 dakikalık emniyet sınırı kondu.

- 2.0.0: Arayüz yenilemesi. Önizleme cam arayüze uygun yeniden tasarlandı: filtre kartı (Tümü, Gruplar listesi, sürükle-bırak sıralı grup düğmeleri, arama), tarih filtresi (takvim, kısayollar, aralık; 60 gün sınırı kalktı), tam genişlikte açılıp kapanan gün kartları (yalnızca en yeni gün açık, kapalı günler çizilmez), grup görünümünde yalnızca o grubun fotoğrafları, Google tarzı sayfalama (marka yazı tipiyle ARCHIV + O), grup adı standardı (yalnızca görünüm) ve bütün düğmelerin ikon karosu + ad olarak yeniden çizimi. Vurgu rengi kehribardan kurumsal maviye çevrildi. Ayrıntı: README “2.0.0 arayüz”.
- 2.0.0: Silme. Grup görünümünde gün silme yalnızca o grubun o günkü fotoğraflarını siler; Tümü’nde onay penceresi büyük harfli uyarı verir.
- 2.0.0: Topla/Geçmiş sırasında oluşan hata yazıları yeni çalışmada silinir ve elle kapatılabilir; Ayarlar’daki eski sınır açıklaması insan hızı modeline göre düzeltildi.
- 2.0.0: Sürüm. Önceki sürümlerin verisi taşınmaz; 2.0.0 temiz profille (`profiller/2.0.0`) ve `Pictures/Archivo 2.0.0 Arsivi` klasörüyle başlar, WhatsApp eşleşmesi sıfırdan yapılır.
- 2.0.1: Sürüm. 2.0.0’ın verisi taşınmaz; 2.0.1 temiz profille (`profiller/2.0.1`) ve `Pictures/Archivo 2.0.1 Arsivi` klasörüyle başlar, WhatsApp eşleşmesi yeniden yapılır.
- 2.0.1: Senkron paneli aşamalı oldu (bağlantı, grup listesi, telefondan mesajlar); Devam et her zaman görünür, işlem bitince tüm pencereler kapanır; telefondan gelen mesajların yerel sayısı deneme olarak izlenir.
- 2.0.1: Alttaki Topla çubuğunun yerini çalışırken küçük cam işlem kapsülü (Durdur sağda), bitince sonuç kartı alır; pencere önde değilken işletim sistemi bildirimi gönderilir.
- 2.0.1: Genel sayfalama güne göre (sayfa başına 7/15/30 gün, sayfanın en altında `ARCHIV`+O çubuğu); gün kartı içi sayfalama kaldırıldı. Hata bildirimleri yalnızca Tümü’nde görünür ve 30 saniye sonra kaybolur.
- 2.0.1: Ayarlar: Telefon Eşlemesi satırı (durum rozeti ve iki eşit düğme), kalın ve baş harfleri büyük başlıklar, İndirme Hızı (Yavaş/Orta/Hızlı; Hızlı’da onay).
- 2.0.1: Hazırlık beklemesi: sayaç %99+ takılıp WhatsApp “senkron tamam” derse 10 saniyede devam edilir (önceden 45).
- 2.0.2: Sürüm. 2.0.1’in verisi taşınmaz; 2.0.2 temiz profille (`profiller/2.0.2`) ve `Pictures/Archivo 2.0.2 Arsivi` klasörüyle başlar, WhatsApp eşleşmesi yeniden yapılır.
- 2.0.2: Telefondan çıkış Archivo’yu “Bağlı değil / QR kod göster” durumuna döndürür (kopma nedeni okunur, uyku/ağ kopması eşleşmeyi silmez); elle çıkışta “Çıkış yapılıyor” hemen görünür ve Bitti beklenmeden güncellenir.
- 2.0.2: Yetim Chrome temizliği (“The browser is already running” hatası): yalnızca bu sürümün oturum klasörüyle açılmış Chrome süreçleri kapatılır.
- 2.0.2: Hiç grup seçili değilken Topla/Geçmiş önce sorar (Vazgeç varsayılan); çıkışta grup seçimi korunur.
- 2.0.2: PDF’leri de İndir (belge türleri tablosu; diğer belgeler yalnızca sayılır); galeride video ve PDF (karo, video oynatıcı, PDF’i Aç, silme, arama); videoların örtüşmede ikinci kez inmesi hatası düzeltildi.
- 2.0.2: Açılışta Otomatik Topla (bilgisayar açılınca ya da uykudan uyanınca; 5 dk bekleme, 6 saat kuralı, bildirimler, menü çubuğu durumu); Windows giriş öğesi asıl exe yoluna yazılır.
- 2.0.2: Ayarlar kartı %30 büyük; hata bildirimleri 10 saniye; bağlandıktan sonra özet satırı yenilenir.

## Doğrulama ve sınırlar

2.0.2 için GitHub Actions (`v2.0.2` dalı, `aaf90dd`, çalışma 38491844642) Windows x64, Apple Silicon Mac ve Intel Mac üzerinde test (her sistemde 232 testten 191’i geçti, 0 hata; gerçek Chrome gerektiren 41 test GitHub’da atlanır), paketleme ve artefakt yükleme adımlarını başarıyla tamamladı: https://github.com/enescvsdg/archivo/actions/runs/38491844642.

2.0.1 için GitHub Actions (`v2.0.1` dalı, çalışma 37235694150) Windows x64, Apple Silicon Mac ve Intel Mac üzerinde test, paketleme ve artefakt yükleme adımlarını başarıyla tamamladı: https://github.com/enescvsdg/archivo/actions/runs/37235694150.

2.0.2 için 232 yerel test geçti (2.0.1’de 173; 40’ı gerçek Chrome ile arayüzü sürer, biri gerçek Chrome ile yetim tarayıcı hatasını üretir). 2.0.2 ayrıntıları DOGRULAMA-2.0.2.md, 2.0.1 ayrıntıları DOGRULAMA-2.0.1.md içindedir. Testler sahte WhatsApp istemcisi kullanır; otomatik testlerde gerçek hesap kullanılmaz. Gerçek hesapla Mac arm64 üzerinde elle canlı testler yapıldı (eşleşme, grup listesi, 1 grup/1 gün ve 4 grup/3 gün toplama, uygulama içi çıkış); ayrıntı ve sonuçlar DOGRULAMA-2.0.0.md’dedir. Sayfa sağlık kontrolü ayrıca gerçek Puppeteer ve Chrome for Testing ile denendi. Mac arm64 paketi derlendi ve paket içindeki kaynak dosyalar kaynakla karşılaştırıldı (yedi kod dosyası birebir aynı; `package.json` electron-builder tarafından yeniden yazılır); Intel Mac ve Windows 2.0.0 paketleri bu bilgisayarda değil, GitHub Actions’ta derlendi.

2.0.0 için GitHub Actions (`v2.0.0` dalı, çalışma 37169528298) Windows x64, Apple Silicon Mac ve Intel Mac üzerinde test (testler her sistemde geçti), paketleme ve artefakt yükleme adımlarını başarıyla tamamladı: https://github.com/enescvsdg/archivo/actions/runs/37169528298. Önceki sürümde Windows’taki CSP özet testini bozan satır sonu dönüşümü `.gitattributes` ile LF’ye sabitlenmişti.

Windows ve Intel Mac paketlerinin gerçek kullanıcı açılışı ve canlı WhatsApp davranışı (GitHub’da yalnızca test ve paketleme çalışır) ayrıca doğrulanmalıdır. 2.0.2’den itibaren bu bilgisayarda derlenen Mac paketleri Developer ID ile imzalıdır (bildirimler için); Mac notarizasyonu yapılmamıştır. Windows paketi ve GitHub’da derlenen Mac paketleri imzasızdır. Yeni sürüm, otomatik olarak tüm geçmişe erişim veya kısıtlanma riskinin ortadan kalkması anlamına gelmez.
