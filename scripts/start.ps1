param([switch]$Background)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath '.env')) { throw 'Önce scripts/setup.ps1 çalıştırın.' }
$line = Get-Content -LiteralPath '.env' | Where-Object { $_ -match '^VIGIL_DB_PASSWORD=' } | Select-Object -First 1
$databasePassword = $line.Substring('VIGIL_DB_PASSWORD='.Length)
$env:VIGIL_DATABASE_URL = "postgres://vigil:${databasePassword}@127.0.0.1:55440/vigil?sslmode=disable"
$env:VIGIL_ADDR = '127.0.0.1:8320'
docker compose up -d --wait
if ($LASTEXITCODE -ne 0) { throw 'Veritabanı başlatılamadı.' }
if (Get-NetTCPConnection -State Listen -LocalPort 8320 -ErrorAction SilentlyContinue) {
    try { $existing = Invoke-RestMethod -Uri 'http://127.0.0.1:8320/api/health' -TimeoutSec 3 } catch { throw '8320 portu kullanımda; uygulama başlatılmadı.' }
    if ($existing.product -eq 'XLab Vigil') { Write-Output 'XLab Vigil zaten çalışıyor: http://127.0.0.1:8320'; return }
    throw '8320 portu başka bir uygulama tarafından kullanılıyor.'
}
if ($Background) {
    $process = Start-Process -FilePath (Join-Path $projectRoot 'runtime/vigil.exe') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'runtime/server.out.log') -RedirectStandardError (Join-Path $projectRoot 'runtime/server.err.log') -PassThru
    Set-Content -LiteralPath 'runtime/server.pid' -Value $process.Id
    Write-Output "XLab Vigil: http://127.0.0.1:8320"
} else { & (Join-Path $projectRoot 'runtime/vigil.exe') }
