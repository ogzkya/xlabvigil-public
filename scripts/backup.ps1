param(
    [string]$OutputDirectory,
    [Security.SecureString]$Passphrase,
    [switch]$Unencrypted
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'backup-crypto.ps1')
Assert-VigilPackage

if ($Unencrypted -and $PSBoundParameters.ContainsKey('Passphrase')) { throw '-Unencrypted ile -Passphrase birlikte kullanılamaz; veritabanına erişilmedi.' }
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Bu yedekleme betiği Windows dosya izinlerini gerektirir.' }

$projectRoot = Get-VigilProjectRoot
Set-Location -LiteralPath $projectRoot
$null = Get-VigilDatabasePassword
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker bulunamadı.' }
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = Join-Path $projectRoot 'runtime/backups' }
if (-not [IO.Path]::IsPathRooted($OutputDirectory)) { $OutputDirectory = Join-Path $projectRoot $OutputDirectory }
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
if ($outputRoot.StartsWith('\\')) { throw 'Bu yerel akış UNC/ağ paylaşımına yedek yazmaz; yerel bir dizin seçin.' }

function Get-VigilBackupSnapshot {
    $query = @'
SELECT json_build_object(
  'product', (SELECT name FROM public.vigil_product WHERE id=true),
  'schemaVersion', (SELECT COALESCE(max(version),0) FROM public.schema_migrations),
  'migrations', (SELECT COALESCE(json_agg(json_build_object('version',version,'checksum',checksum) ORDER BY version),'[]'::json) FROM public.schema_migrations),
  'postgresVersion', current_setting('server_version'),
  'hasForeignProduct', to_regclass('public.records') IS NOT NULL OR to_regclass('public.nexus_product') IS NOT NULL,
  'hasTrigram', EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_trgm'),
  'missingTables', (SELECT COALESCE(json_agg(required.name),'[]'::json) FROM unnest(ARRAY['vigil_product','schema_migrations','users','sessions','entities','risk_groups','memberships','membership_history','audit_events','source_connections','security_events','notifications','notification_reads','notification_settings','membership_event_evidence','membership_reviews','investigation_cases','case_history','case_event_evidence']) AS required(name) WHERE to_regclass('public.' || required.name) IS NULL)
);
'@
    $result = & docker compose exec -T database psql --username=vigil --dbname=vigil --no-password --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --command=$query
    if ($LASTEXITCODE -ne 0) { throw 'Vigil veritabanının ürün ve göç bilgileri okunamadı. Önce uygulamayı başlatıp göçleri tamamlayın.' }
    $snapshot = (($result -join "`n").Trim()) | ConvertFrom-Json
    if ($snapshot.product -ne 'XLab Vigil' -or $snapshot.hasForeignProduct -ne $false) { throw 'Veritabanının bağımsız XLab Vigil ürünü olduğu doğrulanamadı.' }
    $ledger = @($snapshot.migrations)
    if ($snapshot.schemaVersion -ne 12 -or $ledger.Count -ne 12 -or @($snapshot.missingTables).Count -ne 0 -or $snapshot.hasTrigram -ne $true) { throw 'Yedekleme için Vigil göç 1–12 ve gerekli tablolar/pg_trgm tamamlanmış olmalıdır.' }
    for ($index = 0; $index -lt $ledger.Count; $index++) {
        if ($ledger[$index].version -ne ($index + 1) -or $ledger[$index].checksum -cnotmatch '\A[0-9a-f]{64}\z') { throw 'Göç defteri kesintili veya geçersiz.' }
    }
    return $snapshot
}

$containerDirectory = $null
$plaintextDirectory = $null
$ownedPassphrase = $null
$temporaryRoot = Join-Path $projectRoot 'runtime'
$cryptoExecutable = Join-Path $temporaryRoot 'vigil-backup.exe'
try {
if (-not $Unencrypted) {
    if (-not (Test-Path -LiteralPath $cryptoExecutable -PathType Leaf)) { throw 'Şifreli yedek aracı bulunamadı. Önce kaynak depoda setup.ps1 veya teslim paketinde install.ps1 çalıştırın.' }
    $ownedPassphrase = Get-VigilBackupPassphrase -Passphrase $Passphrase -Confirm
}
$snapshot = Get-VigilBackupSnapshot
$databaseContainerId = ((& docker compose ps -q database) -join '').Trim()
if ($LASTEXITCODE -ne 0 -or $databaseContainerId -cnotmatch '\A[0-9a-f]{12,64}\z') { throw 'Bu Compose projesinin tek çalışan veritabanı kapsayıcısı bulunamadı.' }
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$packageName = 'vigil-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N')
$backupDirectory = Join-Path $outputRoot $packageName
$null = New-VigilPrivateBackupDirectory $backupDirectory
$plainRoot = $backupDirectory
if (-not $Unencrypted) {
    New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
    $plaintextDirectory = New-VigilPrivateBackupDirectory (Join-Path $temporaryRoot ('vigil-backup-plaintext-' + [Guid]::NewGuid().ToString('N')))
    $plainRoot = $plaintextDirectory
}
    $containerDirectory = ((& docker compose exec -T database mktemp -d /tmp/vigil-backup.XXXXXXXXXX) -join '').Trim()
    if ($LASTEXITCODE -ne 0 -or $containerDirectory -cnotmatch '\A/tmp/vigil-backup\.[A-Za-z0-9]{10}\z') { throw 'Kapsayıcıda güvenli geçici yedek dizini oluşturulamadı.' }
    $containerDump = "$containerDirectory/database.dump"
    & docker compose exec -T database pg_dump --username=vigil --dbname=vigil --no-password --format=custom --exclude-table-data=public.sessions --file=$containerDump
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL yedeği oluşturulamadı.' }
    & docker compose exec -T database pg_restore --list $containerDump | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Oluşturulan PostgreSQL arşivi okunamıyor.' }

    $partialPath = Join-Path $plainRoot 'database.dump.partial'
    $dumpPath = Join-Path $plainRoot 'database.dump'
    & docker cp "${databaseContainerId}:$containerDump" $partialPath
    if ($LASTEXITCODE -ne 0) { throw 'Yedek dosyası Windows dizinine kopyalanamadı.' }
    if (-not (Test-Path -LiteralPath $partialPath -PathType Leaf) -or (Get-Item -LiteralPath $partialPath).Length -le 0) { throw 'Kopyalanan yedek boş veya eksik.' }
    Move-Item -LiteralPath $partialPath -Destination $dumpPath
    $metadata = [ordered]@{
        formatVersion = 1
        product = 'XLab Vigil'
        createdAtUtc = [DateTime]::UtcNow.ToString('o')
        sourceDatabase = 'vigil'
        postgresVersion = $snapshot.postgresVersion
        format = 'postgresql-custom'
        dumpFile = 'database.dump'
        dumpBytes = (Get-Item -LiteralPath $dumpPath).Length
        sha256 = (Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256).Hash.ToLowerInvariant()
        schemaVersion = $snapshot.schemaVersion
        migrations = @($snapshot.migrations)
        sessionDataIncluded = $false
    }
    $metadataPath = Join-Path $plainRoot 'metadata.json'
    $metadataBytes = [Text.Encoding]::UTF8.GetBytes(($metadata | ConvertTo-Json -Depth 8))
    $metadataStream = [IO.File]::Open($metadataPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $metadataStream.Write($metadataBytes, 0, $metadataBytes.Length) } finally { $metadataStream.Dispose() }
    if (-not $Unencrypted) {
        $ciphertextPath = Join-Path $backupDirectory 'backup.age'
        Invoke-VigilBackupCrypto -Executable $cryptoExecutable -Arguments @('encrypt', '--source-dir', $plaintextDirectory, '--output', $ciphertextPath) -Passphrase $ownedPassphrase
        if (-not (Test-Path -LiteralPath $ciphertextPath -PathType Leaf) -or (Get-Item -LiteralPath $ciphertextPath).Length -le 0) { throw 'Şifreli yedek dosyası boş veya eksik.' }
    }
} finally {
    $plaintextCleanupFailed = $false
    $containerCleanupFailed = $false
    if ($null -ne $ownedPassphrase) { $ownedPassphrase.Dispose() }
    if ($null -ne $plaintextDirectory) {
        try { Remove-VigilPrivateBackupDirectory -Path $plaintextDirectory -ParentDirectory $temporaryRoot }
        catch { $plaintextCleanupFailed = $true; Write-Warning "Bu çalışmanın kullanıcıya özel açık yedek dosyaları temizlenemedi: $plaintextDirectory" }
    }
    if ($null -ne $containerDirectory -and $containerDirectory -cmatch '\A/tmp/vigil-backup\.[A-Za-z0-9]{10}\z') {
        try {
            & docker compose exec -T database rm -f -- "$containerDirectory/database.dump" | Out-Null
            if ($LASTEXITCODE -ne 0) { $containerCleanupFailed = $true; Write-Warning "Kapsayıcıdaki geçici yedek dosyası temizlenemedi: $containerDirectory/database.dump" }
        } catch { $containerCleanupFailed = $true; Write-Warning "Kapsayıcıdaki geçici yedek dosyası temizlenemedi: $containerDirectory/database.dump" }
        try {
            & docker compose exec -T database rmdir -- $containerDirectory | Out-Null
            if ($LASTEXITCODE -ne 0) { $containerCleanupFailed = $true; Write-Warning "Kapsayıcıdaki geçici yedek dizini temizlenemedi: $containerDirectory" }
        } catch { $containerCleanupFailed = $true; Write-Warning "Kapsayıcıdaki geçici yedek dizini temizlenemedi: $containerDirectory" }
    }
    if ($plaintextCleanupFailed -or $containerCleanupFailed) { throw 'Geçici açık yedek temizlenemedi; yedek dosyası oluşturulmuş olsa da yedekleme tamamlanmış sayılmaz. Uyarıda belirtilen geçici dizini kontrol edin.' }
}
if ($Unencrypted) {
    Write-Output "Şifresiz Vigil yedeği hazır: $backupDirectory"
    Write-Output 'Açık -Unencrypted seçimi kullanıldı. database.dump ve metadata.json birlikte saklanmalıdır; oturum verileri yedeğe dahil edilmez.'
} else {
    Write-Output "Şifreli Vigil yedeği hazır: $backupDirectory"
    Write-Output 'Yedek yalnızca backup.age dosyasındadır. Geri yüklemede aynı parola gerekir; parola bu dosyanın yanında saklanmamalıdır. Oturum verileri dahil edilmez.'
}
