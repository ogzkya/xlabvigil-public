param(
    [Parameter(Mandatory=$true)][string]$BackupDirectory,
    [string]$TargetDatabase,
    [Security.SecureString]$Passphrase
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'backup-crypto.ps1')
Assert-VigilPackage

$projectRoot = Get-VigilProjectRoot
Set-Location -LiteralPath $projectRoot
$null = Get-VigilDatabasePassword
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker bulunamadı.' }
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Bu geri yükleme betiği Windows dosya izinlerini gerektirir.' }
if ([string]::IsNullOrWhiteSpace($TargetDatabase)) {
    $TargetDatabase = 'vigil_restore_' + [DateTime]::UtcNow.ToString('yyyyMMdd_HHmmss') + '_' + [Guid]::NewGuid().ToString('N').Substring(0,12)
}
if ($TargetDatabase -cnotmatch '\Avigil_restore_[a-z0-9_]{1,49}\z') { throw 'Hedef yalnızca vigil_restore_ ile başlayan, en fazla 63 karakterlik küçük harf/rakam/alt çizgi içeren yeni bir veritabanı olabilir.' }
if ($BackupDirectory.StartsWith('\\')) { throw 'Bu yerel akış UNC/ağ paylaşımından arşiv okumaz; yerel bir yedek dizini seçin.' }
$backupRoot = (Resolve-Path -LiteralPath $BackupDirectory).ProviderPath
$backupItem = Get-Item -LiteralPath $backupRoot -Force
if (-not $backupItem.PSIsContainer -or ($backupItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Yedek kökü düzenli bir yerel dizin olmalıdır.' }
$ciphertextPath = Join-Path $backupRoot 'backup.age'
$encrypted = Test-Path -LiteralPath $ciphertextPath
if ($encrypted -and ((Test-Path -LiteralPath (Join-Path $backupRoot 'database.dump')) -or (Test-Path -LiteralPath (Join-Path $backupRoot 'metadata.json')))) { throw 'Yedek dizini şifreli ve şifresiz biçimleri birlikte içeriyor; belirsiz arşivden veritabanı oluşturulmadı.' }
if (-not $encrypted -and $PSBoundParameters.ContainsKey('Passphrase')) { throw 'Şifresiz arşiv için -Passphrase kullanılamaz; veritabanı oluşturulmadı.' }
$containerDirectory = $null
$createdTarget = $false
$plaintextDirectory = $null
$ownedPassphrase = $null
$temporaryRoot = Join-Path $projectRoot 'runtime'
$cryptoExecutable = Join-Path $temporaryRoot 'vigil-backup.exe'
try {
$plainRoot = $backupRoot
if ($encrypted) {
    $ciphertextItem = Get-Item -LiteralPath $ciphertextPath -Force
    if ($ciphertextItem.PSIsContainer -or ($ciphertextItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $ciphertextItem.Length -le 0) { throw 'backup.age düzenli ve boş olmayan bir dosya olmalıdır; veritabanı oluşturulmadı.' }
    if (-not (Test-Path -LiteralPath $cryptoExecutable -PathType Leaf)) { throw 'Şifreli yedek aracı bulunamadı. Önce kaynak depoda setup.ps1 veya teslim paketinde install.ps1 çalıştırın.' }
    $ownedPassphrase = Get-VigilBackupPassphrase -Passphrase $Passphrase
    New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
    $plaintextDirectory = New-VigilPrivateBackupDirectory (Join-Path $temporaryRoot ('vigil-restore-plaintext-' + [Guid]::NewGuid().ToString('N')))
    Invoke-VigilBackupCrypto -Executable $cryptoExecutable -Arguments @('decrypt', '--input', $ciphertextPath, '--output-dir', $plaintextDirectory) -Passphrase $ownedPassphrase
    $plainRoot = $plaintextDirectory
}
$dumpPath = Join-Path $plainRoot 'database.dump'
$metadataPath = Join-Path $plainRoot 'metadata.json'
if (-not (Test-Path -LiteralPath $dumpPath -PathType Leaf) -or -not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) { throw 'Yedek dizininde database.dump ve metadata.json birlikte bulunmalıdır.' }
foreach ($archivePath in @($dumpPath, $metadataPath)) {
    if (((Get-Item -LiteralPath $archivePath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Yedek dosyaları bağlantı veya yeniden ayrıştırma noktası olamaz; veritabanı oluşturulmadı.' }
}
if ((Get-Item -LiteralPath $metadataPath).Length -gt 65536) { throw 'Yedek metaverisi beklenen boyutu aşıyor.' }
$metadata = Get-Content -LiteralPath $metadataPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($metadata.formatVersion -ne 1 -or $metadata.product -ne 'XLab Vigil' -or $metadata.sourceDatabase -ne 'vigil' -or $metadata.format -ne 'postgresql-custom' -or $metadata.dumpFile -ne 'database.dump' -or $metadata.sessionDataIncluded -isnot [bool] -or $metadata.sessionDataIncluded -ne $false) { throw 'Bu dizin desteklenen Vigil yedek biçiminde değil.' }
$ledger = @($metadata.migrations)
if (($metadata.schemaVersion -isnot [int] -and $metadata.schemaVersion -isnot [long]) -or $metadata.schemaVersion -notin @(11,12) -or $ledger.Count -ne $metadata.schemaVersion) { throw 'Bu sürüm yalnızca tamamlanmış Vigil göç 1–11 veya 1–12 yedeğini kabul eder.' }
for ($index = 0; $index -lt $ledger.Count; $index++) {
    if ($ledger[$index].version -ne ($index + 1) -or $ledger[$index].checksum -cnotmatch '\A[0-9a-f]{64}\z') { throw 'Yedekteki göç defteri kesintili veya geçersiz.' }
}
if ($metadata.sha256 -cnotmatch '\A[0-9a-f]{64}\z' -or $metadata.dumpBytes -ne (Get-Item -LiteralPath $dumpPath).Length -or $metadata.sha256 -cne (Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'Yedek dosyasının boyutu veya SHA-256 değeri metaveriyle eşleşmiyor; veritabanı oluşturulmadı.' }

$exists = ((& docker compose exec -T database psql --username=vigil --dbname=postgres --no-password --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --command="SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='$TargetDatabase');") -join '').Trim()
if ($LASTEXITCODE -ne 0 -or $exists -cnotmatch '\A[tf]\z') { throw 'Hedef veritabanı durumu okunamadı.' }
if ($exists -eq 't') { throw 'Hedef veritabanı zaten var; hiçbir kaydı değiştirmemek için geri yükleme reddedildi.' }
$databaseContainerId = ((& docker compose ps -q database) -join '').Trim()
if ($LASTEXITCODE -ne 0 -or $databaseContainerId -cnotmatch '\A[0-9a-f]{12,64}\z') { throw 'Bu Compose projesinin tek çalışan veritabanı kapsayıcısı bulunamadı.' }

    $containerDirectory = ((& docker compose exec -T database mktemp -d /tmp/vigil-restore.XXXXXXXXXX) -join '').Trim()
    if ($LASTEXITCODE -ne 0 -or $containerDirectory -cnotmatch '\A/tmp/vigil-restore\.[A-Za-z0-9]{10}\z') { throw 'Kapsayıcıda güvenli geçici geri yükleme dizini oluşturulamadı.' }
    $containerDump = "$containerDirectory/database.dump"
    & docker cp $dumpPath "${databaseContainerId}:$containerDump"
    if ($LASTEXITCODE -ne 0) { throw 'Yedek dosyası kapsayıcıya kopyalanamadı.' }
    & docker compose exec -T database pg_restore --list $containerDump | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL arşivi okunamadı; veritabanı oluşturulmadı.' }
    & docker compose exec -T database createdb --username=vigil --no-password --maintenance-db=postgres --template=template0 --owner=vigil $TargetDatabase
    if ($LASTEXITCODE -ne 0) { throw 'Yeni geri yükleme veritabanı oluşturulamadı; mevcut hedefin üzerine yazılmaz.' }
    $createdTarget = $true
    & docker compose exec -T database pg_restore --username=vigil --dbname=$TargetDatabase --no-password --no-owner --no-privileges --single-transaction --exit-on-error $containerDump
    if ($LASTEXITCODE -ne 0) { throw 'Yeni kopyanın geri yüklemesi başarısız; bu veritabanı kabul edilmedi.' }

    # These fixed identifiers depend only on the validated supported schema.
    # A schema-11 copy is checked as schema 11 and is never upgraded here.
    $requiredTablesSql = "'vigil_product','schema_migrations','users','sessions','entities','risk_groups','memberships','membership_history','audit_events','source_connections','security_events','notifications','notification_reads','notification_settings','membership_event_evidence','membership_reviews'"
    if ($metadata.schemaVersion -eq 12) { $requiredTablesSql += ",'investigation_cases','case_history','case_event_evidence'" }
    $query = @"
SELECT json_build_object(
  'product', (SELECT name FROM public.vigil_product WHERE id=true),
  'schemaVersion', (SELECT COALESCE(max(version),0) FROM public.schema_migrations),
  'migrations', (SELECT COALESCE(json_agg(json_build_object('version',version,'checksum',checksum) ORDER BY version),'[]'::json) FROM public.schema_migrations),
  'hasForeignProduct', to_regclass('public.records') IS NOT NULL OR to_regclass('public.nexus_product') IS NOT NULL,
  'hasTrigram', EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_trgm'),
  'sessionCount', (SELECT count(*) FROM public.sessions),
  'missingTables', (SELECT COALESCE(json_agg(required.name),'[]'::json) FROM unnest(ARRAY[$requiredTablesSql]) AS required(name) WHERE to_regclass('public.' || required.name) IS NULL)
);
"@
    $result = & docker compose exec -T database psql --username=vigil --dbname=$TargetDatabase --no-password --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --command=$query
    if ($LASTEXITCODE -ne 0) { throw 'Geri yüklenen kopyanın ürün ve göç bilgileri okunamadı.' }
    $snapshot = (($result -join "`n").Trim()) | ConvertFrom-Json
    if ($snapshot.product -ne 'XLab Vigil' -or $snapshot.hasForeignProduct -ne $false -or $snapshot.hasTrigram -ne $true -or $snapshot.schemaVersion -ne $metadata.schemaVersion -or @($snapshot.missingTables).Count -ne 0 -or $snapshot.sessionCount -ne 0) { throw 'Geri yüklenen kopyanın ürün/şema/oturum kontrolü başarısız.' }
    $restoredLedger = @($snapshot.migrations)
    if ($restoredLedger.Count -ne $ledger.Count) { throw 'Geri yüklenen göç sayısı yedekle eşleşmiyor.' }
    for ($index = 0; $index -lt $ledger.Count; $index++) {
        if ($restoredLedger[$index].version -ne $ledger[$index].version -or $restoredLedger[$index].checksum -cne $ledger[$index].checksum) { throw 'Geri yüklenen göç defteri yedekle eşleşmiyor.' }
    }

    $reportRoot = Join-Path $projectRoot 'runtime/restore-reports'
    New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null
    $reportPath = Join-Path $reportRoot ($TargetDatabase + '-' + [Guid]::NewGuid().ToString('N') + '.json')
    $report = [ordered]@{ product = 'XLab Vigil'; validatedAtUtc = [DateTime]::UtcNow.ToString('o'); targetDatabase = $TargetDatabase; backupSha256 = $metadata.sha256; encrypted = [bool]$encrypted; schemaVersion = $snapshot.schemaVersion; migrations = $restoredLedger; sessionCount = $snapshot.sessionCount; validation = 'product_schema_and_archive_hash'; mainDatabaseChanged = $false }
    $reportBytes = [Text.Encoding]::UTF8.GetBytes(($report | ConvertTo-Json -Depth 8))
    $reportStream = [IO.File]::Open($reportPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $reportStream.Write($reportBytes, 0, $reportBytes.Length) } finally { $reportStream.Dispose() }
} catch {
    if ($createdTarget) { Write-Warning "Yeni $TargetDatabase veritabanı inceleme için korundu; başarısız kopya kullanılmamalıdır." }
    throw
} finally {
    $plaintextCleanupFailed = $false
    $containerCleanupFailed = $false
    if ($null -ne $ownedPassphrase) { $ownedPassphrase.Dispose() }
    if ($null -ne $plaintextDirectory) {
        try { Remove-VigilPrivateBackupDirectory -Path $plaintextDirectory -ParentDirectory $temporaryRoot }
        catch { $plaintextCleanupFailed = $true; Write-Warning "Bu çalışmanın kullanıcıya özel çözülmüş yedek dosyaları temizlenemedi: $plaintextDirectory" }
    }
    if ($null -ne $containerDirectory -and $containerDirectory -cmatch '\A/tmp/vigil-restore\.[A-Za-z0-9]{10}\z') {
        try {
            & docker compose exec -T database rm -f -- "$containerDirectory/database.dump" | Out-Null
            if ($LASTEXITCODE -ne 0) { $containerCleanupFailed = $true; Write-Warning "Kapsayıcıdaki geçici geri yükleme dosyası temizlenemedi: $containerDirectory/database.dump" }
        } catch { $containerCleanupFailed = $true; Write-Warning "Kapsayıcıdaki geçici geri yükleme dosyası temizlenemedi: $containerDirectory/database.dump" }
        try {
            & docker compose exec -T database rmdir -- $containerDirectory | Out-Null
            if ($LASTEXITCODE -ne 0) { $containerCleanupFailed = $true; Write-Warning "Kapsayıcıdaki geçici geri yükleme dizini temizlenemedi: $containerDirectory" }
        } catch { $containerCleanupFailed = $true; Write-Warning "Kapsayıcıdaki geçici geri yükleme dizini temizlenemedi: $containerDirectory" }
    }
    if ($plaintextCleanupFailed -or $containerCleanupFailed) { throw 'Geçici çözülmüş yedek temizlenemedi; geri yükleme tamamlanmış sayılmaz. Uyarıda belirtilen geçici dizini kontrol edin; ana veritabanı değiştirilmedi.' }
}
Write-Output "Ayrı geri yükleme kopyası doğrulandı: $TargetDatabase"
Write-Output "Doğrulama kaydı: $reportPath"
Write-Output 'Ana vigil veritabanı korunur; uygulama bu kopyaya geçirilmez ve kopya otomatik silinmez.'
