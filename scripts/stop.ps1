$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'common.ps1')
$identityPath = Join-Path $projectRoot 'runtime/server-process.json'
$pidPath = Join-Path $projectRoot 'runtime/server.pid'
if (-not (Test-Path -LiteralPath $identityPath)) {
    if (Test-Path -LiteralPath $pidPath) { throw 'Eski PID kaydında süreç başlangıç zamanı yok; güvenli otomatik durdurma yapılmadı. Süreci kendi terminalinden kapatın.' }
    Write-Output 'Kayıtlı Vigil süreci yok.'
    return
}
$identity = Get-Content -LiteralPath $identityPath -Raw -Encoding UTF8 | ConvertFrom-Json
$vigilProcessId = [int]$identity.pid
$vigilProcess = Get-Process -Id $vigilProcessId -ErrorAction SilentlyContinue
$expectedPath = [IO.Path]::GetFullPath((Join-Path $projectRoot 'runtime/vigil.exe'))
if ($vigilProcess) {
    $actualTicks = $vigilProcess.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
    if (-not [string]::Equals($vigilProcess.Path, $expectedPath, [StringComparison]::OrdinalIgnoreCase) -or -not [string]::Equals($identity.executable, $expectedPath, [StringComparison]::OrdinalIgnoreCase) -or [string]$identity.startedAtUtcTicks -cnotmatch '^[0-9]{1,19}$' -or $actualTicks -cne [string]$identity.startedAtUtcTicks) { throw 'PID, dosya yolu veya başlangıç zamanı eşleşmedi; hiçbir süreç durdurulmadı.' }
    Stop-Process -Id $vigilProcessId
    $vigilProcess.WaitForExit()
}
Remove-Item -LiteralPath $identityPath
if (Test-Path -LiteralPath $pidPath) { Remove-Item -LiteralPath $pidPath }
Write-Output 'XLab Vigil durduruldu; veritabanı korunuyor.'
