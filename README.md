# XLab Vigil

Kurum içindeki personel, hesap, cihaz ve uygulama kayıtları ile risk ve izleme grupları için bağımsız web uygulaması. Go + React/TypeScript + PostgreSQL. Yerel geliştirme sürümü 0.4.0.

## İlk ayrımın kapsamı

- İlk yönetici kurulumu ve ayrı Vigil oturumu; varsayılan hesap yok.
- Yönetici tarafından yerel kullanıcı oluşturma, rol ve etkinlik yönetimi; tek tek oturum iptali ve son etkin yöneticinin korunması.
- Mevcut parola doğrulamasıyla öz hizmet parola değişikliği; diğer oturumların iptali.
- Personel, hesap, cihaz, servis ve uygulama varlıkları; aday kimlik bilgisi ve personel ilişkisi.
- Sarı, turuncu, kırmızı ve özel gruplar; bir varlığın birden fazla gruba üyeliği.
- Üyelik gerekçesi, sorumlu, başlangıç/bitiş/gözden geçirme tarihleri, kapatma ve geçmiş.
- Değişiklik sürümü kontrolü ve işlemle atomik denetim.
- LDAP/AD, Windows/WEF, Palo Alto, Logsign ve ayrı Trend Micro ürün profilleri için kalıcı kaynak tanımları; sürüm, kapsam, güvenli adres ve yalnız sır referansı.
- Ortak şemada yerel JSON olay aktarımı, aynı kaynak içinde tekilleştirme, filtrelenebilir/sayfalı olay akışı ve aday varlık ilişkisi.
- Yüksek/kritik olaylar için uygulama içi bildirimler ve kullanıcıya özel okundu bilgisi. SMTP/Microsoft Graph kanal hazırlık ayarları; dış gönderim henüz uygulanmadı.
- Tarayıcı belleğinde açıkça etiketli salt okunur örnek görünüm.

Canlı AD/WEF, VPN, SIEM, EDR veya başka kaynak bağlı değildir; zamanlanmış API çekimi, LDAP eşitlemesi ve Syslog dinleyicisi henüz uygulanmadı. Yapılandırma kaydı bağlantı kanıtı değildir. Olaylar yönetici tarafından yerel içe aktarılır; ham üretici logu ayrıştırılmaz. Otomatik risk kararı, hesap engelleme, e-posta teslimi veya ekip sohbeti uygulanmadı. Renk inceleme önceliğidir; bir kişinin tehdit olduğuna ilişkin karar değildir. Bu sürümün risk kayıtları admin/analyst rollerine açıktır; dosya/grup bazında daha dar erişim ve üretim SSO/MFA sonraki dilimlerdir.

## Windows üzerinde çalışma

PowerShell 7, Go toolchain, Node.js 24 ve Docker Desktop gerekir.

```powershell
cd xlabvigil
pwsh -File scripts/setup.ps1
pwsh -File scripts/start.ps1 -Background
```

Web: http://127.0.0.1:8320. Veritabanı: 127.0.0.1:55440. İlk yönetici hesabını uygulama üzerinden siz oluşturursunuz.

```powershell
pwsh -File scripts/check.ps1
pwsh -File scripts/stop.ps1
```

check.ps1 testleri veritabanında rastgele adlı geçici şemalarda çalıştırır; ana kayıtları kullanmaz. stop.ps1 yalnızca bu projenin executable yolu ve PID'si eşleşen uygulamayı durdurur; veritabanı korunur. Veritabanını durdurmak için bu klasörde docker compose stop kullanılabilir.

Vigil'in .env dosyası, veritabanı parolası, Compose projesi/ağı/hacmi ve vigil_session oturumu Nexus'tan ayrıdır. Nexus özel notları, kullanıcıları, oturumları veya kasa verileri buraya kopyalanmaz. Bağlantı ve bildirim formları gerçek parola/token yerine env:DEGISKEN_ADI referansı kabul eder; bu referanslar henüz çözümlenmez. Uygulama yalnızca loopback HTTP sınırında çalışır; üretim kurulumu değildir.

Geliştirme: [docs/DEVIR.md](docs/DEVIR.md). Sözleşme: [docs/API-CONTRACT.md](docs/API-CONTRACT.md). Tasarım: [docs/TASARIM-DILI.md](docs/TASARIM-DILI.md).

Resmî üretici belgeleri, API seçenekleri ve pilot planı: [docs/ENTEGRASYON-ARASTIRMASI.md](docs/ENTEGRASYON-ARASTIRMASI.md).
