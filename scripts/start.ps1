param([switch]$Background, [ValidateRange(1024,65535)][int]$Port = 8320, [ValidateRange(1024,65535)][int]$DatabasePort = 55440)
if ($Port -eq $DatabasePort) { throw 'HTTP portu ve veritabanı portu farklı olmalıdır. Hiçbir ortam, süreç veya veritabanı işlemi yapılmadı.' }
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-VigilCommand 'docker'
Assert-VigilRuntime
$databasePassword = Get-VigilDatabasePassword
Invoke-VigilEnvironment @{ VIGIL_DATABASE_URL = "postgres://vigil:${databasePassword}@127.0.0.1:$DatabasePort/vigil?sslmode=disable"; VIGIL_ADDR = "127.0.0.1:$Port"; VIGIL_DB_PASSWORD = $databasePassword; VIGIL_DB_PORT = [string]$DatabasePort } {
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
    foreach ($listener in $listeners) {
        $existingProcess = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        if (-not $existingProcess -or -not [string]::Equals($existingProcess.Path, [IO.Path]::GetFullPath((Get-VigilExecutable)), [StringComparison]::OrdinalIgnoreCase)) { throw "$Port portu başka bir uygulama veya Vigil klasörü tarafından kullanılıyor." }
    }
    Wait-VigilReady $existingProcess 5 $Port
    Write-Output "Bu klasörün XLab Vigil uygulaması zaten hazır: http://127.0.0.1:$Port"
    return
}
Assert-VigilDatabaseConfiguration
docker compose up -d --wait
if ($LASTEXITCODE -ne 0) { throw 'Veritabanı başlatılamadı.' }
if ($Background) {
    $process = Start-Process -FilePath (Join-Path $projectRoot 'runtime/vigil.exe') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'runtime/server.out.log') -RedirectStandardError (Join-Path $projectRoot 'runtime/server.err.log') -PassThru
    try {
        Wait-VigilReady $process 30 $Port
        $identity = @{ pid = $process.Id; startedAtUtc = $process.StartTime.ToUniversalTime().ToString('o'); startedAtUtcTicks = $process.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture); executable = [IO.Path]::GetFullPath((Get-VigilExecutable)) }
        $identity | ConvertTo-Json | Set-Content -LiteralPath 'runtime/server-process.json' -Encoding UTF8
        Set-Content -LiteralPath 'runtime/server.pid' -Value $process.Id
    } catch { $process.Refresh(); if (-not $process.HasExited) { $process.Kill() }; throw }
    Write-Output "XLab Vigil hazır: http://127.0.0.1:$Port"
} else {
    & (Get-VigilExecutable)
    if ($LASTEXITCODE -ne 0) { throw 'Vigil başlatılamadı.' }
}
}
