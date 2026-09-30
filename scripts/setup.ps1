$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath '.env')) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $databasePassword = [Convert]::ToHexString($bytes).ToLowerInvariant()
    Set-Content -LiteralPath '.env' -Value "VIGIL_DB_PASSWORD=$databasePassword" -Encoding utf8
    $account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe (Join-Path $projectRoot '.env') /inheritance:r /grant:r "${account}:(F)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Yerel ayar dosyasının izinleri kısıtlanamadı.' }
}
docker compose up -d --wait
if ($LASTEXITCODE -ne 0) { throw 'Veritabanı başlatılamadı.' }
Push-Location web
try {
    npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Arayüz bağımlılıkları yüklenemedi.' }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Arayüz derlenemedi.' }
} finally { Pop-Location }
New-Item -ItemType Directory -Path runtime -Force | Out-Null
go build -o runtime/vigil.exe ./cmd/vigil
if ($LASTEXITCODE -ne 0) { throw 'Uygulama derlenemedi.' }
Write-Output 'XLab Vigil hazır. Başlatmak için scripts/start.ps1 çalıştırın.'
