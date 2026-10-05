# Shared by source checkouts and the standalone package (PowerShell 5.1+).
function Get-VigilProjectRoot { Split-Path -Parent $PSScriptRoot }
function Get-VigilDatabasePassword {
    $settingsPath = Join-Path (Get-VigilProjectRoot) '.env'
    if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) { throw 'Yerel ayar dosyası yok. Önce scripts/install.ps1 çalıştırın.' }
    $entries = @(Get-Content -LiteralPath $settingsPath -Encoding UTF8 | Where-Object { $_ -match '^VIGIL_DB_PASSWORD=' })
    if ($entries.Count -ne 1 -or $entries[0] -notmatch '^VIGIL_DB_PASSWORD=([a-fA-F0-9]{64})$') { throw '.env içinde tek bir VIGIL_DB_PASSWORD ve 64 haneli hexadecimal parola bulunmalıdır. Mevcut dosya değiştirilmedi.' }
    $entries[0].Substring('VIGIL_DB_PASSWORD='.Length)
}
function New-VigilRandomSecret {
    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}
function Initialize-VigilLocalEnvironment {
    $settingsPath = Join-Path (Get-VigilProjectRoot) '.env'
    if (-not (Test-Path -LiteralPath $settingsPath)) {
        $content = 'VIGIL_DB_PASSWORD=' + (New-VigilRandomSecret) + [Environment]::NewLine
        $stream = [IO.File]::Open($settingsPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $encoded = (New-Object Text.UTF8Encoding($false)).GetBytes($content); $stream.Write($encoded, 0, $encoded.Length) } finally { $stream.Dispose() }
        $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        & icacls.exe $settingsPath /inheritance:r /grant:r "${account}:(F)" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Yerel ayar dosyasının izinleri kısıtlanamadı.' }
    }
    Get-VigilDatabasePassword | Out-Null
}
function Assert-VigilCommand([string]$Name) { if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "Gerekli araç bulunamadı: $Name" } }
function Invoke-VigilEnvironment([hashtable]$Values, [scriptblock]$Action) {
    $previous = @{}
    try {
        foreach ($key in $Values.Keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process'); [Environment]::SetEnvironmentVariable($key, $Values[$key], 'Process') }
        & $Action
    } finally { foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') } }
}
function Get-VigilExecutable { Join-Path (Get-VigilProjectRoot) 'runtime/vigil.exe' }
function Assert-VigilStopped {
    $expectedPath = [IO.Path]::GetFullPath((Get-VigilExecutable))
    foreach ($process in @(Get-Process -Name vigil -ErrorAction SilentlyContinue)) {
        if ([string]::Equals($process.Path, $expectedPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Bu klasörün Vigil uygulaması çalışıyor. Önce scripts/stop.ps1 ile durdurun; çalışan dosyalar güncellenmedi.' }
    }
}
function Assert-VigilPackage {
    $projectRoot = Get-VigilProjectRoot
    $manifestPath = Join-Path $projectRoot 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) { return }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.product -ne 'XLab Vigil' -or $manifest.format -ne 1 -or @($manifest.files).Count -eq 0) { throw 'Paket manifesti geçersiz.' }
    $rootPrefix = [IO.Path]::GetFullPath($projectRoot) + [IO.Path]::DirectorySeparatorChar
    $seen = @{}
    foreach ($entry in $manifest.files) {
        $relative = [string]$entry.path
        $target = [IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
        if ([IO.Path]::IsPathRooted($relative) -or -not $target.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or $seen.ContainsKey($target)) { throw 'Manifest dosya yolu geçersiz.' }
        $seen[$target] = $true
        if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Paket dosyası eksik veya değişmiş: $relative" }
    }
    foreach ($required in @('runtime/vigil.exe', 'web/dist/index.html', 'compose.yaml', 'scripts/start.ps1', 'scripts/install.ps1', 'scripts/common.ps1')) {
        if (-not $seen.ContainsKey([IO.Path]::GetFullPath((Join-Path $projectRoot $required)))) { throw "Manifest zorunlu dosyayı içermiyor: $required" }
    }
    if ([version]$manifest.version -ge [version]'1.1.0') {
        foreach ($required in @('runtime/vigil-backup.exe', 'scripts/backup.ps1', 'scripts/backup-crypto.ps1', 'scripts/restore-copy.ps1', 'docs/THIRD-PARTY-NOTICES.txt')) {
            if (-not $seen.ContainsKey([IO.Path]::GetFullPath((Join-Path $projectRoot $required)))) { throw "Manifest zorunlu yedek dosyasını içermiyor: $required" }
        }
    }
}
function Assert-VigilRuntime {
    foreach ($path in @((Get-VigilExecutable), (Join-Path (Get-VigilProjectRoot) 'web/dist/index.html'))) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Uygulama dosyaları eksik. Kaynak depoda setup.ps1, teslim paketinde install.ps1 kullanın.' }
    }
    Assert-VigilPackage
}
function Assert-VigilDatabaseConfiguration {
    $password = Get-VigilDatabasePassword
    $containerId = ((& docker compose ps -a -q database) -join '').Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Mevcut veritabanı kimliği okunamadı.' }
    if (-not $containerId) { return }
    if ($containerId -notmatch '^[a-f0-9]{12,64}$') { throw 'Tek bir veritabanı kapsayıcısı bekleniyor.' }
    $settings = ((& docker inspect --format '{{json .Config.Env}}' $containerId) -join '') | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or @($settings | Where-Object { $_ -ceq ('POSTGRES_PASSWORD=' + $password) }).Count -ne 1) { throw 'Mevcut PostgreSQL ile .env parolası eşleşmiyor. Eski kurulumun .env dosyasını koruyun; veritabanı değiştirilmedi.' }
    $labelsJson = (& docker inspect --format '{{json .Config.Labels}}' $containerId) -join ''
    if ($LASTEXITCODE -ne 0) { throw 'Veritabanı klasör sahipliği okunamadı.' }
    $labels = $labelsJson | ConvertFrom-Json
    $workingDirectory = [string]$labels.'com.docker.compose.project.working_dir'
    try {
        if ($workingDirectory -notmatch '^[a-zA-Z]:[\\/]') { throw 'Çalışma klasörü mutlak yerel Windows yolu değil.' }
        $previousRoot = [IO.Path]::GetFullPath($workingDirectory)
        $currentRoot = [IO.Path]::GetFullPath((Get-VigilProjectRoot))
    } catch { throw 'Veritabanının eski klasör kimliği doğrulanamadı; veritabanı değiştirilmedi.' }
    $separators = [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    if ([string]::Equals($previousRoot.TrimEnd($separators), $currentRoot.TrimEnd($separators), [StringComparison]::OrdinalIgnoreCase)) { return }
    try {
        $previousDirectory = Get-Item -LiteralPath $previousRoot -Force -ErrorAction Stop
        if (-not $previousDirectory.PSIsContainer -or $previousDirectory.PSProvider.Name -ne 'FileSystem') { throw 'Eski klasör okunabilir bir dosya sistemi dizini değil.' }
        $previousExecutable = [IO.Path]::GetFullPath((Join-Path $previousRoot 'runtime/vigil.exe'))
    } catch { throw 'Veritabanının eski klasör kimliği okunamadı; veritabanı değiştirilmedi.' }
    try { $vigilProcesses = @(Get-Process -Name vigil -ErrorAction Stop) }
    catch {
        if ($_.FullyQualifiedErrorId -notlike 'NoProcessFoundForGivenName,*') { throw 'Çalışan Vigil süreçlerinin kimliği okunamadı; veritabanı değiştirilmedi.' }
        $vigilProcesses = @()
    }
    foreach ($vigilProcess in $vigilProcesses) {
        try {
            $processPath = [string]$vigilProcess.Path
            if ($processPath -notmatch '^[a-zA-Z]:[\\/]') { throw 'Süreç dosya yolu okunamadı.' }
            $processPath = [IO.Path]::GetFullPath($processPath)
        } catch { throw 'Bir Vigil sürecinin dosya kimliği doğrulanamadı; veritabanı değiştirilmedi.' }
        if ([string]::Equals($processPath, $previousExecutable, [StringComparison]::OrdinalIgnoreCase)) { throw 'Bu veritabanının eski klasöründeki Vigil süreci çalışıyor. Güncellemeden önce kendi klasöründe durdurun; veritabanı değiştirilmedi.' }
    }
}
function Wait-VigilReady([Diagnostics.Process]$Process, [int]$TimeoutSeconds = 30, [int]$Port = 8320) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $Process.Refresh()
        if ($Process.HasExited) { throw 'Vigil başlangıç sırasında kapandı. runtime/server.err.log dosyasını inceleyin.' }
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
            $page = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2
            $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
            if ($health.product -eq 'XLab Vigil' -and $health.status -eq 'ok' -and $page.StatusCode -eq 200 -and $page.Content -match '<div id="root"' -and @($listener | Where-Object OwningProcess -eq $Process.Id).Count -gt 0) { return }
        } catch { }
        Start-Sleep -Milliseconds 300
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Vigil belirtilen sürede hazır olmadı. runtime/server.err.log dosyasını inceleyin.'
}
