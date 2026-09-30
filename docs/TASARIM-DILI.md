# XLab Vigil — tasarım dili

Kurum içi risk ve izleme çalışma alanı. XLab ailesinin sade tipografi ve bileşen dilini kullanır. Nötr beyaz/gri yüzey, koyu lacivert gezinme ve kontrollü Microsoft mavisi vurgu temel görsel düzendir. Sarı, turuncu ve kırmızı yalnız inceleme önceliği veya ilgili durum için kullanılır; tehdit sonucu anlamına gelmez.

## Ortak görsel kaynak

- `web/src/design-tokens.css` renk paleti ve anlamlı arayüz renklerinin, boşlukların, yazı ölçülerinin/ağırlıklarının, köşe yarıçaplarının ve temel gölgelerin tek kaynağıdır. `main.tsx` dosyası bunu ortak stillerden önce yükler.
- Sayfa ve bileşen stilleri bu değişkenleri kullanır. Yeni bileşenlerde doğrudan renk, aralık, yazı ölçüsü veya köşe değeri eklemek yerine önce ortak token ölçeği kullanılır; yeni bir ihtiyaç tekrar kullanılacaksa token eklenir.
- `--color-*` değişkenleri renkler için semantik arayüzdür. Eski `--palette-*` tanımları ve kullanımları kaldırıldı; bileşenler ham renk adlarına bağlanmaz.
- Fluent 2'nin global ve semantik token ayrımı izlenir: temel değerler `--base-*` içinde, bileşenlerin kullandığı renk rolleri `--color-*` içindedir. `npm run check:design` eksik/kullanılmayan tokenları, token dosyası dışındaki ham renkleri, eski palet tanımını ve hatalı gölge bileşimini reddeder. [Fluent 2 token rehberi](https://fluent2.microsoft.design/design-tokens) ve [renk rehberi](https://fluent2.microsoft.design/color) temel alınır.
- Ortak `styles.css`, temel kontroller, butonlar, paneller, tablolar, açılır katmanlar ve modal davranışını taşır. Sayfa özelinde ayrı renk paleti oluşturulmaz.
- `components.tsx`, uygulamanın ortak görsel ve etkileşim durumlarını sunar: `Badge`, `Loading`, `Empty`, `FormError`, `LoadError`, `InlineError` ve `SuccessNotice`. Bir ekran bu bileşenlere kendi başlık/metnini ve kendi isteğinin yeniden deneme işlevini verir; ortak bileşenler alan verisini veya istek yaşam döngüsünü sahiplenmez.
- `resource.ts`, kaynak, olay, bildirim, denetim ve kullanıcı listesi isteklerinin yükleme/hata/yeniden deneme akışını taşır. Yeni istek veya sayfadan ayrılma, eski yanıtın görünümü değiştirmesini engeller; sayfalı arama ekranları yanıtın geçerli filtre isteğine ait olmasını bekler.
- `listSearch.ts`, olay, bildirim ve işlem günlüğünün ortak 3–120 karakter eşiğini, kısa bekleme süresini ve sorgu değişince sayfa geçmişini sıfırlama çağrısını taşır. Aynı üst arama alanı bu ekranlarda tüm sunucu kayıtlarını; kurmaca önizlemede yalnız yerel örnekleri tarar.
- Temel buton, form kontrolü, panel, tablo ve hata stilleri semantik `--color-*` tokenlarına bağlanır. Özel durum görünümlerindeki mevcut renkler palet tokenlarıyla korunur; yeni ortak durumlar için semantik ad eklenir.
- Bilgi şeritleri arka plan, kenarlık ve metin için ayrı `--color-info-*` tokenları kullanır. Durum rengi metin mesajıyla birlikte gösterilir.
- Yükleniyor, boş, hata ve başarılı kayıt çağrılarının renkleri `--color-loading-*`, `--color-empty-*`, `--color-error-*` ve `--color-success-*` tokenlarıyla merkezi tutulur. Hata, boş sonuç gibi gösterilmez.
- Rozet renk sınıfları `web/src/design.ts` içindeki `BadgeTone` birleşim türüyle sınırlıdır. Önem düzeyi eşlemesi aynı türü kullanır; grupların inceleme önceliği renkleri ayrıca etiketle birlikte gösterilir.
- Grup ve üyelik kartlarının renkleri `--color-review-priority-*` değişkenlerindedir. Bu renkler inceleme önceliğini anlatır; kesin tehdit kararı olarak kullanılmaz.
- Kaynak profillerinde `Profil kaydedildi` nötr rozetle gösterilir; kayıt durumu canlı bağlantı sağlığı anlamına gelmez. Durum metni ve rozet tonu `operations.tsx` içindeki ortak eşlemeden gelir.
- Kaynak sağlayıcı işaretlerinin renkleri `--color-source-mark-*` tokenlarındadır. E-posta gönderim durumu yalnız ayar yanıtı yüklüyken “Gönderim kapalı” der; yükleme ve hata durumları nötr ve ayrı etiketlenir.
- Hesap ve oturum rozetleri `accountSessionStatusTone` üzerinden nötr, etkin ve uyarı durumlarına eşlenir. Etkin hesap olumlu durumu; kapalı hesap ve yapılandırılmamış ek doğrulama uyarıyı; kullanılmayan kurum dizini gibi yerel kapsam bilgileri nötr tonu kullanır. Etiketler renk olmadan da durumu açıklar; bu renkler tehdit kararı değildir.

## Olay verisi ve demo sınırı

- Kurgusal bağlantı, olay ve bildirim kayıtları yalnız `web/src/demoFixtures.ts` içindedir; gerçek çalışma alanının boş/hata durumunu doldurmak için kullanılmaz.
- Bu kayıtlar yalnız demo görünümünün salt okunur kaynak yedeği olarak verilir. Demo görünümündeyken JSON olay aktarımı açılamaz veya gönderilemez.
- Gerçek olay içe aktarım formu sentetik kayıt üretmez veya hazır örnek sunmaz. Form, kaynağınızdan alınmış olayları girmeniz gerektiğini belirtir. Uygulama içe aktarılan olayın dış kaynaktaki doğruluğunu tek başına kanıtlamaz.
- Varlık ve üyelik ayrıntısındaki `CandidateEvents` aynı sayfalı salt okunur görünümü kullanır. Liste yalnız varlığın açıkça girilmiş aday `entityId` ilişkisini gösterir; üyeliğe bağlı kanıt veya doğrulanmış kimlik ilişkisi olarak adlandırılmaz. Olay zamanı ve yerel kabul zamanı ayrı görünür. Boş, yükleniyor ve hata durumları ortak bileşenlerle gösterilir; kurmaca önizleme kendi yerel olaylarını filtreler.
- Bu düzen için [Microsoft Sentinel'in varlık/zaman çizelgesi bağlamı](https://learn.microsoft.com/en-us/azure/sentinel/incident-investigation) ve [Elastic Security'nin olay ve varlık inceleme bölümleri](https://www.elastic.co/docs/solutions/security/investigate/security-cases) referans alındı. [Elastic ECS zaman alanları](https://www.elastic.co/docs/reference/ecs/ecs-event) da kaynak zamanı ile merkezi sisteme geliş zamanını ayrı tanımlar; Vigil'in `occurredAt` ve `receivedAt` alanları bu ayrımı korur, tam ECS uyumluluğu iddia etmez. Ürünlerin otomatik vaka/kanıt kararları Vigil'e taşınmış sayılmaz.
- Üyelikte iliştirilmiş olaylar aday olay havuzundan ayrı bir bölümde görünür. Her ilişki kendi gerekçe, aktör, ekleme zamanı ve varsa geri alma gerekçesi/zamanıyla gösterilir; ilişki durumunu yalnız renkle anlatmayız. İliştirme/geri alma formları iç içe modal açmaz, mevcut modal içinde satır arası ilerler. Başarısız kayıt form taslağını korur; çakışma açık yeniden yükleme ister.
- Bu metaveri düzeni [Google SecOps CaseEvidence](https://docs.cloud.google.com/chronicle/docs/reference/rest/v1alpha/CaseEvidence) ve [Elastic Security Cases](https://www.elastic.co/docs/solutions/security/investigate/security-cases) örneklerinden yararlanır. Vigil'deki iliştirme analist seçimidir; kaynağın doğruluğunu veya üyeliğin risk sonucunu onaylamaz.
- Üyelik ayrıntısındaki `MembershipActivity`, oluşturma/güncelleme ile olay iliştirme/geri alma işlemlerini tek kronolojide sunar. İşlem adı, kişi ve işlem zamanı görünür; kaynak olay zamanı ayrıca etiketlenir. Tümü / Üyelik değişiklikleri / Olay ilişkileri filtresi sunucuda sayfalamadan önce uygulanır.
- Üyelikte değişen gerekçe, sorumlu, durum ve üç tarih alanı açık “Önce / Sonra” etiketleriyle okunur. Önceki sürüm sayfa dışında olsa da sunucudan gelir; bulunmuyorsa karşılaştırma eksikliği belirtilir. Zamanla hesaplanan etkinlik durumu bir kullanıcı değişikliği gibi çizilmez. İliştirme ve geri alma ayrı tarihsel işlemlerdir; sonraki geri alma, eski iliştirme satırının anlamını değiştirmez.
- Etkinlik listesi ortak `useResource`, `Loading`, `LoadError`, `Empty` ve `PageNavigation` kullanır. Filtre değişikliği ve başarılı olay işlemi ilk sayfaya döner; otomatik yenileme odağı taşımaz. Kurmaca olay ilişkileri `evidenceFixtures.ts` üzerinden hem ilişki listesine hem etkinlik akışına aynı kişi ve zamanlarla verilir; canlı hata/boş sonuç yerine kullanılmaz.
- Bu uyarlama [Microsoft Sentinel etkinlik günlüğü](https://learn.microsoft.com/en-us/azure/sentinel/investigate-incidents#audit-incident-events-and-add-comments), [Elastic etkinlik akışı](https://www.elastic.co/docs/explore-analyze/cases/manage-cases#filter-activity-feed) ve [sayfalı etkinlik API'si](https://www.elastic.co/docs/api/doc/kibana/operation/operation-findcaseactivitydefaultspace) örneklerine dayanır. Vigil'in birleşik görünümü mevcut uygulama kayıtlarını okur; bağımsız değişmez arşiv veya kaynak doğrulama garantisi vermez.

- Ana gezinme: genel bakış, varlıklar, gruplar, üyelikler, kaynaklar, denetim, ayarlar.
- Kırmızı/sarı/turuncu durumlar metin etiketiyle gösterilir. Grup rengi kişi hakkında kesin tehdit kararı değildir.
- Aday kimlik ilişkisi doğrulanmış gibi gösterilmez. Manuel gerekçe gerçek kaynak olayı değildir.
- Kaynak kataloğu başlangıçta bağlantısızdır. Kaynak eksikliği sıfır olay veya güvenli durum olarak çizilmez.
- Salt okunur kurmaca önizleme her sayfada görünür; gerçek çalışma alanı ayrı ve boş başlar.
- Yükleniyor, hata/yeniden dene, boş ve dolu görünümler ayrıdır.
- Üyelik tarihleri açık etiketlidir; UTC gün sınırı belirtilir. Süresi biten veya kapalı üyelik geçmişte korunur.
- Mobil ve kısa masaüstü yükseklikleri kontrol edilir. Menü/modaller Escape, odak dönüşü, odak kapanı ve inert arka plan kullanır.
- Form hataları kullanıcı girişini korur; kaydetme sırasında çift gönderim engellenir.
- Not, proje ve şifre kasası modülleri XLab Nexus'a aittir.

## 0.3 kaynak, olay ve bildirim çalışma alanı

Material 3'ün uyarlanabilir liste/ayrıntı düzeni ile Fluent 2'nin çekmece, mesaj çubuğu ve görev odaklı hiyerarşi ilkeleri referans alınır; Vigil'in lacivert/yeşil-mavi kimliği korunur. Marka arayüzü kopyalanmaz. Kaynak kartlarından yapılandırmaya, filtreli olay listesinden kanıt ayrıntısına ve kişisel okundu bilgisine doğrudan erişilir.

- Kaynak kataloğu, kaydedilmiş yapılandırma ve alınmış olay ayrı anlamlardır. `Yapılandırıldı` bağlantı başarısı değildir; kaynak yoksa yeşil sağlık göstergesi kullanılmaz.
- Olayın kaynak zamanı, alınma zamanı, manuel aktarım kökeni ve aday kimlik ilişkisi ayrıntıda görünür. Olay önem düzeyi ile personelin grup rengi ayrı tutulur.
- Gerçek olay, bildirim ve işlem günlüğü araması sunucuda sayfalamadan önce uygulanır; sorgu değişince imleç başa döner. Olayda kaynak/önem, bildirimde kişisel okunmamış filtresi de sunucu tarafındadır. Üç karakterden kısa ifade için açıklama, istek ve arama sürerken yükleme, başarısız istekte hata/yeniden dene, başarılı boş sonuçta boş durum görünür. Kurmaca önizleme kendi yerel kayıtlarını filtreler. Sayfalama ve yeni veri için yenileme açıktır.
- Kaynak, olay ve bildirim sayfaları kendi yüklenme/hata durumlarını taşır; başarısız kaynak çağrısı varlık veya grup kayıtlarını gizlemez.
- Bildirimler güvenlik olayı mesajlarıdır; ekip sohbeti değildir. E-posta ayarlarında gönderimin kapalı olduğu açıkça gösterilir.

Kaynaklar: [Material 3](https://m3.material.io/), [Fluent 2](https://fluent2.microsoft.design/), ayrıntılı tasarım referansları [araştırma belgesinde](ENTEGRASYON-ARASTIRMASI.md).

## 0.4 yerel kullanıcı yönetimi

- Kullanıcı ve rol yönetimi yöneticiye özel bir alandır. Etkinlik durumu metin etiketiyle gösterilir; kapalı hesapların oturumları iptal edilir.
- Son etkin yönetici korunur ve yönetici kendi rolünü veya hesabının etkinliğini değiştiremez.
- Rol seçimi yerel uygulama yetkisidir; SSO/MFA bağlantısı veya kurum dizini doğrulaması olarak sunulmaz.
- Her roldeki yerel kullanıcı `Hesabım` alanından mevcut parolasıyla parola değiştirir; geçerli oturum açık kalırken diğer oturumlar kapatılır. Örnek kullanıcıda bu işlem kapalıdır.
- Yönetici, kendi dışındaki etkin bir hesabın oturumlarını hesap rolünü değiştirmeden ayrıca kapatabilir; işlem onay penceresinde açıkça anlatılır.

## 0.13 hesap ve oturum durumları

- Hesap yönetimi ve Hesabım kartları aynı nötr/etkin/uyarı rozet sözleşmesini kullanır. `design.ts` ton eşlemesini, `design-tokens.css` renk değerlerini, `styles.css` görünümü tanımlar.
- Etkin hesap etkin, kapalı hesap uyarı tonundadır. Henüz yapılandırılmamış MFA/ikinci doğrulama uyarı, kurum dizininin yerel hesaba bağlı olmaması nötr durumdur.
- Durum metinleri renklerden bağımsız olarak görünür; uyarı tonu kesin tehdit veya ihlal anlamına gelmez.

## 0.14 ortak durum geri bildirimi

- Tam alan hataları `components.tsx` içindeki `LoadError`, dar alandaki bağımsız hata ve yeniden deneme `InlineError` ile gösterilir. Her ikisi ortak hata renk tokenlarını ve erişilebilir uyarı rolünü kullanır.
- İşlem başarıları ortak `SuccessNotice` ile ve semantik başarı tokenlarıyla çizilir; parola değişimi gibi satır içi geri bildirim aynı bileşenin `inline` görünümünü kullanır.
- Uygulama başlangıcı, ana çalışma alanı, denetim, kullanıcı yönetimi, kaynaklar, olaylar ve bildirimler aynı tam hata panelini kullanır. Her ekran kendi yükleme verisini ve `onRetry` işlevini korur.
- Boş durum, hata durumu yerine kullanılmaz; başarısız yüklemede sayaç veya kayıt listesi boşmuş gibi gösterilmez.

## 0.15 ortak form hatası

- Form, modal ve eylem doğrulama hataları `FormError` ile aynı semantik hata yüzeyini ve `role="alert"` davranışını kullanır.
- Ekran kendi hata metnini ve gerekiyorsa içindeki düzeltme/yeniden deneme eylemini sağlar. Ortak bileşen mesajları değiştirmez veya hataları yutmaz.

## 0.16 ortak veri yenileme ve modal odağı

- `resource.ts` ortak istek kancasının sahibidir; kullanıcı listesi ve operasyon ekranları aynı istek nesli, yükleme, hata ve yeniden deneme davranışını kullanır.
- Ortak `Modal`, ilk etkin alanı seçer; etkin alan yoksa pencerenin kendisine odaklanır. Tab/Shift+Tab odağı pencereye geri alır; açılır olay ayrıntılarının `summary` odağı da aynı döngüye dahildir. Başlık ve varsa açıklama, pencereye özgü erişilebilir kimliklerle bağlanır.

## 0.17 sayfalı denetim görünümü

- İşlem günlüğü de olay ve bildirim ekranlarıyla aynı `useResource`, `Loading`, `LoadError`, `Empty`, panel, tablo ve sayfalama stillerini kullanır.
- Önceki/sonraki düğmeleri sunucunun verdiği imlece göre çalışır. Sayfa sayısı ve eşleşen kayıt sayısı yalnız gezilen/yüklenen sayfaları anlatır; toplam kayıt hacmi olarak sunulmaz.
- 0.22'de işlem günlüğü araması tüm sayfalara taşındı; görünen Türkçe işlem adları eşleşen işlem kodlarıyla sorgulanır. İşlem günlüğü uygulama işlemleridir; kaynak güvenlik olayı veya bağımsız değiştirilemez arşiv gibi gösterilmez.

## 0.18 ortak sayfalama denetimleri

- Olay, bildirim ve işlem günlüğü sayfaları aynı erişilebilir `PageNavigation` bileşenini ve dar ekranda sarılan ortak sayfalama düzenini kullanır.

## 0.19 bağlama göre yükleme mesajı

- Ortak `Loading` bileşeni aynı spinner ve `role="status"` görünümünü korurken sayfanın yüklediği veriyi açıkça adlandırır; varsayılan metin yalnız belirli bağlam olmadığında kullanılır.

## 0.20 ortak yenileme geri bildirimi

- Üst yenileme eylemi ana çalışma alanında ve operasyon sayfalarında aynı şekilde devre dışı kalır, dönen simgeyi ve “Yenileniyor…” etiketini gösterir.
- Operasyon ekranı yenilemeyi kendi tüm liste istekleri sonuçlandığında tamamlanmış sayar; birden fazla veri çağrısı olan sayfalar son isteğin bitmesini bekler.

## 0.26 gerekçeli gözden geçirme kararı

- Üyelik ayrıntısında “Gözden geçirmeyi kaydet” eylemi, aynı pencere içinde devam/kapat seçimi ve ayrı karar gerekçesi açar. Mevcut üyelik gerekçesi ve sorumlu gösterilmeye devam eder. Devam için UTC bugününden sonraki, üyelik aralığı içindeki takip günü açıkça seçilir; kapanışta yeni tarih istenmez.
- “Devam et” kararı bitiş tarihini kendiliğinden uzatmaz. İleri inceleme günü kalmadığında kullanıcı üyeliği kapatabilir veya üyelik bilgilerini ayrıca düzenleyebilir. Kapalı üyelik için yeni karar kaydı sunulmaz. Karar etiketleri inceleme sürecini anlatır; hesap erişimi ya da tehdit sonucu belirlemez.
- Gerekçe taslağı ve seçilen tarih hatada korunur. Sürüm çakışmasında otomatik yeniden gönderim yapılmaz; “Güncel kaydı yükle” yalnız ilgili üyeliği getirir ve taslağı tutar. Kapalı hale gelen üyelikte yeniden gönderim engellenir. Karar kaydedilirken pencerenin kapatma ve düzenleme geçişleri devre dışıdır.
- Başarılı yanıttaki üyelik, ana listedeki ve açık ayrıntıdaki aynı kaydı birlikte günceller; önceki isteğin eski sürümü geri getirmesi engellenir. Pencere açık kalır. Etkinlik akışı kararı, karar gerekçesini ve alan değişikliklerini tek satırda birleştirir; aynı karar ayrıca genel güncelleme olarak yinelenmez.
- Genel üyelik düzenlemesi hâlâ ayrı bir işlemdir. Durum veya tarih alanını düzenlemek, ayrı değerlendirme gerekçesiyle gözden geçirme kararı kaydedildiği anlamına gelmez. Arayüz bu işlemleri ayrı etiketlerle sunar.
- Ortak form, düğme, hata/başarı yüzeyleri ve semantik renk tokenları kullanılır. Demo salt okunur kalır. Bu uyarlama [Microsoft Sentinel kapanış açıklaması](https://learn.microsoft.com/en-us/azure/sentinel/incident-navigate-triage#close-an-incident), [Elastic kapanış nedeni](https://www.elastic.co/docs/solutions/security/investigate/security-cases#set-an-alert-closing-reason-when-closing-a-case) ve [Google SecOps tarihli takip görevleri](https://docs.cloud.google.com/chronicle/docs/soar/investigate/working-with-cases/manage-tasks-from-the-cases-screen) örneklerinden yararlanır; üyelik tarih kuralları Vigil'e özgüdür.

## 0.27 ortak inceleme takvimi ve iş listesi

- `reviewSchedule.ts` takvim kuralları ile etiket/rozet tonlarının ortak kaynağıdır. `ReviewQueueFilters` ve `ReviewScheduleBadge` ana ekran ile üyelik listesinin aynı tarih anlamlarını sunmasını sağlar. Tarih karşılaştırması bir görünüm çiziminde tek UTC günü kullanır; gün tarayıcı saatinden alınır. Üyeliğin etkinlik durumu ile inceleme takvimi ayrı anlamlardır.
- “İşlem bekleyen” gecikmiş, bugün gelen ve süresi dolduğu halde açık kalan kayıtları kapsar. “7 gün içinde” yarın ile bugün+7 arasındaki incelemeleri kapsar; bugün ayrı gösterilir. Kapatılmış üyelik bekleyen iş sayılmaz. Sürenin bitmesi üyeliği kapatmaz ve kendiliğinden bir inceleme kararı üretmez.
- Sayaçların kapsamı arama/grup filtreleriyle aynıdır. Ana ekran ilk dört bekleyen kaydı tarih sırasıyla gösterir; daha fazla kayıt varsa toplam ve kesit açıkça belirtilir. Liste bağlantısı aynı kapsamı açar. Renkler iş takvimini destekler; metin etiketi daima görünür. Yeni stiller `review-queue` öneki ve mevcut semantik tokenları kullanır.
- Son çalışma alanı yenilenemezse açık taslaklar bağlı kalır. Pencerelerin içindeki `WorkspaceRefreshNotice`, ortak `Loading`/`InlineError` ile durumu ve yeniden denemeyi gösterir. Kaydetme durdurulur; yazılmış alanlar silinmez. Ana ekran eski toplamları güncelmiş gibi sunmaz. Oturum/yetki kaybında eski veri ve modal seçimleri temizlenir.
- Kaynaklar: [Microsoft Entra inceleme listesi](https://learn.microsoft.com/en-us/entra/id-governance/perform-access-review), [Google SecOps görev takibi](https://docs.cloud.google.com/chronicle/docs/soar/investigate/working-with-cases/manage-tasks-from-the-cases-screen). Tarih sınıfları Vigil'in manuel inceleme kapsamına uyarlanmıştır.

## 0.29 nötr/mavi kabuk ve veri yenileme

- Ortak kabuk, giriş ve genel bakış nötr yüzey/koyu lacivert gezinme/ölçülü mavi vurgu rollerini `design-tokens.css` içinden alır. İş önceliği, olay önem derecesi ve sonuç renkleri marka vurgusundan ayrı kalır. [Fluent 2 renk ilkeleri](https://fluent2.microsoft.design/color) metni renk yanında tutmayı ve semantik rengi dekorasyon için kullanmamayı önerir.
- `web/scripts/check-design.mjs`, tanımsız CSS değişkenlerini, token dosyası dışındaki ham renkleri ve doğrudan `--palette-*` tanımı/kullanımını derleme öncesi reddeder. 142 doğrudan kullanım ve 308 eski palet tanımı kaldırıldı; ekran stilleri semantik `--color-*` rollerini kullanır. [Fluent 2 renk tokenları](https://fluent2.microsoft.design/color-tokens) ortak nötr, marka ve durum rolleri için örnektir.
- Üst Yenile operasyon ekranını yeniden oluşturmaz. Liste filtresi, imleç ve açık form taslağı mount'ta kalır; sonuç yalnız ilgili kaynak istekleri tamamlandığında üst düğmeye bildirilir. Ekran/oturum değişimindeki eski bildirim dikkate alınmaz.
- Gün ve zaman etiketleri ortak UTC gösterimine taşındı. Bu, UTC gününe göre hesaplanan inceleme kuyruğunun başlık ve ayrıntı zamanlarıyla aynı sınırı kullanmasını sağlar. Kaydedilmiş zamanın kaynak tarafından doğrulandığı anlamına gelmez.
- Mobil modal kapanışından sonra odak, `inert` durumunun kaldırılmasını izleyen karede açan kontrole döner. Filtre grupları açık grup rolü, bildirim okundu durumu ise renk dışında metin taşır. [Fluent 2 erişilebilirlik rehberi](https://fluent2.microsoft.design/accessibility) odak ve renk dışında anlamı vurgular.
- Liste/sayfa yanıtlarının temel biçimi doğrulanır; bozuk başarılı yanıt boş liste veya sıfır okunmamış bildirim gibi gösterilmez. Sürüm çakışmasında varlık, grup, üyelik, kaynak, kullanıcı ve posta ayarı formları taslağı tutar; güncel kayıt açıkça yüklenip incelenmeden eski sürümle yeniden kaydedilemez.

## 0.30 filtre kapsamına göre boş durum

- Üyelik listesinde hiç kayıt yoksa ilk oluşturma gereksinimi gösterilir. Kayıtlar arama veya grup filtresiyle gizlendiyse bu kapsam belirtilir ve filtreleri temizleme eylemi sunulur. Seçili durum ya da inceleme dönemi boşsa tüm üyeliklere dönüş önerilir; yeni kayıt oluşturma yanlış çözüm olarak sunulmaz. Görünen sayı toplam kayıt hacmi değil, mevcut filtrenin sonucudur.
- Varlık ve grup listelerinde kayıt bulunduğu halde arama/tür filtresi sonuç vermiyorsa temizleme eylemi gösterilir; ilk kurulum mesajı yalnız gerçekten boş koleksiyona aittir. Bu desen [Elastic Cases filtrelerinin](https://www.elastic.co/docs/explore-analyze/cases/manage-cases) tam listeye dönüş eyleminden yararlanır.
- Bilgi taşıyan metin ve etkileşimli kontrollerde en az 12px yazı kullanılır; 10–11px kalan etiketler dekoratif marka/nav ayrıntılarıyla sınırlıdır. [Fluent 2 web tipografi ölçeği](https://fluent2.microsoft.design/typography) 12px Caption 1 ve 14px Body 1 düzeylerini tanımlar. Dar ekranda sekmeler, filtreler, demo bandı ve modal eylemleri gerektiğinde satır kırar.


## 0.31 form taslağı ve veri sözleşmesi

- Koşullu alanlar gizlendiğinde form taslağı silinmez. Kaynak adresi ve gizli bilgi referansı sağlayıcı/taşıma çiftine aittir; başka yöntemin değerleri yeni yönteme kendiliğinden taşınmaz. Kaydetme yükü yalnız ekranda seçili yapılandırma alanlarından kurulur.
- API'den gelen başarılı koleksiyonlar yalnız dizi olmasına göre değerlendirilmez. Listeyi çizen alanlar ve kaynak kataloğunun izin verdiği sağlayıcı/taşıma eşleşmesi doğrulanır; eksik yanıt hata durumuna gider. Çakışma sonrası yeniden yüklemede taslak ve sunucudaki güncel değer yan yana incelenir, otomatik üzerine yazma yapılmaz.

## 0.32 sayfalı kayıtlar ve karar taslağı

- İşlem günlüğü, olay, olay referansı, etkinlik ve bildirim listeleri başarılı ama biçimi bozuk yanıtı gerçek boş durumdan ayırır. Kayıt alanları uçlarına göre doğrulanır; etiket katalogları tekrar edilmez. Boş ekran yalnız geçerli boş koleksiyon yanıtından çıkar.
- Gözden geçirme kararında gizlenen formun taslağı görünür Kaydedilmemiş taslak etiketi ve Taslağa dön eylemiyle sürer. Taslağı sil açık silme eylemidir; pencereyi kapatma veya düzenlemeye geçme öncesi silme onayı odak alır. Bu desen [Elastic Cases taslak ve etkinlik davranışından](https://www.elastic.co/docs/explore-analyze/cases/manage-cases) dar kapsamda uyarlandı. Karar erişim veya tehdit sonucu üretmez.
- Koyu gezinmede odak halkası --color-nav-focus ile ortak tokenlardan çözülür. Bu kontrolün rengi doğrudan bileşene yazılmaz; seçili ve normal gezinmede metin yanında görünür klavye geri bildirimi verir.
