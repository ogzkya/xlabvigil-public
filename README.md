# XLab Vigil

Kurum içindeki personel, hesap, cihaz ve uygulama kayıtları, inceleme grupları ve bağımsız inceleme dosyaları için web uygulaması. Go + React/TypeScript + PostgreSQL. Kaynak sürümü **1.4.0**; kabul edilmiş son Windows paketi 1.3.5.

İlk kurulumdan günlük inceleme, olay aktarımı, dosya kararı ve yedekten dönüşe kadar adımlar: [Kullanım rehberi](docs/KULLANIM.md).

## Ürün kapsamı

- Kurumsal yenilenmiş arayüz: bölümlü menü, açık/koyu/sistem teması, ilk ekranda öncelik dağılımı, inceleme takvimi ve 14 günlük olay grafiği olan pano.
- `Ctrl+K` komut paleti: sayfalar arası geçiş, varlık/üyelik/grup arama, olay/dosya/bildirim/işlem günlüğünde sunucu araması, hızlı oluşturma ve tema seçimi.
- Varlık, üyelik, olay, dosya ve işlem günlüğü için uygulanan filtrelerle CSV dışa aktarma (UTF-8, `;`, en fazla 10.000 satır, formül enjeksiyonuna karşı korumalı); her dışa aktarma işlem günlüğüne yazılır.
- İlk yönetici kurulumu ve ayrı Vigil oturumu; varsayılan hesap yok.
- Yönetici tarafından yerel kullanıcı oluşturma, rol ve etkinlik yönetimi; tek tek oturum iptali ve son etkin yöneticinin korunması.
- Mevcut parola doğrulamasıyla öz hizmet parola değişikliği; diğer oturumların iptali.
- Personel, hesap, cihaz, servis ve uygulama varlıkları; aday kimlik bilgisi ve personel ilişkisi.
- Sarı, turuncu, kırmızı ve özel gruplar; bir varlığın birden fazla gruba üyeliği.
- Üyelik gerekçesi, sorumlu, başlangıç/bitiş/gözden geçirme tarihleri, kapatma ve geçmiş.
- Gerekçeli devam/kapat kararları, son karar bağlamı, UTC takvimli inceleme iş listesi ve birleşik etkinlik geçmişi.
- Doğrudan kırmızı/sarı açık üyelik listeleri; süresi dolmuş, inceleme tarihi gelmiş, etkin kırmızı ve yedi gün içinde incelenecek üyelikler için öncelikli uyarılar. Sayılar üyelik satırlarıdır; benzersiz kişi sayısı değildir.
- Liste genelinde varlık adı/tanımlayıcı, birim, grup, gerekçe ve sorumlu araması; varlık türü filtresi. Arama ve tür **Ara** ile uygulanır; sayaçlar ve sayfalar aynı kapsamı kullanır.
- Yönetici/analist için üst çubukta **Uyarılar** ve **Uyarı özeti**: tüm kapsamdaki üyelik inceleme uyarıları ile kişisel okunmamış kaynak bildirimleri ayrı gösterilir. Liste filtreleri genel özeti daraltmaz; güncelleme hatasında eski sayı güncelmiş gibi sunulmaz.
- Özetten bir uyarı türünü açınca liste araması/tür seçimi ve sayfalar temizlenir; tüm kapsamdaki seçili uyarı türüne geçilip uyarı başlığına odaklanılır. Liste içindeki tür değişimi mevcut arama kapsamını korur.
- Olayların incelemeye gerekçeyle iliştirilmesi ve geri alınması; aday kimlik bağlamı ayrı gösterilir.
- Bağımsız inceleme dosyası oluşturma/düzenleme, gerekçeli not, kapatma ve yeniden açma; olay referanslarını iliştirme/geri alma, sürümlü kayıt anı görüntüleri ve işlem geçmişi.
- Açık taslakları koruyan yenileme, sürüm çakışmasında güncel kaydı inceleme ve kaydedilmemiş formu kapatma onayı.
- Değişiklik sürümü kontrolü ve işlemle atomik denetim.
- LDAP/AD, Windows/WEF, Palo Alto, Logsign ve ayrı Trend Micro ürün profilleri için kalıcı kaynak tanımları; sürüm, kapsam, güvenli adres ve yalnız sır referansı.
- Ortak şemada yerel JSON olay aktarımı, aynı kaynak içinde tekilleştirme, filtrelenebilir/sayfalı olay akışı ve aday varlık ilişkisi.
- Yüksek/kritik olaylar için uygulama içi bildirimler ve kullanıcıya özel okundu bilgisi; görünür ekranda 30 saniyelik otomatik yenileme. Okundu işareti inceleme kararı değildir. SMTP/Microsoft Graph kanal hazırlık ayarları; dış gönderim henüz uygulanmadı.
- Tarayıcı belleğinde açıkça etiketli salt okunur örnek görünüm.
- Varsayılan age parola şifrelemeli yerel yedek, ayrı yeni veritabanına doğrulamalı geri yükleme ve eski şifresiz yedek uyumluluğu.

Canlı AD/WEF, VPN, SIEM, EDR veya başka kaynak bağlı değildir; zamanlanmış API çekimi, LDAP eşitlemesi ve Syslog dinleyicisi henüz uygulanmadı. Yapılandırma kaydı bağlantı kanıtı değildir. Olaylar yönetici tarafından yerel içe aktarılır; ham üretici logu ayrıştırılmaz. Otomatik risk kararı, hesap engelleme, e-posta teslimi veya ekip sohbeti uygulanmadı. Renk inceleme önceliğidir; bir kişinin tehdit olduğuna ilişkin karar değildir. İnceleme dosyaları insan kararlarını kaydeder; kapatma veya olay iliştirme dış kaynağın doğrulandığını göstermez. Bu sürümün risk kayıtları ve inceleme dosyaları admin/analyst rollerine açıktır; dosya/grup bazında daha dar erişim ve üretim SSO/MFA sonraki dilimlerdir.

## Windows üzerinde çalışma

Hazır Windows paketinde PowerShell 5.1 veya 7 ve Docker Desktop gerekir; Go/Node veya ayrı age kurulması gerekmez. Uygulama ve `runtime/vigil-backup.exe` şifreleme yardımcısı pakettedir. ZIP'i ayrı bir klasöre açıp aşağıdaki komutları o klasörde çalıştırın:

```powershell
powershell -File scripts/verify-package.ps1
powershell -File scripts/install.ps1
powershell -File scripts/start.ps1 -Background
```

Kaynak depodan geliştirme için ayrıca Go 1.27.1 ve Node.js 24 gerekir:

```powershell
cd xlabvigil
pwsh -File scripts/setup.ps1
pwsh -File scripts/start.ps1 -Background
```

Web: http://127.0.0.1:8320. Veritabanı: 127.0.0.1:55440. İlk yönetici hesabını uygulama üzerinden siz oluşturursunuz. Ayrı pilot için `start.ps1 -Port 8330 -DatabasePort 55441` gibi farklı portlar seçilebilir; HTTP yalnız `127.0.0.1` üzerinde 1024–65535 aralığında açılır. Ayrı kurulum klasörü, benzersiz `COMPOSE_PROJECT_NAME` ve ayrı DB portu kullanımı [pilot rehberinde](docs/PILOT.md) açıklanır.

Bu komutlar yeni kurulum içindir. Mevcut kurulumu aynı HTTP portu veya veritabanıyla yükseltirken eski hizmet kendi klasöründeki `stop.ps1` ile durdurulur. Bağımsız pilot ayrı HTTP/DB portları, klasör ve Compose projesi/hacmiyle eski hizmet korunarak açılabilir. Yeni paket çalışan hizmeti kendiliğinden güncellemez. Şema 11/12 için uygun eski sürümle yedek/ayrı geri dönüş doğrulaması yapılır; ana eski 0.3.0/şema 3 kurulumunun geçişi ayrı taşıma planı ve göç doğrulaması gerektirir. Ayrıntılar [yerel teslim belgesinde](docs/YEREL-TESLIM.md#güncelleme-ve-işletim) bulunur.

```powershell
pwsh -File scripts/check.ps1
pwsh -File scripts/stop.ps1
```

`check.ps1` varsayılan olarak yeni geçici PostgreSQL kapsayıcısı açar, testleri rastgele şemalarda çalıştırır ve kendi kapsayıcısını temizler. Ana `.env` ve veritabanını kullanmaz; atlanan test kabul başarısı sayılmaz. Arayüz çıktısı `runtime/qa/web-dist` altında kalır. `stop.ps1` bu klasörün executable yolu, PID ve başlangıç zamanı eşleşen uygulamasını durdurur; veritabanı korunur. Veritabanını durdurmak için bu klasörde `docker compose stop` kullanılabilir.

Doğrulama ve SHA-256 manifestli Windows ZIP paketi üretmek için `scripts/package.ps1` kullanın. Yeni paket ayrı çıktı dizininde derlenir; `.env`, kullanıcı kayıtları ve veritabanı dosyaları pakete girmez. Kurulum/güncelleme ve kapsam: [docs/YEREL-TESLIM.md](docs/YEREL-TESLIM.md). Yedek ve ayrı kopyaya dönüş: [docs/YEDEKLEME.md](docs/YEDEKLEME.md).

`scripts/backup.ps1` tamamlanmış şema 12 için gizli istemle kurtarma parolası alıp varsayılan olarak `backup.age` üretir. Parolayı yedekten ayrı kasada saklayın; kaybolursa yedek açılamaz. `restore-copy.ps1` şifreli ve eski paketleri algılar, tamamlanmış şema 11/12 yedeklerini yalnız yeni `vigil_restore_...` veritabanına geri yükler. Şema 11 kopyası otomatik yükseltilmez; uygulama bu kopyaya geçirilmez. Açık legacy yedek için `-Unencrypted` gerekir. SecureString/SecretManagement örnekleri ve geçici açık dosyaların temizleme sınırı yedek belgesindedir.

Vigil'in .env dosyası, veritabanı parolası, Compose projesi/ağı/hacmi ve vigil_session oturumu Nexus'tan ayrıdır. Nexus özel notları, kullanıcıları, oturumları veya kasa verileri buraya kopyalanmaz. Bağlantı ve bildirim formları gerçek parola/token yerine env:DEGISKEN_ADI referansı kabul eder; bu referanslar henüz çözümlenmez. Uygulama yalnızca loopback HTTP sınırında çalışır; üretim kurulumu değildir.

Geliştirme: [docs/DEVIR.md](docs/DEVIR.md). Sözleşme: [docs/API-CONTRACT.md](docs/API-CONTRACT.md). Tasarım: [docs/TASARIM-DILI.md](docs/TASARIM-DILI.md).

Resmî üretici belgeleri, API seçenekleri ve pilot planı: [docs/ENTEGRASYON-ARASTIRMASI.md](docs/ENTEGRASYON-ARASTIRMASI.md).
