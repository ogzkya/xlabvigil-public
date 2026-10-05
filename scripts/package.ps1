$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$projectRoot = Get-VigilProjectRoot
Set-Location -LiteralPath $projectRoot
# A release is always checked. Neither .env nor a user's database is packaged.
& (Join-Path $PSScriptRoot 'check.ps1')
$version = (Get-Content -LiteralPath 'web/package.json' -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Paket sürümü geçersiz.' }
$releaseRoot = Join-Path $projectRoot 'runtime/releases'
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
$name = "xlab-vigil-$version-windows-amd64-" + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,6)
$staging = Join-Path $releaseRoot $name
foreach ($directory in @('runtime', 'web/dist', 'scripts', 'docs')) { New-Item -ItemType Directory -Path (Join-Path $staging $directory) -Force | Out-Null }
Invoke-VigilEnvironment @{ GOOS = 'windows'; GOARCH = 'amd64'; GOCACHE = (Join-Path $projectRoot 'runtime/go-cache') } {
    go build -trimpath -o (Join-Path $staging 'runtime/vigil.exe') ./cmd/vigil
    if ($LASTEXITCODE -ne 0) { throw 'Teslim uygulaması derlenemedi.' }
    go build -trimpath -o (Join-Path $staging 'runtime/vigil-backup.exe') ./cmd/vigil-backup
    if ($LASTEXITCODE -ne 0) { throw 'Teslim yedek şifreleme aracı derlenemedi.' }
}
Push-Location web
try {
    npm.cmd run build -- --outDir (Join-Path $staging 'web/dist')
    if ($LASTEXITCODE -ne 0) { throw 'Teslim arayüzü derlenemedi.' }
} finally { Pop-Location }
foreach ($script in @('common.ps1','install.ps1','start.ps1','stop.ps1','backup.ps1','backup-crypto.ps1','restore-copy.ps1','verify-package.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $script) -Destination (Join-Path $staging "scripts/$script")
}
Copy-Item -LiteralPath 'README.md','compose.yaml' -Destination $staging
foreach ($document in @('YEREL-TESLIM.md','KULLANIM.md','YEDEKLEME.md','PILOT.md','API-CONTRACT.md','TASARIM-DILI.md','DEVIR.md','ENTEGRASYON-ARASTIRMASI.md','THIRD-PARTY-NOTICES.txt')) { Copy-Item -LiteralPath (Join-Path $projectRoot "docs/$document") -Destination (Join-Path $staging 'docs') }
$files = @(Get-ChildItem -LiteralPath $staging -Recurse -File | Sort-Object FullName | ForEach-Object {
    [ordered]@{ path = $_.FullName.Substring($staging.Length + 1).Replace('\','/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
$events = @(Get-Content -LiteralPath 'runtime/qa/go-tests.jsonl' -Encoding UTF8 | ForEach-Object { $_ | ConvertFrom-Json })
$testCount = @($events | Where-Object { $_.Action -eq 'pass' -and $_.Test -and $_.Test -notmatch '/' }).Count
$manifest = [ordered]@{ format = 1; product = 'XLab Vigil'; version = $version; platform = 'windows-amd64'; mode = 'local-development'; builtAtUtc = [DateTime]::UtcNow.ToString('o'); schemaVersion = 12; goTestsPassed = $testCount; goTestsSkipped = 0; verification = 'isolated-postgresql-go-vet-frontend-build'; files = $files }
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $staging 'manifest.json') -Encoding UTF8
& (Join-Path $staging 'scripts/verify-package.ps1')
$archive = Join-Path $releaseRoot ($name + '.zip')
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open($archive, [IO.Compression.ZipArchiveMode]::Create)
try {
    # Explicit entry names keep PS 5.1/.NET Framework ZIP paths portable and
    # identical to the manifest's forward-slash paths.
    foreach ($entry in $files) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $staging $entry.path), $entry.path, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $staging 'manifest.json'), 'manifest.json', [IO.Compression.CompressionLevel]::Optimal) | Out-Null
} finally { $zip.Dispose() }
$archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath ($archive + '.sha256') -Value ($archiveHash + '  ' + [IO.Path]::GetFileName($archive)) -Encoding UTF8
Write-Output "Teslim paketi: $archive"
Write-Output "SHA-256: $archiveHash"
