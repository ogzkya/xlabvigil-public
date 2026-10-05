# Şifreli yerel yedek ve ayrı geri yükleme kopyası

Vigil 1.2.0 yedekleri varsayılan olarak kurtarma parolasıyla şifreler. Yeni yedek oluşturmak için Windows x64, PowerShell 5.1 veya üzeri, çalışan Docker Desktop `database` servisi ve tamamlanmış Vigil göç 1–12 gerekir. Geri yüklemede tamamlanmış şema 11 ve 12 yedekleri desteklenir. Teslim paketindeki `runtime/vigil-backup.exe` şifreleme yardımcısı kullanılır; ayrıca age CLI kurulması gerekmez.

## Yedek oluşturma

Kurulum klasöründe çalıştırın:

```powershell
powershell -File scripts/backup.ps1
```

Betik kurtarma parolasını ekranda göstermeden iki kez ister. Tek satırda 12–1024 UTF-8 bayt kabul edilir. Bu parola uygulama giriş parolası veya `.env` içindeki veritabanı parolası değildir. Uzun, rastgele üretilmiş ve başka yerde kullanılmayan bir kurtarma parolası seçin; kurumun onaylı sır kasasında yedekten ayrı saklayın. **Kurtarma parolası kaybolursa şifreli yedek açılamaz.** Parolayı sohbet, destek kaydı, açık komut metni veya ortam değişkenine yazmayın.

Her çalışma `runtime/backups/vigil-<UTC-zaman>-<benzersiz-kimlik>/` altında yeni bir dizin oluşturur. Başka bir yerel klasör için `-OutputDirectory 'D:\VigilBackups'` kullanılabilir. UNC/ağ paylaşımı yolları kabul edilmez. Paket dizininin Windows izinleri işlemi yapan kullanıcıya kısıtlanır; önceki yedeklerin üzerine yazılmaz.

Varsayılan çıktıda saklanacak dosya **`backup.age`** olur. PostgreSQL custom-format `database.dump` ve ürün, UTC zaman, PostgreSQL sürümü, göç defteri, dosya boyutu/SHA-256 bilgilerini taşıyan `metadata.json`, standart tar arşivi içinde birlikte şifrelenir. Parola Go yardımcısına standart giriş üzerinden iletilir; subprocess argümanına, ortam değişkenine veya işlem günlüğüne yazılmaz.

age v1 biçiminin `scrypt` parola alıcısı kullanılır. Bu biçim parola ile anahtar türetme ve şifreli içeriğin bütünlük doğrulamasını tanımlar. [Resmî age biçim tanımı](https://age-encryption.org/v1) ve [Go scrypt alıcısı](https://pkg.go.dev/filippo.io/age#ScryptRecipient) uygulamanın dayanağıdır. `backup.age` Windows hesabına veya makinesine DPAPI ile bağlanmaz; kurtarma için doğru parola ve uyumlu age/arşiv işlemesi gerekir. Windows ACL dosyanın yerel erişimini korur, şifreli dosyanın taşınabilirliğiyle ayrı bir kontroldür.

## SecureString ile kullanım

Parolayı aynı PowerShell oturumunda güvenli istemden alıp betiğe verebilirsiniz:

```powershell
$backupPassphrase = Read-Host 'Vigil yedek kurtarma parolası' -AsSecureString
try {
    & .\scripts\backup.ps1 -Passphrase $backupPassphrase
} finally {
    $backupPassphrase.Dispose()
}
```

Önceden kurulmuş SecretManagement ve kayıtlı kurum kasası varsa parolayı göstermeden alın:

```powershell
$backupPassphrase = Get-Secret -Name 'VigilBackupPassphrase' -Vault 'KurumKasasi'
if ($backupPassphrase -isnot [Security.SecureString]) {
    throw 'Kasa bu sır için SecureString döndürmelidir.'
}
try {
    & .\scripts\backup.ps1 -Passphrase $backupPassphrase
} finally {
    $backupPassphrase.Dispose()
}
```

`Get-Secret` metin sırlarını varsayılan olarak SecureString döndürür; bu akışta `-AsPlainText` kullanılmaz. [Microsoft Get-Secret belgesi](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.secretmanagement/get-secret?view=ps-modules). SecureString nesnesini geçirmek için örneklerdeki `&` çağrısını aynı oturumda kullanın. Yeni bir `powershell -File` veya `pwsh -File` sürecine SecureString parametresi taşımaya çalışmayın. SecureString ve standart giriş kullanımı parolanın çalışma sırasında bellekte hiç açılmadığı anlamına gelmez.

## Yedeğin kapsamı ve geçici dosyalar

Yedek; varlıkları, grupları, üyelikleri, bağımsız inceleme dosyalarını ve dosyaların olay referansları/kayıt anı görüntülerini, yerel kullanıcı/parola hashlerini, olayları, inceleme geçmişini ve kaynak/bildirim ayarlarını kapsar. Oturum tablosunun verisi dışarıda bırakılır; kopya üzerinden uygulama açıldığında yeni giriş gerekir. `.env`, veritabanı parolası, uygulama dosyaları ve kurum sistemleri bu veritabanı yedeğine dahil değildir.

`pg_dump` kapsayıcıdaki geçici dosyaya yazar; `docker cp` binary dosyayı taşır. PowerShell metin yönlendirmesi kullanılmaz. Şifreleme ve geri yükleme sırasında açık `database.dump` ve `metadata.json`, kullanıcıya özel Windows geçici dizininde ve kapsayıcıdaki özel geçici alanda işlenir; işlem sonunda temizlenir. Temizleme hatasında betik tamamlanmış sayılmaz. Uyarıda belirtilen `runtime/vigil-backup-plaintext-...`, `runtime/vigil-restore-plaintext-...` veya kapsayıcı geçici alanını ayrıca inceleyin; şifreli dosyanın oluşması temizliğin tamamlandığını tek başına göstermez. Dosya silme, diskte güvenli silme veya bellek/disk adli kurtarmasına karşı güvence değildir. Disk şifrelemesi ve kurumun depolama politikası ayrıca uygulanmalıdır. Süreç veya makine zorla kapanırsa geçici dosyalar kalabilir; yeniden çalıştırmadan önce korunmuş geçici alanları inceleyin.

## Ayrı veritabanına geri yükleme

```powershell
powershell -File scripts/restore-copy.ps1 -BackupDirectory 'runtime/backups/vigil-<paket-adı>'
```

Betik yedek dizinindeki biçimi otomatik algılar. `backup.age` için kurtarma parolasını gizli istemle alır; aynı oturumdaki SecureString, `-Passphrase $backupPassphrase` ile de verilebilir. Aynı dizinde `backup.age` ile açık `database.dump` veya `metadata.json` birlikte bulunursa belirsiz biçim reddedilir. Şifreli arşivin tamamı, tar içeriği ve dump boyutu/SHA-256 değeri doğrulandıktan sonra yeni `vigil_restore_<UTC-zaman>_<benzersiz-kimlik>` veritabanı oluşturulur. Yanlış parola veya hasarlı/eksik arşiv ön doğrulamada reddedilir.

İsteğe bağlı `-TargetDatabase vigil_restore_prova_20261003` verilebilir. Ad yalnızca bu ön eki, küçük harfleri, rakamları ve alt çizgiyi kabul eder; en fazla 63 karakterdir. Hedef zaten varsa işlem reddedilir. Ana `vigil`, `postgres` ve başka ürün veritabanları hedef seçilemez.

`pg_restore --single-transaction --exit-on-error` yalnız yeni veritabanına uygulanır. `--create` veya `--clean` kullanılmaz. Ardından ürün adı, yabancı ürün işaretlerinin yokluğu, gerekli tablolar, `pg_trgm`, arşivin şemasına göre tam 1–11 veya 1–12 göç defteri ve her göç checksumunun yedek metaverisiyle eşleşmesi denetlenir. Şema 12 için `investigation_cases`, `case_history` ve `case_event_evidence` tabloları da gerekir; şema 11 kopyasında bu tablolar sorgulanmaz. Oturum sayısı sıfır olmalıdır. Başarılı çalışma yeni bir `runtime/restore-reports/` JSON kaydı oluşturur; gerçek şema sürümü, göç defteri, sıfır oturum sayısı ve kullanılan yedeğin şifreli olup olmadığı da kayıtta belirtilir.

Vigil 1.1.0 ile alınmış tamamlanmış şema 11 yedeği, şifreli veya legacy biçimiyle ayrı kopyaya geri yüklenebilir. Kopya şema 11 olarak korunur; geri yükleme betiği göç çalıştırmaz ve yeni dosya tablolarını eklemez. Uygun uygulama sürümüyle yapılacak sonraki başlangıç/yükseltme ayrı olarak planlanır. Bu uyumluluk şema 12 yükseltmesinin veya 1.2.0 dosya işlevlerinin doğrulandığı anlamına gelmez. Yeni 1.2.0 yedeği için kaynak veritabanının uygulama başlangıcında şema 12'ye tamamlanmış olması gerekir; şema 11 kaynak bu betikle yedeklenmez, önceki sürümün yedek betiği güncelleme öncesi kullanılabilir.

Ana `vigil` veritabanı ve uygulamanın bağlantı ayarı korunur. Oluşturulmuş kopya otomatik silinmez; geri yükleme veya son doğrulama başarısızsa kopya inceleme için kalır ve kullanıma kabul edilmez. Uygulamayı kopyaya geçirmek ayrı, planlı bir kurtarma işlemidir. Yalnız kendi Vigil kurulumunuzdan üretilmiş, güvenilir yerde tutulmuş yedekleri açın; PostgreSQL arşivi geri yüklenirken SQL çalıştırır. [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html) ve [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html).

## Eski şifresiz biçim

Eski `database.dump` + `metadata.json` paketleri geri yükleme tarafından algılanır. Bu biçimde `-Passphrase` verilmez; boyut, SHA-256, ürün ve göç kontrolleri sürer. Yeni şifresiz yedek yalnız açık seçimle oluşturulur:

```powershell
powershell -File scripts/backup.ps1 -Unencrypted
```

`-Unencrypted` ile `-Passphrase` birlikte kullanılamaz. Legacy pakette iki dosya birlikte saklanmalıdır. Bu dosyalar şifreli değildir; kullanıcı ACL'si ve kurumun onaylı şifreli depolaması gerekir. SHA-256 değişikliği saptar; gizlilik veya yayıncı imzası sağlamaz.

| Seçim | Tamamlanmış yedekte saklanan çıktı | Geri yükleme parolası |
| --- | --- | --- |
| Varsayılan | `backup.age` | Gerekir |
| `-Unencrypted` veya eski paket | `database.dump` ve `metadata.json` | Kullanılmaz |

Betik başarısı ve beklenen çıktı birlikte kontrol edilmelidir. Yalnız `.partial` dosyası, eksik legacy eş dosya veya yarım çalışma tamamlanmış yedek sayılmaz. Şifreli ve açık biçimleri aynı dizinde karıştırmayın. Başarı mesajından sonra yerel kopyayı açma ve örnek kayıt karşılaştırmasıyla kurtarma provasını tamamlayın.

## Kabul kapsamı

Kabul; ayrı sentetik PostgreSQL üzerinde şifreli yedek → yeni kopyaya geri yükleme → ürün/şema/kayıt karşılaştırması, yanlış parola, bozulmuş/kesilmiş arşiv, mevcut hedefin korunması ve legacy uyumluluğunu kapsar. Geçici açık dosyaların normal başarı ve hata yollarında temizlenmesi ayrıca gözlenir. Çalıştırılan kontroller ve sonuçları [DEVIR.md](DEVIR.md) içinde kaydedilir; burada tarif edilen davranışlar tek başına başarılı kabul kanıtı değildir.

Bu akış için bağımsız kriptografi denetimi veya üretim felaket kurtarma kabulü iddiası yoktur. Otomatik saklama politikası, kurum entegrasyonları ve sunucu arızası tatbikatı ayrı kapsamdır.
