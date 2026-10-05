$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
if (-not (Test-Path -LiteralPath (Join-Path (Get-VigilProjectRoot) 'manifest.json'))) { throw 'Bu klasörde teslim manifesti yok.' }
Assert-VigilRuntime
Write-Output 'Paket manifesti, zorunlu dosyalar ve SHA-256 değerleri doğrulandı.'
