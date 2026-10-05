param([ValidateRange(1024,65535)][int]$DatabasePort = 55440)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location -LiteralPath (Get-VigilProjectRoot)
Assert-VigilCommand 'docker'
Assert-VigilRuntime
Initialize-VigilLocalEnvironment
Invoke-VigilEnvironment @{ VIGIL_DB_PASSWORD = (Get-VigilDatabasePassword); VIGIL_DB_PORT = [string]$DatabasePort } {
    Assert-VigilDatabaseConfiguration
    docker compose up -d --wait
    if ($LASTEXITCODE -ne 0) { throw 'Veritabanı başlatılamadı. Docker Desktop ve veritabanı portunu kontrol edin.' }
}
Write-Output 'XLab Vigil kuruldu. scripts/start.ps1 -Background ile başlatın; ilk yöneticiyi uygulamada oluşturun.'
