# XLab Vigil kullanım rehberi

Vigil, insan tarafından yürütülen incelemelerin kayıtlarını ve gerekçelerini aynı yerde tutar. İki çalışma yolu vardır: varlıkları gruplarda süreli olarak takip etmek ve kaynak olaylarını bağımsız inceleme dosyalarında değerlendirmek. Bir dosya açmak için önceden varlık, grup veya üyelik oluşturmak gerekmez.

Bu rehber 1.3.3 yerel ürününün kullanımını anlatır; inceleme dosyaları ve yedek akışı 1.2.0'da tamamlanmıştır. Hazır paket ayrı bir teslim dosyasıdır; çalışan eski servisin kendiliğinden güncellendiği anlamına gelmez. Tarihli yerel kabulün sonuçları [DEVIR.md](DEVIR.md), kurulum/güncelleme ayrıntıları [YEREL-TESLIM.md](YEREL-TESLIM.md) içindedir.

## 1. Kurun ve giriş yapın

Yeni kurulum için Windows x64, PowerShell 5.1 veya 7 ve çalışan Docker Desktop gerekir. Hazır ZIP'i ayrı bir klasöre açın; o klasörde PowerShell ile çalıştırın:

```powershell
powershell -File scripts/verify-package.ps1
powershell -File scripts/install.ps1
powershell -File scripts/start.ps1 -Background
```

`verify-package.ps1` paket dosyalarını manifestteki hashlerle karşılaştırır. `install.ps1` yerel ayarları ve PostgreSQL kapsayıcısını hazırlar. `start.ps1` uygulamayı başlatır ve hazır olduğunu denetler. Hazır pakette Go/Node veya ayrıca age kurulumu gerekmez. Docker imajı önbellekte değilse kurulum PostgreSQL imajını indirir.

Tarayıcıda `http://127.0.0.1:8320` adresini açın. Yeni veritabanında ad soyad, kullanıcı adı ve parola ile ilk yöneticiyi oluşturun; varsayılan hesap bulunmaz. Daha önce kurulmuş veritabanında mevcut hesabınızla giriş yapın. “Örnek çalışma alanını incele” yalnız kurgusal, salt okunur bir önizleme açar.

8320 portunda başka kurulum çalışıyorsa yeni klasörden başlatma reddedilir. Desteklenen şema 11/12 kurulumunu güncellemek için önce uygun eski sürümle yedek alın ve kendi klasöründeki `stop.ps1` ile uygulamayı durdurun; `.env` ve veritabanı hacmini koruyarak [güncelleme adımlarını](YEREL-TESLIM.md#güncelleme-ve-işletim) izleyin. Bu çalışma sırasında ana hizmet eski 0.3.0 sürümünde kaldı. Şema 3/0.3.0 geçişi ayrı taşıma planı ve göç doğrulaması gerektirir; bu komutlarla doğrulanmış kabul edilmez. Bu rehber mevcut servisi durdurmuş veya yeni pakete geçirmiş değildir.

## 2. Çalışacak kişilerin rollerini belirleyin

Yönetici, **Kullanıcılar** ekranından yerel Vigil hesabı oluşturur ve rolünü seçer. Kullanıcı yönetimindeki hesap uygulamaya giriş içindir; **Varlıklar** içindeki “Hesap” ise incelemeye aldığınız kurumsal hesap kaydıdır. Bu iki kayıt aynı şey değildir.

| İşlem | Yönetici (`admin`) | Analist (`analyst`) | Üye / Görüntüleyici (`member` / `viewer`) |
| --- | --- | --- | --- |
| Varlık, grup ve inceleme üyeliği yönetimi | Evet | Evet | Erişemez |
| Kırmızı/sarı listeler, üyelik uyarıları ve genel uyarı özeti | Evet | Evet | Erişemez |
| Olayları ve kaynak profillerini okuma | Evet | Evet | Erişemez |
| Kaynak profili oluşturma/değiştirme ve JSON olay aktarımı | Evet | Hayır | Hayır |
| İnceleme dosyası, not ve olay ilişkisi işlemleri | Evet | Evet | Erişemez |
| Uygulama içi bildirimleri okuma ve kendi okundu işaretini kaydetme | Evet | Evet | Erişemez |
| Kullanıcı yönetimi, işlem günlüğü ve e-posta kanalını değiştirme | Evet | Hayır | Hayır |
| Hesabım üzerinden kendi parolasını değiştirme | Evet | Evet | Evet |

Üye ve Görüntüleyici, inceleme/risk alanını salt okunur olarak da göremez. Sorumlu alanına bir kişinin adını yazmak ona yetki vermez. Dosyaya veya gruba özel daha dar erişim listeleri henüz uygulanmaz. Rol/etkinlik değişikliği ilgili kullanıcının oturumlarını iptal eder; son etkin yönetici korunur.

## 3. Kişi, hesap ve cihazı kaydedin

**Varlıklar → Varlık ekle** ile kayıt açın. İlk prova için şu üç kurgusal kaydı kullanabilirsiniz:

- **Personel:** “Deneme Personeli”, birim “Bilgi Teknolojileri”.
- **Hesap:** “deneme.hesabi”, tanımlayıcı “TEST\deneme.hesabi”, ilişkili personel “Deneme Personeli”.
- **Cihaz:** “TEST-PC-01”, tanımlayıcı aynı cihaz adı, ilişkili personel “Deneme Personeli”.

Servis ve uygulama türleri de seçilebilir. Hesap/cihaz bir personele bağlanabilir veya paylaşılan varlık olarak ilişkisiz bırakılabilir. Bu bilgiler elle kaydedilir ve aday ilişki olarak gösterilir. AD'den hesap çekilmez; ilişki, belirli bir olayı o kişinin gerçekleştirdiğini doğrulamaz.

## 4. Grubu ve gerekçeli üyeliği oluşturun

**İzleme grupları → Grup oluştur** ile örneğin “Yetki incelemesi” grubunu açın. Rengi Sarı seçip kapsamına hangi kayıtların neden takip edileceğini yazın. Sarı/Turuncu/Kırmızı/Özel renkleri inceleme önceliğidir; kişiye veya hesaba otomatik tehdit kararı vermez.

**İnceleme üyelikleri → Üyelik ekle** ekranında “deneme.hesabi” ve bu grubu seçin. Gerekçe olarak “Ayrıcalıklı hesap kapsamının ekip tarafından gözden geçirilmesi” yazın; sorumlu olarak ekibi belirtin. Başlangıcı bugün, bitişi 30 gün sonrası, gözden geçirmeyi 7 gün sonrası seçin. Tarihler UTC gününe göre değerlendirilir; başlangıç ≤ gözden geçirme ≤ bitiş olmalı, toplam aralık 366 günü aşmamalıdır. Bitiş günü dahildir.

Bir varlık birden fazla grupta takip edilebilir. Aynı varlık/grup için kapatılmamış ikinci üyelik açılamaz. Tarihinin geçmesi üyeliği kendiliğinden kapatmaz; süresi dolmuş açık kayıt iş listesinde kalır.

Üyelik ayrıntısında **Gözden geçirmeyi kaydet** ile ayrı bir karar verin:

- **İncelemeye devam et:** Ayrı gerekçe ve bugünden sonraki bir inceleme tarihi ister. Tarih mevcut üyelik süresi içinde kalır; bitiş kendiliğinden uzamaz.
- **Üyeliği kapat:** Ayrı gerekçeyi ve kararı geçmişe kaydeder. Hesap veya ağ erişimini değiştirmez.

Genel düzenleme ile tarih/durum değiştirmek ayrı bir gözden geçirme kararı sayılmaz. Ayrıntıdaki etkinlik geçmişi yapılan işlemleri, gerekçeleri ve önce/sonra değerlerini gösterir.

## 4a. Kırmızı/sarı listeleri ve günlük uyarıları açın

Yönetici veya analist olarak **Listeler ve uyarılar** ekranını açın. Kırmızı liste, kırmızı gruplardaki kapatılmamış üyelikleri; sarı liste, sarı gruplardaki kapatılmamış üyelikleri doğrudan gösterir. Gelecekte başlayacak veya süresi geçmiş üyelikler de bu listelerde kalır. Bir kişi/hesap birden fazla gruptaysa birden fazla satır oluşturur; liste ve uyarı sayıları benzersiz kişi sayısı değildir.

Sayfanın kendi **Listelerde ara** alanına varlık adı, aday tanımlayıcı, birim, grup adı, üyelik gerekçesi veya sorumlu etiketini yazın; isterseniz **Varlık türü** alanını Personel, Hesap, Cihaz, Servis veya Uygulama olarak seçin. **Ara** ile seçimi uygulayın. Arama bu alanlarda büyük/küçük harf duyarsız metin eşleşmesidir; `%`, `_` ve ters eğik çizgi joker değildir. Dolu arama 3–120 Unicode karakter olmalıdır; boş arama tümünü gösterir. Kurgusal örnekte `TEST\deneme.hesabi` araması ve Hesap türüyle ilgili üyelikleri bulabilirsiniz. Satırdaki **Aday kimlik** kayıtlı tanımlayıcıdır; dış kimlik doğrulaması değildir.

Bu form yalnız görüntülenen 20 satırı değil, tüm uygun açık üyelikleri arar. Kırmızı/sarı satırlar, etkin üyelik sayıları ve dört uyarı türünün sayaçları aynı uygulanmış arama/tür kapsamındadır. Arama kişiye bağlı tüm hesapları kendiliğinden ilişkilendirmez; doğrudan her varlığın kayıtlı alanlarını kullanır. Kaynak olay bildirimlerinin kişisel okunmamış sayısı bu filtreden etkilenmez.

Formdaki değişiklikler **Ara** seçilene kadar taslaktır; ekrandaki sonuçlar son uygulanmış seçime aittir. **Filtreleri temizle** ile arama/tür seçimini kaldırıp ilk sayfalara dönün; seçili uyarı türü korunur. Bu sayfada üst genel arama kullanılmaz. Sayfa yenilemesi ve 30 saniyelik otomatik okuma son uygulanmış seçimi korur; henüz uygulanmamış formu sizin adınıza göndermez.

**İnceleme uyarıları** bütün grup renklerini kapsar. **Tümü**, **Süresi dolmuş**, **İnceleme tarihi gelmiş**, **Kırmızı öncelik** veya **Önümüzdeki 7 gün** filtresiyle çalışabilirsiniz. Yalnız başlangıç günü gelmiş açık üyelikler değerlendirilir ve her üyelik için aşağıdaki sırada **tek** uyarı seçilir:

1. Bitiş tarihi bugünden önceyse süresi dolmuş üyelik.
2. Süresi dolmamışken gözden geçirme tarihi bugün veya geçmişteyse incelemesi gelmiş üyelik.
3. Önceki koşullar yoksa, etkin kırmızı üyelik için kırmızı öncelik.
4. Önceki koşullar yoksa, gözden geçirmesi yarından başlayarak yedi gün içinde olan üyelik.

Bugün, sunucunun UTC takvim günüdür; bitiş günü üyelik süresine dahildir. Henüz başlamamış üyelik uyarı üretmez. Turuncu/özel gruplar ilk, ikinci veya dördüncü koşulla uyarı üretebilir. Yaklaşan inceleme penceresinin yedinci günü dahildir.

Satırdan ilgili üyeliğin ayrıntısını açın; gerekçeyi, tarihleri ve son inceleme kararını okuyup **Gözden geçirmeyi kaydet** ile karar verin. Üyeliği kapatmak onu açık listelerden ve uyarılardan kaldırır. İncelemeye devam edip yeni tarihi ileri almak, tarihi gelmiş inceleme uyarısını kaldırır; üyelik hâlâ etkin kırmızıysa kırmızı öncelik uyarısı sürebilir. Bir uyarının azalması hesabın engellendiği, tehdidin giderildiği veya dış kaynağın doğrulandığı anlamına gelmez.

Ekran görünürken veri 30 saniyede bir yenilenir ve mevcut sayfalar korunur; elle yenileme de kullanılabilir. Arama/tür seçimi uygulanınca, tarih günü veya kaydettiğiniz üyelik değişince üç liste ilk sayfaya döner; uyarı türü değişince yalnız ilgili uyarı sayfası baştan açılır. Gün/sayfalama hatasında **Listeleri baştan yükle** ile uygulanmış seçimi koruyarak üç listeyi yeni ilk sayfadan alın. Yenileme açık karar formundaki taslağı sizin adınıza göndermez veya yeni sürümle uzlaştırmaz. Yükleme hatasında eski sayı güncel başarı gibi sunulmaz; yeniden deneyin.

**Kaynak olay bildirimleri** bölümündeki sayı yalnız sizin okunmamış uygulama içi olay bildirimlerinizdir. **Bildirimleri aç** ile ayrıntıya geçin; üyelik uyarısı ve kişisel okundu işareti ayrı kayıtlar olarak kalır.

## 4b. Her ekrandan genel uyarı özetine bakın

Yönetici veya analist olarak üst çubuktaki **Uyarılar** düğmesini açın. **Uyarı özeti** iki ayrı işi gösterir: tüm kayıtlardaki üyelik inceleme uyarıları ve yalnız sizin okunmamış kaynak olay bildirimleriniz. Üyelik uyarıları süresi dolmuş, inceleme tarihi gelmiş, kırmızı öncelik ve önümüzdeki yedi gün olarak ayrılır. Aynı üyelik yalnız en öncelikli türde sayılır; bir kişinin birden fazla üyeliği birden fazla satır oluşturabilir.

Üst çubuktaki güncel sayı üyelik inceleme toplamıdır; 99'u aşınca küçük rozet **99+** gösterir, özetin içinde tam sayı bulunur. Kişisel okunmamış bildirim sayısı ayrı gösterilir; bu iki sayı tehdit toplamı olarak birleştirilmez. Özet yalnız görünür sayfayı veya ilk 1000 kaydı saymaz.

Özette **Süresi dolmuş**, **İnceleme tarihi gelmiş**, **Kırmızı öncelik** veya **Önümüzdeki 7 gün** türünü açın. **Listeler ve uyarılar** ekranı tüm kapsamdaki seçili türe geçer ve uyarı başlığına odaklanır. **Listeleri ve uyarıları aç** tüm uyarı türlerini açar. Bu genel girişler önceki liste aramasını, varlık türünü, henüz uygulanmamış filtre taslağını ve üç listenin sayfalarını temizler; zaten aynı ekrandaysanız da yeniden ilk sayfadan açılır. Liste ekranının kendi uyarı türü filtresini değiştirmeniz ise uygulanmış arama/tür kapsamını ve kırmızı/sarı sayfaları korur. **Bildirimleri aç** kişisel kaynak bildirimi ekranına götürür.

Görünürken özet 30 saniyede bir ve sayfaya dönüldüğünde yenilenir; **Özeti yenile** ile elle de alınabilir. Yenileme başarısız olursa üst çubuktaki sayı **!** olur; daha önce alınmış sayılar yalnız özetin içinde **Güncel değil** ve **Son başarılı görüntü** zaman bilgisiyle görülebilir. Hata alanındaki **Yeniden dene** işlemini kullanın. İlk yüklemedeki hata sıfır uyarı gibi gösterilmez; oturum veya rol erişimi sona erdiğinde eski özel sayılar kaldırılır. Örnek çalışma alanındaki özet kurgusaldır.

Özeti açmak bildirimleri okundu işaretlemez, üyeliği veya dosyayı kapatmaz ve açık karar taslağını göndermez. Bir uyarıyı sonuçlandırmak için ilgili üyelikte gerekçeli karar kaydedin; kişisel okundu bilgisi için bildirim ayrıntısındaki işlemi kullanın. Özetin azalması hesap/ağ engelleme, tehdit giderme veya dış ileti teslimatı değildir.

## 5. Kaynak profilini kaydedin ve olay aktarın

Yönetici olarak **Veri kaynakları → Bağlantı ekle** ekranını açın. İlk prova için sağlayıcı **Özel veri kaynağı**, taşıma yöntemi **Manuel JSON aktarımı**, profil durumu **Yapılandırıldı** seçin. Adı “Yerel deneme kaynağı”, kapsamı “Yalnız kurgusal kullanım provası” olabilir. Bu profil kaynak sistemine bağlanmaz. Duraklatılmış profil aktarım kabul etmez.

Ardından **Güvenlik olayları → JSON içe aktar** ile profili seçin. “Olay dizisi” alanı bir JSON dizisi ister. Aşağıdaki kurgusal örnek yalnız kullanım provası içindir; gerçek kullanımda kaynaktan alınmış kayıt alanlarını girin:

```json
[
  {
    "externalId": "deneme-20261001-001",
    "occurredAt": "2026-10-01T09:15:00Z",
    "category": "authentication",
    "severity": "high",
    "title": "Deneme hesabında tekrarlanan başarısız giriş",
    "summary": "Kurgusal inceleme örneği; gerçek kullanıcı olayı değildir.",
    "subject": "TEST\\deneme.hesabi",
    "device": "TEST-PC-01",
    "sourceIp": "192.0.2.10",
    "originProduct": "Kurgusal kaynak",
    "originEventId": "test-001"
  }
]
```

`occurredAt` kaynak olayının tarihidir; ISO/RFC3339 biçimi kullanılır. Tek aktarım 1–100 normalize edilmiş olay kabul eder; ham üretici logu, e-posta gövdesi veya bilinmeyen alanlar ayrıştırılmaz. Arayüz hedef bağlantıyı kendisi ekler; bu kutuya ayrıca `connectionId`/`events` içeren bir üst nesne yapıştırmayın.

Başarıda eklenen ve yinelenen kayıt sayıları görünür. Aynı kaynakta aynı `externalId` ve aynı içerik tekrar gönderilirse ikinci olay oluşmaz. Aynı kimlikle farklı içerik gönderilirse aktarım çakışma ile reddedilir; kayıt sessizce üzerine yazılmaz.

Bu örnekte `entityId` bulunmadığından olay varlıkla eşleştirilmez. Hesap adı, cihaz veya IP'den otomatik kişi eşleşmesi yapılmaz. Mevcut varlığın gerçek UUID'si açıkça `entityId` olarak verilirse ilişki yine **aday** olur. Bu teknik alanın sözleşmesi [API-CONTRACT.md](API-CONTRACT.md#03-source-configuration-and-normalized-import) içindedir.

Üyeliğe olay iliştirmek istediğinizde olayın açık aday varlık kimliği o üyeliğin varlığıyla aynı olmalıdır. Bağımsız inceleme dosyası ise varlıkla eşleşmemiş bir olayı da insan seçimiyle iliştirebilir. Olay aktarımı grup üyeliği veya dosya oluşturmaz.

## 6. Uygulama içi bildirimi inceleyin

Yeni kabul edilen `high` veya `critical` olay, **Bildirimler** ekranında yönetici/analist için ortak bir inceleme bildirimi oluşturur. Diğer önem düzeyleri olay listesine girer; bu bildirim oluşturma kuralına girmez.

Bildirim ayrıntısını açın ve **Okundu işaretle** ile kendi okundu kaydınızı saklayın. Bir kişinin okuması diğer analistin okunmamış bilgisini kaldırmaz. Okundu durumu dosyanın incelendiği veya kapatıldığı anlamına gelmez.

Görünür ekranda otomatik yenileme uygulama içi bildirimleri ve kendi okunmamış sayınızı günceller. İşlem sürerken veya posta ayarı düzenlenirken otomatik yenileme bekler. Mevcut bildirim sayfası ve araması korunur; en yeni kayıtları görmek için ilk sayfayı açın. Bildirim sayısı, liste/uyarı üyelik sayısından ayrıdır; aynı üyelik için seçilen uyarı bir olay bildirimi oluşturmaz. Sayının değişmesi inceleme kararı değildir.

E-posta kanalı altında SMTP veya Microsoft Graph ayarı kaydedilebilir; mevcut sürüm dış gönderim yapmaz. Buradaki bildirim uygulama içindedir; e-posta veya Teams/sohbet teslimatı değildir.

## 7. Bağımsız inceleme dosyasıyla kararı kaydedin

**İnceleme dosyaları → Dosya oluştur** ile başlık, en az 10 karakterlik özet ve sorumlu kişi/ekip etiketini girin. Örneğin başlık “Deneme hesabının giriş kayıtları”, özet “Elle aktarılan giriş olaylarının ekip tarafından değerlendirilmesi”, sorumlu “İnceleme ekibi” olabilir. Dosya açık olarak oluşturulur; varlık veya grup üyeliği seçmeniz gerekmez.

Dosya ayrıntısında sırayla şu işlemleri yapabilirsiniz:

1. **Olay seç ve iliştir:** Kaynak olaylarını arayın, ilgili olayı elle seçin ve 10–1000 karakterlik iliştirme gerekçesi yazın. Birden fazla kaynak olayı aynı dosyada tutulabilir.
2. **İnceleme notu ekle:** 10–2000 karakterlik değerlendirme notunu kaydedin. Not dosyayı kapatmaz.
3. **Bilgileri düzenle:** Açık dosyanın başlık, özet ve sorumlusunu değiştirin.
4. **İlişkiyi gerekçeyle geri al:** Yanlış veya artık ilgili olmayan olay ilişkisinin geri alma gerekçesini yazın. Kaynak olay ve ilk iliştirme gerekçesi silinmez.
5. **Dosyayı kapat:** 10–2000 karakterlik karar gerekçesini yazın. Kapalı dosyanın bilgileri, notları ve olay ilişkileri değiştirilemez.
6. **Gerekçeyle yeniden aç:** Yeni değerlendirme gerektiğinde gerekçe ile dosyayı açın. Önceki kapanış kararı geçmişte kalır.

**Dosya etkinlikleri**, her işlemin aktörünü, zamanını, gerekçesini ve işlem öncesi/sonrası dosya görüntüsünü gösterir. Açık/Kapalı/Tümü filtreleri ve arama dosyayı tekrar bulmanızı sağlar. Listede gösterilen kayıt sayısı yalnız o sayfanın sayısıdır.

Dosya kararları ve üyelik takibi ayrı kayıtlardır. Dosyayı kapatmak, aynı kişinin üyeliğini kapatmaz; üyeliği kapatmak da dosyayı kapatmaz. Olayı iliştirmek kaynak, kimlik veya tehdit doğrulaması oluşturmaz.

## 8. Çakışma ve hatalarda taslağı koruyun

Başka bir kullanıcı aynı kaydı değiştirirse eski sürümle yazma reddedilir. Formdaki alanlar korunur; **Güncel dosyayı yükle** veya ilgili formun güncel kayıt yükleme işlemiyle sunucu kaydını açıkça alın. Güncel değerleri inceleyip taslağı yeniden değerlendirin. Arka plan yenilemesi sizin adınıza yeni sürümü kabul ederek taslağı göndermez.

Yükleme hatası, “kayıt yok” veya sıfır bildirim olarak gösterilmez. Hata alanındaki yeniden deneme işlemini kullanın. Oturum/rol erişimi sona ermişse tekrar yetkili hesabınızla giriş yapın. “Örnek çalışma alanı” hiçbir değişiklik kaydetmez.

## 9. İşlem günlüğünü kontrol edin

Yönetici olarak **İşlem günlüğü** ekranından kullanıcı, varlık, grup, üyelik, kaynak, olay aktarımı ve dosya işlemlerini inceleyin. Arama ve sayfalama ile ilgili yönetim eylemini bulun. Dosya/üyelik ayrıntısındaki etkinlik, o kaydın değerlendirme bağlamını verir; işlem günlüğü uygulama işlemlerini topluca gösterir.

İşlem ve ilgili geçmiş/denetim kaydı aynı veritabanı işlemiyle saklanır. Bu kayıtlar bağımsız değişmez bir kanıt deposu değildir. Kurumun ayrı arşivleme ve denetim gereksinimleri ayrıca ele alınır.

## 10. Şifreli yedek alın ve ayrı kopyaya geri yükleyin

Kurulum klasöründe, çalışan PostgreSQL ile:

```powershell
powershell -File scripts/backup.ps1
```

Betik kurtarma parolasını gizli istemde iki kez alır ve yeni klasörde `backup.age` üretir. Parolayı yedekten ayrı sır kasasında saklayın; kaybolursa yedek açılamaz. Parolayı açık komut, sohbet veya ortam değişkenine yazmayın. Yeni yedek için kaynak şema 12 tamamlanmış olmalıdır; şema 11 kaynakta önce eski 1.1.0 paketinin kendi yedek betiği kullanılır. Şema 3/0.3.0 için bu akış doğrulanmış değildir.

Betik çıktısındaki yedek klasörünü kullanarak kurtarma provasını yapın:

```powershell
powershell -File scripts/restore-copy.ps1 -BackupDirectory 'runtime/backups/vigil-<çıktıdaki-paket-adı>'
```

Şifreli dosya için aynı kurtarma parolası istenir. Geri yükleme yalnız yeni `vigil_restore_...` veritabanı oluşturur; mevcut hedefin üzerine yazmaz. Ürün, arşiv hashleri, göç defteri, gerekli tablolar ve sıfır oturum sayısı doğrulanır. Ana `vigil` veritabanı ve uygulamanın bağlantısı değişmez; geri yüklenen kopyanın uygulamaya bağlanması ayrı bir kurtarma işlemidir.

Şema 11/12 yedekleri desteklenir; şema 11 kopyası kendiliğinden yükseltilmez. Oturum verileri yedeğe girmez. Normal dosya temizliği diskte güvenli silme değildir. SecureString/SecretManagement örnekleri, şifresiz legacy biçim ve prova ayrıntıları [YEDEKLEME.md](YEDEKLEME.md) içindedir.

## 11. Pano, komut paleti, tema ve CSV

**Pano** girişten sonra açılan ilk ekrandır. Üstteki beş kutu varlık, etkin üyelik, kırmızı öncelik, işlem bekleyen inceleme ve açık dosya sayılarını gösterir; kutuya tıklamak ilgili listeyi açar. Olay grafiği son 14 UTC gününü olay zamanına göre sayar; çubuğun üzerine gelince önem kırılımı görünür. İnceleme takviminde geciken, bugün, süresi dolmuş ve 7 gün içindeki üyelikler doğrudan iş listesine götürür. Sayılar üyelik satırlarıdır; kişi sayısı veya risk puanı değildir.

**Komut paleti** için `Ctrl+K` tuşlayın veya üst çubuktaki **Komutlar** düğmesini kullanın. Sayfa adı yazarak geçiş yapın; varlık adı, tanımlayıcı, grup veya gerekçe yazarak kaydı açın. En az 3 karakterlik bir ifadeyle **Olaylarda ara**, **Dosyalarda ara**, **Bildirimlerde ara** veya (yöneticiyseniz) **İşlem günlüğünde ara** seçenekleri ilgili ekranı aramayla açar. Yeni varlık/grup/üyelik ve tema değiştirme de buradan yapılır. Ok tuşlarıyla seçip Enter ile açın; Escape kapatır.

**Tema** üst çubuktaki ekran simgesiyle Sistem → Açık → Koyu sırasıyla değişir. Tercih yalnız bu tarayıcıda saklanır.

**CSV dışa aktarma** Varlıklar, İnceleme üyelikleri, Güvenlik olayları, İnceleme dosyaları ve (yönetici) İşlem günlüğü ekranlarındaki **CSV dışa aktar** düğmesiyle yapılır. Olay, dosya ve işlem günlüğü dosyaları ekranda uygulanmış arama ve filtreleri kullanır; arama henüz uygulanmamışsa düğme bekler. Dosya UTF-8, noktalı virgül ayraçlıdır ve Türkçe Excel'de doğrudan açılır. Bir dosya en fazla 10.000 satır içerir; fazlası için filtreyi daraltmanız istenir ve eksik dosya üretilmez. Her dışa aktarma işlem günlüğüne kaydedilir. İndirilen dosya artık Vigil'in erişim denetimi dışındadır; kurum kurallarına göre saklayın.

## Günlük çalışma düzeni

| Ne takip ediyorsunuz? | Açacağınız ekran ve yapacağınız işlem |
| --- | --- |
| Ekranlar arasında genel inceleme yükü | Üst çubuktaki Uyarılar: üyelik uyarı toplamını ve kişisel okunmamış bildirimleri ayrı inceleyin. |
| Açık kırmızı veya sarı takip kayıtları | Listeler ve uyarılar: ilgili renk listesini açın; tarihler ve gerekçeyle üyelik satırını inceleyin. |
| Süresi dolan veya incelemesi gelen takip | Listeler ve uyarılar: uyarıları açın, ilgili üyelikte gerekçeli devam/kapat kararı kaydedin. |
| Yeni kaynak kaydı | Yönetici: normalize JSON aktarın; analist: olayları/bildirimleri inceleyin. |
| Birden fazla olayın birlikte değerlendirilmesi | İnceleme dosyaları: olayları elle iliştirin, not ve gerekçeli karar kaydedin. |
| Bir işlemin kim tarafından yapıldığı | Kayıt etkinliği; yönetici için ayrıca İşlem günlüğü. |
| Verinin geri getirilebilmesi | Şifreli yedek ve ayrı veritabanına geri yükleme provası. |

Canlı LDAP/AD, WEF, Palo Alto, Logsign veya Trend toplayıcısı; otomatik tehdit kararı; hesap/ağ engelleme; dış SMTP/Graph teslimatı ve üretim HTTPS/SSO/MFA bu sürümde uygulanmaz. Kaynak profili bir hazırlık kaydıdır. Ürün yerel loopback adresinde çalışır; yerel sentetik kabul, kurum entegrasyonu veya üretim kabulü değildir.
