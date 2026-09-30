$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $projectRoot 'runtime/server.pid'
if (-not (Test-Path -LiteralPath $pidPath)) { Write-Output 'Kayıtlı Vigil süreci yok.'; return }
$vigilProcessId = [int](Get-Content -LiteralPath $pidPath -Raw).Trim()
$vigilProcess = Get-Process -Id $vigilProcessId -ErrorAction SilentlyContinue
$expectedPath = [IO.Path]::GetFullPath((Join-Path $projectRoot 'runtime/vigil.exe'))
if ($vigilProcess) {
    if (-not [string]::Equals($vigilProcess.Path, $expectedPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Süreç kimliği başka bir uygulamaya ait; işlem durdurulmadı.' }
    Stop-Process -Id $vigilProcessId
}
Remove-Item -LiteralPath $pidPath
Write-Output 'XLab Vigil durduruldu; veritabanı korunuyor.'
