$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
. (Join-Path $PSScriptRoot 'common.ps1')
foreach ($command in @('docker', 'go', 'node', 'npm.cmd')) { Assert-VigilCommand $command }
Assert-VigilStopped
Push-Location web
try {
    npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Arayüz bağımlılıkları yüklenemedi.' }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Arayüz derlenemedi.' }
} finally { Pop-Location }
New-Item -ItemType Directory -Path runtime -Force | Out-Null
go build -trimpath -o runtime/vigil.exe ./cmd/vigil
if ($LASTEXITCODE -ne 0) { throw 'Uygulama derlenemedi.' }
go build -trimpath -o runtime/vigil-backup.exe ./cmd/vigil-backup
if ($LASTEXITCODE -ne 0) { throw 'Yedek şifreleme aracı derlenemedi.' }
& (Join-Path $PSScriptRoot 'install.ps1')
